import { describe, expect, it } from 'vitest';
import { computeDamage, defenseReduction, effectivenessOf, typeMultiplier } from './damage';
import { createRng } from '../core/rng';

/** クリティカルを起こさない / 必ず起こす RNG */
const noCrit = () => createRng(1) && { ...createRng(1), chance: () => false, next: () => 0.99 };
const allCrit = () => ({ ...createRng(1), chance: () => true });

describe('typeMultiplier', () => {
  it('3 すくみが循環する', () => {
    expect(typeMultiplier('vocal', 'silence')).toBe(1.2);
    expect(typeMultiplier('dance', 'noise')).toBe(1.2);
    expect(typeMultiplier('visual', 'glare')).toBe(1.2);
  });

  it('不利は 0.9、等倍は 1.0', () => {
    expect(typeMultiplier('vocal', 'glare')).toBe(0.9);
    expect(typeMultiplier('vocal', 'noise')).toBe(1.0);
  });

  it('どの系統も有利・等倍・不利を 1 つずつ持つ', () => {
    for (const type of ['vocal', 'dance', 'visual'] as const) {
      const muls = (['silence', 'noise', 'glare'] as const).map((a) => typeMultiplier(type, a));
      expect(muls.filter((m) => m > 1)).toHaveLength(1);
      expect(muls.filter((m) => m === 1)).toHaveLength(1);
      expect(muls.filter((m) => m < 1)).toHaveLength(1);
    }
  });

  it('effectivenessOf が倍率と一致する', () => {
    expect(effectivenessOf('vocal', 'silence')).toBe('strong');
    expect(effectivenessOf('vocal', 'noise')).toBe('neutral');
    expect(effectivenessOf('vocal', 'glare')).toBe('weak');
  });
});

describe('defenseReduction', () => {
  it('DEF 0 で軽減なし', () => {
    expect(defenseReduction(0)).toBe(1);
  });

  it('DEF 100 で半減、200 で 1/3', () => {
    expect(defenseReduction(100)).toBeCloseTo(0.5);
    expect(defenseReduction(200)).toBeCloseTo(1 / 3);
  });

  it('負の DEF は 0 として扱う', () => {
    expect(defenseReduction(-50)).toBe(1);
  });
});

describe('computeDamage', () => {
  const attacker = {
    atk: 100,
    skillMul: 1,
    type: 'vocal' as const,
    critRate: 0,
    critDmg: 0.5,
  };

  it('基本式どおりに計算する', () => {
    const result = computeDamage(attacker, { attr: 'noise', def: 0 }, noCrit());
    expect(result.amount).toBeCloseTo(100);
    expect(result.crit).toBe(false);
  });

  it('属性相性が乗る', () => {
    const strong = computeDamage(attacker, { attr: 'silence', def: 0 }, noCrit());
    const weak = computeDamage(attacker, { attr: 'glare', def: 0 }, noCrit());
    expect(strong.amount).toBeCloseTo(120);
    expect(weak.amount).toBeCloseTo(90);
    expect(strong.effectiveness).toBe('strong');
    expect(weak.effectiveness).toBe('weak');
  });

  it('防御で軽減される', () => {
    const result = computeDamage(attacker, { attr: 'noise', def: 100 }, noCrit());
    expect(result.amount).toBeCloseTo(50);
  });

  it('クリティカルで 1.5 + critDmg 倍になる', () => {
    const result = computeDamage(attacker, { attr: 'noise', def: 0 }, allCrit());
    expect(result.crit).toBe(true);
    expect(result.amount).toBeCloseTo(200); // 1.5 + 0.5
  });

  it('攻撃力バフと脆弱が乗る', () => {
    const result = computeDamage(
      { ...attacker, atkBonus: 0.5 },
      { attr: 'noise', def: 0, fragile: 0.2 },
      noCrit(),
    );
    expect(result.amount).toBeCloseTo(100 * 1.5 * 1.2);
  });
});
