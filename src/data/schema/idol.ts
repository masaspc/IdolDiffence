import { z } from 'zod';
import { idolTypeSchema } from './common';

/** 命中時に付与する状態異常。減速と Echo（継続ダメージ） */
export const onHitSchema = z.object({
  status: z.enum(['slow', 'echo']),
  /** 減速なら -X%（0.25 = 25% 減速）、Echo なら付与スタック数 */
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

/**
 * 覚醒分岐（03-progression.md ②）。ポジション Lv3 到達時に A/B から 1 つを選ぶ。
 * 単なる数値上昇ではなく、攻撃の挙動そのものが変わるようにしている。
 */
export const awakeningBranchSchema = z.object({
  name: z.string().min(1),
  desc: z.string().min(1),
  mods: z
    .object({
      attackIntervalMul: z.number().positive().optional(),
      radiusMul: z.number().positive().optional(),
      critRateAdd: z.number().optional(),
      /** 単体攻撃を同時 N 体へ */
      multiTarget: z.number().int().positive().optional(),
      /** 単体攻撃を範囲化する。値は半径 */
      toAoe: z.number().positive().optional(),
      /** onHit の効果量を上書きする */
      slowValue: z.number().optional(),
    })
    .default({}),
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
  awakening: z.object({ A: awakeningBranchSchema, B: awakeningBranchSchema }).optional(),
});

export const idolsSchema = z.record(z.string(), idolSchema);

export type OnHit = z.infer<typeof onHitSchema>;
export type AttackDef = z.infer<typeof attackSchema>;
export type AwakeningBranch = z.infer<typeof awakeningBranchSchema>;
export type IdolDef = z.infer<typeof idolSchema>;
export type Idols = z.infer<typeof idolsSchema>;
export type AwakeningKey = 'A' | 'B';
