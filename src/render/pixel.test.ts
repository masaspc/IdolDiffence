/**
 * ドット絵を打つ道具（render/pixel.ts）。
 *
 * 見どころは**左右対称に打てること**。スプライトを組んでいるあいだ、
 * 右側の開始位置を呼び出しごとに手計算していて 1 ドットずれた箇所が
 * いくつも出た。ずれは絵を見ても気付きにくいので、ここで数えて止める。
 */
import { describe, expect, it } from 'vitest';
import { PixelCanvas, shade } from './pixel';

const RED = '#ff0000';

/** 塗られている列。行を 1 本だけ見る */
function columns(px: PixelCanvas, y: number): number[] {
  const out: number[] = [];
  for (let x = 0; x < px.width; x++) {
    if ((px.pixels[(y * px.width + x) * 4 + 3] ?? 0) > 0) out.push(x);
  }
  return out;
}

/** 中心 cx について左右対称か */
function symmetric(px: PixelCanvas, y: number, cx: number): boolean {
  const cols = columns(px, y);
  return cols.every((c) => cols.includes(2 * cx - c));
}

describe('pair（左右対称の矩形）', () => {
  it('中心が .5 のとき対称になる', () => {
    const px = new PixelCanvas(48, 4);
    px.pair(23.5, 8, 1, 4, 1, RED);
    expect(columns(px, 1)).toEqual([16, 17, 18, 19, 28, 29, 30, 31]);
    expect(symmetric(px, 1, 23.5)).toBe(true);
  });

  it('中心が整数のときも対称になる', () => {
    const px = new PixelCanvas(48, 4);
    px.pair(24, 8, 1, 4, 1, RED);
    expect(columns(px, 1)).toEqual([16, 17, 18, 19, 29, 30, 31, 32]);
    expect(symmetric(px, 1, 24)).toBe(true);
  });

  it('幅を変えても対称のまま', () => {
    for (const w of [1, 2, 3, 5, 8]) {
      const px = new PixelCanvas(48, 4);
      px.pair(23.5, 12, 1, w, 1, RED);
      expect(columns(px, 1)).toHaveLength(w * 2);
      expect(symmetric(px, 1, 23.5), `幅 ${w} で対称でない`).toBe(true);
    }
  });

  it('中心をまたぐ指定では左右が重なって 1 つの帯になる', () => {
    const px = new PixelCanvas(48, 4);
    px.pair(23.5, 1, 1, 4, 1, RED);
    expect(symmetric(px, 1, 23.5)).toBe(true);
  });
});

describe('span（中心をまたぐ矩形）', () => {
  it('左右へ等しく張り出す', () => {
    const px = new PixelCanvas(48, 4);
    px.span(23.5, 7, 1, 1, RED);
    expect(columns(px, 1)).toEqual([17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30]);
    expect(symmetric(px, 1, 23.5)).toBe(true);
  });

  it('張り出し量を変えても対称のまま', () => {
    for (const left of [1, 2, 5, 11, 14]) {
      const px = new PixelCanvas(48, 4);
      px.span(23.5, left, 1, 1, RED);
      expect(columns(px, 1)).toHaveLength(left * 2);
      expect(symmetric(px, 1, 23.5), `張り出し ${left} で対称でない`).toBe(true);
    }
  });
});

describe('pairDisc', () => {
  it('左右に同じ楕円が並ぶ', () => {
    const px = new PixelCanvas(48, 20);
    px.pairDisc(23.5, 14, 10, 3, 4, RED);
    expect(symmetric(px, 10, 23.5)).toBe(true);
  });
});

describe('outline', () => {
  it('塗った外周にだけ縁が付く', () => {
    const px = new PixelCanvas(8, 8);
    px.rect(3, 3, 2, 2, RED);
    px.outline('#000000');
    // 2×2 の四方に 1 ドットずつ（角は付かない）
    expect(columns(px, 2)).toEqual([3, 4]);
    expect(columns(px, 3)).toEqual([2, 3, 4, 5]);
  });
});

describe('shade', () => {
  it('正なら明るく、負なら暗くなる', () => {
    expect(shade('#808080', 0.5)).toBe('#c0c0c0');
    expect(shade('#808080', -0.5)).toBe('#404040');
    expect(shade('#3a5f7a', 0)).toBe('#3a5f7a');
  });
});
