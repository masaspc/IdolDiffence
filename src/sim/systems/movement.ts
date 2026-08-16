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
  const step = (speed * dtMs) / 1000;

  // 飛行敵は経路を辿らず、ゴールへ直線で向かう（04-content.md 対空のルール）。
  // 地上と同じ迂回路を進ませると、対空を要求するステージの移動時間が成立しない
  if (enemy.flying) return advanceFlying(enemy, path, step);

  let remaining = step;

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

/**
 * 飛行敵の直線移動。
 * `progress` は「ゴールまでの残り距離を、直線距離から引いた値」として持たせる。
 * 地上敵と同じ尺度で「先頭」を判定できるようにするため。
 */
function advanceFlying(enemy: Enemy, path: Path, step: number): boolean {
  const dx = path.goal.x - enemy.pos.x;
  const dy = path.goal.y - enemy.pos.y;
  const distance = Math.hypot(dx, dy);

  if (distance <= step || distance === 0) {
    enemy.pos.x = path.goal.x;
    enemy.pos.y = path.goal.y;
    enemy.progress = path.totalLength;
    return true;
  }

  enemy.pos.x += (dx / distance) * step;
  enemy.pos.y += (dy / distance) * step;
  enemy.progress += step;
  return false;
}
