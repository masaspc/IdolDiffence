/**
 * 恒久進行（アイドルレベル）と、リザルト報酬。
 * 「負ける → 育てる → 勝つ」のループを成立させる最小構成（03-progression.md ⑦）。
 */
import { getIdol, getStage, idolUnlockStage, PARTY_SIZE, rosterIds, SECRET_IDS } from '../data';
import { clampStar, MAX_STAR, starCoefficients } from '../sim/star';
import { battleExp, songExp } from './rank';
import { dropCount, grantDrops } from './costumes';
import { isSecretUnlocked } from './secrets';
import type { CostumeInstance, SaveData } from './save';

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

// --- 解放と編成 ---

const ROSTER = new Set<string>(rosterIds);
const SECRETS = new Set<string>(SECRET_IDS);

export function isUnlocked(save: SaveData, idolId: string): boolean {
  // ロスターに無い ID は「解放前」ではなく**存在しない**。
  // 手で書き換えたセーブや、キャラを削除した後の古いセーブがここを通ると、
  // 後段の getIdol() が例外を投げてゲームごと起動しなくなる
  if (!ROSTER.has(idolId)) return false;
  // 隠しキャラの鍵は合言葉と腕前の 2 つ。`idolUnlockStage` には載せない
  // ―― 載せると育成画面に条件が先出しされ、隠れていることにならない（`meta/secrets.ts`）
  if (SECRETS.has(idolId)) return isSecretUnlocked(save, idolId);
  const gate = idolUnlockStage[idolId];
  if (gate === null || gate === undefined) return true;
  return save.stageProgress[gate]?.cleared === true;
}

export function unlockedIds(save: SaveData): string[] {
  return rosterIds.filter((id) => isUnlocked(save, id));
}

/**
 * 編成を正規化する。
 *
 * 解放前・重複・定員超過を落とし、センターが編成外なら先頭へ寄せる。
 * セーブは手で書き換えられるうえ、解放条件はバージョンで変わりうるので、
 * **読み出すたびに通す**。sim 側にも同じ判定を置いているが、
 * UI が壊れた編成を表示しないようここで整えておく
 */
export function normalizeParty(save: SaveData): { party: string[]; center: string | null } {
  const seen = new Set<string>();
  const party: string[] = [];
  for (const id of save.party) {
    if (seen.has(id) || !isUnlocked(save, id) || party.length >= PARTY_SIZE) continue;
    seen.add(id);
    party.push(id);
  }
  // 全員外した状態で出撃できてしまうと詰むので、初期メンバーで埋め戻す
  if (party.length === 0) {
    for (const id of unlockedIds(save).slice(0, PARTY_SIZE)) party.push(id);
  }
  const center = save.center && party.includes(save.center) ? save.center : (party[0] ?? null);
  return { party, center };
}

/** 出撃メンバーの入れ替え。定員に達している状態での追加は無視する */
export function toggleParty(save: SaveData, idolId: string): SaveData {
  if (!isUnlocked(save, idolId)) return save;
  const { party, center } = normalizeParty(save);

  if (party.includes(idolId)) {
    const next = party.filter((id) => id !== idolId);
    if (next.length === 0) return save; // 空編成は許さない
    return { ...save, party: next, center: center === idolId ? (next[0] ?? null) : center };
  }
  if (party.length >= PARTY_SIZE) return save;
  return { ...save, party: [...party, idolId], center };
}

export function setCenter(save: SaveData, idolId: string): SaveData {
  const { party } = normalizeParty(save);
  if (!party.includes(idolId)) return save;
  return { ...save, party, center: idolId };
}

export interface BattleOutcome {
  stageId: string;
  won: boolean;
  audience: number;
  killed: number;
  /** 挑んだ★難度。省略時は 1 */
  star?: number;
  /** 漏らした数。実績「完全防衛」に要る */
  leaked?: number;
  /** コールの成績（02-core-battle.md 2.9）。自動ぶんは含めない */
  perfectCalls?: number;
  bestCallCombo?: number;
  /** ソロパートを使った回数 */
  soloUses?: number;
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
  const plain = base + kills + audience;

