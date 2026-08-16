/**
 * ターゲティング。M1 はデフォルトの「先頭」のみ。
 * 最後尾 / 最大HP / 最小HP / 弱点は M3 で追加する（02-core-battle.md 2.7）。
 */
import { withinRange } from '../../core/vec';
import type { Enemy, Unit } from '../entities';

export type TargetingMode = 'first';

/** 射程内で最もゴールに近い敵を返す */
export function findTarget(unit: Unit, enemies: readonly Enemy[]): Enemy | null {
  let best: Enemy | null = null;
  for (const enemy of enemies) {
    if (!enemy.alive) continue;
    if (enemy.flying && !unit.attack.canHitFlying) continue;
    if (!withinRange(unit.pos, enemy.pos, unit.range)) continue;
    if (!best || enemy.progress > best.progress) best = enemy;
  }
  return best;
}
