import { z } from 'zod';
import { attributeSchema } from './common';

/**
 * 敵の特性（04-content.md 4.3「敵の設計意図」）。
 *
 * 各敵は「特定の強化・編成に対する問い」になっている。数値の大小だけで差をつけると
 * どれも「硬いか速いか」に収束するため、挙動そのものを変える枠をここに置く。
 */
export const enemyTraitsSchema = z.object({
  /** 周囲の敵を回復する。ツキシズク */
  healAura: z
    .object({
      radius: z.number().positive(),
      /** 最大 HP に対する毎秒の回復割合（0.03 = 3%/s） */
      percentPerSec: z.number().positive(),
    })
    .optional(),
  /** 射程内のメンバーの攻撃速度を落とす。トコヤミ */
  drainAura: z
    .object({
      radius: z.number().positive(),
      /** 攻撃速度倍率（0.75 = -25%） */
      speedMul: z.number().positive().max(1),
    })
    .optional(),
  /**
   * 正面からの単体攻撃を軽減する。カガミ。
   * **範囲攻撃には効かない**ので、「範囲で崩す」という答えが用意されている
   */
  frontShield: z.number().min(0).max(1).optional(),
  /** 撃破時に別の敵を生成する。ムラクモ */
  onDeathSpawn: z
    .object({
      enemy: z.string().min(1),
      count: z.number().int().positive(),
    })
    .optional(),
});

export const enemySchema = z.object({
  name: z.string().min(1),
  attr: attributeSchema,
  hp: z.number().positive(),
  def: z.number().nonnegative(),
  /** 移動速度（マス／秒） */
  speed: z.number().positive(),
  /** センターステージ到達時に減る観客ゲージ */
  leak: z.number().positive(),
  /** 撃破時に得られる声援 */
  bounty: z.number().nonnegative(),
  /** 飛行。経路を無視して直線でゴールへ向かう */
  flying: z.boolean().default(false),
  /** 描画半径（マス単位） */
  radius: z.number().positive().default(0.3),
  traits: enemyTraitsSchema.default({}),
});

export const enemiesSchema = z.record(z.string(), enemySchema);

export type EnemyTraits = z.infer<typeof enemyTraitsSchema>;
export type EnemyDef = z.infer<typeof enemySchema>;
export type Enemies = z.infer<typeof enemiesSchema>;
