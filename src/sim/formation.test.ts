/**
 * フォーメーション（03-progression.md ④）。
 *
 * 「置く場所」で結果が変わることが要なので、**成立する配置と成立しない配置の
 * 両方**を確かめる。片側だけだと、常に成立する実装でもテストが通ってしまう。
 */
import { describe, expect, it } from 'vitest';
import { evaluateFormations, formationModsFor, type FormationUnit } from './systems/formation';
import { createWorld, type BattleWorld } from './world';
import { getIdol } from '../data';

let nextId = 1;

function unit(idolId: string, x: number, y: number): FormationUnit {
  const def = getIdol(idolId);
  return {
    id: nextId++,
    idolId,
    type: def.type,
    cell: { x, y },
    pos: { x: x + 0.5, y: y + 0.5 },
    tags: def.tags,
  };
}

const ids = (result: ReturnType<typeof evaluateFormations>, id: string): string[] =>
  result.hits.filter((h) => h.id === id).map((h) => h.name);

describe('同系統ペア', () => {
  it('隣り合うと双方の攻撃力が上がる', () => {
    // V1 と V2 はどちらも歌
    const a = unit('V1', 2, 3);
    const b = unit('V2', 4, 3);
    const result = evaluateFormations([a, b], null);
    expect(ids(result, 'pair_type')).toHaveLength(1);
    expect(formationModsFor(result, a.id).atkMul).toBeCloseTo(1.12);
    expect(formationModsFor(result, b.id).atkMul).toBeCloseTo(1.12);
  });

  it('離れていると成立しない', () => {
    const result = evaluateFormations([unit('V1', 2, 3), unit('V2', 9, 3)], null);
    expect(ids(result, 'pair_type')).toHaveLength(0);
  });

  it('系統が違えば成立しない', () => {
    const result = evaluateFormations([unit('V1', 2, 3), unit('D1', 4, 3)], null);
    expect(ids(result, 'pair_type')).toHaveLength(0);
  });
});

describe('同ユニットペア', () => {
  it('原作のユニットが同じなら攻撃速度が上がる', () => {
    // かぐや と 彩葉 はどちらも「かぐや・いろP」
    const a = unit('V1', 2, 3);
    const b = unit('D1', 4, 3);
    const result = evaluateFormations([a, b], null);
    expect(ids(result, 'pair_tag')).toHaveLength(1);
    expect(formationModsFor(result, a.id).attackSpeedMul).toBeCloseTo(1.1);
  });

  it('タグが違えば成立しない', () => {
    // かぐや（かぐや・いろP）と ヤチヨ（ツクヨミのライバー）
    const result = evaluateFormations([unit('V1', 2, 3), unit('Vi1', 4, 3)], null);
    expect(ids(result, 'pair_tag')).toHaveLength(0);
  });
});

describe('三色の陣', () => {
  it('3 系統が固まると攻撃速度と月華が伸びる', () => {
    const a = unit('V1', 4, 4);
    const b = unit('D1', 6, 4);
    const c = unit('Vi1', 5, 6);
    const result = evaluateFormations([a, b, c], null);
    expect(ids(result, 'trio')).toHaveLength(1);
    expect(result.voltageMul).toBeCloseTo(1.1);
    expect(formationModsFor(result, c.id).attackSpeedMul).toBeGreaterThan(1);
  });

  it('2 系統しかなければ成立しない', () => {
    const result = evaluateFormations(
      [unit('V1', 4, 4), unit('V2', 6, 4), unit('D1', 5, 6)],
      null,
    );
    expect(ids(result, 'trio')).toHaveLength(0);
    expect(result.voltageMul).toBe(1);
  });
});

describe('一列ダンス', () => {
  it('同じ行に 3 人連なると両端の射程が伸びる', () => {
    const a = unit('V1', 2, 3);
    const b = unit('D1', 4, 3);
    const c = unit('Vi1', 6, 3);
    const result = evaluateFormations([a, b, c], null);
    expect(ids(result, 'line')).toHaveLength(1);
    expect(formationModsFor(result, a.id).rangeMul).toBeCloseTo(1.3);
    expect(formationModsFor(result, c.id).rangeMul).toBeCloseTo(1.3);
    // 真ん中は伸びない。端に置く意味を作る
    expect(formationModsFor(result, b.id).rangeMul).toBe(1);
  });

  it('行が同じでも離れていれば成立しない', () => {
    const result = evaluateFormations(
      [unit('V1', 1, 3), unit('D1', 7, 3), unit('Vi1', 13, 3)],
      null,
    );
    expect(ids(result, 'line')).toHaveLength(0);
  });
});

describe('センター護衛', () => {
  it('センターの隣に 2 人いると攻撃力が上がる', () => {
    const center = unit('V1', 4, 4);
    const result = evaluateFormations([center, unit('D1', 6, 4), unit('Vi1', 4, 6)], 'V1');
    expect(ids(result, 'center_guard')).toHaveLength(1);
    expect(formationModsFor(result, center.id).atkMul).toBeGreaterThanOrEqual(1.25);
  });

  it('1 人では成立しない', () => {
    const result = evaluateFormations([unit('V1', 4, 4), unit('D1', 6, 4)], 'V1');
    expect(ids(result, 'center_guard')).toHaveLength(0);
  });
});

describe('盤面への反映', () => {
  function rich(): BattleWorld {
    const world = createWorld('S3', 1, { party: ['V1', 'V2', 'D1', 'Vi1'], center: 'V1' });
    world.addCheer(20_000);
    return world;
  }

  it('隣に同系統を置くと、先に置いた側の攻撃力も上がる', () => {
    const world = rich();
    const first = world.placeUnit('V1', 2, 3);
    if (typeof first === 'string') throw new Error(first);
    const before = world.snapshot().units.find((u) => u.id === first.id)!.atk;

    // S3 の (3,3) は (2,3) の隣。同じ歌なのでペアが成立する
    const second = world.placeUnit('V2', 3, 3);
    if (typeof second === 'string') throw new Error(second);

    const after = world.snapshot().units.find((u) => u.id === first.id)!.atk;
    expect(after).toBeGreaterThan(before);
    expect(world.snapshot().formations.some((f) => f.id === 'pair_type')).toBe(true);
  });

  it('売却するとボーナスも消える', () => {
    const world = rich();
    const first = world.placeUnit('V1', 2, 3);
    const second = world.placeUnit('V2', 3, 3);
    if (typeof first === 'string' || typeof second === 'string') throw new Error('置けなかった');

    const paired = world.snapshot().units.find((u) => u.id === first.id)!.atk;
    world.sellUnit(second.id);
    const alone = world.snapshot().units.find((u) => u.id === first.id)!.atk;

    expect(alone).toBeLessThan(paired);
    expect(world.snapshot().formations).toHaveLength(0);
  });
});
