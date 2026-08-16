import { z } from 'zod';
import { idolTypeSchema } from './common';

/** 命中時に付与する状態異常。M1 では減速のみ */
export const onHitSchema = z.object({
  status: z.enum(['slow']),
  /** 減速なら -X%（0.25 = 25% 減速） */
  value: z.number(),
  durationMs: z.number().positive(),
});

export const attackSchema = z.object({
  /** single = 単体、aoe_ring = 対象を中心とした範囲 */
  kind: z.enum(['single', 'aoe_ring']),
  skillMul: z.number().positive(),
  /** aoe_ring の半径（マス単位） */
  radius: z.number().nonnegative().default(0),
  /** 飛行敵を攻撃できるか。歌とヴィジュアルは true、ダンスは false */
  canHitFlying: z.boolean(),
  onHit: onHitSchema.optional(),
});

export const idolSchema = z.object({
  name: z.string().min(1),
  /** 表示用の短縮名。HUD の配置パレットで使う */
  shortName: z.string().min(1),
  type: idolTypeSchema,
  cost: z.number().positive(),
  base: z.object({
    atk: z.number().positive(),
    /** 射程（マス単位） */
    range: z.number().positive(),
    attackIntervalMs: z.number().positive(),
    critRate: z.number().min(0).max(1).default(0.05),
    critDmg: z.number().nonnegative().default(0.5),
  }),
  attack: attackSchema,
});

export const idolsSchema = z.record(z.string(), idolSchema);

export type OnHit = z.infer<typeof onHitSchema>;
export type AttackDef = z.infer<typeof attackSchema>;
export type IdolDef = z.infer<typeof idolSchema>;
export type Idols = z.infer<typeof idolsSchema>;
