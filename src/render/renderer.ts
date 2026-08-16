/**
 * Canvas 2D レンダラ。
 *
 * 静的な要素（背景・グリッド・経路・配置マス）はオフスクリーンに一度だけ描き、
 * 毎フレームはそれを 1 枚貼るだけにする。draw call を抑える方針
 * （docs/design/05-architecture.md 5.9）。
 *
 * 将来 WebGL(PixiJS) へ移すときは、このクラスを差し替えるだけで済むよう
 * 外部には resize / draw / セル変換しか見せない。
 */
import type { BattleWorld, EnemyView, UnitView, WorldSnapshot } from '../sim/world';
import { attrColor, cellStyle, palette, typeColor } from './palette';

/** 論理解像度。1 マス = 64px、16×9 マスで 1024×576 */
export const CELL_SIZE = 64;

export interface HoverState {
  cell: { x: number; y: number } | null;
  /** 配置プレビュー中のアイドル */
  pendingIdolId: string | null;
  pendingRange: number;
  pendingValid: boolean;
  selectedUnitId: number | null;
}

export class Renderer {
  private ctx: CanvasRenderingContext2D;
  private staticLayer: HTMLCanvasElement | null = null;
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

  /** 画面座標をセル座標に変換する。範囲外なら null */
  cellFromClient(clientX: number, clientY: number): { x: number; y: number } | null {
    const rect = this.canvas.getBoundingClientRect();
    const scale = this.viewScale();
    const x = Math.floor((clientX - rect.left - this.offsetX()) / scale / CELL_SIZE);
    const y = Math.floor((clientY - rect.top - this.offsetY()) / scale / CELL_SIZE);
    const { w, h } = this.world.stage.grid;
    if (x < 0 || y < 0 || x >= w || y >= h) return null;
    return { x, y };
  }

  /**
   * @param alpha 固定ステップ間の補間係数。敵の位置をこれで補間するので、
   *              フレームレートが揺れても動きが滑らかに見える
   */
  draw(snapshot: WorldSnapshot, hover: HoverState, alpha: number): void {
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
    this.drawHover(ctx, hover, snapshot);
    this.drawAttacks(ctx, snapshot);
    this.drawEnemies(ctx, snapshot.enemies, alpha);
    this.drawUnits(ctx, snapshot.units, hover.selectedUnitId);
    this.drawFloatingTexts(ctx, snapshot);

    ctx.restore();
  }

  private viewScale(): number {
    return Math.min(this.widthCss / this.logicalWidth, this.heightCss / this.logicalHeight);
  }

  private offsetX(): number {
    return (this.widthCss - this.logicalWidth * this.viewScale()) / 2;
  }

  private offsetY(): number {
    return (this.heightCss - this.logicalHeight * this.viewScale()) / 2;
  }

  // --- 静的レイヤ ---

  private drawStaticLayer(ctx: CanvasRenderingContext2D): void {
    if (!this.staticLayer) this.staticLayer = this.buildStaticLayer();
    ctx.drawImage(this.staticLayer, 0, 0);
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
   * （docs/design/04-content.md 4.6）。S1 は小さめ。
   */
  private drawMoon(ctx: CanvasRenderingContext2D): void {
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
      ctx.fillStyle = style.fill;
      ctx.strokeStyle = style.stroke;
      ctx.lineWidth = 2;
      roundRect(ctx, x * CELL_SIZE + pad, y * CELL_SIZE + pad, CELL_SIZE - pad * 2, CELL_SIZE - pad * 2, 8);
      ctx.fill();
      ctx.stroke();
    }
  }

  // --- 動的レイヤ ---

