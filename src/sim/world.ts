/**
 * バトルシミュレーションの状態コンテナ。
 *
 * **DOM に一切依存しない**。React はフレームごとに読み取り専用のスナップショットを
 * 受け取るだけで、逆方向の参照は持たない（docs/design/05-architecture.md 5.1）。
 * これによりヘッドレスのバランス検証とテストが成立する。
 *
 * M0 の段階では敵・ユニットはまだ存在せず、
 * 時計・経済・ウェーブ進行だけが動く「空のステージ」。
 */
import { GameClock } from '../core/clock';
import { EventBus, type BattleEvents } from '../core/events';
import { createRng, type Rng } from '../core/rng';
import { getSong, getStage, type Song, type Stage } from '../data';
import { clamp } from '../core/vec';

/** 声援の自然回復。観客ゲージへの依存は意図的に浅い（02-core-battle.md 2.3） */
const CHEER_REGEN_BASE = 5.0;
const CHEER_REGEN_PER_AUDIENCE = 0.01;
const INITIAL_CHEER = 150;
const INITIAL_AUDIENCE = 100;

/** 小節ごとの月華（ボルテージ）基礎蓄積。劣勢からの逆転経路を確保するため */
const VOLTAGE_PER_BAR = 2.0;
const VOLTAGE_MAX = 100;

export interface WaveInfo {
  index: number;
  section: string;
  /** 曲頭からの開始小節 */
  startBar: number;
  bars: number;
  cardPick: boolean;
}

export interface WorldSnapshot {
  stageId: string;
  stageName: string;
  songName: string;
  bpm: number;
  bar: number;
  barProgress: number;
  wave: WaveInfo | null;
  waveCount: number;
  cheer: number;
  audience: number;
  voltage: number;
  clockState: string;
  speed: number;
  finished: boolean;
  won: boolean;
}

export class BattleWorld {
  readonly stage: Stage;
  readonly song: Song;
  readonly clock: GameClock;
  readonly events = new EventBus<BattleEvents>();
  readonly rng: Rng;
  readonly seed: number;

  private readonly waves: WaveInfo[];
  private readonly totalBars: number;

  private cheer = INITIAL_CHEER;
  private audience = INITIAL_AUDIENCE;
  private voltage = 0;
  private finished = false;
  private won = false;

  constructor(
    readonly stageId: string,
    seed: number,
  ) {
    this.stage = getStage(stageId);
    this.song = getSong(this.stage.song);
    this.clock = new GameClock(this.song.bpm, this.song.beatsPerBar);
    this.seed = seed;
    this.rng = createRng(seed);

    let startBar = 0;
    this.waves = this.stage.waves.map((wave, index) => {
      const info: WaveInfo = {
        index,
        section: wave.section,
        startBar,
        bars: wave.bars,
        cardPick: wave.cardPick,
      };
      startBar += wave.bars;
      return info;
    });
    this.totalBars = startBar;
  }

  /** 固定ステップの更新。呼び出し元は GameLoop か runHeadless のみ */
  update(dtMs: number): void {
    if (this.finished) return;

    const advanced = this.clock.advance(dtMs, (info) => {
      this.events.emit('beat', { bar: info.bar, beat: info.beat });
      if (info.beat === 0) {
        this.events.emit('bar', { bar: info.bar });
        this.addVoltage(VOLTAGE_PER_BAR);
      }
    });

    if (advanced === 0) return;

    const seconds = advanced / 1000;
    const regen = CHEER_REGEN_BASE + CHEER_REGEN_PER_AUDIENCE * this.audience;
    this.addCheer(regen * seconds);

    if (this.clock.bar >= this.totalBars) {
      this.finish(true);
    }
  }

  addCheer(delta: number): void {
    const next = Math.max(0, this.cheer + delta);
    const applied = next - this.cheer;
    this.cheer = next;
    if (applied !== 0) this.events.emit('cheerChanged', { value: this.cheer, delta: applied });
  }

  /** 配置・強化で消費する。足りなければ false を返して何もしない */
  spendCheer(cost: number): boolean {
    if (this.cheer < cost) return false;
    this.addCheer(-cost);
    return true;
  }

  addVoltage(delta: number): void {
    const next = clamp(this.voltage + delta, 0, VOLTAGE_MAX);
    if (next === this.voltage) return;
    this.voltage = next;
    this.events.emit('voltageChanged', { value: this.voltage });
  }

  /** 敵がセンターステージへ到達したとき */
  leakAudience(amount: number): void {
    this.audience = Math.max(0, this.audience - amount);
    this.events.emit('audienceChanged', { value: this.audience });
    if (this.audience <= 0) this.finish(false);
  }

  private finish(won: boolean): void {
    if (this.finished) return;
    this.finished = true;
    this.won = won;
    this.clock.pause();
    this.events.emit('battleEnded', { won, audienceLeft: this.audience });
  }

  /** 現在のウェーブ。全ウェーブを終えていれば null */
  get currentWave(): WaveInfo | null {
    const bar = this.clock.bar;
    for (const wave of this.waves) {
      if (bar < wave.startBar + wave.bars) return wave;
    }
    return null;
  }

  /** 描画・UI 向けの読み取り専用ビュー */
  snapshot(): WorldSnapshot {
    return {
      stageId: this.stageId,
      stageName: this.stage.name,
      songName: this.song.name,
      bpm: this.song.bpm,
      bar: this.clock.bar,
      barProgress: this.clock.barProgress,
      wave: this.currentWave,
      waveCount: this.waves.length,
      cheer: Math.floor(this.cheer),
      audience: this.audience,
      voltage: this.voltage,
      clockState: this.clock.currentState,
      speed: this.clock.playbackSpeed,
      finished: this.finished,
      won: this.won,
    };
  }
}

export function createWorld(stageId: string, seed: number): BattleWorld {
  return new BattleWorld(stageId, seed);
}
