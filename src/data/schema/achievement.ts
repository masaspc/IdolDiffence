import { z } from 'zod';

/**
 * 実績が見る指標（03-progression.md ⑬）。
 *
 * **できるだけセーブに数を持たない。** 進捗・★・ランクから導けるものは
 * 導き、どうしても記録が要るものだけ `save.stats` に積む
 * （才能ポイントと同じ方針 —— 条件を変えたときに古いセーブだけ食い違うのを避ける）。
 */
export const achievementStatSchema = z.enum([
  // --- 進捗から導く ---
  /** クリア済みのステージ数 */
  'clearedStages',
  /** 観客 100 を出したステージ数 */
  'perfectStages',
  /** クリア済みのボスステージ数 */
  'bossStages',
  /** どこかのステージで到達した最高の★ */
  'maxStar',
  /** 全ステージの★の合計。周回の総量 */
  'starTotal',
  /** 総プレイ回数 */
  'plays',
  // --- 育成から導く ---
  /** プロデューサーランク */
  'rank',
  /** いちばん育っているメンバーのレベル */
  'maxIdolLevel',
  /** 使えるメンバーの数 */
  'roster',
  /** 進化を解放した数 */
  'evolved',
  /** 取得済みの才能ノード数 */
  'talents',
  /** 所持している衣装の数 */
  'costumes',
  /** いちばん強化した衣装の +値 */
  'maxCostumeLevel',
  /** UR 衣装の数 */
  'urCostumes',
  /** 到達した最高の楽曲レベル */
  'maxSongLevel',
  // --- ライブの記録（save.stats） ---
  /** 完走した回数 */
  'wins',
  /** 撃破した敵の総数 */
  'kills',
  /** 1 ライブでの最多撃破 */
  'bestKills',
  /** 1 体も漏らさずに完走した回数 */
  'noLeakWins',
  /** コールの Perfect 総数 */
  'perfectCalls',
  /** Perfect の最大連続数 */
  'bestCallCombo',
  /** ソロパートを使った回数 */
  'soloUses',
  /** 稼いだ資金の総額 */
  'fundsEarned',
]);

export type AchievementStat = z.infer<typeof achievementStatSchema>;

export const achievementSchema = z.object({
  name: z.string().min(1),
  desc: z.string().min(1),
  /**
   * 解除で得られる称号。**表示のみ**で戦力バフは付けない（03-progression.md ⑬）。
   * 付けると「実績を埋めないと強くなれない」になり、やり込みが義務になる
   */
  title: z.string().min(1),
  /** 見るべき指標としきい値。`stat >= goal` で解除 */
  stat: achievementStatSchema,
  goal: z.number().positive(),
  /** 報酬の才能ポイント。やり込みを**素材ではなく育成**へ還元する */
  points: z.number().int().nonnegative().default(0),
  /** 報酬の資金 */
  funds: z.number().int().nonnegative().default(0),
  /**
   * 隠し実績。解除するまで条件も名前も伏せる。
   * 「何をすればいいか分からない」ものだけに付ける（数は少なく）
   */
  hidden: z.boolean().default(false),
});

export const achievementsSchema = z.record(z.string(), achievementSchema);

export type AchievementDef = z.infer<typeof achievementSchema>;
export type Achievements = z.infer<typeof achievementsSchema>;