  /** 拍に合わせて配置マスが光る。音が無くても BPM が目で分かるようにする */
  private drawBeatPulse(ctx: CanvasRenderingContext2D): void {
    const { beatsPerBar } = this.world.clock;
    const beatPhase = ((this.world.clock.absoluteBeat % 1) + 1) % 1;
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

  /** 配置プレビュー。射程円を出して「どこに置くと効くか」を先に見せる */
  private drawHover(ctx: CanvasRenderingContext2D, hover: HoverState, snapshot: WorldSnapshot): void {
    if (hover.selectedUnitId !== null) {
      const unit = snapshot.units.find((u) => u.id === hover.selectedUnitId);
      if (unit) this.drawRangeCircle(ctx, unit.x, unit.y, unit.range, typeColor(unit.type));
    }

    const cell = hover.cell;
    if (!cell || !hover.pendingIdolId) return;

    const cx = (cell.x + 0.5) * CELL_SIZE;
    const cy = (cell.y + 0.5) * CELL_SIZE;
    const color = hover.pendingValid ? palette.placeableEdge : palette.invalid;

    this.drawRangeCircle(ctx, cell.x + 0.5, cell.y + 0.5, hover.pendingRange, color);

    ctx.save();
    ctx.globalAlpha = 0.85;
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    roundRect(ctx, cell.x * CELL_SIZE + 4, cell.y * CELL_SIZE + 4, CELL_SIZE - 8, CELL_SIZE - 8, 8);
    ctx.stroke();
    if (!hover.pendingValid) {
      ctx.beginPath();
      ctx.moveTo(cx - 14, cy - 14);
      ctx.lineTo(cx + 14, cy + 14);
      ctx.moveTo(cx + 14, cy - 14);
      ctx.lineTo(cx - 14, cy + 14);
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawRangeCircle(
    ctx: CanvasRenderingContext2D,
    cellX: number,
    cellY: number,
    range: number,
    color: string,
  ): void {
    ctx.save();
    ctx.beginPath();
    ctx.arc(cellX * CELL_SIZE, cellY * CELL_SIZE, range * CELL_SIZE, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.05)';
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.setLineDash([8, 6]);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }

  /** 攻撃の演出。歌は音波リング、それ以外は光の帯 */
  private drawAttacks(ctx: CanvasRenderingContext2D, snapshot: WorldSnapshot): void {
    const FLASH_MS = 180;
    for (const unit of snapshot.units) {
      if (unit.targetX === null || unit.targetY === null) continue;
      if (unit.lastAttackAgeMs > FLASH_MS) continue;

      const t = unit.lastAttackAgeMs / FLASH_MS;
      const color = typeColor(unit.type);
      ctx.save();
      ctx.globalAlpha = 1 - t;

      if (unit.attackKind === 'aoe_ring') {
        ctx.strokeStyle = color;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(
          unit.targetX * CELL_SIZE,
          unit.targetY * CELL_SIZE,
          unit.attackRadius * CELL_SIZE * (0.4 + 0.6 * t),
          0,
          Math.PI * 2,
        );
        ctx.stroke();
      } else {
        ctx.strokeStyle = color;
        ctx.lineWidth = 3 * (1 - t) + 1;
        ctx.beginPath();
        ctx.moveTo(unit.x * CELL_SIZE, unit.y * CELL_SIZE);
        ctx.lineTo(unit.targetX * CELL_SIZE, unit.targetY * CELL_SIZE);
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  private drawEnemies(ctx: CanvasRenderingContext2D, enemies: readonly EnemyView[], alpha: number): void {
    for (const enemy of enemies) {
      // 固定ステップ間を補間して滑らかに見せる
      const x = (enemy.prevX + (enemy.x - enemy.prevX) * alpha) * CELL_SIZE;
      const y = (enemy.prevY + (enemy.y - enemy.prevY) * alpha) * CELL_SIZE;
      const r = enemy.radius * CELL_SIZE;
      const color = attrColor(enemy.attr);

      ctx.save();
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = 'rgba(255, 255, 255, 0.65)';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // 減速中は青い縁取りで示す。数値を読まずに効果が分かるように
      if (enemy.slowed) {
        ctx.strokeStyle = palette.dance;
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.arc(x, y, r + 3, 0, Math.PI * 2);
        ctx.stroke();
      }

      // HP バー
      if (enemy.hpRatio < 1) {
        const bw = r * 2.2;
        const bh = 4;
        const bx = x - bw / 2;
        const by = y - r - 8;
        ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
        ctx.fillRect(bx, by, bw, bh);
        ctx.fillStyle = enemy.hpRatio > 0.4 ? '#7ee2a8' : '#ff7b7b';
        ctx.fillRect(bx, by, bw * enemy.hpRatio, bh);
      }
      ctx.restore();
    }
  }

  private drawUnits(
    ctx: CanvasRenderingContext2D,
    units: readonly UnitView[],
    selectedId: number | null,
  ): void {
    for (const unit of units) {
      const x = unit.x * CELL_SIZE;
      const y = unit.y * CELL_SIZE;
      const color = typeColor(unit.type);
      const r = CELL_SIZE * 0.34;

      ctx.save();
      const glow = ctx.createRadialGradient(x, y, r * 0.4, x, y, r * 1.9);
      glow.addColorStop(0, `${color}55`);
      glow.addColorStop(1, `${color}00`);
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(x, y, r * 1.9, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = palette.unitBody;
      ctx.strokeStyle = color;
      ctx.lineWidth = selectedId === unit.id ? 4 : 2.5;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      // 系統は色だけでなく形アイコンでも示す（色覚配慮 / 06-ui-ux.md 6.7）
      ctx.fillStyle = color;
      ctx.font = `bold ${Math.round(CELL_SIZE * 0.34)}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(typeIcon(unit.type), x, y + 1);

      ctx.fillStyle = palette.text;
      ctx.font = `${Math.round(CELL_SIZE * 0.17)}px system-ui, sans-serif`;
      ctx.fillText(unit.shortName, x, y + r + 10);
      ctx.restore();
    }
  }

  private drawFloatingTexts(ctx: CanvasRenderingContext2D, snapshot: WorldSnapshot): void {
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const text of snapshot.floatingTexts) {
      const t = text.ageMs / text.lifeMs;
      const x = text.x * CELL_SIZE;
      const y = text.y * CELL_SIZE - 14 - t * 22;

      // 有利は大きく黄色、不利は小さく灰色（06-ui-ux.md 6.3）
      const size =
        CELL_SIZE * (text.effectiveness === 'strong' ? 0.26 : text.effectiveness === 'weak' ? 0.17 : 0.21);
      ctx.globalAlpha = 1 - t;
      ctx.fillStyle =
        text.effectiveness === 'strong'
          ? palette.visual
          : text.effectiveness === 'weak'
            ? palette.textDim
            : palette.text;
      ctx.font = `${text.crit ? 'bold ' : ''}${Math.round(size)}px system-ui, sans-serif`;
      ctx.fillText(text.crit ? `${text.amount}!` : String(text.amount), x, y);
    }
    ctx.restore();
  }
}

function typeIcon(type: string): string {
  switch (type) {
    case 'vocal':
      return '♪';
    case 'dance':
      return '★';
    default:
      return '♥';
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
