import { describe, expect, it } from 'vitest';
import { addFlat, addPct, addTypePct, emptyPool, mulPct, resolveStat } from './modifiers';

describe('resolveStat', () => {
  it('プールが空なら素通し', () => {
    expect(resolveStat(100, 'atk', [emptyPool()])).toBe(100);
  });

  it('flat → 加算プール → 乗算プール の順で適用される', () => {
    const pool = emptyPool();
    addFlat(pool, 'atk', 10); // 100 + 10 = 110
    addPct(pool, 'atk', 0.5); // 110 * 1.5 = 165
    mulPct(pool, 'atk', 2); // 165 * 2 = 330
    expect(resolveStat(100, 'atk', [pool])).toBe(330);
  });

  it('加算プールは合算される（掛け算にならない）', () => {
    const pool = emptyPool();
    addPct(pool, 'atk', 0.1);
    addPct(pool, 'atk', 0.1);
    // 1.1 * 1.1 = 1.21 ではなく 1.2
    expect(resolveStat(100, 'atk', [pool])).toBeCloseTo(120);
  });

  it('乗算プールは順に掛かる', () => {
    const pool = emptyPool();
    mulPct(pool, 'atk', 1.1);
    mulPct(pool, 'atk', 1.1);
    expect(resolveStat(100, 'atk', [pool])).toBeCloseTo(121);
  });

  it('複数プールをまたいで加算プールが合算される', () => {
    const a = emptyPool();
    const b = emptyPool();
    addPct(a, 'atk', 0.2);
    addPct(b, 'atk', 0.3);
    expect(resolveStat(100, 'atk', [a, b])).toBeCloseTo(150);
  });

  it('系統別の攻撃力加算は該当系統にだけ乗る', () => {
    const pool = emptyPool();
    addTypePct(pool, 'vocal', 0.5);
    expect(resolveStat(100, 'atk', [pool], 'vocal')).toBeCloseTo(150);
    expect(resolveStat(100, 'atk', [pool], 'dance')).toBe(100);
  });

  it('系統別の加算は他の攻撃力の加算と同じプールに合流する', () => {
    const pool = emptyPool();
    addPct(pool, 'atk', 0.2);
    addTypePct(pool, 'vocal', 0.3);
    // 1.2 * 1.3 = 1.56 ではなく 1.5
    expect(resolveStat(100, 'atk', [pool], 'vocal')).toBeCloseTo(150);
  });

  it('クリティカル率は 100% でクランプされる', () => {
    const pool = emptyPool();
    addFlat(pool, 'critRate', 5);
    expect(resolveStat(0.05, 'critRate', [pool])).toBe(1);
  });

  it('攻撃速度は +150% でクランプされる', () => {
    const pool = emptyPool();
    addPct(pool, 'attackSpeed', 10);
    expect(resolveStat(1, 'attackSpeed', [pool])).toBe(2.5);
  });
});
