/**
 * ボスの挙動（04-content.md 4.3）。
 *
 * ボスは「HP が大きい敵」ではなく**問いを出す敵**として置いている。
 * 数値は `enemies.json` にあるので、ここには判断のロジックだけを置く。
 */
import type { Attribute } from '../../data/schema/common';
import type { EnemyTraits } from '../../data/schema/enemy';

/**
 * 残 HP の割合から、いま乗るべき属性を決める（ボス「偽アカウント」）。
 *
 * **しきい値の高い順に見て、通過したものすべてを上書きする。**
 * 「高い順に見て最初に一致したものを採る」だと、一撃で 2 段飛ばしたときに
 * 中間のフェーズで止まってしまう（66% → 10% へ落ちても喧噪のまま）。
 *
 * @param base 定義上の属性。フェーズを持たない敵はこれがそのまま返る
 * @returns 現在の属性
 */
export function phaseAttribute(
  traits: EnemyTraits,
  base: Attribute,
  hpRatio: number,
): Attribute {
  const phases = traits.phases;
  if (!phases || phases.length === 0) return base;

  let current = base;
  for (const phase of [...phases].sort((a, b) => b.at - a.at)) {
    if (hpRatio <= phase.at) current = phase.attr;
  }
  return current;
}
