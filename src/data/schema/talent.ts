import { z } from 'zod';
import { idolTypeSchema } from './common';

/**
 * 才能ボードのノード（03-progression.md ⑧）。
 *
 * **小ノードを敷き詰めない。**「ATK +2%」を並べても強くなった実感は出ず、
 * 調整対象だけが増える。条件付き強化とキーストーンを主役にする。
 */
export const talentTierSchema = z.enum([
  /** 接続のための最小限。素の数値が少し伸びる */
  'small',
  /** 条件付き強化。効く場面が限られる代わりに濃い */
  'mid',
  /** ブランチ末端。**同じブランチ内で 1 つしか取れない** */
  'keystone',
]);

/**
 * ノードが供給する強化。才能ボードは**加算プール**（03-progression.md E-1）。
 * 同じ器に足し込むので、取れば取るほど効きが鈍る。
 */
export const talentModsSchema = z
  .object({
    /** 系統を問わない攻撃力（0.04 = +4%） */
    atkPct: z.number().optional(),
    /** このブランチの系統だけの攻撃力 */
    typeAtkPct: z.number().optional(),
    rangePct: z.number().optional(),
    attackSpeedPct: z.number().optional(),
    critRateAdd: z.number().optional(),
    critDmgAdd: z.number().optional(),
    cheerGainPct: z.number().optional(),
    voltageGainPct: z.number().optional(),
    /** 状態異常の効果量 */
    statusPowerPct: z.number().optional(),
    /** 状態異常の継続時間 */
    statusDurationPct: z.number().optional(),
    /** 範囲攻撃の半径 */
    aoeRadiusPct: z.number().optional(),
    /** Echo の 1 スタックあたりのダメージ */
    echoPowerPct: z.number().optional(),
    /** Echo の最大スタックを増やす */
    echoMaxStacksAdd: z.number().int().optional(),
    /** 撃破ごとに攻撃速度が上がる（ウェーブ内で累積） */
    killSpeedStack: z
      .object({ perKill: z.number().positive(), max: z.number().positive() })
      .optional(),
  })
  .default({});

export const talentNodeSchema = z.object({
  branch: idolTypeSchema,
  tier: talentTierSchema,
  name: z.string().min(1),
  desc: z.string().min(1),
  /** 取得に要る才能ポイント */
  cost: z.number().int().positive(),
  /** 先に取っていないと開かないノード。空ならブランチの入口 */
  requires: z.array(z.string()).default([]),
  mods: talentModsSchema,
});

export const talentsSchema = z.record(z.string(), talentNodeSchema);

export type TalentTier = z.infer<typeof talentTierSchema>;
export type TalentMods = z.infer<typeof talentModsSchema>;
export type TalentNode = z.infer<typeof talentNodeSchema>;
export type Talents = z.infer<typeof talentsSchema>;
