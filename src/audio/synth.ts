/**
 * 音を出す。和楽器をシンセで近似する（04-content.md 4.5）。
 *
 * 1 音ごとにノードを作って捨てる。使い回すと停止処理が要るうえ、
 * 同じ音が重なったときに前の音を切ってしまう。Web Audio のノードは軽く、
 * 1 小節あたり数十個なら作り捨てで問題ない。
 *
 * ## 音色の作り方
 *
 * 本物の楽器の波形は持たない（サンプルを置けないので）。代わりに
 * **その楽器を「らしく」しているのは何か**を 1〜2 個だけ真似る。
 *
 * - 和太鼓 = 急激に下がる低音 + 打面のノイズ
 * - 箏 = 弦を爪弾く鋭い立ち上がりと、倍音を含む減衰
 * - 尺八 = 息のノイズと、遅れて掛かるビブラート
 *
 * 全部を真似ようとすると重くなるだけで、似てはこない。
 */
import type { Voice } from './compose';
import { midiToFreq } from './scale';

/**
 * 残響。**ここが無いと、どれだけ良い譜面でも「打ち込み」に聞こえる。**
 *
 * 1 音ずつが乾いたまま鳴ると、会場ではなく机の上で鳴っている音になる。
 * インパルス応答（減衰するノイズ）を作って `ConvolverNode` に食わせるだけで、
 * 「広い場所で鳴っている」に変わる。音源ファイルは要らない。
 *
 * AudioContext ごとに 1 つ作って使い回す。
 */
const reverbs = new WeakMap<BaseAudioContext, GainNode>();

function reverbSend(ctx: BaseAudioContext, destination: AudioNode): GainNode {
  const existing = reverbs.get(ctx);
  if (existing) return existing;

  const seconds = 1.9;
  const length = Math.floor(ctx.sampleRate * seconds);
  const impulse = ctx.createBuffer(2, length, ctx.sampleRate);
  // 決定性のため `Math.random()` は使わない（eslint で禁止）
  let seed = 0x6d2b79f5;
  for (let channel = 0; channel < 2; channel++) {
    const data = impulse.getChannelData(channel);
    for (let i = 0; i < length; i++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      const noise = (seed / 0xffffffff) * 2 - 1;
      // 指数減衰。頭を少し遅らせると、壁までの距離が出る
      const decay = Math.pow(1 - i / length, 2.6);
      data[i] = noise * decay * (i < ctx.sampleRate * 0.012 ? 0.2 : 1);
    }
  }

  const convolver = ctx.createConvolver();
  convolver.buffer = impulse;
  // 残響だけ高域を落とす。落とさないと、刻みの残響が耳に刺さる
  const damp = ctx.createBiquadFilter();
  damp.type = 'lowpass';
  damp.frequency.value = 3600;

  const send = ctx.createGain();
  send.gain.value = 1;
  send.connect(convolver).connect(damp).connect(destination);
  reverbs.set(ctx, send);
  return send;
}

/** ホワイトノイズのバッファ。打楽器と息の成分に使う。1 回作って使い回す */
let noiseBuffer: AudioBuffer | null = null;

function noise(ctx: BaseAudioContext): AudioBuffer {
  if (noiseBuffer && noiseBuffer.sampleRate === ctx.sampleRate) return noiseBuffer;
  const length = Math.floor(ctx.sampleRate * 0.5);
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  // 決定性のため `Math.random()` は使わない（eslint で禁止）。
  // 線形合同法で十分にノイズらしくなる
  let seed = 0x2545f491;
  for (let i = 0; i < length; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    data[i] = (seed / 0xffffffff) * 2 - 1;
  }
  noiseBuffer = buffer;
  return buffer;
}

function noiseSource(ctx: BaseAudioContext): AudioBufferSourceNode {
  const source = ctx.createBufferSource();
  source.buffer = noise(ctx);
  source.loop = true;
  return source;
}

/** 立ち上がりと減衰。すべての音がこの形を通る */
function envelope(
  ctx: BaseAudioContext,
  at: number,
  attack: number,
  duration: number,
  peak: number,
): GainNode {
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, at);
  gain.gain.linearRampToValueAtTime(peak, at + attack);
  // 指数減衰。0 へは落とせないので、十分小さい値で止めてから 0 にする
  gain.gain.exponentialRampToValueAtTime(peak * 0.001, at + duration);
  gain.gain.setValueAtTime(0, at + duration + 0.01);
  return gain;
}

