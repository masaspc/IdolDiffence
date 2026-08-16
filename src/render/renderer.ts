/**
 * Canvas 2D レンダラ。
 *
 * 静的な要素（背景・グリッド・経路・配置マス）はオフスクリーンに一度だけ描き、
 * 毎フレームはそれを 1 枚貼るだけにする。draw call を抑える方針
 * （docs/design/05-architecture.md 5.9）。
 *
 * 将来 WebGL(PixiJS) へ移すときは、このクラスを差し替えるだけで済むよう
 * 外部には `resize` / `draw` しか見せない。
 */
import type { BattleWorld } from '../sim/world';
import { cellStyle, palette } from './palette';

/** 論理解像度。1 マス = 64px、16×9 マスで 1024×576 */
export const CELL_SIZE = 64;

export class Renderer {
  private ctx: CanvasRenderingContext2D;
  private staticLayer: HTMLCanvasElement | OffscreenCanvas | null = null;
  private dpr = 1;
  private widthCss = 0;
  private heightCss = 0;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly world: BattleWorld,
  ) {
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('2D コンテキストを取得できませんでした');
    this.ctx = ctx;
  }

  get logicalWidth(): number {
    return this.world.stage.grid.w * CELL_SIZE;
  }

  get logicalHeight(): number {
    return this.world.stage.grid.h * CELL_SIZE;
  }

  /** CSS ピクセルサイズを渡す。devicePixelRatio はここで吸収する */
  resize(cssWidth: number, cssHeight: number, dpr: number): void {
    this.widthCss = cssWidth;
    this.heightCss = cssHeight;
    this.dpr = dpr;
    this.canvas.width = Math.round(cssWidth * dpr);
    this.canvas.height = Math.round(cssHeight * dpr);
    this.canvas.style.width = `${cssWidth}px`;
    this.canvas.style.height = `${cssHeight}px`;
    this.staticLayer = null; // スケールが変わったので静的レイヤを作り直す
  }

  /** @param alpha 固定ステップ間の補間係数。M0 ではまだ動くものが無いので未使用 */
  draw(_alpha: number): void {
    const { ctx } = this;
    const scale = this.viewScale();

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.widthCss, this.heightCss);

    ctx.save();
    ctx.translate(this.offsetX(), this.offsetY());
    ctx.scale(scale, scale);

    this.drawStaticLayer(ctx);
    this.drawBeatPulse(ctx);
    this.drawGoalGlow(ctx);

    ctx.restore();
  }

  /** ステージ全体が収まる倍率 */
  private viewScale(): number {
    return Math.min(this.widthCss / this.logicalWidth, this.heightCss / this.logicalHeight);
  }

  private offsetX(): number {
    return (this.widthCss - this.logicalWidth * this.viewScale()) / 2;
  }

  private offsetY(): number {
    return (this.heightCss - this.logicalHeight * this.viewScale()) / 2;
  }

  private drawStaticLayer(ctx: CanvasRenderingContext2D): void {
    if (!this.staticLayer) this.staticLayer = this.buildStaticLayer();
    ctx.drawImage(this.staticLayer as CanvasImageSource, 0, 0);
  }

  private buildStaticLayer(): HTMLCanvasElement {
    const layer = document.createElement('canvas');
    layer.width = this.logicalWidth;
    layer.height = this.logicalHeight;
    const ctx = layer.getContext('2d');
    if (!ctx) throw new Error('静的レイヤの 2D コンテキストを取得できませんでした');

    this.drawBackground(ctx);
    this.drawMoon(ctx);
    this.drawGrid(ctx);
    this.drawLanes(ctx);
    this.drawPlaceableCells(ctx);
    return layer;
  }

  private drawBackground(ctx: CanvasRenderingContext2D): void {
    const gradient = ctx.createLinearGradient(0, 0, 0, this.logicalHeight);
    gradient.addColorStop(0, palette.bgTop);
    gradient.addColorStop(1, palette.bgBottom);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, this.logicalWidth, this.logicalHeight);
  }

  /**
   * 背景の月。ステージが進むほど大きくなり、迫る帰還の期限を言葉なしで伝える
   * （docs/design/04-content.md 4.6）。M0 は S1 相当の小さい月。
   */
  private drawMoon(ctx: CanvasRenderingContext2D): void {
    // 配置マスと重ならない位置に置く。S1 は小さめの月で、
    // ステージが進むほど大きくしていく
    const cx = this.logicalWidth * 0.72;
    const cy = this.logicalHeight * 0.17;
    const r = this.logicalHeight * 0.11;

    const glow = ctx.createRadialGradient(cx, cy, r * 0.6, cx, cy, r * 3);
    glow.addColorStop(0, 'rgba(232, 241, 255, 0.22)');
    glow.addColorStop(1, 'rgba(232, 241, 255, 0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(cx, cy, r * 3, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = palette.moonLow;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
  }

  private drawGrid(ctx: CanvasRenderingContext2D): void {
    const { w, h } = this.world.stage.grid;
    ctx.lineWidth = 1;
    for (let x = 0; x <= w; x++) {
      ctx.strokeStyle = x % 4 === 0 ? palette.gridStrong : palette.grid;
      ctx.beginPath();
      ctx.moveTo(x * CELL_SIZE + 0.5, 0);
      ctx.lineTo(x * CELL_SIZE + 0.5, h * CELL_SIZE);
      ctx.stroke();
    }
    for (let y = 0; y <= h; y++) {
      ctx.strokeStyle = y % 4 === 0 ? palette.gridStrong : palette.grid;
      ctx.beginPath();
      ctx.moveTo(0, y * CELL_SIZE + 0.5);
      ctx.lineTo(w * CELL_SIZE, y * CELL_SIZE + 0.5);
      ctx.stroke();
    }
  }

  private drawLanes(ctx: CanvasRenderingContext2D): void {
    const half = CELL_SIZE / 2;
    for (const lane of this.world.stage.lanes) {
      const points = lane.waypoints.map(([x, y]) => ({
        x: x * CELL_SIZE + half,
        y: y * CELL_SIZE + half,
      }));
      if (points.length < 2) continue;

      const trace = (): void => {
        ctx.beginPath();
        const first = points[0];
        if (!first) return;
        ctx.moveTo(first.x, first.y);
        for (let i = 1; i < points.length; i++) {
          const p = points[i];
          if (p) ctx.lineTo(p.x, p.y);
        }
      };

      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      ctx.strokeStyle = palette.lane;
      ctx.lineWidth = CELL_SIZE * 0.8;
      trace();
      ctx.stroke();

      ctx.strokeStyle = palette.laneEdge;
      ctx.lineWidth = 2;
      ctx.setLineDash([10, 8]);
      trace();
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  private drawPlaceableCells(ctx: CanvasRenderingContext2D): void {
    const pad = 6;
    for (const [x, y] of this.world.stage.placeable) {
      const style = cellStyle(this.world.stage.cellTypes[`${x},${y}`]);
      const px = x * CELL_SIZE + pad;
      const py = y * CELL_SIZE + pad;
      const size = CELL_SIZE - pad * 2;

      ctx.fillStyle = style.fill;
      ctx.strokeStyle = style.stroke;
      ctx.lineWidth = 2;
      roundRect(ctx, px, py, size, size, 8);
      ctx.fill();
      ctx.stroke();
    }
  }

  /** 拍に合わせて配置マスが光る。音が無くても BPM が目で分かるようにする */
  private drawBeatPulse(ctx: CanvasRenderingContext2D): void {
    const { beatsPerBar } = this.world.clock;
    const beatPhase = (this.world.clock.absoluteBeat % 1 + 1) % 1;
    const pulse = Math.max(0, 1 - beatPhase * 2.2);
    if (pulse <= 0.01) return;

    const isDownbeat = Math.floor(this.world.clock.absoluteBeat) % beatsPerBar === 0;
    const pad = 6;

    ctx.save();
    ctx.globalAlpha = pulse * (isDownbeat ? 0.5 : 0.22);
    ctx.strokeStyle = isDownbeat ? palette.moonHigh : palette.moonLow;
    ctx.lineWidth = 2;
    for (const [x, y] of this.world.stage.placeable) {
      roundRect(ctx, x * CELL_SIZE + pad, y * CELL_SIZE + pad, CELL_SIZE - pad * 2, CELL_SIZE - pad * 2, 8);
      ctx.stroke();
    }
    ctx.restore();
  }

  /** センターステージ（経路の終端）。ここに敵が到達すると観客が減る */
  private drawGoalGlow(ctx: CanvasRenderingContext2D): void {
    const half = CELL_SIZE / 2;
    for (const lane of this.world.stage.lanes) {
      const last = lane.waypoints[lane.waypoints.length - 1];
      if (!last) continue;
      const cx = last[0] * CELL_SIZE + half;
      const cy = last[1] * CELL_SIZE + half;
      const breathe = 0.6 + 0.4 * Math.sin(this.world.clock.absoluteBeat * Math.PI);
      const r = CELL_SIZE * (0.55 + 0.08 * breathe);

      const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
      glow.addColorStop(0, 'rgba(255, 213, 79, 0.55)');
      glow.addColorStop(1, 'rgba(255, 213, 79, 0)');
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = palette.goal;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(cx, cy, CELL_SIZE * 0.34, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
