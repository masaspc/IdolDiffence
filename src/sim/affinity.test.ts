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

  it('同じタグの相手には攻撃速度を重ねない（二重に乗る）', () => {
    // ユニットタグはすでに「同じ組が並ぶと**攻撃速度** +10%」を配っている
    // （`formation.ts` の pair_tag）。同じ相手への相性でも攻撃速度を足すと、
    // ひとつの関係で同じ数値が 2 回掛かる —— 実際、かぐや×彩葉 に
    // 「かぐや・いろP」を書いたら 1.1 が 1.21 になった。
    //
    // **攻撃力は重ねてよい。** タグが配っていない軸なので二重にはならず、
    // 「同じ組の中でも特に近い 2 人」を表せる（ヤチヨ×FUSHI の相棒）。
    // 例外は 犬DOGE の「おさんぽ」だけで、+30% はタグの +10% とは別格として置く
    const tagsOf = (id: string): Set<string> => new Set(getIdol(id).tags);
    for (const id of canonIds) {
      for (const rule of getIdol(id).affinity) {
        if (rule.name === 'おさんぽ' || rule.attackSpeedPct === 0) continue;
        for (const partner of rule.with) {
          const shared = [...tagsOf(id)].filter((t) => tagsOf(partner).has(t));
          expect(
            shared,
            `${id} と ${partner} は「${rule.name}」とタグ ${shared.join()} で攻撃速度が二重に乗る`,
          ).toHaveLength(0);
        }
      }
    }
  });

  it('良い相性は双方向、悪い相性は片側だけ', () => {
    // FUSHI の「犬猿の仲」は FUSHI 側にしか書かない。両側に書くと
    // 「2 人ぶんの罰」になり、置けない組み合わせが生まれる
    const mutual = (a: string, b: string, name: string): boolean =>
      getIdol(a).affinity.some((r) => r.name === name && r.with.includes(b)) &&
      getIdol(b).affinity.some((r) => r.name === name && r.with.includes(a));
    expect(mutual('V1', 'Vi1', '二人で歌う')).toBe(true);
    expect(mutual('D1', 'Vi3', 'クールな親友')).toBe(true);
    expect(mutual('D1', 'V4', '食べに行く約束')).toBe(true);
    expect(getIdol('V1').affinity.some((r) => r.name === '犬猿の仲')).toBe(false);
  });

  it('数値は控えめ（盤面の置き方が 1 通りにならないこと）', () => {
    // 関係が強すぎると「つながっている 2 人を並べる」以外の置き方が消える。
    // 例外は FUSHI の 2 件と 犬DOGE で、どれも原作でも極端な関係
    for (const id of canonIds) {
      if (id === 'Vi4' || id === 'D4') continue;
      for (const rule of getIdol(id).affinity) {
        expect(Math.abs(rule.atkPct), `${id} の「${rule.name}」が強すぎる`).toBeLessThanOrEqual(
          0.15,
        );
      }
    }
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
    // かぐやとヤチヨの「二人で歌う」も同じ盤面で成立する（相手が隣にいる）。
    // 数えるのは **FUSHI に掛かっているぶん**だけ
    expect(names).toContain('相棒');
    expect(names).toContain('犬猿の仲');
    // 1.3 × 0.75。ヤチヨとの同系統ペア（×1.12）も乗る
    expect(atk(result, fushi.id)).toBeCloseTo(1.12 * 1.3 * 0.75, 5);
  });
});