/**
 * 1 音を鳴らす。
 *
 * @param at 鳴らす時刻（`AudioContext.currentTime` と同じ基準の秒）
 * @param duration 長さ（秒）
 */
/** 声部ごとの残響の深さ。低音と刻みを濡らすと輪郭が消える */
const REVERB: Record<Voice, number> = {
  taiko: 0.12,
  hat: 0.06,
  koto: 0.3,
  shakuhachi: 0.34,
  bass: 0.05,
  bell: 0.5,
  musicbox: 0.45,
};

export function playVoice(
  ctx: BaseAudioContext,
  destination: AudioNode,
  voice: Voice,
  at: number,
  duration: number,
  gain: number,
  midi?: number,
): void {
  const freq = midi === undefined ? 0 : midiToFreq(midi);

  // 直接音と残響へ同時に送る。残響の深さは声部ごと
  const bus = ctx.createGain();
  bus.gain.value = 1;
  bus.connect(destination);
  const wet = REVERB[voice];
  if (wet > 0) {
    const send = ctx.createGain();
    send.gain.value = wet;
    bus.connect(send).connect(reverbSend(ctx, destination));
  }

  switch (voice) {
    case 'taiko':
      taiko(ctx, bus, at, gain);
      return;
    case 'hat':
      hat(ctx, bus, at, gain);
      return;
    case 'koto':
      koto(ctx, bus, at, duration, gain, freq);
      return;
    case 'shakuhachi':
      shakuhachi(ctx, bus, at, duration, gain, freq);
      return;
    case 'bass':
      bass(ctx, bus, at, duration, gain, freq);
      return;
    case 'bell':
      bell(ctx, bus, at, duration, gain, freq);
      return;
    case 'musicbox':
      musicbox(ctx, bus, at, duration, gain, freq);
      return;
  }
}

/**
 * オルゴール。**加算合成 + 非整数倍音**。
 *
 * 櫛歯を弾く音なので、
 *
 * - 立ち上がりはほぼ 0（打鍵の瞬間に全部の倍音が立つ）
 * - 倍音は整数比から外す（金属の板は弦と違って倍音が整数にならない）
 * - 高い倍音ほど早く消える
 * - 撥の当たる「カチッ」を頭に少しだけ足す
 *
 * この 4 つで「オルゴールらしさ」はほぼ決まる。鐘（`bell`）と作りは似ているが、
 * オルゴールのほうが倍音が少なく、減衰が速く、頭の音が硬い。
 */
function musicbox(
  ctx: BaseAudioContext,
  out: AudioNode,
  at: number,
  duration: number,
  gain: number,
  freq: number,
): void {
  // 非整数の倍音列。板の振動モードを粗く真似たもの
  const partials: readonly [number, number, number][] = [
    // [倍率, 音量, 減衰の速さ]
    [1, 1, 1],
    [2.76, 0.42, 0.6],
    [5.4, 0.18, 0.35],
    [8.9, 0.08, 0.2],
  ];
  const tail = Math.max(0.7, Math.min(2.4, duration * 1.8));
  for (const [ratio, level, decay] of partials) {
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = freq * ratio;
    const env = envelope(ctx, at, 0.001, tail * decay, gain * 0.34 * level);
    osc.connect(env).connect(out);
    osc.start(at);
    osc.stop(at + tail * decay + 0.1);
  }
  // 撥が当たる音。これが無いと「柔らかいベル」で止まる
  const click = noiseSource(ctx);
  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = Math.min(9000, freq * 6);
  filter.Q.value = 1.2;
  const clickEnv = envelope(ctx, at, 0.0005, 0.03, gain * 0.12);
  click.connect(filter).connect(clickEnv).connect(out);
  click.start(at);
  click.stop(at + 0.06);
}

/** 和太鼓。低音が一瞬で落ちるのが芯、打面のノイズが胴の鳴り */
function taiko(ctx: BaseAudioContext, out: AudioNode, at: number, gain: number): void {
  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(160, at);
  osc.frequency.exponentialRampToValueAtTime(46, at + 0.14);
  const body = envelope(ctx, at, 0.002, 0.34, gain * 0.9);
  osc.connect(body).connect(out);
  osc.start(at);
  osc.stop(at + 0.4);

  const skin = noiseSource(ctx);
  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = 900;
  const hit = envelope(ctx, at, 0.001, 0.06, gain * 0.28);
  skin.connect(filter).connect(hit).connect(out);
  skin.start(at);
  skin.stop(at + 0.1);
}

