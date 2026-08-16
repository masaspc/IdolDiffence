/**
 * 恒久進行（アイドルレベル）と、リザルト報酬。
 * 「負ける → 育てる → 勝つ」のループを成立させる最小構成（03-progression.md ⑦）。
 */
import { getIdol } from '../data';
import type { SaveData } from './save';

/** M2 のレベル上限。設計上の最終は 60 だが、限界突破は M3 以降 */
export const MAX_LEVEL = 30;

/** `ATK(L) = ATK₁ × (1 + 0.06 × (L-1))`（Lv30 で約 2.7 倍） */
export function levelAtkMultiplier(level: number): number {
  return 1 + 0.06 * (level - 1);
}

/** レベルアップ費用。序盤は軽く、後半は重く */
export function levelUpCost(currentLevel: number): number {
  return Math.round(40 * Math.pow(currentLevel, 1.35));
}

export function idolLevel(save: SaveData, idolId: string): number {
  return save.idolLevels[idolId] ?? 1;
}

export function canLevelUp(save: SaveData, idolId: string): boolean {
  const level = idolLevel(save, idolId);
  return level < MAX_LEVEL && save.funds >= levelUpCost(level);
}

/** @returns 更新後のセーブ。条件を満たさない場合は同じ参照を返す */
export function levelUp(save: SaveData, idolId: string): SaveData {
  if (!canLevelUp(save, idolId)) return save;
  const level = idolLevel(save, idolId);
  return {
    ...save,
    funds: save.funds - levelUpCost(level),
    idolLevels: { ...save.idolLevels, [idolId]: level + 1 },
  };
}

/** 育成状態を反映した攻撃力。バトル開始時に一度だけ解決する */
export function resolvedAtk(save: SaveData, idolId: string): number {
  return getIdol(idolId).base.atk * levelAtkMultiplier(idolLevel(save, idolId));
}

export interface BattleOutcome {
  stageId: string;
  won: boolean;
  audience: number;
  killed: number;
}

export interface Reward {
  funds: number;
  breakdown: { label: string; value: number }[];
}

/**
 * リザルト報酬。**負けても撃破ぶんは入る**。
 * ゼロにすると、負けた回のプレイが完全な無駄になり再挑戦の意欲を折る。
 */
export function calcReward(outcome: BattleOutcome): Reward {
  const base = outcome.won ? 120 : 40;
  const kills = outcome.killed * 3;
  const audience = outcome.won ? Math.round(outcome.audience * 1.5) : 0;
  return {
    funds: base + kills + audience,
    breakdown: [
      { label: outcome.won ? '完走ボーナス' : '参加報酬', value: base },
      { label: `撃破 ${outcome.killed} 体`, value: kills },
      ...(audience > 0 ? [{ label: `観客 ${outcome.audience}`, value: audience }] : []),
    ],
  };
}

export function applyReward(save: SaveData, outcome: BattleOutcome, reward: Reward): SaveData {
  const previous = save.stageProgress[outcome.stageId];
  return {
    ...save,
    funds: save.funds + reward.funds,
    stageProgress: {
      ...save.stageProgress,
      [outcome.stageId]: {
        cleared: (previous?.cleared ?? false) || outcome.won,
        bestAudience: Math.max(previous?.bestAudience ?? 0, outcome.won ? outcome.audience : 0),
        plays: (previous?.plays ?? 0) + 1,
      },
    },
  };
}
