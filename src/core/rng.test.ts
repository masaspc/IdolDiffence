import { describe, expect, it } from 'vitest';
import { createRng, seedFromString } from './rng';

describe('createRng', () => {
  it('同じ seed からは同じ列が出る（決定性）', () => {
    const a = createRng(12345);
    const b = createRng(12345);
    const seqA = Array.from({ length: 20 }, () => a.next());
    const seqB = Array.from({ length: 20 }, () => b.next());
    expect(seqA).toEqual(seqB);
  });

  it('違う seed からは違う列が出る', () => {
    const a = createRng(1);
    const b = createRng(2);
    expect(a.next()).not.toBe(b.next());
  });

  it('0 以上 1 未満に収まる', () => {
    const rng = createRng(99);
    for (let i = 0; i < 1000; i++) {
      const v = rng.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('int は両端を含む範囲に収まる', () => {
    const rng = createRng(7);
    const seen = new Set<number>();
    for (let i = 0; i < 500; i++) {
      const v = rng.int(1, 3);
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(1);
      expect(v).toBeLessThanOrEqual(3);
      seen.add(v);
    }
    expect(seen).toEqual(new Set([1, 2, 3]));
  });

  it('state を保存・復元すると続きが再現できる', () => {
    const rng = createRng(42);
    rng.next();
    rng.next();
    const saved = rng.getState();
    const expected = [rng.next(), rng.next(), rng.next()];

    const restored = createRng(0);
    restored.setState(saved);
    expect([restored.next(), restored.next(), restored.next()]).toEqual(expected);
  });

  it('pick は空配列で undefined を返す', () => {
    const rng = createRng(1);
    expect(rng.pick([])).toBeUndefined();
    expect(rng.pick(['a'])).toBe('a');
  });

  it('chance(0) は常に false、chance(1) は常に true', () => {
    const rng = createRng(3);
    for (let i = 0; i < 100; i++) {
      expect(rng.chance(0)).toBe(false);
      expect(rng.chance(1)).toBe(true);
    }
  });
});

describe('seedFromString', () => {
  it('同じ文字列からは同じ seed が出る', () => {
    expect(seedFromString('S1')).toBe(seedFromString('S1'));
  });

  it('違う文字列からは違う seed が出る', () => {
    expect(seedFromString('S1')).not.toBe(seedFromString('S2'));
  });

  it('32bit 符号なし整数を返す', () => {
    const seed = seedFromString('月見 ヤチヨ');
    expect(Number.isInteger(seed)).toBe(true);
    expect(seed).toBeGreaterThanOrEqual(0);
    expect(seed).toBeLessThanOrEqual(0xffffffff);
  });
});
