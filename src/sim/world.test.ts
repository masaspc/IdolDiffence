import { describe, expect, it } from 'vitest';
import { createWorld } from './world';
import { runHeadless, FIXED_STEP_MS } from '../core/loop';
import { autoplay } from './autoplay';
import { STAGE_PLANS } from '../balance/plans';
import { balanceMeta } from '../balance/investment';

const SEED = 20260816;

describe('BattleWorld', () => {
  it('ステージと楽曲を読み込める', () => {
    const world = createWorld('S1', SEED);
    // 名前そのものではなく「ステージと楽曲がつながっていること」を見る。
    // 名前で固定すると、原作に合わせて言い回しを直すたびに落ちる
    expect(world.stage.name.length).toBeGreaterThan(0);
    expect(world.song.name).toBe('Reply');
    expect(world.song.bpm).toBe(132);
  });

  it('未知のステージは例外', () => {
    expect(() => createWorld('S999', SEED)).toThrow();
  });

  it('開始時の声援と観客ゲージ', () => {
    const snap = createWorld('S1', SEED).snapshot();
    expect(snap.cheer).toBe(150);
    expect(snap.audience).toBe(100);
    expect(snap.voltage).toBe(0);
  });

  it('声援が時間とともに増える', () => {
    const world = createWorld('S1', SEED);
    const before = world.snapshot().cheer;
    runHeadless(1000, (dt) => world.update(dt));
    const after = world.snapshot().cheer;
    // 満タン時 6.0/秒
    expect(after - before).toBeGreaterThanOrEqual(5);
    expect(after - before).toBeLessThanOrEqual(7);
  });

  it('声援は負にならない', () => {
    const world = createWorld('S1', SEED);
    world.addCheer(-10000);
    expect(world.snapshot().cheer).toBe(0);
  });

  it('足りない声援は消費できない', () => {
    const world = createWorld('S1', SEED);
    expect(world.spendCheer(1000)).toBe(false);
    expect(world.snapshot().cheer).toBe(150);
    expect(world.spendCheer(30)).toBe(true);
    expect(world.snapshot().cheer).toBe(120);
  });

  it('ウェーブの境目で sectionChanged が発火する', () => {
    // 宣言と購読だけあって発火する者がいなかったイベント。
    // サビのコメント（M5-11）とサビ突入のリング（M5-17）がこれを待っている
    const world = createWorld('S1', SEED);
    const seen: { index: number; section: string }[] = [];
    world.events.on('sectionChanged', (e) => seen.push(e));
    // S1 を頭から 1 分回せば、イントロの次のウェーブには必ず入る
    runHeadless(60_000, (dt) => world.update(dt));
    expect(seen.length).toBeGreaterThan(0);
    // 最初のウェーブ（index 0）では出さない。開始の合図は battleStart の仕事
    expect(seen[0]?.index).toBeGreaterThan(0);
    // 同じウェーブで二度は出ない
    expect(new Set(seen.map((e) => e.index)).size).toBe(seen.length);
  });

  it('月華ゲージが小節ごとに溜まり、100 を超えない', () => {
    const world = createWorld('S1', SEED);
    runHeadless(10_000, (dt) => world.update(dt));
    const snap = world.snapshot();
    expect(snap.voltage).toBeGreaterThan(0);
    expect(snap.voltage).toBeLessThanOrEqual(100);

    world.addVoltage(1000);
    expect(world.snapshot().voltage).toBe(100);
  });

  it('観客ゲージが 0 になるとライブ中断', () => {
    const world = createWorld('S1', SEED);
    world.leakAudience(100);
    const snap = world.snapshot();
    expect(snap.audience).toBe(0);
    expect(snap.finished).toBe(true);
    expect(snap.won).toBe(false);
  });

  it('観客ゲージは 0 を下回らない', () => {
    const world = createWorld('S1', SEED);
    world.leakAudience(9999);
    expect(world.snapshot().audience).toBe(0);
  });

  it('ウェーブがセクションの順に進む', () => {
    const world = createWorld('S1', SEED);
    expect(world.currentWave?.section).toBe('intro');
    expect(world.currentWave?.startBar).toBe(0);

    // イントロは 8 小節。1 小節 = 4 拍 / 132BPM ≒ 1818ms
    const msPerBar = world.clock.msPerBar;
    runHeadless(msPerBar * 8 + FIXED_STEP_MS, (dt) => world.update(dt));
    expect(world.currentWave?.section).toBe('verse');
  });

  it('迎撃しなければ観客が尽きて終了する', () => {
    // 完走できるケースは battle.test.ts の「経路沿いに置けば完走できる」で見る
    const world = createWorld('S1', SEED);
    const { snapshot } = autoplay(world);
    expect(snapshot.finished).toBe(true);
    expect(snapshot.won).toBe(false);
  });

  it('同じ seed なら同じ結果になる（決定性）', () => {
    const run = (): string => {
      const world = createWorld('S1', SEED);
      runHeadless(30_000, (dt) => world.update(dt));
      return JSON.stringify(world.snapshot());
    };
    expect(run()).toBe(run());
  });
});

/**
 * 段階解放（06-ui-ux.md 6.5）。塞ぐかどうかを決めるのは meta 層で、
 * sim は渡されたものを受け取るだけ（`meta/onboarding.ts`）。
 */
describe('まだ開いていない要素', () => {
  it('既定では何も塞がない（計測とテストの基準を変えない）', () => {
    // ここが既定で塞がると、hpMul の実測が全部やり直しになる
    const world = createWorld('S1', SEED);
    const { cardsPicked } = autoplay(world, { plan: [], useSpecial: true });
    expect(cardsPicked).toBeGreaterThan(0);
  });

  it('セットリストを塞ぐと ◆ で止まらない', () => {
    const world = createWorld('S1', SEED, { locked: ['setlist'] });
    const { cardsPicked, snapshot } = autoplay(world, { plan: [] });
    expect(cardsPicked).toBe(0);
    // 止まらずに最後まで進む（止まると誰も選ばないまま永久に終わらない）
    expect(snapshot.finished).toBe(true);
  });

  it('月華を塞ぐと、ボルテージが満タンになっても撃てない', () => {
    const everReady = (locked: readonly ('setlist' | 'special')[]): boolean => {
      const world = createWorld('S1', SEED, {
        ...balanceMeta('S1', 1, 'bare'),
        locked,
      });
      let ready = false;
      autoplay(world, {
        plan: STAGE_PLANS.S1?.placements ?? [],
        onTick: (w) => {
          if (w.specialReady) ready = true;
        },
      });
      return ready;
    };
    // 塞いでいなければ同じ盤面で満タンになる ―― 比較しないと
    // 「そもそも貯まっていないだけ」と区別が付かない
    expect(everReady([])).toBe(true);
    expect(everReady(['special'])).toBe(false);
  });

  it('塞いでも S1 は勝てる（最初の 1 本を壁にしない）', () => {
    // 配置とポジション強化だけで通ることを、ここで見張る。
    // S1 の参照盤面は `balance/plans.ts`
    const world = createWorld('S1', SEED, {
      ...balanceMeta('S1', 1, 'bare'),
      locked: ['setlist', 'special'],
    });
    const { snapshot } = autoplay(world, { plan: STAGE_PLANS.S1?.placements ?? [] });
    expect(snapshot.won).toBe(true);
    expect(snapshot.audience).toBe(100);
  });
});
