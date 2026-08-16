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
