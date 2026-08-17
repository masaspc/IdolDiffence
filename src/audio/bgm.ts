/**
 * BGM の再生。
 *
 * ## 時計は GameClock、音は追従側
 *
 * `AudioContext.currentTime` はポーズでもセットリスト選択でも止まらない
 * （05-architecture.md 5.4）。だから**音が時刻を持たない**。
 * 毎フレーム sim の時刻を渡してもらい、そこから「次に鳴らすべき小節」を決める。
 *
 * ## 先読みして予約する
 *
 * フレームのたびにその瞬間の音を鳴らすと、60fps でも 16ms のばらつきが出る。
 * 拍の頭が 16ms 揺れるのは、音楽としてははっきり分かる。
 * そこで **1 小節先まで予約**しておき、実際の発音は Web Audio の
 * スケジューラに任せる。ばらつきはフレームレートと切り離される。
 *
 * 予約の基準点（sim 時刻と音時刻の対応）は、**状態が変わるたびに取り直す**。
 * 取り直さないと 2 つの時計がじわじわずれる。
 *
 * ## 倍速は「速く弾く」で表す
 *
 * 録音を 2 倍速で流すと 1 オクターブ上がるが、ここは楽譜から作っているので
 * **音程はそのままでテンポだけ上げられる**。倍速でも曲が曲のまま聞こえる。
 */
import type { Section } from '../data/schema/common';
import type { Song } from '../data/schema/song';
import type { ClockState } from '../core/clock';
import { composeBar, DEFAULT_STYLE, sectionMap, type MusicStyle } from './compose';
import { playVoice } from './synth';

/** どれだけ先まで予約するか（ミリ秒）。1 小節ぶんあれば取りこぼさない */
const LOOKAHEAD_MS = 1400;

/**
 * 基準点を取り直す閾値（秒）。これを超えてずれたら合わせ直す。
 *
 * セットリスト選択のあとは小節頭へスナップする（`clock.endChoice`）ので、
 * sim 時刻が飛ぶ。飛びに気づかないと、以後ずっと過去の音を鳴らし続ける
 */
const RESYNC_SEC = 0.12;

export interface BgmOptions {
  song: Song;
  songId: string;
  style?: MusicStyle;
  /** ステージのウェーブ。曲の構成をここから作る */
  waves: readonly { section: Section; bars: number }[];
}

/** `songs.json` の `music` から合成の設定を取り出す */
export function styleOf(song: Song): MusicStyle {
  return { root: song.music.root, scale: song.music.scale, groove: song.music.groove };
}

export class BgmPlayer {
  private readonly master: GainNode;
  private readonly sections: Section[];
  private readonly msPerBar: number;

  /** 次に予約する小節 */
  private nextBar = 0;
  /** 基準点。sim 時刻（ms）と音時刻（秒）の対応 */
  private anchorSimMs = 0;
  private anchorAudioSec = 0;
  private anchored = false;
  private speed = 1;
  private lastState: ClockState = 'running';

  /**
   * セットリスト選択中のループ。
   *
   * sim が止まっているあいだ、**同じ 2 小節を鳴らし続ける**（04-content.md 4.5）。
   * 止めてしまうと選択画面が無音になり、曲が終わったように聞こえる
   */
  private loopFrom = 0;
  private loopCursorSec = 0;

  private volume = 1;

  constructor(
    private readonly ctx: AudioContext,
    private readonly options: BgmOptions,
  ) {
    this.master = ctx.createGain();
    this.master.gain.value = 0;
    this.master.connect(ctx.destination);
    this.sections = sectionMap(options.waves);
    this.msPerBar = (60000 / options.song.bpm) * options.song.beatsPerBar;
  }

  /** 0..1。0 なら以後の予約もしない（無音のためだけに音を組み立てない） */
  setVolume(value: number): void {
    this.volume = Math.max(0, Math.min(1, value));
    const target = this.lastState === 'paused' ? 0 : this.volume;
    this.master.gain.setTargetAtTime(target, this.ctx.currentTime, 0.05);
  }