/** 締太鼓・拍子木。高い帯域のごく短い音 */
function hat(ctx: BaseAudioContext, out: AudioNode, at: number, gain: number): void {
  const source = noiseSource(ctx);
  const filter = ctx.createBiquadFilter();
  filter.type = 'highpass';
  filter.frequency.value = 6500;
  const env = envelope(ctx, at, 0.001, 0.045, gain * 0.3);
  source.connect(filter).connect(env).connect(out);
  source.start(at);
  source.stop(at + 0.08);
}

/**
 * 箏。弦を爪弾く音。
 *
 * 立ち上がりを極端に短くし、倍音を少し足してから落とす。
 * ここを緩めると途端に「シンセのパッド」になる
 */
function koto(
  ctx: BaseAudioContext,
  out: AudioNode,
  at: number,
  duration: number,
  gain: number,
  freq: number,
): void {
  const osc = ctx.createOscillator();
  osc.type = 'triangle';
  osc.frequency.value = freq;
  const partial = ctx.createOscillator();
  partial.type = 'square';
  partial.frequency.value = freq * 2.01; // わずかにずらして弦のうねりを作る

  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(freq * 6, at);
  filter.frequency.exponentialRampToValueAtTime(freq * 1.6, at + 0.25);

  const env = envelope(ctx, at, 0.004, Math.max(0.25, duration * 0.9), gain * 0.5);
  const partialGain = ctx.createGain();
  partialGain.gain.value = 0.16;

  osc.connect(filter);
  partial.connect(partialGain).connect(filter);
  filter.connect(env).connect(out);
  osc.start(at);
  partial.start(at);
  osc.stop(at + duration + 0.4);
  partial.stop(at + duration + 0.4);
}

/**
 * 尺八。息の音と、遅れて掛かるビブラート。
 *
 * ビブラートを最初から掛けると electronic に聞こえる。
 * 実際の管楽器と同じで、**音を伸ばしてから**揺れ始めるのが肝
 */
function shakuhachi(
  ctx: BaseAudioContext,
  out: AudioNode,
  at: number,
  duration: number,
  gain: number,
  freq: number,
): void {
  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.value = freq;

  const vibrato = ctx.createOscillator();
  vibrato.frequency.value = 5.2;
  const vibratoDepth = ctx.createGain();
  vibratoDepth.gain.setValueAtTime(0, at);
  vibratoDepth.gain.linearRampToValueAtTime(freq * 0.012, at + Math.min(0.35, duration * 0.6));
  vibrato.connect(vibratoDepth).connect(osc.frequency);

  const breath = noiseSource(ctx);
  const breathFilter = ctx.createBiquadFilter();
  breathFilter.type = 'bandpass';
  breathFilter.frequency.value = freq * 2;
  breathFilter.Q.value = 0.7;
  const breathGain = envelope(ctx, at, 0.05, duration, gain * 0.1);

  const env = envelope(ctx, at, 0.06, duration, gain * 0.42);
  osc.connect(env).connect(out);
  breath.connect(breathFilter).connect(breathGain).connect(out);

  osc.start(at);
  vibrato.start(at);
  breath.start(at);
  osc.stop(at + duration + 0.2);
  vibrato.stop(at + duration + 0.2);
  breath.stop(at + duration + 0.2);
}

/** 低音。曲の土台なので、目立たず途切れないことだけを狙う */
function bass(
  ctx: BaseAudioContext,
  out: AudioNode,
  at: number,
  duration: number,
  gain: number,
  freq: number,
): void {
  const osc = ctx.createOscillator();
  osc.type = 'triangle';
  osc.frequency.value = freq;
  const env = envelope(ctx, at, 0.02, duration, gain * 0.55);
  osc.connect(env).connect(out);
  osc.start(at);
  osc.stop(at + duration + 0.2);
}

/** 鈴。倍音がぶつかる金属音。長く残す */
function bell(
  ctx: BaseAudioContext,
  out: AudioNode,
  at: number,
  duration: number,
  gain: number,
  freq: number,
): void {
  // 整数比から外した 2 音を重ねると金属らしくなる
  for (const [ratio, level] of [
    [1, 1],
    [2.76, 0.5],
  ] as const) {
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = freq * ratio;
    const env = envelope(ctx, at, 0.003, duration * 1.6, gain * 0.3 * level);
    osc.connect(env).connect(out);
    osc.start(at);
    osc.stop(at + duration * 1.6 + 0.2);
  }
}
