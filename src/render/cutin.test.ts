/**
 * カットインの待ち行列（`cutin.ts`）。
 *
 * 見た目は測れないが、**溜まらないこと**と**消えないこと**は測れる。
 * どちらも崩れると静かに壊れる —— 前者は数秒遅れの通知が流れ続け、
 * 後者は「ボスが湧いたのに気づかない」になる。
 */
import { describe, expect, it } from 'vitest';
import { CutInQueue, CUTIN_STYLES, cutInSpeed, type CutIn } from './cutin';

const boss: CutIn = { kind: 'boss', title: 'ボス' };
const phase: CutIn = { kind: 'phase', title: 'フェーズ' };
const danger: CutIn = { kind: 'danger', title: '危機' };

describe('待ち行列', () => {
  it('積んだものがすぐ出る', () => {
    const queue = new CutInQueue();
    expect(queue.active('full')).toBeNull();
    queue.push(boss);
    expect(queue.active('full')?.cutIn).toBe(boss);
    expect(queue.active('full')?.t).toBe(0);
  });

  it('時間が経つと終わる', () => {
    const queue = new CutInQueue();
    queue.push(boss);
    queue.advance(CUTIN_STYLES.boss.durationMs + 1, 'full');
    expect(queue.active('full')).toBeNull();
  });

  it('同じ種類が続いたら差し替える（列を伸ばさない）', () => {
    // ボスが 2 体同時に湧く盤面がある。並べると、2 体目の通知が
    // 1.5 秒遅れて出ることになり、そのころには状況が変わっている
    const queue = new CutInQueue();
    queue.push(boss);
    queue.advance(500, 'full');
    const second: CutIn = { kind: 'boss', title: '2 体目' };
    queue.push(second);
    expect(queue.size).toBe(1);
    expect(queue.active('full')?.cutIn).toBe(second);
    expect(queue.active('full')?.t).toBe(0); // 頭から出し直す
  });

  it('控えは 1 つまで（3 つ目は捨てる）', () => {
    const queue = new CutInQueue();
    queue.push(boss);
    queue.push(phase);
    queue.push(danger);
    expect(queue.size).toBe(2);
    // 出るのは最初の 1 つと、最後に積んだ 1 つ
    expect(queue.active('full')?.cutIn).toBe(boss);
    queue.advance(CUTIN_STYLES.boss.durationMs + 1, 'full');
    expect(queue.active('full')?.cutIn).toBe(danger);
  });

  it('控えていたものは、前のが終わってから出る', () => {
    const queue = new CutInQueue();
    queue.push(boss);
    queue.push(phase);
    queue.advance(CUTIN_STYLES.boss.durationMs - 10, 'full');
    expect(queue.active('full')?.cutIn).toBe(boss);
    queue.advance(20, 'full');
    expect(queue.active('full')?.cutIn).toBe(phase);
    expect(queue.active('full')?.t).toBe(0);
  });

  it('空のまま進めても壊れない', () => {
    const queue = new CutInQueue();
    queue.advance(5000, 'full');
    expect(queue.active('full')).toBeNull();
    expect(queue.size).toBe(0);
  });
});

describe('演出の強さ', () => {
  it('弱くすると短くなるが、消えはしない', () => {
    // カットインは点滅ではなく**情報**。消すと
    // 「ボスが湧いたのに気づかない」が起きる（06-ui-ux.md 6.7）
    expect(cutInSpeed('full')).toBe(1);
    expect(cutInSpeed('reduced')).toBeLessThan(cutInSpeed('full'));
    expect(cutInSpeed('minimal')).toBeLessThan(cutInSpeed('reduced'));
    expect(cutInSpeed('minimal')).toBeGreaterThan(0);
  });

  it('最小でも表示はされる', () => {
    const queue = new CutInQueue();
    queue.push(boss);
    expect(queue.active('minimal')).not.toBeNull();
  });

  it('最小のほうが早く終わる', () => {
    const short = new CutInQueue();
    short.push(boss);
    short.advance(CUTIN_STYLES.boss.durationMs * 0.7, 'minimal');
    expect(short.active('minimal')).toBeNull();

    const long = new CutInQueue();
    long.push(boss);
    long.advance(CUTIN_STYLES.boss.durationMs * 0.7, 'full');
    expect(long.active('full')).not.toBeNull();
  });
});

describe('見た目の指定', () => {
  it('全種類に色と長さがある', () => {
    for (const kind of ['special', 'solo', 'boss', 'phase', 'danger'] as const) {
      const style = CUTIN_STYLES[kind];
      expect(style.durationMs, kind).toBeGreaterThan(0);
      // 1.6 秒を超えると、盤面を止めずに出す演出としては長すぎる
      expect(style.durationMs, kind).toBeLessThanOrEqual(1600);
      expect(style.from, kind).toMatch(/^#[0-9a-f]{6}$/);
      expect(style.to, kind).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it('ボスは味方の演出と違う色にする', () => {
    // 同じ色にすると、「良いことが起きた」のか「まずいことが起きた」のかが
    // 一瞬で読めない
    expect(CUTIN_STYLES.boss.from).not.toBe(CUTIN_STYLES.special.from);
    expect(CUTIN_STYLES.boss.from).not.toBe(CUTIN_STYLES.solo.from);
  });
});
