/**
 * 波形の合成（`render.ts`）。
 *
 * **「ファミコンに聞こえる」は数字で見張れる。** 単純な波形が安っぽく響く理由は
 * はっきりしていて、どれも測れる ——
 *
 * - 倍音が 1 本しか無い（サイン波）
 * - 鳴っているあいだ中身が変わらない
 * - どの音も寸分違わず同じ
 *
 * ここが崩れると、音色を作り込んだつもりで 8bit へ戻る。
 */
import { describe, expect, it } from 'vitest';
import {
  breath,
  clave,
  fadeEdges,
  lowString,
  membrane,
  noiseGen,
  normalize,
  pluck,
  strike,
} from './render';

const SR = 22050;

function render(fill: (out: Float32Array) => void, seconds = 1): Float32Array {
  const out = new Float32Array(Math.round(SR * seconds));
  fill(out);
  return out;
}

/** その区間の実効値。減衰しているかを見るのに使う */
function rms(data: Float32Array, from: number, to: number): number {
  let sum = 0;
  for (let i = from; i < to; i++) sum += (data[i] ?? 0) ** 2;
  return Math.sqrt(sum / Math.max(1, to - from));
}

/** 基音の n 倍のところにどれだけ成分があるか（素朴な DFT） */
function harmonics(data: Float32Array, from: number, freq: number, count = 12): number[] {
  const N = Math.min(2048, data.length - from);
  const out: number[] = [];
  for (let h = 1; h <= count; h++) {
    let re = 0;
    let im = 0;
    for (let i = 0; i < N; i++) {
      const angle = (2 * Math.PI * freq * h * i) / SR;
      re += (data[from + i] ?? 0) * Math.cos(angle);
      im += (data[from + i] ?? 0) * Math.sin(angle);
    }
    out.push(Math.sqrt(re * re + im * im) / N);
  }
  return out;
}

/** 倍音の重心。大きいほど「明るい / ざらついた」音 */
function centroid(values: number[]): number {
  const total = values.reduce((sum, v) => sum + v, 0);
  if (total === 0) return 0;
  return values.reduce((sum, v, i) => sum + v * (i + 1), 0) / total;
}

/** 単純な波形との比較用。前の実装はこれだった */
function sine(out: Float32Array, freq: number): void {
  for (let i = 0; i < out.length; i++) {
    const t = i / SR;
    out[i] = Math.sin(2 * Math.PI * freq * t) * Math.exp(-t / 1.6);
  }
}

describe('決定性', () => {
  it('同じ種からは寸分違わず同じ波形が出る', () => {
    // 曲として覚えられるために要る。テストが書けるのも同じ理由
    const a = render((o) => pluck(o, { sampleRate: SR, freq: 440, seed: 42 }));
    const b = render((o) => pluck(o, { sampleRate: SR, freq: 440, seed: 42 }));
    expect(Array.from(a.slice(0, 500))).toEqual(Array.from(b.slice(0, 500)));
  });

  it('乱数は 0 を挟んで散らばる', () => {
    const random = noiseGen(1);
    let sum = 0;
    let min = 1;
    let max = -1;
    for (let i = 0; i < 4000; i++) {
      const v = random();
      sum += v;
      min = Math.min(min, v);
      max = Math.max(max, v);
    }
    expect(Math.abs(sum / 4000)).toBeLessThan(0.05);
    expect(min).toBeLessThan(-0.9);
    expect(max).toBeGreaterThan(0.9);
  });
});

