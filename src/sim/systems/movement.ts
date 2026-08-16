/**
 * 敵の移動。ウェイポイント追従を線形補間で行う。
 * 減速などの状態異常は速度係数として掛かる。
 */
import type { Enemy } from '../entities';
import { slowFactor } from '../entities';
import type { Path } from '../path';

/** @returns ゴールに到達したら true */
export function advanceEnemy(enemy: Enemy, path: Path, dtMs: number): boolean {
  enemy.prevPos.x = enemy.pos.x;
  enemy.prevPos.y = enemy.pos.y;

  const speed = enemy.baseSpeed * slowFactor(enemy.statuses);
  let remaining = (speed * dtMs) / 1000;

  while (remaining > 0) {
    const segment = path.segments[enemy.pathIndex];
    if (!segment) return true; // 区間を使い切った = ゴール

    const distanceLeft = segment.length * (1 - enemy.pathT);
    if (remaining < distanceLeft) {
      const moved = remaining / segment.length;
      enemy.pathT += moved;
      enemy.progress += remaining;
      remaining = 0;
    } else {
      enemy.progress += distanceLeft;
      remaining -= distanceLeft;
      enemy.pathIndex += 1;
      enemy.pathT = 0;
      if (enemy.pathIndex >= path.segments.length) {
        enemy.pos.x = path.goal.x;
        enemy.pos.y = path.goal.y;
        return true;
      }
    }
  }

  const segment = path.segments[enemy.pathIndex];
  if (!segment) return true;
  enemy.pos.x = segment.from.x + (segment.to.x - segment.from.x) * enemy.pathT;
  enemy.pos.y = segment.from.y + (segment.to.y - segment.from.y) * enemy.pathT;
  return false;
}
