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
import { attrColor, attrGlyph, cellStyle, palette, typeColor } from './palette';
import { GeneratedSprites, SPRITE_DRAW_SIZE, type SpriteProvider } from './sprites';
import { allowsFloatingText, flashAmount, type EffectLevel } from '../meta/settings';

/** 論理解像度。1 マス = 64px、16×9 マスで 1024×576 */
export const CELL_SIZE = 64;

/**
 * 盤面を倒すと決めるしきい値。
 *
 * 「倒したほうが大きく入るなら倒す」でよい。ただし完全な同点だと
 * 端末を少し傾けただけで向きが行き来するので、わずかに手前で止める。
 */
const ROTATE_GAIN = 1.02;

/** スペシャルライブの演出の長さ。バフの 8 秒より短くして、盤面をすぐ返す */
const SPECIAL_EFFECT_MS = 1400;

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
/** 入りは速く、終わりはゆっくり */
const ease = (t: number): number => 1 - (1 - t) * (1 - t);

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
  /** 直近の draw で盤面を 90° 倒したか */
  private rotated = false;
  /** HUD が覆っている上下の帯。背景は全面に描くが、盤面はこの内側へ収める */
  private insetTop = 0;
  private insetBottom = 0;
  /** スペシャルライブの演出。発動から数えた経過時間（ms）。null なら演出中でない */
  private specialAgeMs: number | null = null;
  private specialCenterName = '';

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly world: BattleWorld,
    /**
     * 配置メンバーの絵。差し替えたいときはここへ別の実装を渡す。
     * 手描きの PNG アトラスに移るときも Renderer 側は触らずに済む
     */
    private readonly sprites: SpriteProvider = new GeneratedSprites(),
    /**
     * 演出の強さ（06-ui-ux.md 6.7）。点滅と浮遊ダメージ表示を段階的に落とす。
     * **盤面の情報は落とさない** —— 敵・射程・配置マスは強度に関わらず同じに描く
     */
    private effects: EffectLevel = 'full',
    /** 敵に属性の記号を重ねる（06-ui-ux.md 6.7 色覚） */
    private attributeGlyphs = false,
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
    // 同じ大きさで呼ばれても作り直さない。静的レイヤの再生成が高くつくので、
    // 呼び出し側が定期的に測り直せるようにここで弾く
    if (this.widthCss === cssWidth && this.heightCss === cssHeight && this.dpr === dpr) return;

    this.widthCss = cssWidth;
    this.heightCss = cssHeight;
    this.dpr = dpr;
    this.canvas.width = Math.round(cssWidth * dpr);
    this.canvas.height = Math.round(cssHeight * dpr);
    this.canvas.style.width = `${cssWidth}px`;
    this.canvas.style.height = `${cssHeight}px`;
    this.staticLayer = null; // スケールが変わったので静的レイヤを作り直す
  }

  /**
   * HUD が覆っている領域を伝える。
   *
   * canvas 自体は画面いっぱいのままにして背景を端まで見せる一方、
   * **盤面は HUD に隠れない範囲へ収める**。canvas ごと HUD の内側へ縮めると、
   * 縦持ちで盤面を倒しても中央の細い帯にしか収まらず、倒す意味が消える。
   */
  setSafeArea(top: number, bottom: number): void {
    this.insetTop = Math.max(0, top);
    this.insetBottom = Math.max(0, bottom);
  }

  /** 画面座標をセル座標に変換する。範囲外なら null */
  cellFromClient(clientX: number, clientY: number): { x: number; y: number } | null {
    const rect = this.canvas.getBoundingClientRect();
    const view = this.view();
    const px = (clientX - rect.left - view.offsetX) / view.scale;
    const py = (clientY - rect.top - view.offsetY) / view.scale;

    // 回転しているときは描画と逆の変換をかける。
    // 盤面の当たり判定を描画と別々に持つと、必ずどちらかがずれる
    const lx = view.rotated ? py : px;
    const ly = view.rotated ? this.logicalHeight - px : py;

    const x = Math.floor(lx / CELL_SIZE);
    const y = Math.floor(ly / CELL_SIZE);
    const { w, h } = this.world.stage.grid;
    if (x < 0 || y < 0 || x >= w || y >= h) return null;
    return { x, y };
  }

  /**
   * @param alpha 固定ステップ間の補間係数。敵の位置をこれで補間するので、
   *              フレームレートが揺れても動きが滑らかに見える
   */
  /**
   * スペシャルライブの演出を始める（03-progression.md / 07 M3-2）。
   *
   * 演出の時間は **sim ではなく描画側**で数える。sim 時刻に紐付けると、
   * 一時停止やカード選択で演出が固まり、倍速では早送りされてしまう。
   */
  startSpecialEffect(centerName: string | null): void {
    this.specialAgeMs = 0;
    this.specialCenterName = centerName ?? '';
  }

  /** 設定画面での変更を、バトルを作り直さずに反映する */
  setEffects(effects: EffectLevel): void {
    this.effects = effects;
  }

  setAttributeGlyphs(on: boolean): void {
    this.attributeGlyphs = on;
  }

  draw(snapshot: WorldSnapshot, hover: HoverState, alpha: number): void {
    const { ctx } = this;
    const view = this.view();
    this.rotated = view.rotated;

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.widthCss, this.heightCss);

    ctx.save();
    ctx.translate(view.offsetX, view.offsetY);
    ctx.scale(view.scale, view.scale);
    if (view.rotated) {
      // 縦持ちでは盤面を 90° 倒して画面いっぱいに使う。
      // 16:9 の盤を縦画面へそのまま入れると 1 マスが 20px 台になり、
      // 指で押し分けられる大きさにならない
      ctx.translate(this.logicalHeight, 0);
      ctx.rotate(Math.PI / 2);
    }

    this.drawStaticLayer(ctx);
    this.drawBeatPulse(ctx);
    this.drawGoalGlow(ctx);
    this.drawHover(ctx, hover, snapshot);
    this.drawAttacks(ctx, snapshot);
    this.drawEnemies(ctx, snapshot.enemies, alpha);
    this.drawUnits(ctx, snapshot.units, hover.selectedUnitId);
    if (allowsFloatingText(this.effects)) this.drawFloatingTexts(ctx, snapshot);

    ctx.restore();

    // 演出は盤面の変換の外。画面いっぱいに出したいので、倒しても正立させる
    this.drawSpecialEffect(ctx, snapshot);
  }

  /** 実時間の経過を演出へ流し込む。呼び出しは描画ループから */
  advanceEffects(deltaMs: number): void {
    if (this.specialAgeMs !== null) {
      this.specialAgeMs += deltaMs;
      if (this.specialAgeMs > SPECIAL_EFFECT_MS) this.specialAgeMs = null;
    }
  }

  /**
   * 発動の瞬間だけ強く、あとは尾を引かせる。
   * 8 秒のバフ全体を派手にすると、肝心の盤面が見えなくなる
   */
  private drawSpecialEffect(ctx: CanvasRenderingContext2D, snapshot: WorldSnapshot): void {
    // 画面いっぱいの閃光がいちばん強い刺激。強度 0 なら丸ごと出さない
    if (flashAmount(this.effects) <= 0) return;
    // バフ中はうっすら色を乗せて、効果が続いていることを示す
    if (snapshot.specialRemainingMs > 0) {
      ctx.save();
      ctx.fillStyle = 'rgba(255, 213, 79, 0.07)';
      ctx.fillRect(0, 0, this.widthCss, this.heightCss);
      ctx.restore();
    }

    const age = this.specialAgeMs;
    if (age === null) return;
    const t = age / SPECIAL_EFFECT_MS;
    const cx = this.widthCss / 2;
    const cy = this.heightCss / 2;

    ctx.save();

    // 閃光
    if (t < 0.22) {
      ctx.fillStyle = `rgba(255, 255, 255, ${(1 - t / 0.22) * 0.75})`;
      ctx.fillRect(0, 0, this.widthCss, this.heightCss);
    }

    // 広がる輪。3 本ずらして重ねると、1 本より速く見える
    const maxR = Math.hypot(this.widthCss, this.heightCss) / 2;
    for (let i = 0; i < 3; i++) {
      const rt = t * 1.5 - i * 0.12;
      if (rt <= 0 || rt >= 1) continue;
      ctx.strokeStyle = `rgba(255, 213, 79, ${(1 - rt) * 0.7})`;
      ctx.lineWidth = 6 * (1 - rt) + 1;
      ctx.beginPath();
      ctx.arc(cx, cy, maxR * rt, 0, Math.PI * 2);
      ctx.stroke();
    }

    // カットインの帯。左から入って右へ抜ける
    const bandT = clamp01((t - 0.05) / 0.55);
    if (bandT > 0 && bandT < 1) {
      const height = this.heightCss * 0.18;
      const slide = ease(bandT);
      const alpha = bandT < 0.75 ? 1 : 1 - (bandT - 0.75) / 0.25;
      ctx.globalAlpha = alpha;
      ctx.translate(0, cy - height / 2);

      const gradient = ctx.createLinearGradient(0, 0, this.widthCss, 0);
      gradient.addColorStop(0, 'rgba(255, 107, 168, 0.0)');
      gradient.addColorStop(0.25, 'rgba(255, 107, 168, 0.85)');
      gradient.addColorStop(0.75, 'rgba(255, 213, 79, 0.85)');
      gradient.addColorStop(1, 'rgba(255, 213, 79, 0.0)');
      ctx.fillStyle = gradient;
      ctx.fillRect((slide - 1) * this.widthCss * 0.4, 0, this.widthCss * 1.4, height);

      ctx.fillStyle = '#1a1430';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      // 帯の高さだけで字を決めると、縦持ちでは画面外へはみ出す。
      // 幅からも上限を掛けて、必ず収まるようにする
      const title = Math.round(Math.min(height * 0.42, this.widthCss * 0.095));
      ctx.font = `bold ${title}px system-ui, sans-serif`;
      ctx.fillText('スペシャルライブ！', cx, height * 0.38);
      if (this.specialCenterName) {
        ctx.font = `${Math.round(title * 0.58)}px system-ui, sans-serif`;
        ctx.fillText(`センター ${this.specialCenterName}`, cx, height * 0.72);
      }
      ctx.globalAlpha = 1;
    }

    ctx.restore();
  }

  /**
   * 画面へ盤面をはめ込む変換。
   *
   * 縦画面では 90° 倒したほうが大きく入るので、**十分に得なときだけ**倒す。
   * わずかな差で倒すと、少し傾けただけで向きが変わってしまう
   */
  private view(): { scale: number; offsetX: number; offsetY: number; rotated: boolean } {
    const availH = Math.max(1, this.heightCss - this.insetTop - this.insetBottom);
    const upright = Math.min(this.widthCss / this.logicalWidth, availH / this.logicalHeight);
    const turned = Math.min(this.widthCss / this.logicalHeight, availH / this.logicalWidth);
    const rotated = turned > upright * ROTATE_GAIN;

    const scale = rotated ? turned : upright;
    const drawnW = (rotated ? this.logicalHeight : this.logicalWidth) * scale;
    const drawnH = (rotated ? this.logicalWidth : this.logicalHeight) * scale;
    return {
      scale,
      offsetX: (this.widthCss - drawnW) / 2,
      offsetY: this.insetTop + (availH - drawnH) / 2,
      rotated,
    };
  }

  /**
   * 盤面を倒していても、文字とスプライトは正立させる。
   * ダメージ数字やキャラクターが横倒しになると、盤面を大きくした意味が薄れる
   */
  private upright(ctx: CanvasRenderingContext2D, x: number, y: number, draw: () => void): void {
    if (!this.rotated) {
      draw();
      return;
    }
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(-Math.PI / 2);
    ctx.translate(-x, -y);
    draw();
    ctx.restore();
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
    // 演出強度で振れ幅を落とす。0 なら完全に止まる（光過敏対策）
    const pulse = Math.max(0, 1 - beatPhase * 2.2) * flashAmount(this.effects);
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

      // 属性の記号。色だけで見分けさせないための選択肢（06-ui-ux.md 6.7）。
      // 敵の中央へ黒で置く —— 縁へ出すと減速・停止の輪と混ざる
      if (this.attributeGlyphs) {
        ctx.fillStyle = 'rgba(10, 8, 24, 0.85)';
        ctx.font = `bold ${Math.round(r * 1.25)}px system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        this.upright(ctx, x, y, () => {
          ctx.fillText(attrGlyph(enemy.attr), x, y);
        });
      }

      // 減速中は青い縁取りで示す。数値を読まずに効果が分かるように
      if (enemy.slowed) {
        ctx.strokeStyle = palette.dance;
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.arc(x, y, r + 3, 0, Math.PI * 2);
        ctx.stroke();
      }

      // 魅了・スタンは「止まっている」ことが最も重要なので、破線の輪で強く示す
      if (enemy.bound) {
        ctx.strokeStyle = palette.visual;
        ctx.lineWidth = 2.5;
        ctx.setLineDash([4, 3]);
        ctx.beginPath();
        ctx.arc(x, y, r + 6, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
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

      // 足元の光。系統の色をここに置くと、スプライトの色に頼らずに
      // 「誰がどの系統か」が分かる（色覚配慮 / 06-ui-ux.md 6.7）
      const glow = ctx.createRadialGradient(x, y + r * 0.7, 2, x, y + r * 0.7, r * 1.6);
      glow.addColorStop(0, `${color}66`);
      glow.addColorStop(1, `${color}00`);
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.ellipse(x, y + r * 0.7, r * 1.6, r * 0.7, 0, 0, Math.PI * 2);
      ctx.fill();

      const sprite = this.sprites.get(unit.spriteId);
      if (sprite) {
        this.drawSprite(ctx, sprite, x, y, color, selectedId === unit.id);
      } else {
        this.drawUnitDisc(ctx, unit, x, y, color, r, selectedId === unit.id);
      }

      this.upright(ctx, x, y, () => {
        ctx.fillStyle = palette.text;
        ctx.font = `${Math.round(CELL_SIZE * 0.17)}px system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(unit.shortName, x, y + r + 10);
      });
      ctx.restore();
    }
  }

  private drawSprite(
    ctx: CanvasRenderingContext2D,
    sprite: CanvasImageSource,
    x: number,
    y: number,
    color: string,
    selected: boolean,
  ): void {
    // 48 ドットを 72 論理 px（= セル 64px より少し大きい）へ。
    // 1.5 倍なので 2 ドットが 3px に揃い、太さのばらつきは出ない
    const size = SPRITE_DRAW_SIZE;
    this.upright(ctx, x, y, () => {
      if (selected) {
        ctx.strokeStyle = color;
        ctx.lineWidth = 3;
        ctx.strokeRect(x - size / 2 + 4, y - size / 2 + 2, size - 8, size - 4);
      }
      const smoothing = ctx.imageSmoothingEnabled;
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(sprite, x - size / 2, y - size / 2, size, size);
      ctx.imageSmoothingEnabled = smoothing;
    });
  }

  /** スプライトが無いときの暫定表示。系統の色と形アイコンだけで見分ける */
  private drawUnitDisc(
    ctx: CanvasRenderingContext2D,
    unit: UnitView,
    x: number,
    y: number,
    color: string,
    r: number,
    selected: boolean,
  ): void {
    ctx.fillStyle = palette.unitBody;
    ctx.strokeStyle = color;
    ctx.lineWidth = selected ? 4 : 2.5;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    this.upright(ctx, x, y, () => {
      ctx.fillStyle = color;
      ctx.font = `bold ${Math.round(CELL_SIZE * 0.34)}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(typeIcon(unit.type), x, y + 1);
    });
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
      this.upright(ctx, x, y, () => {
        ctx.fillText(text.crit ? `${text.amount}!` : String(text.amount), x, y);
      });
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
