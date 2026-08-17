/**
 * 敵の移動。ウェイポイント追従を線形補間で行う。
 * 減速などの状態異常は速度係数として掛かる。
 */
import type { Enemy } from '../entities';
import { enrageFactor, isImmobilized, slowFactor } from '../entities';
import type { Path } from '../path';

/** @returns ゴールに到達したら true */
export function advanceEnemy(enemy: Enemy, path: Path, dtMs: number): boolean {
  enemy.prevPos.x = enemy.pos.x;
  enemy.prevPos.y = enemy.pos.y;

  // 魅了・スタン中は足が止まる。減速と違い、完全に 0 になる
  if (isImmobilized(enemy.statuses)) return false;

  // 手負いの加速（石上麻呂）は減速と**掛け算**にする。足し算にすると
  // 減速を撒いた側が加速を打ち消しきれてしまい、「1 体ずつ落とす」という問いが消える
  const speed = enemy.baseSpeed * slowFactor(enemy.statuses) * enrageFactor(enemy);
  const step = (speed * dtMs) / 1000;

  // 飛行敵は経路を辿らず、ゴールへ直線で向かう（04-content.md 対空のルール）。
  // 地上と同じ迂回路を進ませると、対空を要求するステージの移動時間が成立しない
  if (enemy.flying) return advanceFlying(enemy, path, step);

  return walkPath(enemy, path, step);
}

/** 経路上を `step` マスぶん進める。@returns ゴールに到達したら true */
function walkPath(enemy: Enemy, path: Path, step: number): boolean {
  // 動かないなら位置も変わらない。毎フレームの再計算を省くだけでなく、
  // 完全停止した敵の座標を区間から作り直さないという保証にもなる
  if (step <= 0) return false;

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

  syncPosition(enemy, path);
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

/**
 * 経路上を後ろへ押し戻す（D2「たまくだき」・V3 覚醒「咆哮」）。
 *
 * 進捗を戻すだけでなく `pathIndex` / `pathT` も巻き戻す。
 * 進捗だけ戻すとターゲティングの「先頭」判定と実際の位置がずれ、
 * 押し戻したはずの敵が最優先で狙われ続ける。
 */
export function knockbackEnemy(enemy: Enemy, path: Path, distance: number): void {
  if (distance <= 0) return;

  if (enemy.flying) {
    // 飛行敵には経路が無いので、ゴールから遠ざける向きへ押す
    const dx = enemy.pos.x - path.goal.x;
    const dy = enemy.pos.y - path.goal.y;
    const length = Math.hypot(dx, dy);
    if (length === 0) return;
    const moved = Math.min(distance, enemy.progress);
    enemy.pos.x += (dx / length) * moved;
    enemy.pos.y += (dy / length) * moved;
    enemy.progress -= moved;
    return;
  }

  let remaining = Math.min(distance, enemy.progress);
  enemy.progress -= remaining;

  while (remaining > 0) {
    const segment = path.segments[enemy.pathIndex];
    if (!segment) {
      // ゴール到達済みの区間から戻る場合は最終区間の末尾から辿り直す
      enemy.pathIndex = path.segments.length - 1;
      enemy.pathT = 1;
      continue;
    }

    const behind = segment.length * enemy.pathT;
    if (remaining <= behind) {
      enemy.pathT -= remaining / segment.length;
      remaining = 0;
    } else {
      remaining -= behind;
      if (enemy.pathIndex === 0) {
        enemy.pathT = 0;
        break;
      }
      enemy.pathIndex -= 1;
      enemy.pathT = 1;
    }
  }

  syncPosition(enemy, path);
}

function syncPosition(enemy: Enemy, path: Path): void {
  const segment = path.segments[enemy.pathIndex];
  if (!segment) return;
  enemy.pos.x = segment.from.x + (segment.to.x - segment.from.x) * enemy.pathT;
  enemy.pos.y = segment.from.y + (segment.to.y - segment.from.y) * enemy.pathT;
}
