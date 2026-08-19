/**
 * 緊迫の曲線（`bgm.ts`）。
 *
 * 06-ui-ux 6.4「観客ゲージ 20% 以下: 画面周辺が暗くなり、BGM の
 * ハイパスフィルタが強まる」。画面の減光と音のハイパスが**同じ曲線**を
 * 使うので、ここが壊れると両方いっぺんに壊れる。
 */
import { describe, expect, it } from 'vitest';
import { tensionAmount, tensionFrequency } from './bgm';

describe('緊迫の度合い', () => {
  it('20 を切るまでは効かない', () => {
    expect(tensionAmount(100)).toBe(0);
    expect(tensionAmount(21)).toBe(0);
    expect(tensionAmount(20)).toBe(0);
  });

  it('20 から 0 へ向けて滑らかに強まる', () => {
    expect(tensionAmount(10)).toBeCloseTo(0.5, 6);
    expect(tensionAmount(0)).toBe(1);
    let prev = -1;
    for (let audience = 20; audience >= 0; audience--) {
      const now = tensionAmount(audience);
      expect(now).toBeGreaterThanOrEqual(prev);
      prev = now;
    }
  });

  it('範囲の外でも壊れない', () => {
    expect(tensionAmount(-5)).toBe(1);
    expect(tensionAmount(999)).toBe(0);
  });
});

describe('ハイパスの遮断周波数', () => {
  it('普段は素通し（20Hz）、最大で 400Hz', () => {
    expect(tensionFrequency(0)).toBeCloseTo(20, 6);
    expect(tensionFrequency(1)).toBeCloseTo(400, 6);
  });

  it('度合いに対して単調に上がる', () => {
    let prev = 0;
    for (let amount = 0; amount <= 1; amount += 0.1) {
      const now = tensionFrequency(amount);
      expect(now).toBeGreaterThan(prev);
      prev = now;
    }
  });
});
