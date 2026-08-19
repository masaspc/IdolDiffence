/**
 * 子ウサギの客席（`audience.ts`）。
 *
 * 見張るのは 2 つ ——
 * - **席が決定的であること。** 同じステージなら毎回同じ客席
 * - **同接と席の数が正しく連動すること。** 減った観客だけが帰り、
 *   残っているあいだは最後のひとりが席に残る
 */
import { describe, expect, it } from 'vitest';
import { filledCount, seatsAround } from './audience';

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
