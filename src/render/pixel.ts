/**
 * ドット絵を「打つ」ための最小の道具。
 *
 * Canvas の描画 API（arc / fill）はアンチエイリアスが乗るので、
 * ドット絵には使えない。1 ドットずつ ImageData へ書き込んで、
 * **境界が必ずドットに揃う**ようにする。
 */
export class PixelCanvas {
  private readonly data: Uint8ClampedArray<ArrayBuffer>;

  constructor(
    readonly width: number,
    readonly height: number,
  ) {
    this.data = new Uint8ClampedArray(new ArrayBuffer(width * height * 4));
  }

  set(x: number, y: number, color: string, alpha = 255): void {
    const px = Math.round(x);
    const py = Math.round(y);
    if (px < 0 || py < 0 || px >= this.width || py >= this.height) return;
    const [r, g, b] = parseHex(color);
    const i = (py * this.width + px) * 4;
    this.data[i] = r;
    this.data[i + 1] = g;
    this.data[i + 2] = b;
    this.data[i + 3] = alpha;
  }

  /** 左右対称に打つ。中心線は `cx`（ドットの座標系） */
  setMirrored(cx: number, x: number, y: number, color: string, alpha = 255): void {
    this.set(x, y, color, alpha);
    this.set(cx * 2 - x, y, color, alpha);
  }

  rect(x: number, y: number, w: number, h: number, color: string, alpha = 255): void {
    for (let dy = 0; dy < h; dy++) {
      for (let dx = 0; dx < w; dx++) this.set(x + dx, y + dy, color, alpha);
    }
  }

  /**
   * 左右対称に矩形を打つ。`left` は中心から左端までのドット数。
   *
   * 右側の開始位置を呼び出しごとに手で書くと**1 ドットずれる**（実際ずれた）。
   * `cx` が .5 か整数かでも式が変わるので、ここに閉じ込める。
   * 列 `c` の鏡像は `2*cx - c` なので、右端から逆算して開始位置を出す。
   */
  pair(cx: number, left: number, y: number, w: number, h: number, color: string): void {
    const x0 = Math.round(cx - left);
    this.rect(x0, y, w, h, color);
    this.rect(2 * cx - x0 - w + 1, y, w, h, color);
  }

  /** 左右対称に楕円を打つ。`left` は中心から楕円の中心までのドット数 */
  pairDisc(cx: number, left: number, cy: number, rx: number, ry: number, color: string): void {
    this.disc(cx - left, cy, rx, ry, color);
    this.disc(cx + left, cy, rx, ry, color);
  }

  /**
   * 中心をまたぐ矩形。帯や裾のように「左右に等しく張り出す」ものに使う。
   * 幅は `left` から決まるので、渡さない（渡せると非対称に書けてしまう）。
   */
  span(cx: number, left: number, y: number, h: number, color: string): void {
    const x0 = Math.round(cx - left);
    this.rect(x0, y, 2 * cx - 2 * x0 + 1, h, color);
  }

  /** 楕円の塗りつぶし。半径は「中心からのドット数」 */
  disc(cx: number, cy: number, rx: number, ry: number, color: string, alpha = 255): void {
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
      for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
        const nx = (x - cx) / rx;
        const ny = (y - cy) / ry;
        if (nx * nx + ny * ny <= 1) this.set(x, y, color, alpha);
      }
    }
  }

  /** 楕円のうち、指定した行だけを塗る。髪を「頭の上半分」に載せるのに使う */
  discRows(
    cx: number,
    cy: number,
    rx: number,
    ry: number,
    color: string,
    yMin: number,
    yMax: number,
  ): void {
    for (let y = Math.max(yMin, Math.floor(cy - ry)); y <= Math.min(yMax, Math.ceil(cy + ry)); y++) {
      for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
        const nx = (x - cx) / rx;
        const ny = (y - cy) / ry;
        if (nx * nx + ny * ny <= 1) this.set(x, y, color);
      }
    }
  }

  /** 上底と下底の幅が違う台形。スカートと髪の広がりに使う */
  trapezoid(
    cx: number,
    top: number,
    height: number,
    topHalf: number,
    bottomHalf: number,
    color: string,
  ): void {
    for (let i = 0; i < height; i++) {
      const t = height === 1 ? 0 : i / (height - 1);
      const half = Math.round(topHalf + (bottomHalf - topHalf) * t);
      this.rect(cx - half, top + i, half * 2 + 1, 1, color);
    }
  }

  /** 塗ってあるドットの外周に 1 ドットの縁を付ける。輪郭があると小さくても形が読める */
  outline(color: string): void {
    const filled = new Set<number>();
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        if (this.alphaAt(x, y) > 0) filled.add(y * this.width + x);
      }
    }
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        if (filled.has(y * this.width + x)) continue;
        const touching =
          filled.has(y * this.width + (x - 1)) ||
          filled.has(y * this.width + (x + 1)) ||
          filled.has((y - 1) * this.width + x) ||
          filled.has((y + 1) * this.width + x);
        if (touching) this.set(x, y, color);
      }
    }
  }

  private alphaAt(x: number, y: number): number {
    return this.data[(y * this.width + x) * 4 + 3] ?? 0;
  }

  /**
   * RGBA の生バイト列。
   *
   * `toCanvas()` は DOM を要る。見た目を確かめるスクリプトやテストは
   * ブラウザ無しで走らせたいので、焼く前の中身をここから読めるようにしておく。
   */
  get pixels(): Uint8ClampedArray {
    return this.data;
  }

  /** 実際に描ける canvas へ焼く */
  toCanvas(): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    canvas.width = this.width;
    canvas.height = this.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('ドット絵の 2D コンテキストを取得できませんでした');
    ctx.putImageData(new ImageData(this.data, this.width, this.height), 0, 0);
    return canvas;
  }
}

function parseHex(color: string): [number, number, number] {
  const hex = color.replace('#', '');
  return [
    parseInt(hex.slice(0, 2), 16),
    parseInt(hex.slice(2, 4), 16),
    parseInt(hex.slice(4, 6), 16),
  ];
}

/** 明度を上げ下げした色を作る。ハイライトと影に使う */
export function shade(color: string, amount: number): string {
  const [r, g, b] = parseHex(color);
  const mix = (v: number): number =>
    Math.round(amount >= 0 ? v + (255 - v) * amount : v * (1 + amount));
  return `#${[mix(r), mix(g), mix(b)].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}