describe('撥弦（箏）', () => {
  it('サイン波よりずっと倍音が多い', () => {
    // **ここが「ファミコンではない」の中身。** サイン波は倍音が 1 本しか無い
    const string = render((o) => pluck(o, { sampleRate: SR, freq: 220, seed: 7 }));
    const plain = render((o) => sine(o, 220));
    normalize(string);
    normalize(plain);
    const at = Math.round(SR * 0.03);
    const rich = harmonics(string, at, 220);
    const flat = harmonics(plain, at, 220);
    const above = (values: number[]): number => {
      const peak = Math.max(...values);
      return values.filter((v) => v > peak * 0.02).length;
    };
    expect(above(flat)).toBe(1);
    expect(above(rich)).toBeGreaterThan(3);
  });

  it('高い倍音から先に消える（弦の減り方）', () => {
    // 全部同じ速さで消すと、シンセのパッドを短く切った音になる
    const data = render((o) => pluck(o, { sampleRate: SR, freq: 220, seed: 7 }), 1.4);
    normalize(data);
    const early = centroid(harmonics(data, Math.round(SR * 0.02), 220));
    const late = centroid(harmonics(data, Math.round(SR * 0.7), 220));
    expect(late).toBeLessThan(early);
  });

  it('ちゃんと減衰して終わる（鳴りっぱなしにならない）', () => {
    const data = render((o) => pluck(o, { sampleRate: SR, freq: 220, seed: 7 }), 1.6);
    expect(rms(data, SR * 1.2, SR * 1.5)).toBeLessThan(rms(data, 0, SR * 0.1) * 0.5);
  });

  it('種が違えば違う音になる（連打が機械の連射に聞こえない）', () => {
    const a = render((o) => pluck(o, { sampleRate: SR, freq: 330, seed: 1 }));
    const b = render((o) => pluck(o, { sampleRate: SR, freq: 330, seed: 2 }));
    normalize(a);
    normalize(b);
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff += Math.abs((a[i] ?? 0) - (b[i] ?? 0));
    expect(diff / a.length).toBeGreaterThan(0.001);
  });

  it('高い音でも低い音でも壊れない', () => {
    for (const freq of [80, 220, 880, 2000]) {
      const data = render((o) => pluck(o, { sampleRate: SR, freq, seed: 3 }), 0.5);
      expect(
        data.every((v) => Number.isFinite(v)),
        `${freq}Hz`,
      ).toBe(true);
      expect(rms(data, 0, SR * 0.05), `${freq}Hz`).toBeGreaterThan(0);
    }
  });
});

describe('気鳴（尺八）', () => {
  it('鳴っているあいだ中身が動く', () => {
    // **まっすぐな音程は人が出せない音。** 動かないと、倍音をいくら足しても
    // 「合成された音」に聞こえる
    const data = render((o) => breath(o, { sampleRate: SR, freq: 330, seed: 5 }), 1.2);
    normalize(data);
    const a = centroid(harmonics(data, Math.round(SR * 0.1), 330));
    const b = centroid(harmonics(data, Math.round(SR * 0.8), 330));
    expect(Math.abs(a - b)).toBeGreaterThan(0.01);
  });

  it('息の雑音が最後まで混ざる', () => {
    // 倍音の格子から外れた成分がどれだけあるか。純音なら限りなく 0 に近い
    const data = render((o) => breath(o, { sampleRate: SR, freq: 330, seed: 5 }), 1);
    normalize(data);
    const at = Math.round(SR * 0.4);
    const onGrid = harmonics(data, at, 330).reduce((s, v) => s + v, 0);
    // 倍音のあいだ（1.5 倍・2.5 倍…）に何があるか
    const between = harmonics(data, at, 330 * 1.5, 4).reduce((s, v) => s + v, 0);
    expect(between).toBeGreaterThan(onGrid * 0.02);
  });

  it('1 音ごとに表情が変わる', () => {
    const a = render((o) => breath(o, { sampleRate: SR, freq: 440, seed: 11 }), 0.6);
    const b = render((o) => breath(o, { sampleRate: SR, freq: 440, seed: 22 }), 0.6);
    normalize(a);
    normalize(b);
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff += Math.abs((a[i] ?? 0) - (b[i] ?? 0));
    expect(diff / a.length).toBeGreaterThan(0.01);
  });

  it('立ち上がりがある（頭から鳴り切らない）', () => {
    const data = render((o) => breath(o, { sampleRate: SR, freq: 440, seed: 5 }), 0.5);
    expect(rms(data, 0, 60)).toBeLessThan(rms(data, SR * 0.1, SR * 0.2));
  });
});

