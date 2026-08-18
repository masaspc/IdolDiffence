/**
 * 動機の変形（`motif.ts`）。
 *
 * **旋律になっているかどうかは、音を聞かなくても数字で分かる。**
 * 反行が本当に反転しているか、逆行が本当に逆になっているか、
 * 1 小節からはみ出していないか、答えの楽句が主音で終わるか。
 *
 * ここが崩れると「鳴ってはいるが曲になっていない」状態に静かに戻る ——
 * 実際、最初の実装はハッシュで音を選ぶだけで、そうなっていた。
 */
import { describe, expect, it } from 'vitest';
import {
  concat,
  fitToBar,
  fragment,
  invert,
  motifBeats,
  place,
  repeatTo,
  resolveToTonic,
  retrograde,
  scaleTime,
  stretchTo,
  transpose,
  type Motif,
} from './motif';

const M: Motif = { degrees: [0, 2, 1, 4], beats: [1, 0.5, 0.5, 2] };

describe('変形', () => {
  it('移高は全部の音を同じだけ動かす（形は変わらない）', () => {
    const up = transpose(M, 5);
    expect(up.degrees).toEqual([5, 7, 6, 9]);
    expect(up.beats).toEqual(M.beats);
  });

  it('反行は最初の音を軸に上下がひっくり返る', () => {
    // 上がる旋律が下がる旋律になるが、音程の並びは同じなので同じ動機と分かる
    const inverted = invert(M);
    expect(inverted.degrees).toEqual([0, -2, -1, -4]);
    // 軸の音は動かない
    expect(inverted.degrees[0]).toBe(M.degrees[0]);
    // 二度掛けると元に戻る
    expect(invert(inverted).degrees).toEqual([...M.degrees]);
  });

  it('逆行は音も長さも後ろから読む', () => {
    const back = retrograde(M);
    expect(back.degrees).toEqual([4, 1, 2, 0]);
    expect(back.beats).toEqual([2, 0.5, 0.5, 1]);
    expect(motifBeats(back)).toBe(motifBeats(M));
  });

  it('拡大・縮小は長さだけを変える', () => {
    const wide = scaleTime(M, 2);
    expect(wide.degrees).toEqual([...M.degrees]);
    expect(motifBeats(wide)).toBe(motifBeats(M) * 2);
  });

  it('断片化は頭から取る', () => {
    expect(fragment(M, 2)).toEqual({ degrees: [0, 2], beats: [1, 0.5] });
    // 音数より多く求められても壊れない
    expect(fragment(M, 99).degrees).toHaveLength(4);
    expect(fragment(M, 0).degrees).toHaveLength(1);
  });

  it('連結すると長さが足し算になる', () => {
    const twice = concat(fragment(M, 2), fragment(M, 2));
    expect(twice.degrees).toEqual([0, 2, 0, 2]);
    expect(motifBeats(twice)).toBe(3);
  });
});

describe('長さを合わせる', () => {
  it('引き伸ばすと指定した拍数ちょうどになる', () => {
    // 倍率を直に書くと曲ごとに端数が出る（0.575 拍のような長さ）。
    // 行き先で指定すれば、どの動機でも小節にぴったり収まる
    for (const beats of [2, 3, 4, 6]) {
      expect(motifBeats(stretchTo(M, beats))).toBeCloseTo(beats, 9);
    }
  });

  it('引き伸ばしても音の並びと長さの比は変わらない', () => {
    const wide = stretchTo(M, 8);
    expect(wide.degrees).toEqual([...M.degrees]);
    const ratio = (m: Motif): number => (m.beats[0] ?? 0) / (m.beats[1] ?? 1);
    expect(ratio(wide)).toBeCloseTo(ratio(M), 9);
  });

  it('埋まるまで繰り返す', () => {
    const half = scaleTime(M, 0.5); // 2 拍
    const filled = repeatTo(half, 4);
    expect(motifBeats(filled)).toBeCloseTo(4, 9);
    expect(filled.degrees).toEqual([...M.degrees, ...M.degrees]);
  });

  it('もう足りているなら繰り返さない', () => {
    expect(repeatTo(M, 4).degrees).toEqual([...M.degrees]);
  });
});

