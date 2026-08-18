/**
 * チュートリアル（`tutorial.ts`）。
 *
 * **見張りたいのは「1 枚ずつ・一度だけ」。** 同時に何枚も出ると画面が札で埋まり、
 * 見せ終わったものが再び出ると邪魔になる。どちらも、最初のライブで
 * 「配置 → 強化 → 漏れ」が数秒のうちに続けて起きるせいで壊れやすい。
 */
import { describe, expect, it } from 'vitest';
import {
  markTutorialSeen,
  nextTutorial,
  resetTutorial,
  tutorialStep,
  TUTORIAL_IDS,
  type BattleCue,
} from './tutorial';
import { createNewSave } from './save';

const QUIET: BattleCue = {
  placed: 3,
  leaked: 0,
  choosing: false,
  specialReady: false,
  awaiting: false,
};

describe('出す順', () => {
  it('バトルが始まったらまず配置を教える', () => {
    const step = nextTutorial([], { ...QUIET, placed: 0 });
    expect(step?.id).toBe('place');
    expect(step?.anchor).toBe('palette');
  });

  it('置いたら次は強化', () => {
    expect(nextTutorial(['place'], QUIET)?.id).toBe('upgrade');
  });

  it('選択中は割り込んででもセットリストを先に出す', () => {
    // ◆ が出ているあいだは他の操作ができない。
    // ここで「強化しましょう」を出しても押せるものが無い
    const cue: BattleCue = { ...QUIET, placed: 0, choosing: true, leaked: 2 };
    expect(nextTutorial([], cue)?.id).toBe('setlist');
  });

  it('覚醒分岐は待たせない（あとから変えられない選択なので）', () => {
    expect(nextTutorial(['place'], { ...QUIET, awaiting: true })?.id).toBe('awakening');
  });

  it('一度に出るのは 1 枚だけ', () => {
    // 配置ゼロ・漏れあり・月華満タンが同時に起きても 1 枚
    const cue: BattleCue = { ...QUIET, placed: 0, leaked: 5, specialReady: true };
    const step = nextTutorial([], cue);
    expect(step).not.toBeNull();
    expect(typeof step?.id).toBe('string');
  });

  it('見せ終わった札は二度と出ない', () => {
    let seen: string[] = [];
    const cue: BattleCue = { ...QUIET, placed: 0 };
    for (let i = 0; i < TUTORIAL_IDS.length + 2; i++) {
      const step = nextTutorial(seen, cue);
      if (!step) break;
      expect(seen).not.toContain(step.id);
      seen = [...seen, step.id];
    }
    // 同じ状況を繰り返しても、いつかは何も出なくなる
    expect(nextTutorial(seen, cue)).toBeNull();
  });

  it('何も起きていなければ何も出さない', () => {
    expect(nextTutorial([...TUTORIAL_IDS], QUIET)).toBeNull();
  });
});

describe('文言', () => {
  it('全部の札に題と本文がある', () => {
    for (const id of TUTORIAL_IDS) {
      const step = tutorialStep(id);
      expect(step, id).not.toBeNull();
      expect(step?.title.length, id).toBeGreaterThan(2);
      // 1 行で読めて、かつ何をするかが分かる長さ
      expect(step?.body.length, id).toBeGreaterThan(15);
      expect(step?.body.length, id).toBeLessThan(90);
    }
  });

  it('知らない ID では落ちない', () => {
    // セーブは手で書き換えられるし、札を消したあとの古いセーブも通る
    expect(tutorialStep('nope' as never)).toBeNull();
  });
});

describe('見せた記録', () => {
  it('印は重ならない', () => {
    const once = markTutorialSeen(createNewSave(), 'place');
    const twice = markTutorialSeen(once, 'place');
    expect(once.tutorialSeen).toEqual(['place']);
    // 変わらないなら同じ参照を返す（保存も再描画も走らせない）
    expect(twice).toBe(once);
  });

  it('もう一度見られる（遊び方を忘れたときの逃げ道）', () => {
    const save = markTutorialSeen(markTutorialSeen(createNewSave(), 'place'), 'upgrade');
    expect(resetTutorial(save).tutorialSeen).toEqual([]);
    expect(nextTutorial(resetTutorial(save).tutorialSeen, { ...QUIET, placed: 0 })?.id).toBe(
      'place',
    );
  });
});
