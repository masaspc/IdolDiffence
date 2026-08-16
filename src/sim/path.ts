/**
 * 経路。ステージのウェイポイントを、区間長つきの走行可能なパスに変換する。
 * 敵はこの上を線形補間で進む（マス単位の探索は行わない）。
 */
import type { Stage } from '../data/schema/stage';
import { vec, type Vec2 } from '../core/vec';

export interface PathSegment {
  from: Vec2;
  to: Vec2;
  /** 区間長（マス単位） */
  length: number;
}

export interface Path {
  segments: PathSegment[];
  totalLength: number;
  /** 経路の終端 = センターステージ */
  goal: Vec2;
}

/** ウェイポイントはセル座標。セル中心へ寄せてから区間にする */
export function buildPaths(stage: Stage): Path[] {
  return stage.lanes.map((lane) => {
    const points = lane.waypoints.map(([x, y]) => vec(x + 0.5, y + 0.5));
    const segments: PathSegment[] = [];
    let totalLength = 0;

    for (let i = 0; i < points.length - 1; i++) {
      const from = points[i];
      const to = points[i + 1];
      if (!from || !to) continue;
      const length = Math.hypot(to.x - from.x, to.y - from.y);
      segments.push({ from, to, length });
      totalLength += length;
    }

    const goal = points[points.length - 1] ?? vec(0, 0);
    return { segments, totalLength, goal };
  });
}

/**
 * 点から経路までの最短距離。
 *
 * **区間の始点だけを見てはいけない。** 経路は折れ線なので、長い直線の
 * 真横に立っている点は、どのウェイポイントからも遠いのに経路には近い。
 * 始点との距離で近似すると、そういう場所が丸ごと別のレーンへ吸われる
 * （B2 の中央レーンは区間が 1 本しかなく、始点が盤面の左端にあるため、
 * どの配置マスも「中央レーンから最も遠い」と判定されていた）。
 */
export function distanceToPath(path: Path, x: number, y: number): number {
  let best = Number.POSITIVE_INFINITY;
  for (const segment of path.segments) {
    const dist = distanceToSegment(segment, x, y);
    if (dist < best) best = dist;
  }
  return best;
}

/**
 * この座標がいちばん近い経路の番号。同着なら若いレーン。
 * ボスの沈黙が「どのレーンのメンバーを止めるか」に使う
 */
export function nearestLane(paths: readonly Path[], x: number, y: number): number {
  let best = 0;
  let bestDist = Number.POSITIVE_INFINITY;
  paths.forEach((path, lane) => {
    const dist = distanceToPath(path, x, y);
    if (dist < bestDist) {
      bestDist = dist;
      best = lane;
    }
  });
  return best;
}

/** 点と線分の距離。線分上への射影を [0,1] に丸めてから測る */
function distanceToSegment(segment: PathSegment, x: number, y: number): number {
  const dx = segment.to.x - segment.from.x;
  const dy = segment.to.y - segment.from.y;
  const lengthSq = dx * dx + dy * dy;
  // 長さ 0 の区間（同じウェイポイントが並んだとき）は点として扱う
  const t =
    lengthSq === 0
      ? 0
      : Math.min(1, Math.max(0, ((x - segment.from.x) * dx + (y - segment.from.y) * dy) / lengthSq));
  return Math.hypot(segment.from.x + t * dx - x, segment.from.y + t * dy - y);
}
