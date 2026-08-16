/**
 * 称号・実績（03-progression.md ⑬）。
 *
 * ## セーブに「解除済みの一覧」を持たない
 *
 * 実績はセーブの中身から**毎回導く**。才能ポイントやランクと同じで、
 * 結果を保存すると条件を変えたときに古いセーブだけ食い違う
 * （「もう解除済みだから」と条件変更が反映されない / 逆に取り消されて見える）。
 *
 * 保存するのは、進捗からは導けない**生の記録**（`save.stats`）だけ。
 * 「1 ライブで 500 体」のような値は、その場で数えないと後から復元できない。
 *
 * ## 称号は表示のみ
 *
 * 戦力バフは付けない。付けると「実績を埋めないと強くなれない」になり、
 * やり込みが義務になる。報酬は才能ポイントと資金で、
 * **やり込みを素材ではなく育成へ**還元する。
 */
import { achievements, canonIds, getStage, mainStageIds, stageOrder } from '../data';
import type { AchievementDef, AchievementStat } from '../data/schema/achievement';
import { unlockedIds } from './progression';
import { rankOf, songIds, songLevelOf } from './rank';
import type { SaveData } from './save';

export const achievementIds = Object.keys(achievements);

export function getAchievement(id: string): AchievementDef {
  const def = achievements[id];
  if (!def) throw new Error(`unknown achievement: ${id}`);
  return def;
}

/**
 * 指標の現在値。
 *
 * 進捗・育成から導けるものはここで導き、どうしても記録が要るものだけ
 * `save.stats` から読む。
 */
export function statValue(save: SaveData, stat: AchievementStat): number {
  const progress = Object.values(save.stageProgress);

  switch (stat) {
    case 'clearedStages':
      return progress.filter((p) => p.cleared).length;
    case 'clearedMainStages':
      return mainStageIds.filter((id) => save.stageProgress[id]?.cleared).length;
    case 'perfectStages':
      return progress.filter((p) => p.bestAudience >= 100).length;
    case 'bossStages':
      return stageOrder.filter((id) => getStage(id).boss && save.stageProgress[id]?.cleared).length;
    case 'maxStar':
      return Math.max(0, ...Object.values(save.bestStar));
    case 'starTotal':
      return Object.values(save.bestStar).reduce((sum, star) => sum + star, 0);
    case 'plays':
      return progress.reduce((sum, p) => sum + p.plays, 0);

    case 'rank':
      return rankOf(save.totalExp);
    case 'maxIdolLevel':
      return Math.max(1, ...Object.values(save.idolLevels));
    case 'roster':
      // 隠しキャラを混ぜない。GM を出しただけで「原作の 12 人すべて」が
      // 立ってしまう（`rosterIds` は 12 人 + GM の 13 件）
      return unlockedIds(save).filter((id) => canonIds.includes(id)).length;
    case 'evolved':
      return save.evolved.length;
    case 'talents':
      return save.talents.length;
    case 'costumes':
      return save.costumes.length;
    case 'maxCostumeLevel':
      return Math.max(0, ...save.costumes.map((c) => c.enhance));
    case 'urCostumes':
      return save.costumes.filter((c) => c.rarity === 'UR').length;
    case 'maxSongLevel':
      return Math.max(1, ...songIds.map((id) => songLevelOf(save, id)));

    case 'wins':
      return save.stats.wins;
    case 'kills':
      return save.stats.kills;
    case 'bestKills':
      return save.stats.bestKills;
    case 'noLeakWins':
      return save.stats.noLeakWins;
    case 'perfectCalls':
      return save.stats.perfectCalls;
    case 'bestCallCombo':
      return save.stats.bestCallCombo;
    case 'soloUses':
      return save.stats.soloUses;
    case 'fundsEarned':
      return save.stats.fundsEarned;
    default:
      return 0;
  }
}

export interface AchievementView {
  id: string;
  def: AchievementDef;
  value: number;
  unlocked: boolean;
  /** 0..1。UI の進捗バー用 */
  ratio: number;
}

export function achievementView(save: SaveData, id: string): AchievementView {
  const def = getAchievement(id);
  const value = statValue(save, def.stat);
  return {
    id,
    def,
    value,
    unlocked: value >= def.goal,
    ratio: Math.min(1, value / def.goal),
  };
}

/** 全実績の状態。表示順は「解除済み → 進捗の高い順」 */
export function achievementViews(save: SaveData): AchievementView[] {
  return achievementIds
    .map((id) => achievementView(save, id))
    .sort((a, b) => {
      if (a.unlocked !== b.unlocked) return a.unlocked ? -1 : 1;
      return b.ratio - a.ratio;
    });
}

export function unlockedAchievements(save: SaveData): AchievementView[] {
  return achievementViews(save).filter((v) => v.unlocked);
}

/** 実績で得た才能ポイントの合計。`totalTalentPoints` がこれを足す */
export function achievementPoints(save: SaveData): number {
  return unlockedAchievements(save).reduce((sum, v) => sum + v.def.points, 0);
}

/**
 * まだ受け取っていない実績報酬の資金と、その内訳。
 *
 * 資金だけは**セーブに受領済みを持つ**。ポイントと違って残高は増減するので、
 * 「導いた総額 − 使った額」では復元できない
 */
export function pendingRewards(save: SaveData): { funds: number; ids: string[] } {
  const claimed = new Set(save.claimedAchievements);
  const ids = unlockedAchievements(save)
    .filter((v) => !claimed.has(v.id) && v.def.funds > 0)
    .map((v) => v.id);
  const funds = ids.reduce((sum, id) => sum + getAchievement(id).funds, 0);
  return { funds, ids };
}

/**
 * 未受領の報酬をまとめて受け取る。
 *
 * 才能ポイントは解除状態から毎回導けるので、ここでは触らない。
 * 印を付けるのは**資金を配ったぶんだけ**
 */
export function claimRewards(save: SaveData): SaveData {
  const { funds, ids } = pendingRewards(save);
  if (ids.length === 0) return save;
  return {
    ...save,
    funds: save.funds + funds,
    claimedAchievements: [...save.claimedAchievements, ...ids],
  };
}

/**
 * 表示している称号。未解除のものを指していたら null に落とす
 * （実績の条件を変えたときに、外れた称号が付いたまま残らないように）
 */
export function activeTitle(save: SaveData): string | null {
  const id = save.title;
  if (id === null) return null;
  const def = achievements[id];
  if (!def) return null;
  return statValue(save, def.stat) >= def.goal ? def.title : null;
}

/** 選べる称号の一覧 */
export function availableTitles(save: SaveData): { id: string; title: string }[] {
  return unlockedAchievements(save).map((v) => ({ id: v.id, title: v.def.title }));
}