  /**
   * 毎フレーム呼ぶ。sim の現在時刻から、鳴らすべき小節を予約する。
   *
   * @param simTimeMs `GameClock.now`
   * @param state ポーズとセットリスト選択で振る舞いが変わる
   * @param speed 再生速度（1 / 2 / 3）
   */
  sync(simTimeMs: number, state: ClockState, speed: number): void {
    if (this.volume === 0) {
      this.anchored = false;
      return;
    }
    if (state !== this.lastState) {
      this.onStateChange(state, simTimeMs);
      this.lastState = state;
    }
    if (state === 'paused') return;
    if (state === 'choosing') {
      this.scheduleLoop();
      return;
    }
    if (speed !== this.speed) {
      this.speed = speed;
      this.reanchor(simTimeMs);
    }
    this.scheduleForward(simTimeMs);
  }

  /** 曲を止めてノードを片付ける。バトルを抜けるときに呼ぶ */
  dispose(): void {
    this.master.gain.cancelScheduledValues(this.ctx.currentTime);
    this.master.gain.setTargetAtTime(0, this.ctx.currentTime, 0.05);
    // 予約済みの音が鳴り終わってから切る
    window.setTimeout(() => this.master.disconnect(), 600);
  }

  private onStateChange(state: ClockState, simTimeMs: number): void {
    const now = this.ctx.currentTime;
    if (state === 'paused') {
      this.master.gain.setTargetAtTime(0, now, 0.04);
      this.anchored = false;
      return;
    }
    this.master.gain.setTargetAtTime(this.volume, now, 0.06);
    if (state === 'choosing') {
      // いまの小節から 2 小節を繰り返す。頭に戻すと曲の位置を見失う
      this.loopFrom = Math.max(0, Math.floor(simTimeMs / this.msPerBar));
      this.loopCursorSec = Math.max(now, this.loopCursorSec);
      return;
    }
    this.reanchor(simTimeMs);
  }

  /** sim 時刻と音時刻を結び直す。以後の予約はここからの相対で決まる */
  private reanchor(simTimeMs: number): void {
    this.anchorSimMs = simTimeMs;
    // 予約の余裕。いま鳴らそうとすると間に合わずに欠ける
    this.anchorAudioSec = this.ctx.currentTime + 0.06;
    this.nextBar = Math.floor(simTimeMs / this.msPerBar);
    this.anchored = true;
  }

  private audioTimeFor(simMs: number): number {
    return this.anchorAudioSec + (simMs - this.anchorSimMs) / 1000 / this.speed;
  }

  private scheduleForward(simTimeMs: number): void {
    if (!this.anchored) this.reanchor(simTimeMs);
    // 2 つの時計がずれていたら取り直す（選択後のスナップなど）
    const expected = this.audioTimeFor(simTimeMs);
    if (Math.abs(expected - this.ctx.currentTime) > RESYNC_SEC) this.reanchor(simTimeMs);

    const until = simTimeMs + LOOKAHEAD_MS * this.speed;
    while (this.nextBar * this.msPerBar < until) {
      const bar = this.nextBar;
      this.nextBar += 1;
      const at = this.audioTimeFor(bar * this.msPerBar);
      if (at < this.ctx.currentTime) continue; // 間に合わない小節は捨てる
      this.scheduleBar(bar, at);
    }
  }

  /** セットリスト選択中。音時刻だけを頼りに 2 小節を繰り返す */
  private scheduleLoop(): void {
    const horizon = this.ctx.currentTime + LOOKAHEAD_MS / 1000;
    if (this.loopCursorSec < this.ctx.currentTime) {
      this.loopCursorSec = this.ctx.currentTime + 0.06;
    }
    let guard = 0;
    while (this.loopCursorSec < horizon && guard++ < 8) {
      // 2 小節でひと回り。長すぎると選択が短いときに一度も回らない
      const offset = Math.round((this.loopCursorSec - this.ctx.currentTime) / (this.msPerBar / 1000));
      this.scheduleBar(this.loopFrom + (offset % 2), this.loopCursorSec);
      this.loopCursorSec += this.msPerBar / 1000;
    }
  }

  private scheduleBar(bar: number, atSec: number): void {
    const section = this.sections[bar] ?? this.sections[this.sections.length - 1] ?? 'verse';
    const style = this.options.style ?? DEFAULT_STYLE;
    const notes = composeBar(this.options.songId, this.options.song, style, section, bar);
    const secPerBeat = 60 / this.options.song.bpm / this.speed;
    for (const note of notes) {
      playVoice(
        this.ctx,
        this.master,
        note.voice,
        atSec + note.beat * secPerBeat,
        Math.max(0.06, note.beats * secPerBeat),
        note.gain,
        note.midi,
      );
    }
  }
}
