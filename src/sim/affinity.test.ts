/**
 * 名指しの相性（04-content.md 4.1）。
 *
 * 原作の関係には**良い相性と悪い相性の両方**がある。FUSHI がかぐやと犬DOGE に
 * 敵対的なのは原作の設定なので、タグでまとめず相手を名指しで書けるようにしてある。
 */
import { describe, expect, it } from 'vitest';
import { evaluateFormations, formationModsFor, type FormationUnit } from './systems/formation';
import { canonIds, getIdol } from '../data';

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
    affinity: def.affinity,
  };
}

const atk = (result: ReturnType<typeof evaluateFormations>, id: number): number =>
  formationModsFor(result, id).atkMul;
const speed = (result: ReturnType<typeof evaluateFormations>, id: number): number =>
  formationModsFor(result, id).attackSpeedMul;

describe('データ', () => {
  it('相性の相手は実在するアイドルを指している', () => {
    for (const id of canonIds) {
      for (const rule of getIdol(id).affinity) {
        for (const partner of rule.with) {
          expect(canonIds, `${id} の「${rule.name}」が知らない相手を指している`).toContain(partner);
        }
      }
    }
  });

  it('原作にある関係だけを書く（相性を持つのは 犬DOGE と FUSHI）', () => {
    const withAffinity = canonIds.filter((id) => getIdol(id).affinity.length > 0);
    expect(withAffinity).toEqual(['D4', 'Vi4']);
  });
});

describe('犬DOGE のおさんぽ（良い相性）', () => {
  it('かぐやの隣だと速くなる', () => {
    const doge = unit('D4', 4, 4);
    const kaguya = unit('V1', 5, 4);
    const result = evaluateFormations([doge, kaguya], null);
    // 相性の +30% と、「かぐやの相棒」タグの同ユニットペア +10%
    expect(speed(result, doge.id)).toBeCloseTo(1.1 * 1.3, 5);
    expect(atk(result, doge.id)).toBeCloseTo(1.15, 5);
  });

  it('離れていれば掛からない', () => {
    const doge = unit('D4', 0, 0);
    const kaguya = unit('V1', 9, 9);
    const result = evaluateFormations([doge, kaguya], null);
    // 同系統ペアも同ユニットも成立しないので、素のまま
    expect(atk(result, doge.id)).toBe(1);
    expect(result.hits.filter((h) => h.id === 'affinity')).toHaveLength(0);
  });
});

describe('FUSHI の相性', () => {
  it('ヤチヨの隣では攻撃力が上がる', () => {
    const fushi = unit('Vi4', 4, 4);
    const yachiyo = unit('Vi1', 5, 4);
    const result = evaluateFormations([fushi, yachiyo], null);
    // 同系統ペア（×1.12）ぶんも乗るので、相性ぶんだけを取り出して見る
    expect(atk(result, fushi.id)).toBeCloseTo(1.12 * 1.3, 5);
  });

  it('かぐやの隣では攻撃力が下がる（原作で敵対的）', () => {
    const fushi = unit('Vi4', 4, 4);
    const kaguya = unit('V1', 5, 4);
    const result = evaluateFormations([fushi, kaguya], null);
    expect(atk(result, fushi.id)).toBeCloseTo(0.75, 5);
  });

  it('嫌う相手が 2 人いても罰は 1 回だけ', () => {
    // 人数ぶん重ねると、置いた瞬間に無力化されて「置く意味が無い」になる
    const fushi = unit('Vi4', 4, 4);
    const result = evaluateFormations([fushi, unit('V1', 5, 4), unit('D4', 3, 4)], null);
    expect(atk(result, fushi.id)).toBeCloseTo(0.75, 5);
  });

  it('相性は片側にだけ掛かる（かぐやは巻き添えを食わない）', () => {
    // 双方向にすると、悪い相性が事実上「2 人ぶんの罰」になる
    const fushi = unit('Vi4', 4, 4);
    const kaguya = unit('V1', 5, 4);
    const result = evaluateFormations([fushi, kaguya], null);
    expect(atk(result, kaguya.id)).toBe(1);
  });

  it('相棒と犬猿の仲は同時に成立し、打ち消し合う', () => {
    const fushi = unit('Vi4', 4, 4);
    const result = evaluateFormations([fushi, unit('Vi1', 5, 4), unit('V1', 3, 4)], null);
    const names = result.hits.filter((h) => h.id === 'affinity').map((h) => h.name);
    expect(new Set(names)).toEqual(new Set(['相棒', '犬猿の仲']));
    // 1.3 × 0.75。ヤチヨとの同系統ペア（×1.12）も乗る
    expect(atk(result, fushi.id)).toBeCloseTo(1.12 * 1.3 * 0.75, 5);
  });
});
