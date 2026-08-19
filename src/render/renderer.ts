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
import { enemyDrawSize, GeneratedEnemySprites } from './enemySprites';
import { allowsFloatingText, flashAmount, type EffectLevel } from '../meta/settings';
import { CUTIN_STYLES, CutInQueue, type CutIn } from './cutin';
import { CommentStream, type CommentKind } from './comments';
import { blockedCells, filledCount, interleave, seatsAround, type Seat } from './audience';
import { tensionAmount } from '../audio/bgm';
import {
  drawBallSparkle,
  drawDrifters,
  drawMirrorBall,
  drawMoon,
  drawWater,
  skyDrifters,
} from './sky';
import { chapterIndexOf } from '../data';

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
  /** 背景（空）と盤面を分けて焼く。あいだに空の飾りが入る */
  private skyLayer: HTMLCanvasElement | null = null;
  private boardLayer: HTMLCanvasElement | null = null;
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
  /** カットイン（月華・ソロ・ボス・フェーズ・危機）。閃光とは別枠で数える */
  private readonly cutIns = new CutInQueue();
  /**
   * 空の飾り（ツクヨミの魚群・飛行船・蒸気機関車）。
   * sim 時刻ではなく**実時間**で流す —— 一時停止で空まで止まると、
   * 画面が死んだように見える
   */
  private skyTimeMs = 0;
  private readonly drifters: ReturnType<typeof skyDrifters>;
  /** 配信コメント（`comments.ts`）。ツクヨミのライブには画面の向こうの観客がいる */
  private readonly comments = new CommentStream();
  /** 子ウサギの客席（`audience.ts`）。ステージが決まれば席は動かない */
  private readonly audienceSeats: Seat[];

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly world: BattleWorld,
    /**
     * 配置メンバーの絵。差し替えたいときはここへ別の実装を渡す。
     * 手描きの PNG アトラスに移るときも Renderer 側は触らずに済む
     */
    private readonly sprites: SpriteProvider = new GeneratedSprites(),
    /** 敵の絵。アイドルと分けてあるのは、組み立て方も大きさの決め方も違うから */
    private readonly enemySprites: SpriteProvider = new GeneratedEnemySprites(),
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
    this.drifters = skyDrifters(world.stageId);
    // 経路と配置マスの上には座らせない。複数レーンが同じゴールへ集まる
    // ステージでは席を二重に敷かず、ゴールが複数あるステージでは
    // 「前から埋める」がどのゴールにも同じくらい効くよう交互に混ぜる
    const blocked = blockedCells(world.stage.lanes, world.stage.placeable);
    const seenGoals = new Set<string>();
    const groups: Seat[][] = [];
    world.stage.lanes.forEach((lane, laneIndex) => {
      const wp = lane.waypoints;
      const last = wp[wp.length - 1];
      if (!last) return;
      const key = `${last[0]},${last[1]}`;
      if (seenGoals.has(key)) return;
      seenGoals.add(key);
      const prev = wp.length > 1 ? (wp[wp.length - 2] ?? null) : null;
      groups.push(
        seatsAround(last, prev, world.stage.grid.w, world.stage.grid.h, laneIndex, blocked),
      );
    });
    this.audienceSeats = interleave(groups);
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
    // スケールが変わったので静的レイヤを作り直す
    this.skyLayer = null;
    this.boardLayer = null;
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
   * スペシャルライブの閃光を始める（03-progression.md / 07 M3-2）。
   *
   * 演出の時間は **sim ではなく描画側**で数える。sim 時刻に紐付けると、
   * 一時停止やカード選択で演出が固まり、倍速では早送りされてしまう。
   *
   * 文字と顔は `pushCutIn` の側。帯を 2 系統で描くと重なる
   */
  startSpecialEffect(): void {
    this.specialAgeMs = 0;
  }

  /**
   * カットインを積む（`cutin.ts`）。
   *
   * **盤面から目を離させる価値がある場面にだけ呼ぶこと。**
   * 撃破や配置のように毎秒起きるものは音のほうで返す
   */
  pushCutIn(cutIn: CutIn): void {
    this.cutIns.push(cutIn);
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

    this.drawSkyLayer(ctx);
    // 空の飾りは**背景と盤面のあいだ**。経路や配置マスの上を泳がせない
    drawDrifters(ctx, this.logicalWidth, this.logicalHeight, this.drifters, this.skyTimeMs);
    this.drawBoardLayer(ctx);
    this.drawBeatPulse(ctx);
    // 客席は敵とユニットの下。最小設定では描かない（純粋な飾りなので消しても情報は減らない）
    if (this.effects !== 'minimal') this.drawAudience(ctx, snapshot);
    this.drawGoalGlow(ctx);
    this.drawHover(ctx, hover, snapshot);
    this.drawAttacks(ctx, snapshot);
    this.drawEnemies(ctx, snapshot.enemies, alpha);
    this.drawUnits(ctx, snapshot.units, hover.selectedUnitId);
    if (allowsFloatingText(this.effects)) this.drawFloatingTexts(ctx, snapshot);

    ctx.restore();

    // 同接が 20 を切ると画面の周辺が暗くなる（06-ui-ux 6.4）。
    // BGM のハイパス（bgm.setAudience）と同じ曲線で、音と画面が一緒に細る
    this.drawVignette(ctx, snapshot);
    // 演出は盤面の変換の外。画面いっぱいに出したいので、倒しても正立させる
    // 配信コメントは HUD のすぐ下の帯。盤面の変換の外なので、倒しても読める
    this.comments.draw(ctx, this.widthCss, this.insetTop + 8, 84);
    this.drawSpecialEffect(ctx, snapshot);
    this.drawCutIn(ctx);
  }

  /** 実時間の経過を演出へ流し込む。呼び出しは描画ループから */
  advanceEffects(deltaMs: number): void {
    if (this.specialAgeMs !== null) {
      this.specialAgeMs += deltaMs;
      if (this.specialAgeMs > SPECIAL_EFFECT_MS) this.specialAgeMs = null;
    }
    this.cutIns.advance(deltaMs, this.effects);
    this.skyTimeMs += deltaMs;
    this.comments.advance(deltaMs);
    this.comments.prune(this.widthCss);
  }

  /** 配信コメントを流す。呼ぶのは world.events の購読側（BattleScreen） */
  pushComment(kind: CommentKind): void {
    this.comments.push(kind, this.effects);
  }

  /**
   * カットイン。斜めの帯 + 顔 + 見出し。
   *
   * **最小設定でも消さない。** これは点滅ではなく情報で、消すと
   * 「ボスが湧いたことに気づかない」が起きる。短くして刺激だけ減らす
   * （`cutInSpeed`）。閃光の側は `flashAmount` で別に落ちる。
   */
  private drawCutIn(ctx: CanvasRenderingContext2D): void {
    const active = this.cutIns.active(this.effects);
    if (!active) return;
    const { cutIn, t } = active;
    const style = CUTIN_STYLES[cutIn.kind];

    // 入りは速く、出は速く、真ん中で止める。ずっと動いていると文字が読めない
    const enter = clamp01(t / 0.18);
    const exit = 1 - clamp01((t - 0.78) / 0.22);
    const slide = ease(enter) - (1 - exit) * 0.25;
    const alpha = Math.min(enter, exit);
    if (alpha <= 0) return;

    const cx = this.widthCss / 2;
    const height = Math.min(this.heightCss * 0.2, this.widthCss * 0.17);
    const top = this.heightCss * 0.5 - height / 2;

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate((slide - 1) * this.widthCss * 0.35, top);

    // 斜めに切った帯。真横の長方形より「差し込まれた」感じが出る
    const skew = height * 0.35;
    ctx.beginPath();
    ctx.moveTo(-this.widthCss * 0.2 + skew, 0);
    ctx.lineTo(this.widthCss * 1.4, 0);
    ctx.lineTo(this.widthCss * 1.4 - skew, height);
    ctx.lineTo(-this.widthCss * 0.2, height);
    ctx.closePath();

    const gradient = ctx.createLinearGradient(0, 0, this.widthCss, 0);
    gradient.addColorStop(0, `${style.from}00`);
    gradient.addColorStop(0.18, style.from);
    gradient.addColorStop(0.82, style.to);
    gradient.addColorStop(1, `${style.to}00`);
    ctx.fillStyle = gradient;
    ctx.fill();

    // 顔。持っている絵をそのまま大きく出す。無ければ文字だけで成立させる
    const sprite = cutIn.idolId
      ? this.sprites.get(cutIn.idolId)
      : cutIn.enemyId
        ? this.enemySprites.get(cutIn.enemyId)
        : null;
    let textLeft = cx;
    if (sprite) {
      const size = height * 1.35;
      const x = this.widthCss * 0.16;
      ctx.save();
      // 帯からはみ出させる。収めると小さくなりすぎて誰だか分からない
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(sprite, x - size / 2, height / 2 - size / 2, size, size);
      ctx.restore();
      textLeft = cx + this.widthCss * 0.06;
    }

    ctx.fillStyle = style.ink;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const title = Math.round(Math.min(height * 0.4, this.widthCss * 0.075));
    ctx.font = `bold ${title}px system-ui, sans-serif`;
    ctx.fillText(cutIn.title, textLeft, cutIn.subtitle ? height * 0.38 : height * 0.5);
    if (cutIn.subtitle) {
      ctx.font = `${Math.round(title * 0.55)}px system-ui, sans-serif`;
      ctx.fillText(cutIn.subtitle, textLeft, height * 0.73);
    }
    ctx.restore();
  }

  /**
   * 発動の瞬間だけ強く、あとは尾を引かせる。
   * 8 秒のバフ全体を派手にすると、肝心の盤面が見えなくなる
   */
  private drawSpecialEffect(ctx: CanvasRenderingContext2D, snapshot: WorldSnapshot): void {
    // 画面いっぱいの閃光がいちばん強い刺激。強度 0 なら丸ごと出さない。
    // **0 でないときも振れ幅を掛ける** —— ゲートにだけ使うと、
    // 「控えめ」を選んだ人に標準と同じ閃光が出る（光過敏対策の意味が無い）
    const flash = flashAmount(this.effects);
    if (flash <= 0) return;
    // バフ中はうっすら色を乗せて、効果が続いていることを示す
    if (snapshot.specialRemainingMs > 0) {
      ctx.save();
      ctx.fillStyle = `rgba(255, 213, 79, ${0.07 * flash})`;
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
      ctx.fillStyle = `rgba(255, 255, 255, ${(1 - t / 0.22) * 0.75 * flash})`;
      ctx.fillRect(0, 0, this.widthCss, this.heightCss);
    }

    // 広がる輪。3 本ずらして重ねると、1 本より速く見える
    const maxR = Math.hypot(this.widthCss, this.heightCss) / 2;
    for (let i = 0; i < 3; i++) {
      const rt = t * 1.5 - i * 0.12;
      if (rt <= 0 || rt >= 1) continue;
      ctx.strokeStyle = `rgba(255, 213, 79, ${(1 - rt) * 0.7 * flash})`;
      ctx.lineWidth = 6 * (1 - rt) + 1;
      ctx.beginPath();
      ctx.arc(cx, cy, maxR * rt, 0, Math.PI * 2);
      ctx.stroke();
    }

    // 文字と顔はカットイン（`drawCutIn`）が出す。ここは閃光と輪だけ ——
    // 帯を 2 系統が別々に描くと、月華のときだけ 2 枚重なる
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
  //
  // **2 枚に分ける。** 空の飾り（魚群・飛行船・蒸気機関車）は
  // 背景と盤面のあいだへ入るので、1 枚に焼き込むと経路や配置マスの上を
  // 泳ぐことになる。「盤面より奥に描く」という前提が崩れて読みにくくなる。

  /** 空（背景・水・月・ミラーボール）。飾りより奥 */
  private drawSkyLayer(ctx: CanvasRenderingContext2D): void {
    if (!this.skyLayer) this.skyLayer = this.buildLayer(false);
    ctx.drawImage(this.skyLayer, 0, 0);
  }

  /** 盤面（グリッド・経路・配置マス）。飾りより手前 */
  private drawBoardLayer(ctx: CanvasRenderingContext2D): void {
    if (!this.boardLayer) this.boardLayer = this.buildLayer(true);
    ctx.drawImage(this.boardLayer, 0, 0);
  }

  private buildLayer(board: boolean): HTMLCanvasElement {
    const layer = document.createElement('canvas');
    layer.width = this.logicalWidth;
    layer.height = this.logicalHeight;
    const ctx = layer.getContext('2d');
    if (!ctx) throw new Error('静的レイヤの 2D コンテキストを取得できませんでした');

    if (board) {
      // 盤面側は**透ける**。下の空と飾りを覆い隠さない
      this.drawGrid(ctx);
      this.drawLanes(ctx);
      this.drawPlaceableCells(ctx);
      return layer;
    }

    this.drawBackground(ctx);
    // ヤチヨのライブは一面が水。背景に重ねるだけで、盤面の描き方は変えない
    if (this.world.stage.scenery === 'water') {
      drawWater(ctx, this.logicalWidth, this.logicalHeight);
    }
    // ツクヨミの空にあるのはミラーボール。本物の月は章が進むと昇る（sky.ts）
    drawMoon(ctx, this.logicalWidth, this.logicalHeight, chapterIndexOf(this.world.stageId));
    drawMirrorBall(ctx, this.logicalWidth, this.logicalHeight);
    return layer;
  }

  private drawBackground(ctx: CanvasRenderingContext2D): void {
    const gradient = ctx.createLinearGradient(0, 0, 0, this.logicalHeight);
    gradient.addColorStop(0, palette.bgTop);
    gradient.addColorStop(1, palette.bgBottom);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, this.logicalWidth, this.logicalHeight);
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
    // 空のミラーボールも一緒に光る。盤面と空が同じ会場に見える
    drawBallSparkle(ctx, this.logicalWidth, this.logicalHeight, pulse * (isDownbeat ? 1 : 0.45));
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

  /**
   * 子ウサギの客席（`audience.ts`）。
   *
   * 同接に比例して前から席が埋まる —— 敵を通すと、ゲージと一緒に
   * **誰が帰ったのか**が画面に見える。サビと大詰めではペンライトが点き、
   * 1 小節ごとに一斉に色が替わる（06-ui-ux.md 6.4 の演出表）。
   * 揺れは「控えめ」で止め、「最小」ではそもそも呼ばれない。
   */
  private drawAudience(ctx: CanvasRenderingContext2D, snapshot: WorldSnapshot): void {
    const filled = filledCount(this.audienceSeats.length, snapshot.audience);
    if (filled === 0) return;
    const lively = this.effects === 'full';
    const beat = this.world.clock.absoluteBeat;
    const section = snapshot.wave?.section;
    const penlight = section === 'chorus' || section === 'finale';
    const penColors = [typeColor('vocal'), typeColor('dance'), typeColor('visual')];
    const penColor = penColors[snapshot.bar % penColors.length] ?? '#ffd54f';

    ctx.save();
    for (let i = 0; i < filled; i++) {
      const seat = this.audienceSeats[i];
      if (!seat) continue;
      const x = seat.x * CELL_SIZE;
      const bob = lively ? Math.sin((beat + seat.phase) * Math.PI * 2) * 1.8 : 0;
      const y = seat.y * CELL_SIZE + bob;

      if (penlight) {
        const sway = lively ? Math.sin((beat * 2 + seat.phase) * Math.PI * 2) * 0.55 : 0.25;
        ctx.globalAlpha = 0.95;
        ctx.strokeStyle = penColor;
        ctx.lineWidth = 2.4;
        ctx.beginPath();
        ctx.moveTo(x + 4, y - 2);
        ctx.lineTo(x + 4 + sway * 7, y - 14);
        ctx.stroke();
        ctx.fillStyle = penColor;
        ctx.beginPath();
        ctx.arc(x + 4 + sway * 7, y - 14, 2.2, 0, Math.PI * 2);
        ctx.fill();
      }

      // 子ウサギ本体。耳 2 本 + 丸い体（64px マスに対して 14px 程度）
      ctx.globalAlpha = 0.88;
      ctx.fillStyle = '#ece8fa';
      ctx.beginPath();
      ctx.ellipse(x - 2.1, y - 7.5, 1.3, 3.6, -0.14, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(x + 2.1, y - 7.5, 1.3, 3.6, 0.14, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(x, y - 1, 5, 4.4, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  /**
   * 同接 20 以下の周辺減光（06-ui-ux 6.4）。
   *
   * 客が帰るほど画面の隅から暗くなる。中心（盤面）は暗くしない ——
   * 苦しいときほど盤面を読む必要があるので、これは**情報を遮らない演出**。
   * 静的な暗さで点滅ではないため「控えめ」でも出すが、「最小」では消す。
   */
  private drawVignette(ctx: CanvasRenderingContext2D, snapshot: WorldSnapshot): void {
    if (this.effects === 'minimal') return;
    const strength = tensionAmount(snapshot.audience);
    if (strength === 0) return;
    const cx = this.widthCss / 2;
    const cy = this.heightCss / 2;
    const r = Math.hypot(cx, cy);
    const gradient = ctx.createRadialGradient(cx, cy, r * 0.55, cx, cy, r);
    gradient.addColorStop(0, 'rgba(4, 2, 12, 0)');
    gradient.addColorStop(1, `rgba(4, 2, 12, ${0.55 * strength})`);
    ctx.save();
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, this.widthCss, this.heightCss);
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

      const sprite = this.enemySprites.get(enemy.spriteId);
      if (sprite) {
        // 足元に属性の色を敷く。絵は形で役割を伝え、**属性は色で**伝える ——
        // 絵の色を属性に合わせると、五人の貴公子が塗り分けられなくなる
        const glow = ctx.createRadialGradient(x, y + r * 0.5, 1, x, y + r * 0.5, r * 1.5);
        glow.addColorStop(0, `${color}88`);
        glow.addColorStop(1, `${color}00`);
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.ellipse(x, y + r * 0.5, r * 1.5, r * 0.8, 0, 0, Math.PI * 2);
        ctx.fill();

        const size = enemyDrawSize(enemy.radius, CELL_SIZE);
        const smoothing = ctx.imageSmoothingEnabled;
        ctx.imageSmoothingEnabled = false;
        this.upright(ctx, x, y, () => {
          ctx.drawImage(sprite, x - size / 2, y - size / 2, size, size);
        });
        ctx.imageSmoothingEnabled = smoothing;
      } else {
        // 絵の指定が無い敵。丸へ戻す
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();

        ctx.strokeStyle = 'rgba(255, 255, 255, 0.65)';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }

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

      // バリア（月の都の門番）。HP バーの上に別枠で置く。
      // HP と同じ帯にすると「削れているのに減らない」に見え、
      // かといって出さないと「一気に割る」が効いているか読めない
      if (enemy.barrierRatio > 0) {
        const bw = r * 2.2;
        const bh = 3;
        const bx = x - bw / 2;
        const by = y - r - 13;
        ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
        ctx.fillRect(bx, by, bw, bh);
        ctx.fillStyle = '#9fd8ff';
        ctx.fillRect(bx, by, bw * enemy.barrierRatio, bh);
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
      // バリアに吸われたぶんは HP に通っていない。バリアの帯と同じ色で
      // 小さく出して、**削れてはいるが減ってはいない**を一目で分けさせる
      ctx.fillStyle = text.absorbed
        ? '#9fd8ff'
        : text.effectiveness === 'strong'
          ? palette.visual
          : text.effectiveness === 'weak'
            ? palette.textDim
            : palette.text;
      const shown = text.absorbed ? size * 0.8 : size;
      ctx.font = `${text.crit && !text.absorbed ? 'bold ' : ''}${Math.round(shown)}px system-ui, sans-serif`;
      this.upright(ctx, x, y, () => {
        const label = text.absorbed
          ? `◇${text.amount}`
          : text.crit
            ? `${text.amount}!`
            : String(text.amount);
        ctx.fillText(label, x, y);
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