describe('膜（和太鼓）', () => {
  it('倍音が整数比ではない（だから音程を持たない）', () => {
    // 整数比で並べるとキックになる。太鼓らしさは非調和から出る
    const data = render((o) => membrane(o, { sampleRate: SR, freq: 62, seed: 9 }), 0.6);
    normalize(data);
    const at = Math.round(SR * 0.01);
    const onGrid = harmonics(data, at, 62, 4);
    const offGrid = harmonics(data, at, 62 * 1.593, 4);
    // 1.593 倍（Bessel の 2 番目）にちゃんと成分がある
    expect(Math.max(...offGrid)).toBeGreaterThan(Math.max(...onGrid) * 0.05);
  });

  it('一瞬で落ちる', () => {
    const data = render((o) => membrane(o, { sampleRate: SR, freq: 62, seed: 9 }), 0.8);
    expect(rms(data, SR * 0.5, SR * 0.7)).toBeLessThan(rms(data, 0, SR * 0.05) * 0.2);
  });
});

describe('打撃（オルゴール・鈴）', () => {
  it('倍音が整数比から外れている（金属の板）', () => {
    const data = render((o) => strike(o, { sampleRate: SR, freq: 440, seed: 3, tail: 1 }), 1);
    normalize(data);
    const at = Math.round(SR * 0.02);
    // 2.76 倍のところに成分があり、2 倍のところには乏しい
    const inharmonic = harmonics(data, at, 440 * 2.76, 1)[0] ?? 0;
    const octave = harmonics(data, at, 440 * 2, 1)[0] ?? 0;
    expect(inharmonic).toBeGreaterThan(octave);
  });

  it('尾を長くすると長く残る', () => {
    const short = render((o) => strike(o, { sampleRate: SR, freq: 440, seed: 3, tail: 0.3 }), 1.2);
    const long = render((o) => strike(o, { sampleRate: SR, freq: 440, seed: 3, tail: 1.6 }), 1.2);
    normalize(short);
    normalize(long);
    expect(rms(long, SR * 0.8, SR * 1.1)).toBeGreaterThan(rms(short, SR * 0.8, SR * 1.1));
  });
});

describe('低音と刻み', () => {
  it('低音は倍音を持つ（サイン波の低音は曲の土台にならない）', () => {
    const data = render((o) => lowString(o, { sampleRate: SR, freq: 110, seed: 4 }), 0.8);
    normalize(data);
    const values = harmonics(data, Math.round(SR * 0.05), 110);
    const peak = Math.max(...values);
    expect(values.filter((v) => v > peak * 0.05).length).toBeGreaterThan(2);
  });

  it('刻みは短く終わる', () => {
    const data = render((o) => clave(o, { sampleRate: SR, freq: 0, seed: 4 }), 0.4);
    expect(rms(data, SR * 0.2, SR * 0.35)).toBeLessThan(rms(data, 0, SR * 0.02) * 0.1);
  });
});

describe('仕上げ', () => {
  it('いちばん大きいところで揃える', () => {
    const data = new Float32Array([0.1, -0.2, 0.05]);
    normalize(data, 0.8);
    expect(Math.max(...Array.from(data).map(Math.abs))).toBeCloseTo(0.8, 6);
  });

  it('無音を渡しても壊れない', () => {
    const data = new Float32Array(64);
    expect(normalize(data)).toBe(0);
    expect(data.every((v) => v === 0)).toBe(true);
  });

  it('端を落としてプツッと鳴らないようにする', () => {
    const data = new Float32Array(SR).fill(1);
    fadeEdges(data, SR);
    expect(data[0]).toBe(0);
    expect(data[data.length - 1]).toBeCloseTo(0, 5);
    // 真ん中は触らない
    expect(data[Math.round(SR * 0.5)]).toBe(1);
  });
});
