/**
 * ホームの BGM。**オルゴール風の静かなループをゆっくり回す。**
 *
 * ## なぜバトルと別の仕組みか
 *
 * バトルの `BgmPlayer` は sim の時計（`GameClock`）に追従する ——
 * 曲の構成はウェーブから作り、ポーズや倍速に合わせる必要があるから。
 * ホームにはその時計が無い。**音の時刻だけを頼りに 8 小節を回し続ける**、
 * ずっと単純な作りでいい（バトル側の「選択中ループ」と同じ考え方）。
 *
 * ## 何を流すか
 *
 * 主題歌 Ex-Otogibanashi の枠に紐付けた**本作オリジナルの動機**
 * （`songs.json` の `motif`。原曲の旋律ではない —— 旋律の再現は
 * 楽曲の複製・翻案にあたるのでできない）を、イントロと間奏の編成
 * （オルゴールが主役、太鼓なし）で。ホームは「ツクヨミに接続して
 * 次のライブを選ぶ場所」なので、ライブの熱ではなく待ち時間の静けさを置く。
 * テンポは原曲の指定より落とす —— オルゴールは回転がゆっくりなほどらしい。
 *
 * ## 起きるまで黙って待つ
 *
 * AudioContext はユーザー操作まで `suspended`。ここでは**起きているときだけ**
 * 予約し、寝ているあいだは何もしない。タイトル画面のタップ（＝操作）で起きたら、
 * 次の tick から自然に鳴り始める。
 */
import type { Song } from '../data/schema/song';
import type { Section } from '../data/schema/common';
import { composeBar, type MusicStyle } from './compose';
import { bakeNext, createMasterBus, playVoice, warmSamples } from './synth';

/** ホームのテンポ。曲指定より遅くする（オルゴールの回転） */
const HOME_BPM = 88;

/** どれだけ先まで予約するか（秒） */
const LOOKAHEAD_SEC = 1.6;

/** 8 小節でひと回り。前半は動機の断片、後半は反行（`compose.ts` の SHAPES） */
const LOOP_BARS = 8;

function sectionOf(bar: number): Section {
  return bar % LOOP_BARS < 4 ? 'intro' : 'interlude';
}

export class HomeBgm {
  private readonly master: GainNode;
  private readonly bus: GainNode;
  private timer: number | null = null;
  private nextBar = 0;
  private nextBarSec = 0;
  private volume: number;

  constructor(
    private readonly ctx: AudioContext,
    private readonly songId: string,
    private readonly song: Song,
    private readonly style: MusicStyle,
    volume: number,
  ) {
    this.volume = volume;
    this.master = ctx.createGain();
    this.master.gain.value = volume;
    this.bus = createMasterBus(ctx, ctx.destination);
    this.master.connect(this.bus);
    // 要る標本を予約しておく（1 フレームに 1 本ずつ焼くのはバトルと同じ理由）。
    // ホームは静かな編成なので声部が少ない
    warmSamples(ctx, this.master, ['musicbox', 'koto', 'bass', 'hat'], [
      style.root - 12,
      style.root,
      style.root + 12,
      style.root + 24,
    ]);
    this.timer = window.setInterval(() => this.tick(), 250);
  }

  /** 0..1。0 なら予約もしない（無音のためだけに音を組み立てない） */
  setVolume(value: number): void {
    this.volume = Math.max(0, Math.min(1, value));
    this.master.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.05);
  }

  private tick(): void {
    // ホームでも標本は 1 tick に 1 本ずつ。まとめて焼くとここでも固まる
    bakeNext(this.ctx);
    if (this.volume === 0) return;
    // 起きるまで待つ。寝ているあいだに予約すると、起きた瞬間に溜まった音が全部鳴る
    if (this.ctx.state !== 'running') return;

    const now = this.ctx.currentTime;
    // タブを離れて戻ったときなど、予約が過去に取り残されていたら取り直す
    if (this.nextBarSec < now) this.nextBarSec = now + 0.08;

    const secPerBeat = 60 / HOME_BPM;
    const secPerBar = secPerBeat * this.song.beatsPerBar;
    while (this.nextBarSec < now + LOOKAHEAD_SEC) {
      const bar = this.nextBar % LOOP_BARS;
      const notes = composeBar(this.songId, this.song, this.style, sectionOf(bar), bar);
      for (const note of notes) {
        playVoice(
          this.ctx,
          this.master,
          note.voice,
          this.nextBarSec + note.beat * secPerBeat,
          Math.max(0.06, note.beats * secPerBeat),
          // ホームは BGM の下地。バトルと同じ音量だと画面より音が前へ出る
          note.gain * 0.7,
          note.midi,
        );
      }
      this.nextBar += 1;
      this.nextBarSec += secPerBar;
    }
  }

  /** 止めてノードを片付ける。バトルへ入るときに呼ぶ */
  dispose(): void {
    if (this.timer !== null) {
      window.clearInterval(this.timer);
      this.timer = null;
    }
    this.master.gain.cancelScheduledValues(this.ctx.currentTime);
    this.master.gain.setTargetAtTime(0, this.ctx.currentTime, 0.05);
    // 予約済みの音が減衰しきってから切る
    window.setTimeout(() => {
      this.master.disconnect();
      this.bus.disconnect();
    }, 600);
  }
}
