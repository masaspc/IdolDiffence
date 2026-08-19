/**
 * 子ウサギの客席（`audience.ts`）。
 *
 * 見張るのは 2 つ ——
 * - **席が決定的であること。** 同じステージなら毎回同じ客席
 * - **同接と席の数が正しく連動すること。** 減った観客だけが帰り、
 *   残っているあいだは最後のひとりが席に残る
 */
import { describe, expect, it } from 'vitest';
import { blockedCells, filledCount, interleave, seatsAround } from './audience';
import { chapters, getStage } from '../data';

const GOAL: readonly [number, number] = [8, 4];
const PREV: readonly [number, number] = [8, 3];

describe('席の並び', () => {
  it('同じ入力からは同じ席が出る', () => {
    const a = seatsAround(GOAL, PREV, 16, 9, 0);
    const b = seatsAround(GOAL, PREV, 16, 9, 0);
    expect(a).toEqual(b);
    expect(a.length).toBeGreaterThan(0);
  });

  it('席は盤面の中に収まる', () => {
    for (const laneIndex of [0, 1, 2]) {
      for (const seat of seatsAround(GOAL, PREV, 16, 9, laneIndex)) {
        expect(seat.x).toBeGreaterThan(0);
        expect(seat.x).toBeLessThan(16);
        expect(seat.y).toBeGreaterThan(0);
        expect(seat.y).toBeLessThan(9);
      }
    }
  });

  it('客席は敵の来る方向の先（ゴールの向こう側）に並ぶ', () => {
    // 敵が上から下りてくるなら、客席はゴールより下
    const seats = seatsAround(GOAL, PREV, 16, 9, 0);
    const below = seats.filter((s) => s.y > GOAL[1] + 0.5).length;
    expect(below).toBeGreaterThan(seats.length * 0.7);
  });

  it('盤面の端のゴールでは向きを選び直して席を確保する', () => {
    // S1 のゴールは右端。前方（盤外）に開くと 2 席になったので、
    // 直交方向も試して生き残りの多い向きを採る
    const interior = seatsAround([8, 4], [8, 3], 16, 9, 0).length;
    const edge = seatsAround([15, 4], [14, 4], 16, 9, 0).length;
    expect(edge).toBeGreaterThanOrEqual(Math.floor(interior / 2));
    expect(edge).toBeGreaterThanOrEqual(6);
  });

  it('ひとつ手前が無ければ真下向きとみなして壊れない', () => {
    const seats = seatsAround([8, 4], null, 16, 9, 0);
    expect(seats.length).toBeGreaterThan(0);
  });

  it('経路と配置マスの上には座らない（全ステージの実データ）', () => {
    // S28 では経路に 5 席・配置マスに 10 席が重なっていた（Codex の実測）。
    // 盤面の枠だけでなく、歩く場所と押す場所も避けることを全ステージで見張る
    for (const stageId of chapters.flatMap((c) => c.stages)) {
      const stage = getStage(stageId);
      const blocked = blockedCells(stage.lanes, stage.placeable);
      for (const [laneIndex, lane] of stage.lanes.entries()) {
        const wp = lane.waypoints;
        const last = wp[wp.length - 1];
        if (!last) continue;
        const prev = wp.length > 1 ? (wp[wp.length - 2] ?? null) : null;
        const seats = seatsAround(last, prev, stage.grid.w, stage.grid.h, laneIndex, blocked);
        for (const seat of seats) {
          const cell = `${Math.floor(seat.x)},${Math.floor(seat.y)}`;
          expect(blocked.has(cell), `${stageId} lane${laneIndex} の席が ${cell} に重なる`).toBe(
            false,
          );
        }
      }
    }
  });

  it('経路のウェイポイント間のセルも立入禁止になる', () => {
    const blocked = blockedCells([{ waypoints: [[0, 2], [4, 2]] }], [[6, 6]]);
    for (let x = 0; x <= 4; x++) expect(blocked.has(`${x},2`)).toBe(true);
    expect(blocked.has('6,6')).toBe(true);
    expect(blocked.has('5,5')).toBe(false);
  });
});

describe('複数ゴールの混ぜ方', () => {
  it('交互に取るので、前から埋めてもゴールごとに同じくらい残る', () => {
    // S18 の 4 ゴール（7/8/7/7 席）で「先頭 2 ゴールだけ満席、残り無人」に
    // なっていた。各ゴールの 1 席目、2 席目…と取れば前半分でも全ゴールに散る
    const groups = [
      ['a1', 'a2', 'a3', 'a4'],
      ['b1', 'b2', 'b3', 'b4'],
      ['c1', 'c2', 'c3', 'c4'],
    ];
    const mixed = interleave(groups);
    expect(mixed).toHaveLength(12);
    const half = mixed.slice(0, 6);
    expect(half.filter((s) => s.startsWith('a')).length).toBe(2);
    expect(half.filter((s) => s.startsWith('b')).length).toBe(2);
    expect(half.filter((s) => s.startsWith('c')).length).toBe(2);
  });

  it('長さが違うグループでも取りこぼさない', () => {
    expect(interleave([['a1'], ['b1', 'b2', 'b3']])).toEqual(['a1', 'b1', 'b2', 'b3']);
    expect(interleave([])).toEqual([]);
  });
});

describe('席の埋まり', () => {
  it('同接 100 で満席、半分でおよそ半分', () => {
    expect(filledCount(14, 100)).toBe(14);
    expect(filledCount(14, 50)).toBe(7);
  });

  it('同接が残っているあいだは最後のひとりが残る', () => {
    expect(filledCount(14, 1)).toBe(1);
    expect(filledCount(14, 0)).toBe(0);
  });

  it('同接が減ると席は増えない（単調）', () => {
    let prev = Infinity;
    for (let audience = 100; audience >= 0; audience--) {
      const now = filledCount(14, audience);
      expect(now).toBeLessThanOrEqual(prev);
      prev = now;
    }
  });

  it('席が無いステージでも壊れない', () => {
    expect(filledCount(0, 80)).toBe(0);
  });
});
