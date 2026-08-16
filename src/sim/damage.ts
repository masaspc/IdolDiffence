/**
 * ダメージ計算（docs/design/02-core-battle.md 2.6）。
 *
 * ```
 * 最終ダメージ = ATK × スキル倍率 × 属性相性 × (1 + 攻撃力バフ)
 *              × クリティカル倍率 × 防御軽減 × (1 + 脆弱度)
 * ```
 */
import type { Attribute, IdolType } from '../data/schema/common';
import type { Rng } from '../core/rng';

/**
 * 3 すくみ。歌 ▶ 静寂 / ダンス ▶ 喧噪 / ヴィジュアル ▶ 虚飾。
 *
 * 倍率は意図的に控えめ（1.2 / 0.9）。強すぎると敵ギミックへの対応より
 * 「最多属性に染める」が常に最適解になり、編成判断が出撃前の電卓作業に退化する。
 */
const TYPE_CHART: Record<IdolType, Record<Attribute, number>> = {
  vocal: { silence: 1.2, noise: 1.0, glare: 0.9 },
  dance: { silence: 0.9, noise: 1.2, glare: 1.0 },
  visual: { silence: 1.0, noise: 0.9, glare: 1.2 },
};

export function typeMultiplier(type: IdolType, attr: Attribute): number {
  return TYPE_CHART[type][attr];
}

export type Effectiveness = 'strong' | 'neutral' | 'weak';

export function effectivenessOf(type: IdolType, attr: Attribute): Effectiveness {
  const mul = typeMultiplier(type, attr);
  if (mul > 1) return 'strong';
  if (mul < 1) return 'weak';
  return 'neutral';
}

/** 防御軽減。DEF 100 で半減、200 で 1/3 */
export function defenseReduction(def: number): number {
  return 100 / (100 + Math.max(0, def));
}

export interface DamageInput {
  atk: number;
  skillMul: number;
  type: IdolType;
  critRate: number;
  critDmg: number;
  /** 攻撃力バフの合算（加算プール） */
  atkBonus?: number;
}

export interface DamageTarget {
  attr: Attribute;
  def: number;
  /** 被ダメージ増加（脆弱） */
  fragile?: number;
}

export interface DamageResult {
  amount: number;
  crit: boolean;
  effectiveness: Effectiveness;
}

export function computeDamage(
  attacker: DamageInput,
  target: DamageTarget,
  rng: Rng,
): DamageResult {
  const typeMul = typeMultiplier(attacker.type, target.attr);
  const crit = rng.chance(attacker.critRate);
  const critMul = crit ? 1.5 + attacker.critDmg : 1;

  const amount =
    attacker.atk *
    attacker.skillMul *
    typeMul *
    (1 + (attacker.atkBonus ?? 0)) *
    critMul *
    defenseReduction(target.def) *
    (1 + (target.fragile ?? 0));

  return {
    // 内部計算は浮動小数のまま保持し、表示だけ丸める
    amount,
    crit,
    effectiveness: effectivenessOf(attacker.type, target.attr),
  };
}