  // ★の報酬倍率（02-core-battle.md 2.10）。
  // ★10 で約 4 倍。要求戦力の伸び（約 60 倍）よりずっと緩いので、
  // 「稼ぐために★を上げる」ではなく「勝てるようになったから上げる」順序になる
  const star = clampStar(outcome.star ?? 1);
  const starMul = starCoefficients(star).rewardMul;
  const funds = Math.round(plain * starMul);

  return {
    funds,
    breakdown: [
      { label: outcome.won ? '完走ボーナス' : '参加報酬', value: base },
      { label: `撃破 ${outcome.killed} 体`, value: kills },
      ...(audience > 0 ? [{ label: `観客 ${outcome.audience}`, value: audience }] : []),
      ...(star > 1 ? [{ label: `★${star} 補正 ×${starMul.toFixed(2)}`, value: funds - plain }] : []),
    ],
  };
}

/**
 * リザルトをセーブへ反映する。
 *
 * **出た衣装も一緒に返す。** 「反映」と「何が出たか」を別の関数に分けると、
 * 表示側がもう一度引いてしまい、セーブに入ったものと画面に出るものが
 * 食い違う（乱数はセーブの状態を進めるので、2 回引けば 2 組できる）。
 */
export function applyReward(
  save: SaveData,
  outcome: BattleOutcome,
  reward: Reward,
): { save: SaveData; dropped: CostumeInstance[] } {
  const previous = save.stageProgress[outcome.stageId];
  const star = clampStar(outcome.star ?? 1);
  const songId = getStage(outcome.stageId).song;

  const updated: SaveData = {
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
    // ★の記録は**勝ったときだけ**伸びる。挑んだだけで解放されると、
    // ★10 を選んで即負けするのが最速の解放手段になってしまう
    bestStar: outcome.won
      ? { ...save.bestStar, [outcome.stageId]: Math.max(save.bestStar[outcome.stageId] ?? 0, star) }
      : save.bestStar,
    totalExp: save.totalExp + battleExp(outcome.won, outcome.audience, star),
    songExp: {
      ...save.songExp,
      [songId]: (save.songExp[songId] ?? 0) + songExp(outcome.won, star),
    },
    // ライブの記録（03-progression.md ⑬）。**進捗から導けないものだけ**を積む
    stats: {
      ...save.stats,
      wins: save.stats.wins + (outcome.won ? 1 : 0),
      kills: save.stats.kills + outcome.killed,
      bestKills: Math.max(save.stats.bestKills, outcome.killed),
      // 「1 体も漏らさず完走」。負けた回は数えない —— 攻め込まれる前に
      // 終わっただけの試合が「完全防衛」になってしまう
      noLeakWins:
        save.stats.noLeakWins + (outcome.won && (outcome.leaked ?? 0) === 0 ? 1 : 0),
      perfectCalls: save.stats.perfectCalls + (outcome.perfectCalls ?? 0),
      bestCallCombo: Math.max(save.stats.bestCallCombo, outcome.bestCallCombo ?? 0),
      soloUses: save.stats.soloUses + (outcome.soloUses ?? 0),
      fundsEarned: save.stats.fundsEarned + reward.funds,
    },
  };
  // 衣装のドロップ（03-progression.md ⑨）。資金と同じく**負けても出る**
  return grantDrops(updated, dropCount(outcome.won, outcome.audience));
}

// --- ★難度の解放 ---

/**
 * そのステージで選べる最高の★。
 *
 * **1 つずつしか開かない。** まとめて開くと、いきなり ★10 に挑んで
 * 「何が足りないのか分からないまま負ける」ことになる。
 * 1 段ずつなら、直前の勝ち方との差分で足りないものが分かる。
 */
export function maxSelectableStar(save: SaveData, stageId: string): number {
  const best = save.bestStar[stageId] ?? 0;
  return Math.min(MAX_STAR, best + 1);
}

export function bestStarOf(save: SaveData, stageId: string): number {
  return save.bestStar[stageId] ?? 0;
}
