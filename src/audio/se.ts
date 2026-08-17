/**
 * 効果音。BGM と同じで**合成のみ**（音源ファイルは置かない）。
 *
 * ## sim は音を知らない
 *
 * 鳴らすきっかけは `world.events` の購読側で拾う。sim 側から呼ぶと、
 * ヘッドレス計測（`scripts/probe.ts`）やテストで音の都合を持ち込むことになる。
 *
 * ## 間引く
 *
 * 撃破は 1 ライブで数百回起きる。全部鳴らすと音が潰れるだけでなく、
 * 1 フレームに数十個のノードを作ってフレーム落ちの原因になる。
 * **同じ音は最短間隔を空ける**（`MIN_GAP_MS`）。
 *
 * ## 揺らぎは決定的に作る
 *
 * `Math.random()` は eslint で禁じてある（sim の再現性のため）。
 * 効果音は sim の外なので実害は無いが、例外を作ると「ここだけは良い」が
 * 増えていく。鳴らした回数から導く。
 */
import { audioContext } from './context';
import { midiToFreq } from './scale';

export type SeName =
  /** 配置 */
  | 'place'
  /** ポジション強化 */
  | 'upgrade'
  /** 撃破 */
  | 'kill'
  /** 観客が減る */
  | 'leak'
  /** 月華解放 */
  | 'special'
  /** ボス登場 */
  | 'boss'
  /** ボスのフェーズ変化 */
  | 'phase'
  /** セットリストを選んだ */
  | 'card'
  /** コール成功（Perfect） */
  | 'callPerfect'
  /** 完走 */
  | 'win'
  /** 失敗 */
  | 'lose';

/** 同じ音を鳴らす最短間隔。撃破のような高頻度の音を潰さないため */
const MIN_GAP_MS: Record<SeName, number> = {
  place: 40,
  upgrade: 40,
  kill: 55,
  leak: 120,
  special: 400,
  boss: 400,
  phase: 300,
  card: 80,
  callPerfect: 60,
  win: 500,
  lose: 500,
};

const lastAt = new Map<SeName, number>();
/** 鳴らした回数。揺らぎの種にする */
let counter = 0;

let volume = 0;

/** 0..1。0 なら以後の合成もしない */
export function setSeVolume(value: number): void {
  volume = Math.max(0, Math.min(1, value));
}

export function seVolume(): number {
  return volume;
}

/**
 * 効果音を 1 つ鳴らす。
 *
 * 音が使えない環境・音量 0・間引き中は**何もしない**（例外も投げない）。
 * 呼び出し側が状況を確かめなくて済むようにしてある
 */
export function playSe(name: SeName): void {
  if (volume <= 0) return;
  const ctx = audioContext();
  if (!ctx) return;
  const nowMs = ctx.currentTime * 1000;
  const previous = lastAt.get(name);
  if (previous !== undefined && nowMs - previous < MIN_GAP_MS[name]) return;
  lastAt.set(name, nowMs);

  const at = ctx.currentTime + 0.005;
  const seed = counter++;
  render(ctx, name, at, volume, seed);
}

/** 立ち上がりと減衰。`synth.ts` と同じ形（あちらは BGM 専用なので分けてある） */
function envelope(
  ctx: AudioContext,
  at: number,
  attack: number,
  duration: number,
  peak: number,
): GainNode {
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, at);
  gain.gain.linearRampToValueAtTime(peak, at + attack);
  gain.gain.exponentialRampToValueAtTime(Math.max(peak * 0.001, 1e-5), at + duration);
  gain.gain.setValueAtTime(0, at + duration + 0.01);
  return gain;
}

/** 単音。効果音はほぼこれの組み合わせでできている */
function tone(
  ctx: AudioContext,
  type: OscillatorType,
  midi: number,
  at: number,
  duration: number,
  gain: number,
  toMidi?: number,
): void {
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(midiToFreq(midi), at);
  if (toMidi !== undefined) {
    osc.frequency.exponentialRampToValueAtTime(midiToFreq(toMidi), at + duration);
  }
  const env = envelope(ctx, at, 0.004, duration, gain);
  osc.connect(env).connect(ctx.destination);
  osc.start(at);
  osc.stop(at + duration + 0.05);
}

