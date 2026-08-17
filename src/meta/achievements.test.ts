/**
 * 称号・実績（03-progression.md ⑬）。
 *
 * 要は 2 つ ——
 * **セーブに解除済みの一覧を持たない**ことと、**称号に戦力を持たせない**こと。
 * どちらも崩れると、条件を変えた瞬間に古いセーブと食い違うか、
 * やり込みが義務になる。
 */
import { describe, expect, it } from 'vitest';
import { achievements, bossStageIds, canonIds, mainStageIds, stageOrder } from '../data';
import { MAX_STAR } from '../sim/star';
import { createNewSave, type SaveData } from './save';
import { applyReward, calcReward } from './progression';
import { totalTalentPoints } from './talents';
import {
  achievementIds,
  achievementView,
  achievementViews,
  activeTitle,
  availableTitles,
  claimRewards,
  pendingRewards,
  statValue,
} from './achievements';

function withStages(count: number, audience = 100): SaveData {
  const save = createNewSave();
  return {
    ...save,
    stageProgress: Object.fromEntries(
      stageOrder.slice(0, count).map((id) => [id, { cleared: true, bestAudience: audience, plays: 3 }]),
    ),
  };
}

describe('データ', () => {
  it('30 種そろっている（設計どおり。120 種を先に用意しない）', () => {
    expect(achievementIds).toHaveLength(30);
  });

  it('称号は全部ちがう（同じ名前が 2 つ出ると選べない）', () => {
    const titles = achievementIds.map((id) => achievements[id]!.title);
    expect(new Set(titles).size).toBe(titles.length);
  });

  it('どれかは報酬を持つが、称号そのものに戦力は無い', () => {
    // 「称号は表示のみ」（03-progression.md ⑬）。
    // 定義にステータスの欄が無いこと自体が担保だが、
    // 報酬が全部ゼロだと実績を埋める理由も無くなる
    const withReward = achievementIds.filter(
      (id) => achievements[id]!.points > 0 || achievements[id]!.funds > 0,
    );
    expect(withReward).toHaveLength(achievementIds.length);
  });

  it('到達しうる目標だけを置く', () => {
    // 「原作 12 人」「Lv30」のような上限を超える目標は永久に埋まらない
    expect(achievements['full_roster']!.goal).toBe(canonIds.length);
    expect(achievements['level30']!.goal).toBe(30);
  });

  it('ステージ数の目標は実際の本数と一致している', () => {
    // ステージを足すたびに手で直す羽目になっていた。**数え直せる目標は
    // 数え直して比べる** —— ズレると「全ステージ制覇」が届かないか、
    // 全部終える前に立ってしまう
    expect(achievements['all_main']!.goal).toBe(mainStageIds.length);
    expect(achievements['all_stages']!.goal).toBe(stageOrder.length);
    // ★の合計は「全ステージ × ★10」が上限。届く範囲に置く
    expect(achievements['star_grind']!.goal).toBeLessThan(stageOrder.length * MAX_STAR);
  });
});

describe('解除は毎回導く', () => {
  it('新規セーブでは何も解除されていない', () => {
    const views = achievementViews(createNewSave());
    expect(views.filter((v) => v.unlocked)).toHaveLength(0);
  });

  it('進捗から遡って解除される（セーブに一覧を持たない証拠）', () => {
    // 記録（save.stats）はゼロのまま、進捗だけを入れて解除されること
    const save = withStages(5);
    expect(save.stats.wins).toBe(0);
    expect(achievementView(save, 'first_live').unlocked).toBe(true);
    expect(achievementView(save, 'five_stages').unlocked).toBe(true);
    expect(achievementView(save, 'all_main').unlocked).toBe(false);
  });

  it('進捗を取り消せば解除も消える', () => {
    const save = withStages(5);
    const reset: SaveData = { ...save, stageProgress: {} };
    expect(achievementView(reset, 'five_stages').unlocked).toBe(false);
  });

  it('才能ポイントに反映される', () => {
    const before = totalTalentPoints(createNewSave());
    const after = totalTalentPoints(withStages(5));
    // ステージぶん（5 × 3 = 15）に実績ぶんが上乗せされる
    expect(after).toBeGreaterThan(before + 15);
  });
});

