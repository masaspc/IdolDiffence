import { z } from 'zod';
import { attributeSchema } from './common';

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
});

export const enemiesSchema = z.record(z.string(), enemySchema);

export type EnemyDef = z.infer<typeof enemySchema>;
export type Enemies = z.infer<typeof enemiesSchema>;
