/**
 * 攻撃処理。攻撃間隔の消化 → ターゲット選択 → ダメージ適用。
 *
 * world への依存を避けるため、ダメージの適用は呼び出し側のコールバックに委ねる。
 * こうしておくとテストで単体のユニットだけを回せる。
 */
import { withinRange } from '../../core/vec';
import type { Rng } from '../../core/rng';
import { computeDamage, type DamageResult } from '../damage';
import { applyStatus, type Enemy, type Unit } from '../entities';
import { findTarget } from './targeting';

export interface CombatContext {
  rng: Rng;
  enemies: readonly Enemy[];
  /** ダメージを実際に反映する。撃破判定も呼び出し側の責務 */
  applyDamage: (enemy: Enemy, result: DamageResult) => void;
}

export function updateUnit(unit: Unit, ctx: CombatContext, dtMs: number): void {
  unit.lastAttackAgeMs += dtMs;
  unit.cooldownMs -= dtMs;
  if (unit.cooldownMs > 0) return;

  const target = findTarget(unit, ctx.enemies);
  if (!target) {
    // 撃てないあいだクールダウンが際限なく貯まると、
    // 敵が射程に入った瞬間に連射が起きる。0 で止める
    unit.cooldownMs = 0;
    unit.lastTargetPos = null;
    return;
  }

  unit.cooldownMs = unit.attackIntervalMs;
  unit.lastAttackAgeMs = 0;
  unit.lastTargetPos = { x: target.pos.x, y: target.pos.y };

  const victims =
    unit.attack.kind === 'aoe_ring'
      ? ctx.enemies.filter(
          (e) =>
            e.alive &&
            (!e.flying || unit.attack.canHitFlying) &&
            withinRange(target.pos, e.pos, unit.attack.radius),
        )
      : [target];

  for (const victim of victims) {
    const result = computeDamage(
      {
        atk: unit.atk,
        skillMul: unit.attack.skillMul,
        type: unit.type,
        critRate: unit.critRate,
        critDmg: unit.critDmg,
      },
      { attr: victim.attr, def: victim.def },
      ctx.rng,
    );
    ctx.applyDamage(victim, result);

    const onHit = unit.attack.onHit;
    if (onHit && victim.alive) {
      applyStatus(victim, {
        kind: onHit.status,
        value: onHit.value,
        remainingMs: onHit.durationMs,
      });
    }
  }
}