/** ノイズの一撃。打撃感を出す */
function burst(
  ctx: AudioContext,
  at: number,
  duration: number,
  gain: number,
  hz: number,
  type: BiquadFilterType = 'bandpass',
): void {
  const length = Math.max(1, Math.floor(ctx.sampleRate * duration));
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  let s = 0x9e3779b9;
  for (let i = 0; i < length; i++) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    data[i] = (s / 0xffffffff) * 2 - 1;
  }
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  const filter = ctx.createBiquadFilter();
  filter.type = type;
  filter.frequency.value = hz;
  const env = envelope(ctx, at, 0.002, duration, gain);
  source.connect(filter).connect(env).connect(ctx.destination);
  source.start(at);
  source.stop(at + duration + 0.05);
}

function render(ctx: AudioContext, name: SeName, at: number, vol: number, seed: number): void {
  switch (name) {
    // 配置: 木を置く音。低めの短い打撃
    case 'place':
      burst(ctx, at, 0.07, vol * 0.28, 1400);
      tone(ctx, 'triangle', 62, at, 0.09, vol * 0.16);
      return;

    // 強化: 上がったことが分かるように 2 音を上へ
    case 'upgrade':
      tone(ctx, 'triangle', 69, at, 0.09, vol * 0.2);
      tone(ctx, 'triangle', 76, at + 0.06, 0.14, vol * 0.18);
      return;

    // 撃破: 高くて短い。数が多いので**いちばん小さく**する。
    // 音高を少しずつ変えて、連続しても同じ音の繰り返しに聞こえないようにする
    case 'kill':
      tone(ctx, 'square', 84 + (seed % 5), at, 0.05, vol * 0.055);
      return;

    // 漏れ: 下がる音。減ったことが耳で分かる
    case 'leak':
      tone(ctx, 'sawtooth', 55, at, 0.28, vol * 0.16, 41);
      return;

    // 月華解放: 上昇する分散和音 + 鈴
    case 'special':
      for (let i = 0; i < 5; i++) {
        tone(ctx, 'triangle', 64 + i * 4, at + i * 0.045, 0.3, vol * 0.16);
      }
      tone(ctx, 'sine', 93, at + 0.2, 0.9, vol * 0.1);
      return;

    // ボス登場: 低い一撃と、ぶつかる 2 音
    case 'boss':
      burst(ctx, at, 0.45, vol * 0.22, 220, 'lowpass');
      tone(ctx, 'sawtooth', 33, at, 0.7, vol * 0.2);
      tone(ctx, 'sawtooth', 34, at, 0.7, vol * 0.14);
      return;

    // フェーズ変化: 属性が一周したことを示す短い上昇
    case 'phase':
      tone(ctx, 'square', 58, at, 0.16, vol * 0.14, 70);
      return;

    // カード選択: 紙をめくる質感
    case 'card':
      burst(ctx, at, 0.11, vol * 0.14, 3200, 'highpass');
      tone(ctx, 'sine', 81, at + 0.02, 0.12, vol * 0.1);
      return;

    // コール Perfect: 軽い鈴。押した手応えだけを返す
    case 'callPerfect':
      tone(ctx, 'sine', 96, at, 0.11, vol * 0.09);
      return;

    // 完走 / 失敗: 上がる 4 音と、下がる 3 音
    case 'win':
      for (const [i, midi] of [64, 69, 71, 76].entries()) {
        tone(ctx, 'triangle', midi, at + i * 0.1, 0.5, vol * 0.18);
      }
      return;
    case 'lose':
      for (const [i, midi] of [59, 55, 50].entries()) {
        tone(ctx, 'triangle', midi, at + i * 0.16, 0.55, vol * 0.16);
      }
      return;
  }
}
