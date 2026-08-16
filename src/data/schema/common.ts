import { z } from 'zod';

/** 3 系統。歌 = 範囲・持続 / ダンス = 単体・機動 / ヴィジュアル = 妨害・支援 */
export const idolTypeSchema = z.enum(['vocal', 'dance', 'visual']);
export type IdolType = z.infer<typeof idolTypeSchema>;

/** 月の三相。静寂 / 喧噪 / 虚飾 */
export const attributeSchema = z.enum(['silence', 'noise', 'glare']);
export type Attribute = z.infer<typeof attributeSchema>;

/** 楽曲セクション。ウェーブの単位でもある */
export const sectionSchema = z.enum([
  'intro',
  'verse',
  'bridge',
  'chorus',
  'interlude',
  'finale',
]);
export type Section = z.infer<typeof sectionSchema>;

/** グリッド座標 [x, y] */
export const cellSchema = z.tuple([z.number().int().nonnegative(), z.number().int().nonnegative()]);
export type Cell = z.infer<typeof cellSchema>;

/** 配置マスの種別。種別ごとに配置ボーナスが乗る */
export const cellTypeSchema = z.enum(['stage', 'runway', 'audience', 'monitor']);
export type CellType = z.infer<typeof cellTypeSchema>;
