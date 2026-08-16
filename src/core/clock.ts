/**
 * GameClock —— sim 時刻の唯一の源。
 *
 * `AudioContext.currentTime` はポーズやカード選択のモーダルでは止まらない。
 * それをゲーム進行時刻として各システムから読むと、sim を止めた瞬間に「曲だけ進む」
 * 状態が生まれ、ウェーブと楽曲がずれる。
 * そこで **時刻はここが持ち、音は追従側に置く**（docs/design/05-architecture.md 5.4）。
 */
export type ClockState =
  /** 通常再生 */
  | 'running'
  /** 一時停止。音も止める */
  | 'paused'
  /** セットリスト選択中。sim は止め、楽曲はループ区間で鳴り続ける */
  | 'choosing';

export interface BeatInfo {
  /** 0 始まりの小節番号 */
  bar: number;
  /** 小節内の拍（0 始まり） */
  beat: number;
  /** 曲頭からの通算拍（0 始まり） */
  absoluteBeat: number;
}

export class GameClock {
  /** sim の経過時間。ポーズ中は進まない */
  private timeMs = 0;
  private state: ClockState = 'running';
  private speed = 1;
  private lastEmittedBeat = -1;

  readonly beatsPerBar: number;
  private bpmValue: number;

  constructor(bpm: number, beatsPerBar = 4) {
    if (bpm <= 0) throw new Error(`bpm must be positive: ${bpm}`);
    this.bpmValue = bpm;
    this.beatsPerBar = beatsPerBar;
  }

  get bpm(): number {
    return this.bpmValue;
  }

  get msPerBeat(): number {
    return 60000 / this.bpmValue;
  }

  get msPerBar(): number {
    return this.msPerBeat * this.beatsPerBar;
  }

  /** sim 経過時間（ミリ秒） */
  get now(): number {
    return this.timeMs;
  }

  /** 曲頭からの通算拍。小数を含む */
  get absoluteBeat(): number {
    return this.timeMs / this.msPerBeat;
  }

  /** 現在の小節番号（0 始まり） */
  get bar(): number {
    return Math.floor(this.absoluteBeat / this.beatsPerBar);
  }

  /** 小節内での進捗 0..1。UI のビート表現に使う */
  get barProgress(): number {
    const beats = this.absoluteBeat;
    return (beats % this.beatsPerBar) / this.beatsPerBar;
  }

  get currentState(): ClockState {
    return this.state;
  }

  get isRunning(): boolean {
    return this.state === 'running';
  }

  /**
   * 再生速度。1x / 2x / 3x。
   *
   * **この値は時計自身の進み方を変えない。** 呼び出し側が
   * 「1 フレームに何回 sim を回すか」として使う（core/loop.ts の考え方と同じ）。
   * 時計側で dt を倍にすると、1 ステップが 1/60 秒でなくなり、
   * 攻撃回数や乱数の消費順が速度によって変わってしまう。
   * BGM の再生レートには同じ係数を掛ける。
   */
  get playbackSpeed(): number {
    return this.speed;
  }

  /** 整数倍のみ。sim ステップの反復回数として使うため */
  setSpeed(speed: number): void {
    if (!Number.isInteger(speed) || speed <= 0) {
      throw new Error(`speed must be a positive integer: ${speed}`);
    }
    this.speed = speed;
  }

  pause(): void {
    if (this.state === 'running') this.state = 'paused';
  }

  /** セットリスト選択に入る。楽曲はループ区間で鳴らし続ける前提 */
  beginChoice(): void {
    if (this.state === 'running') this.state = 'choosing';
  }

  /**
   * 選択を終えて再開する。**次の小節境界へスナップ**してから進める。
   * こうしないと再開直後のスポーンがリズムから外れる。
   */
  endChoice(): void {
    if (this.state !== 'choosing') return;
    this.snapToNextBar();
    this.state = 'running';
  }

  resume(): void {
    if (this.state === 'paused') this.state = 'running';
  }

  /** 現在時刻を次の小節頭へ進める。境界上にいる場合は動かさない */
  snapToNextBar(): void {
    const barsElapsed = this.timeMs / this.msPerBar;
    const next = Math.ceil(barsElapsed);
    // 浮動小数の誤差で「ほぼ境界」を 1 小節飛ばしてしまうのを防ぐ
    const snapped = Math.abs(next - barsElapsed) < 1e-9 ? barsElapsed : next;
    this.timeMs = snapped * this.msPerBar;
  }

  /**
   * 実時間の経過を sim 時刻へ流し込む。呼び出し元は core/loop.ts のみ。
   *
   * 跨いだ拍を `onBeat` へ**順番どおり**に通知する。跨ぎが複数ある場合
   * （低フレームレートや高速再生時）も 1 拍ずつ漏れなく呼ぶので、
   * 小節単位で定義されたスポーンが取りこぼされない。
   *
   * @returns 実際に進めた時間（ミリ秒）。ポーズ中は 0
   */
  advance(deltaMs: number, onBeat?: (info: BeatInfo) => void): number {
    if (this.state !== 'running') return 0;

    // 速度倍率はここで掛けない。掛けると 1 ステップが 1/60 秒でなくなり、
    // 倍速が「再生速度」ではなく「戦闘結果を変えるもの」になってしまう
    const applied = deltaMs;
    this.timeMs += applied;

    if (onBeat) {
      const currentBeat = Math.floor(this.absoluteBeat);
      while (this.lastEmittedBeat < currentBeat) {
        this.lastEmittedBeat += 1;
        const absoluteBeat = this.lastEmittedBeat;
        onBeat({
          bar: Math.floor(absoluteBeat / this.beatsPerBar),
          beat: absoluteBeat % this.beatsPerBar,
          absoluteBeat,
        });
      }
    }
    return applied;
  }

  /** 小節番号を時刻へ変換する。楽曲データのスポーン定義を秒に落とすのに使う */
  barToMs(bar: number): number {
    return bar * this.msPerBar;
  }

  reset(): void {
    this.timeMs = 0;
    this.state = 'running';
    this.speed = 1;
    this.lastEmittedBeat = -1;
  }
}
