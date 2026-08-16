/**
 * プロデューサーランク（03-progression.md ⑫）と楽曲レベル（⑩）。
 *
 * どちらも**周回で伸びる**軸。M4 の狙いは「同じステージをもう一度回る理由」で、
 * 衣装（⑨）が物のドロップならこちらは時間の蓄積にあたる。
 *
 * ## ランクは強化ではなく進行度
 *
 * 「全キャラ ATK +0.5%/Lv」のような薄い加算は持たせない。才能ボードと
 * 同じプールへ二重に流し込むだけで、体感を生まないため（03-progression.md ⑫）。
 * ランクが配るのは**才能ポイント**と**解放**だけ。
 *
 * ## 楽曲レベルは「そのステージを回った証」
 *
 * ステージではなく**楽曲**に紐づく。10 ステージに対して曲は 5 曲なので、
 * S3 を回して上げた「月光サイレンス」は S7 でもそのまま効く。
 * 周回するステージを選ぶときに「どの曲を伸ばすか」という別軸の判断が生まれる。
 */
import { getStage, songs } from '../data';
import type { SaveData } from './save';

// --- プロデューサーランク ---

/** 1 ライブで入る経験値。完走と観客で伸びる */
export function battleExp(won: boolean, audience: number, star: number): number {
  const base = won ? 100 : 30;
  // ★が高いほど濃い。周回の効率という意味でも、上を目指す理由になる
  return Math.round((base + audience) * (1 + 0.15 * (star - 1)));
}

/** ランク N から N+1 に必要な経験値。上がるほど重い */
export function expToNext(rank: number): number {
  return Math.round(300 * Math.pow(rank, 1.25));
}

export const MAX_RANK = 50;

/** 累計経験値からランクを求める。セーブはランクではなく**累計**を持つ */
export function rankOf(totalExp: number): number {
  let rank = 1;
  let remaining = totalExp;
  while (rank < MAX_RANK) {
    const need = expToNext(rank);
    if (remaining < need) break;
    remaining -= need;
    rank += 1;
  }
  return rank;
}

/** 次のランクまでの進捗（0..1）と、必要な残り経験値 */
export function rankProgress(totalExp: number): { ratio: number; remaining: number } {
  const rank = rankOf(totalExp);
  if (rank >= MAX_RANK) return { ratio: 1, remaining: 0 };

  let consumed = 0;
  for (let r = 1; r < rank; r++) consumed += expToNext(r);
  const need = expToNext(rank);
  const into = totalExp - consumed;
  return { ratio: Math.min(1, into / need), remaining: Math.max(0, need - into) };
}

/** ランクで配る才能ポイント（03-progression.md ⑫: 1 レベルごとに +2） */
export const TALENT_POINTS_PER_RANK = 2;

export function talentPointsFromRank(save: SaveData): number {
  return (rankOf(save.totalExp) - 1) * TALENT_POINTS_PER_RANK;
}

// --- 楽曲レベル ---

export const MAX_SONG_LEVEL = 15;

/** 1 ライブで入る習熟度。完走したときだけ */
export function songExp(won: boolean, star: number): number {
  return won ? 10 + 2 * (star - 1) : 0;
}

export function songLevelToNext(level: number): number {
  return Math.round(40 * Math.pow(level, 1.15));
}

export function songLevelOf(save: SaveData, songId: string): number {
  let level = 1;
  let remaining = save.songExp[songId] ?? 0;
  while (level < MAX_SONG_LEVEL) {
    const need = songLevelToNext(level);
    if (remaining < need) break;
    remaining -= need;
    level += 1;
  }
  return level;
}

/**
 * 楽曲レベルで解禁される「ソロパート」の効果（03-progression.md ⑩）。
 *
 * ライブ中に手動で撃つ全体スキルではなく、**指定 1 人**を強化する。
 * 全体バフはスペシャルライブ（月華）が既に担っていて、
 * もう 1 つ足すと「どちらを先に押すか」だけの判断になってしまう。
 * 1 人を選ばせれば、「今どこが薄いか」を読む判断になる。
 */
export interface SoloPart {
  /** 対象 1 人の攻撃力倍率 */
  atkMul: number;
  durationMs: number;
  cooldownMs: number;
}

export function soloPartOf(level: number): SoloPart {
  const clamped = Math.min(MAX_SONG_LEVEL, Math.max(1, level));
  return {
    // Lv1 で ×1.6、Lv15 で ×2.3
    atkMul: 1.6 + 0.05 * (clamped - 1),
    // Lv1 で 10 秒、Lv15 で 14 秒
    durationMs: 10_000 + 300 * (clamped - 1),
    // Lv1 で 60 秒、Lv15 で 39 秒
    cooldownMs: 60_000 - 1500 * (clamped - 1),
  };
}

/** そのステージで使う楽曲のソロパート。sim へはこれだけを渡す */
export function soloPartForStage(save: SaveData, stageId: string): SoloPart {
  return soloPartOf(songLevelOf(save, getStage(stageId).song));
}

export const songIds = Object.keys(songs);
