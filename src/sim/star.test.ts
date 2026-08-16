/**
 * ★難度（02-core-battle.md 2.10）。
 *
 * ここが崩れると「★10 が最終目標」でなくなる。
 * 3 軸に分散していること・追加ルールが巡回することを固定する。
 */
import { describe, expect, it } from 'vitest';
import {
  clampStar,
  MAX_STAR,
  MIN_STAR,
  RULE_STAR,
  starCoefficients,
  starRuleText,
  weakenedType,
} from './star';
import { createWorld } from './world';

describe('係数', () => {
  it('★1 は素のまま', () => {
    expect(starCoefficients(1)).toEqual({ hpMul: 1, defAdd: 0, countMul: 1, rewardMul: 1 });
  });

  it('HP だけでなく DEF と密度にも分散している', () => {
    // HP だけを膨らませると殴り合いが間延びするだけになる
    const ten = starCoefficients(10);
    expect(ten.hpMul).toBeGreaterThan(1);
    expect(ten.defAdd).toBeGreaterThan(0);
    expect(ten.countMul).toBeGreaterThan(1);
  });

  it('★が上がるほど単調に重くなる', () => {
    for (let star = MIN_STAR; star < MAX_STAR; star++) {
      const a = starCoefficients(star);
      const b = starCoefficients(star + 1);
      expect(b.hpMul).toBeGreaterThan(a.hpMul);
      expect(b.defAdd).toBeGreaterThan(a.defAdd);
      expect(b.countMul).toBeGreaterThan(a.countMul);
      expect(b.rewardMul).toBeGreaterThan(a.rewardMul);
    }
  });

  it('3 軸の積が ★10 で約 60 倍になる（恒久強化の到達点と一致させる）', () => {
    const ten = starCoefficients(10);
    // 防御係数は軽減率の比。基準敵 DEF 60 で考える
    const reduction = (def: number): number => 100 / (100 + def);
    const defFactor = reduction(60) / reduction(60 + ten.defAdd);
    const total = ten.hpMul * defFactor * ten.countMul;
    expect(total).toBeGreaterThan(50);
    expect(total).toBeLessThan(70);
  });
});

describe('範囲', () => {
  it('範囲外は丸める', () => {
    expect(clampStar(0)).toBe(MIN_STAR);
    expect(clampStar(99)).toBe(MAX_STAR);
    expect(clampStar(Number.NaN)).toBe(MIN_STAR);
    expect(clampStar(3.4)).toBe(3);
  });
});

describe('追加ルール', () => {
  it('★6 までは付かない', () => {
    for (let star = 1; star < RULE_STAR; star++) {
      expect(weakenedType(star)).toBeNull();
      expect(starRuleText(star)).toBeNull();
    }
  });

  it('★7 以降は系統が巡回する（同じ編成で通し続けられない）', () => {
    // 固定だとその系統を外すだけで無効化できてしまう
    expect(weakenedType(7)).toBe('vocal');
    expect(weakenedType(8)).toBe('dance');
    expect(weakenedType(9)).toBe('visual');
    expect(weakenedType(10)).toBe('vocal');
  });
});

describe('盤面への反映', () => {
  const atkOf = (star: number, idolId: string): number => {
    const world = createWorld('S1', 1, { party: [idolId], center: null, star });
    world.addCheer(5000);
    const unit = world.placeUnit(idolId, 4, 6);
    if (typeof unit === 'string') throw new Error(unit);
    return world.snapshot().units[0]!.atk;
  };

  it('★7 は歌だけ弱くなる', () => {
    expect(atkOf(7, 'V1')).toBeLessThan(atkOf(6, 'V1'));
    expect(atkOf(7, 'D1')).toBe(atkOf(6, 'D1'));
  });

  it('★8 はダンスだけ弱くなる', () => {
    expect(atkOf(8, 'D1')).toBeLessThan(atkOf(6, 'D1'));
    expect(atkOf(8, 'V1')).toBe(atkOf(6, 'V1'));
  });

  it('敵が硬くなり、数も増える', () => {
    const spawnsAt = (star: number): number =>
      createWorld('S3', 1, { star }).totalSpawnCount;
    expect(spawnsAt(10)).toBeGreaterThan(spawnsAt(1));
  });

  it('スナップショットに★とルールが出る（プレイヤーが理由を知らないまま弱くならない）', () => {
    const snapshot = createWorld('S1', 1, { star: 8 }).snapshot();
    expect(snapshot.star).toBe(8);
    expect(snapshot.starRule).toContain('ダンス');
  });
});
