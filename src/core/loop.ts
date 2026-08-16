/**
 * 固定タイムステップのゲームループ。
 *
 * sim は必ず 1/60 秒刻みで進める（可変 dt にすると決定性が壊れる）。
 * 描画は余り時間 alpha で補間するので、フレームレートが揺れても見た目は滑らか。
 *
 * **このファイルは実時間に触れてよい唯一の場所**。他のモジュールは GameClock を読む。
 */
export const FIXED_STEP_MS = 1000 / 60;

/** 1 フレームで消化する最大ステップ数。タブ復帰時の暴走を防ぐ */
const MAX_STEPS_PER_FRAME = 5;

export interface LoopCallbacks {
  /** 固定ステップの更新。dtMs は常に FIXED_STEP_MS */
  update: (dtMs: number) => void;
  /** 描画。alpha は次ステップまでの補間係数 0..1 */
  render: (alpha: number) => void;
}

export interface LoopStats {
  fps: number;
  /** 直近フレームの update 呼び出し回数 */
  steps: number;
  /** 累計フレーム数 */
  frames: number;
}

export class GameLoop {
  private accumulatorMs = 0;
  private lastTimeMs = 0;
  private rafId: number | null = null;
  private running = false;

  private fpsCounter = 0;
  private fpsWindowStartMs = 0;
  private stats: LoopStats = { fps: 0, steps: 0, frames: 0 };

  constructor(private readonly callbacks: LoopCallbacks) {}

  get isRunning(): boolean {
    return this.running;
  }

  getStats(): Readonly<LoopStats> {
    return this.stats;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastTimeMs = performance.now();
    this.fpsWindowStartMs = this.lastTimeMs;
    this.accumulatorMs = 0;
    this.rafId = requestAnimationFrame(this.tick);
  }

  stop(): void {
    this.running = false;
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  private tick = (nowMs: number): void => {
    if (!this.running) return;
    this.rafId = requestAnimationFrame(this.tick);

    let frameMs = nowMs - this.lastTimeMs;
    this.lastTimeMs = nowMs;

    // タブが裏に回っていた等で巨大な dt が来たら切り詰める。
    // ここで clamp しないと復帰時に数百ステップ回して固まる。
    const maxFrameMs = FIXED_STEP_MS * MAX_STEPS_PER_FRAME;
    if (frameMs > maxFrameMs) frameMs = maxFrameMs;

    this.accumulatorMs += frameMs;

    let steps = 0;
    while (this.accumulatorMs >= FIXED_STEP_MS && steps < MAX_STEPS_PER_FRAME) {
      this.callbacks.update(FIXED_STEP_MS);
      this.accumulatorMs -= FIXED_STEP_MS;
      steps++;
    }

    const alpha = this.accumulatorMs / FIXED_STEP_MS;
    this.callbacks.render(alpha);

    this.stats.steps = steps;
    this.stats.frames++;
    this.fpsCounter++;
    if (nowMs - this.fpsWindowStartMs >= 500) {
      this.stats.fps = Math.round((this.fpsCounter * 1000) / (nowMs - this.fpsWindowStartMs));
      this.fpsCounter = 0;
      this.fpsWindowStartMs = nowMs;
    }
  };
}

/**
 * ヘッドレス実行用。requestAnimationFrame を使わず、指定した時間ぶんを
 * 一気に固定ステップで回す。バランスシミュレータとテストで使う。
 *
 * @returns 実行したステップ数
 */
export function runHeadless(
  durationMs: number,
  update: (dtMs: number) => void,
  shouldStop?: () => boolean,
): number {
  const steps = Math.floor(durationMs / FIXED_STEP_MS);
  for (let i = 0; i < steps; i++) {
    update(FIXED_STEP_MS);
    if (shouldStop?.()) return i + 1;
  }
  return steps;
}