describe('ライブの記録', () => {
  it('リザルトで積まれる', () => {
    let save = createNewSave();
    const outcome = {
      stageId: 'S1',
      won: true,
      audience: 100,
      killed: 120,
      leaked: 0,
      perfectCalls: 12,
      bestCallCombo: 12,
      soloUses: 2,
    };
    save = applyReward(save, outcome, calcReward(outcome)).save;

    expect(save.stats.wins).toBe(1);
    expect(save.stats.kills).toBe(120);
    expect(save.stats.bestKills).toBe(120);
    expect(save.stats.noLeakWins).toBe(1);
    expect(save.stats.perfectCalls).toBe(12);
    expect(save.stats.bestCallCombo).toBe(12);
    expect(save.stats.soloUses).toBe(2);
    expect(save.stats.fundsEarned).toBeGreaterThan(0);
  });

  it('最高記録は下がらない', () => {
    let save = createNewSave();
    const big = { stageId: 'S1', won: true, audience: 100, killed: 500, bestCallCombo: 50 };
    const small = { stageId: 'S1', won: true, audience: 100, killed: 10, bestCallCombo: 3 };
    save = applyReward(save, big, calcReward(big)).save;
    save = applyReward(save, small, calcReward(small)).save;
    expect(save.stats.bestKills).toBe(500);
    expect(save.stats.bestCallCombo).toBe(50);
  });

  it('負けた回は「完全防衛」に数えない', () => {
    // 攻め込まれる前に終わっただけの試合が「1 体も漏らさず完走」になってしまう
    let save = createNewSave();
    const lost = { stageId: 'S1', won: false, audience: 0, killed: 3, leaked: 0 };
    save = applyReward(save, lost, calcReward(lost)).save;
    expect(save.stats.noLeakWins).toBe(0);
  });

  it('漏らした回も数えない', () => {
    let save = createNewSave();
    const leaky = { stageId: 'S1', won: true, audience: 80, killed: 100, leaked: 4 };
    save = applyReward(save, leaky, calcReward(leaky)).save;
    expect(save.stats.noLeakWins).toBe(0);
  });
});

describe('報酬の受け取り', () => {
  it('資金は 1 回だけ配られる', () => {
    const save = withStages(5);
    const pending = pendingRewards(save);
    expect(pending.funds).toBeGreaterThan(0);

    const claimed = claimRewards(save);
    expect(claimed.funds).toBe(save.funds + pending.funds);
    // 2 回目は何も出ない
    expect(pendingRewards(claimed).funds).toBe(0);
    expect(claimRewards(claimed)).toBe(claimed);
  });

  it('才能ポイントは受け取り操作なしで効く（取りこぼしが起きない）', () => {
    const save = withStages(5);
    const before = totalTalentPoints(save);
    expect(totalTalentPoints(claimRewards(save))).toBe(before);
  });
});

describe('称号', () => {
  it('達成していない称号は付かない', () => {
    const save: SaveData = { ...createNewSave(), title: 'all_stages' };
    expect(activeTitle(save)).toBeNull();
  });

  it('達成していれば付く', () => {
    const save: SaveData = { ...withStages(5), title: 'five_stages' };
    expect(activeTitle(save)).toBe(achievements['five_stages']!.title);
  });

  it('知らない ID を指していても落ちない', () => {
    const save: SaveData = { ...withStages(5), title: 'no_such_achievement' };
    expect(activeTitle(save)).toBeNull();
  });

  it('選べるのは達成済みのものだけ', () => {
    const save = withStages(5);
    const ids = availableTitles(save).map((t) => t.id);
    expect(ids).toContain('five_stages');
    expect(ids).not.toContain('all_stages');
  });
});

describe('数え方の境界', () => {
  it('「本編制覇」はボスステージを数えない', () => {
    // B1 は寄り道。数に入れると S10 未クリアのまま本編制覇が立ってしまう
    const save = createNewSave();
    const cleared = (ids: string[]): SaveData => ({
      ...save,
      stageProgress: Object.fromEntries(
        ids.map((id) => [id, { cleared: true, bestAudience: 100, plays: 1 }]),
      ),
    });
    // 本編をあと 1 本だけ残した状態。ボスは全部終えている
    const almost = cleared([...mainStageIds.slice(0, -1), ...bossStageIds]);
    expect(statValue(almost, 'clearedStages')).toBe(stageOrder.length - 1);
    expect(statValue(almost, 'clearedMainStages')).toBe(mainStageIds.length - 1);
    expect(achievementView(almost, 'all_main').unlocked).toBe(false);

    // ボスを 1 本も終えていなくても、本編を全部やれば立つ（ボスは寄り道）
    const mainOnly = cleared([...mainStageIds]);
    expect(achievementView(mainOnly, 'all_main').unlocked).toBe(true);
    expect(achievementView(mainOnly, 'all_stages').unlocked).toBe(false);
  });

  it('「全員集合」は隠しキャラを数えない', () => {
    // `rosterIds` は 12 人 + GM の 13 件。GM を出しただけで
    // 「原作の 12 人すべて」が立ってしまってはいけない
    const base = createNewSave();
    const withSecret: SaveData = {
      ...base,
      // 初期 3 人 + 犬DOGE + オタ公 しか開いていない状態で GM だけ持つ
      stageProgress: { S1: { cleared: true, bestAudience: 100, plays: 1 } },
      secrets: ['GM'],
    };
    expect(statValue(withSecret, 'roster')).toBe(5);
    expect(achievementView(withSecret, 'full_roster').unlocked).toBe(false);
  });
});

describe('指標', () => {
  it('★は最高値と合計の両方を見る', () => {
    const save: SaveData = { ...createNewSave(), bestStar: { S1: 7, S2: 3 } };
    expect(statValue(save, 'maxStar')).toBe(7);
    expect(statValue(save, 'starTotal')).toBe(10);
  });

  it('★を 1 つも取っていなくても落ちない（空配列の Math.max）', () => {
    expect(statValue(createNewSave(), 'maxStar')).toBe(0);
    expect(statValue(createNewSave(), 'maxCostumeLevel')).toBe(0);
  });
});