describe('小節に収める', () => {
  it('はみ出したら切る（次の小節の頭とぶつからない）', () => {
    const wide = scaleTime(M, 3); // 12 拍
    const fitted = fitToBar(wide, 4);
    expect(motifBeats(fitted)).toBeCloseTo(4, 9);
  });

  it('余ったら最後の音を伸ばして埋める（休符で終えない）', () => {
    const short: Motif = { degrees: [0, 1], beats: [1, 1] };
    const fitted = fitToBar(short, 4);
    expect(motifBeats(fitted)).toBeCloseTo(4, 9);
    expect(fitted.degrees).toEqual([0, 1]);
    expect(fitted.beats[1]).toBeCloseTo(3, 9);
  });

  it('小節の終わりに欠片を残さない', () => {
    // 0.1 拍の切れ端が残ると、旋律ではなく**取りこぼし**に聞こえる。
    // 落としたぶんは手前の音を伸ばして埋める
    const fitted = fitToBar({ degrees: [0, 1, 2], beats: [2, 1.9, 1] }, 4);
    expect(fitted.degrees).toEqual([0, 1]);
    expect(motifBeats(fitted)).toBeCloseTo(4, 9);
  });

  it('最初の音だけは短くても残す（無音の小節を作らない）', () => {
    const fitted = fitToBar({ degrees: [0], beats: [9] }, 4);
    expect(fitted.degrees).toEqual([0]);
    expect(motifBeats(fitted)).toBeCloseTo(4, 9);
  });

  it('ちょうどなら何も変えない', () => {
    expect(fitToBar(M, 4)).toEqual({
      degrees: [...M.degrees],
      beats: [...M.beats],
    });
  });
});

describe('終止', () => {
  it('答えの楽句は主音で終わる', () => {
    // 主音で終わらないと、いつまでも終わらない音の列に聞こえる。
    // 5 音音階なので、度数が 5 の倍数のところが主音
    for (const degrees of [
      [0, 2, 4],
      [0, 2, 3],
      [0, 1, 6],
      [0, 1, -3],
    ]) {
      const resolved = resolveToTonic({ degrees, beats: degrees.map(() => 1) });
      const last = resolved.degrees[resolved.degrees.length - 1] ?? 1;
      // 負の度数だと `%` が -0 を返すので絶対値で見る
      expect(Math.abs(last % 5), `${degrees}`).toBe(0);
    }
  });

  it('いちばん近い主音へ寄せる（遠くへ飛ばさない）', () => {
    // 4 → 5（上の主音）。0 まで落とすと旋律の形が壊れる
    expect(resolveToTonic({ degrees: [0, 4], beats: [1, 1] }).degrees[1]).toBe(5);
    expect(resolveToTonic({ degrees: [0, 1], beats: [1, 1] }).degrees[1]).toBe(0);
  });

  it('音域から外れるなら反対側の主音で終える', () => {
    // 主音は 1 オクターブおきにあるので、どちらでも終止にはなる。
    // ここで外れたまま `clampRegister` に畳ませると楽句まるごと動いてしまい、
    // 最後の小節だけ急に高く（低く）なる
    const range = { ceiling: 7, floor: -3 };
    expect(resolveToTonic({ degrees: [0, 9], beats: [1, 1] }, range).degrees[1]).toBe(5);
    expect(resolveToTonic({ degrees: [0, -4], beats: [1, 1] }, range).degrees[1]).toBe(0);
    // 収まっているならいちばん近い主音のまま
    expect(resolveToTonic({ degrees: [0, 4], beats: [1, 1] }, range).degrees[1]).toBe(5);
  });
});

describe('配置', () => {
  it('長さぶんずつ後ろへ並ぶ', () => {
    expect(place(M)).toEqual([
      { beat: 0, degree: 0, beats: 1 },
      { beat: 1, degree: 2, beats: 0.5 },
      { beat: 1.5, degree: 1, beats: 0.5 },
      { beat: 2, degree: 4, beats: 2 },
    ]);
  });
});
