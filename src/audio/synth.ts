/**
 * 音を出す。和楽器を**波形の計算**で近似する（04-content.md 4.5）。
 *
 * ## オシレータを繋ぐのはやめた
 *
 * 最初の実装は Web Audio のオシレータを組み合わせていた ——
 * 尺八はサイン波 1 本、箏は三角波と矩形波。**それはファミコンの音源そのもの**で、
 * 譜面をどれだけ良くしても「8bit 風の和風」から出られなかった。
 *
 * いまは `render.ts` が 1 音ぶんの標本を計算し、ここが `AudioBuffer` に焼いて
 * 鳴らす。撥弦は弦の物理モデル（Karplus-Strong）、気鳴は息の雑音と
 * 揺らぐ倍音、太鼓は円い膜の振動モード —— 単純な波形では作れないもの。
 *
 * ## 標本は使い回す
 *
 * 1 音ごとに計算すると 1 小節に数十回まわることになり、確実に音が途切れる。
 * **オクターブごとに 1 本だけ焼き、`playbackRate` で前後 6 半音をまかなう**
 * （サンプラーと同じやり方）。焼くのは初めて要ったときだけ。
 *
 * 焼いた標本には「1 音ごとの表情」が入らないので、**鳴らすときに崩す** ——
 * 再生位置・速度・定位をわずかにずらす。全部同じ音が並ぶのが、
 * 打ち込みに聞こえるいちばんの原因なので。
 *
 * ## 混ぜ方も音のうち
 *
 * 全部を真ん中で鳴らすと、どれだけ音色を作り込んでも「1 本の線」に潰れる。
 * 声部ごとに定位を振り、まとめてコンプレッサへ通して糊付けする。
 */
import type { Voice } from './compose';
import { midiToFreq } from './scale';
import {
  breath,
  clave,
  fadeEdges,
  lowString,
  membrane,
  noiseGen,
  normalize,
  pluck,
  strike,
} from './render';

/**
 * 残響。**ここが無いと、どれだけ良い譜面でも「打ち込み」に聞こえる。**
 *
 * 1 音ずつが乾いたまま鳴ると、会場ではなく机の上で鳴っている音になる。
 * インパルス応答（減衰するノイズ）を作って `ConvolverNode` に食わせるだけで、
 * 「広い場所で鳴っている」に変わる。音源ファイルは要らない。
 *
 * ## 使い回す単位が 2 つある
 *
 * インパルス応答は**作るのが重い**（数十万サンプルを埋める）ので
 * AudioContext ごとに 1 つ。畳み込みの経路は**行き先ごと**に 1 つ。
 *
 * ここを分けずに AudioContext だけで使い回すと、**2 回目のバトルから
 * 残響が消える** —— AudioContext は使い回されるが `BgmPlayer` の master は
 * バトルごとに作り直され、古い master は `dispose()` で切断される。
 * 経路の出口が古い master のままだと、以後の湿った音は切れた先へ流れる。
 */
const impulses = new WeakMap<BaseAudioContext, AudioBuffer>();
const sends = new WeakMap<AudioNode, GainNode>();

function impulse(ctx: BaseAudioContext): AudioBuffer {
  const cached = impulses.get(ctx);
  if (cached) return cached;

  const seconds = 2.4;
  const length = Math.floor(ctx.sampleRate * seconds);
  const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
  for (let channel = 0; channel < 2; channel++) {
    const data = buffer.getChannelData(channel);
    // 左右で別の種を使う。同じにすると真ん中で固まって「広さ」が出ない
    const random = noiseGen(channel === 0 ? 0x6d2b79f5 : 0x1b56c4e9);
    for (let i = 0; i < length; i++) {
      // 減衰。**`Math.pow` は使わない** —— 24 万標本 × 2ch ぶん呼ぶと
      // バトルに入った最初の 1 フレームが目に見えて落ちる。
      // 3 乗で十分（残響の尾の形なので、指数を厳密に合わせる意味が無い）
      const remain = 1 - i / length;
      const decay = remain * remain * remain;
      data[i] = random() * decay * (i < ctx.sampleRate * 0.018 ? 0.15 : 1);
    }
  }
  impulses.set(ctx, buffer);
  return buffer;
}

function reverbSend(ctx: BaseAudioContext, destination: AudioNode): GainNode {
  const existing = sends.get(destination);
  if (existing) return existing;

  const convolver = ctx.createConvolver();
  convolver.buffer = impulse(ctx);
  // 残響だけ高域を落とす。落とさないと、刻みの残響が耳に刺さる
  const damp = ctx.createBiquadFilter();
  damp.type = 'lowpass';
  damp.frequency.value = 3600;

  const send = ctx.createGain();
  send.gain.value = 1;
  send.connect(convolver).connect(damp).connect(destination);
  sends.set(destination, send);
  return send;
}

// --- 標本を焼く ---

/** 声部ごとの焼き方。長さは「その音がどれだけ残るか」で決める */
interface Recipe {
  /** 焼く長さ（秒） */
  seconds: number;
  /** 音程を持つか。持たない打楽器は 1 本だけ焼く */
  pitched: boolean;
  render: (out: Float32Array, sampleRate: number, freq: number, seed: number) => void;
}

const RECIPES: Record<Voice, Recipe> = {
  koto: {
    seconds: 2.2,
    pitched: true,
    render: (out, sampleRate, freq, seed) => pluck(out, { sampleRate, freq, seed }),
  },
  shakuhachi: {
    // 4 拍の音（118BPM で 2.03 秒）を、音域の上端（`playbackRate` 1.41）で
    // 鳴らしても尻が切れない長さ
    seconds: 3.7,
    pitched: true,
    render: (out, sampleRate, freq, seed) => breath(out, { sampleRate, freq, seed }),
  },
  bass: {
    seconds: 3.0,
    pitched: true,
    render: (out, sampleRate, freq, seed) => lowString(out, { sampleRate, freq, seed }),
  },
  musicbox: {
    seconds: 3.2,
    pitched: true,
    render: (out, sampleRate, freq, seed) => strike(out, { sampleRate, freq, seed, tail: 1.1 }),
  },
  bell: {
    seconds: 3.6,
    pitched: true,
    render: (out, sampleRate, freq, seed) => strike(out, { sampleRate, freq, seed, tail: 1.6 }),
  },
  taiko: {
    seconds: 0.9,
    pitched: false,
    // 音程は持たないが、膜の大きさは決まっている
    render: (out, sampleRate, _freq, seed) => membrane(out, { sampleRate, freq: 62, seed }),
  },
  hat: {
    seconds: 0.22,
    pitched: false,
    render: (out, sampleRate, _freq, seed) => clave(out, { sampleRate, freq: 0, seed }),
  },
};

/** 音程を持たない声部の基準 MIDI。標本の鍵に使うだけ */
const UNPITCHED_MIDI = 60;

/**
 * オクターブごとに 1 本。前後 6 半音は `playbackRate` でまかなう。
 *
 * 1 音ずつ焼くと 1 小節で数十回まわり、確実に音が途切れる。
 * 逆に 1 本だけで全音域をまかなうと、2 オクターブ動かしたところで別の楽器になる
 */
function zoneMidi(midi: number): number {
  return Math.round(midi / 12) * 12;
}

const banks = new WeakMap<BaseAudioContext, Map<string, AudioBuffer>>();

function bake(ctx: BaseAudioContext, voice: Voice, midi: number): AudioBuffer {
  const recipe = RECIPES[voice];
  const key = sampleKey(voice, midi);
  let bank = banks.get(ctx);
  if (!bank) {
    bank = new Map();
    banks.set(ctx, bank);
  }
  const cached = bank.get(key);
  if (cached) return cached;

  const length = Math.max(1, Math.floor(ctx.sampleRate * recipe.seconds));
  const data = new Float32Array(length);
  const reference = recipe.pitched ? zoneMidi(midi) : UNPITCHED_MIDI;
  // 種は鍵から導く。同じ音は何度焼いても同じ波形になる
  recipe.render(data, ctx.sampleRate, midiToFreq(reference), hashSeed(key));
  normalize(data);
  fadeEdges(data, ctx.sampleRate);

  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  buffer.getChannelData(0).set(data);
  bank.set(key, buffer);
  return buffer;
}

/**
 * 焼く順番待ち。**1 フレームに 1 本だけ焼く。**
 *
 * まとめて焼くと、バトルに入った最初のフレームが 218ms 掛かっていた（実測）。
 * 曲の予約は 1 小節先まで行くので（`bgm.ts`）、**要るより前に焼き始められる** ——
 * 1 フレームに 1 本ずつ進めても十分に間に合う。
 */
const queues = new WeakMap<BaseAudioContext, string[]>();

function queueOf(ctx: BaseAudioContext): string[] {
  let queue = queues.get(ctx);
  if (!queue) {
    queue = [];
    queues.set(ctx, queue);
  }
  return queue;
}

/** 標本の鍵。声部とオクターブで決まる */
function sampleKey(voice: Voice, midi: number): string {
  return `${voice}:${RECIPES[voice].pitched ? zoneMidi(midi) : UNPITCHED_MIDI}`;
}

/**
 * この曲で要りそうな標本を予約する。バトルに入る時点で呼ぶ。
 *
 * 全部その場で焼くと最初の 1 フレームが潰れるので、順番待ちに積むだけ
 */
export function warmSamples(
  ctx: BaseAudioContext,
  destination: AudioNode,
  voices: readonly Voice[],
  midis: readonly number[],
): void {
  // 残響のインパルス応答がいちばん重い。先に作っておく
  reverbSend(ctx, destination);
  const queue = queueOf(ctx);
  const bank = banks.get(ctx);
  for (const voice of voices) {
    for (const midi of midis) {
      const key = sampleKey(voice, midi);
      if (bank?.has(key) || queue.includes(key)) continue;
      queue.push(key);
    }
  }
}

/**
 * 順番待ちを 1 本だけ焼く。毎フレーム呼ぶ。
 *
 * @returns まだ残っていれば true
 */
export function bakeNext(ctx: BaseAudioContext): boolean {
  const queue = queueOf(ctx);
  const key = queue.shift();
  if (key === undefined) return false;
  const [voice, midi] = key.split(':');
  if (voice && midi) bake(ctx, voice as Voice, Number(midi));
  return queue.length > 0;
}

function hashSeed(key: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash || 1;
}

// --- 混ぜる ---

/** 声部ごとの残響の深さ。低音と刻みを濡らすと輪郭が消える */
const REVERB: Record<Voice, number> = {
  taiko: 0.1,
  hat: 0.08,
  koto: 0.34,
  shakuhachi: 0.36,
  bass: 0.04,
  bell: 0.55,
  musicbox: 0.5,
};

/**
 * 声部ごとの定位（-1 = 左、1 = 右）。
 *
 * **全部を真ん中で鳴らすと 1 本の線に潰れる。** 土台（低音・太鼓）は中央、
 * 伴奏（箏・刻み）を左右へ散らし、旋律は中央に残す ——
 * 実際の録音でやることと同じで、これだけで「作られた音」に近づく
 */
const PAN: Record<Voice, number> = {
  taiko: 0,
  bass: 0,
  shakuhachi: -0.06,
  koto: 0.34,
  hat: -0.3,
  bell: 0.18,
  musicbox: -0.14,
};

/** 声部ごとの音量。焼いた標本は正規化してあるので、ここで釣り合いを取る */
const LEVEL: Record<Voice, number> = {
  taiko: 0.85,
  hat: 0.3,
  koto: 0.4,
  shakuhachi: 0.5,
  bass: 0.45,
  bell: 0.32,
  musicbox: 0.5,
};

/**
 * 鳴らすたびに増える数。**1 音ごとに表情を変えるための種。**
 *
 * `Math.random()` は使えない（ESLint で禁止）ので、鳴らした回数から導く。
 * ずらすのは定位・速度・音量のごく僅かで、狙いは「同じ音が並ばない」こと
 */
let shots = 0;

/**
 * 1 音を鳴らす。
 *
 * @param at 鳴らす時刻（`AudioContext.currentTime` と同じ基準の秒）
 * @param duration 長さ（秒）
 */
export function playVoice(
  ctx: BaseAudioContext,
  destination: AudioNode,
  voice: Voice,
  at: number,
  duration: number,
  gain: number,
  midi?: number,
): void {
  const recipe = RECIPES[voice];
  const note = midi ?? UNPITCHED_MIDI;
  // 予約が間に合っていれば焼き済み。間に合っていなければここで焼く
  // （音を落とすより、1 フレーム落ちるほうがまし）
  const buffer = bake(ctx, voice, note);

  const source = ctx.createBufferSource();
  source.buffer = buffer;
  if (recipe.pitched) {
    source.playbackRate.value = midiToFreq(note) / midiToFreq(zoneMidi(note));
  }

  // 1 音ごとのばらつき。焼いた標本は寸分違わず同じなので、ここで崩す
  const jitter = ((shots++ * 2654435761) >>> 0) / 0xffffffff;
  source.detune.value = (jitter - 0.5) * 7;

  const env = ctx.createGain();
  // 指数減衰は 0 から掛けられない。下限を切っておく
  const level = Math.max(0.0002, gain * LEVEL[voice]);
  // 減衰は標本が持っている。ここは頭の角を取るのと、音符の終わりで閉じるだけ
  env.gain.setValueAtTime(0, at);
  env.gain.linearRampToValueAtTime(level * (0.92 + jitter * 0.16), at + 0.004);
  const release = Math.max(0.08, duration * 0.25);
  const until = at + duration;
  env.gain.setValueAtTime(level * (0.92 + jitter * 0.16), Math.max(at + 0.005, until - release));
  env.gain.exponentialRampToValueAtTime(0.0001, until + release);

  const panner = ctx.createStereoPanner();
  panner.pan.value = Math.max(-1, Math.min(1, PAN[voice] + (jitter - 0.5) * 0.12));

  source.connect(env).connect(panner);
  panner.connect(destination);

  const wet = REVERB[voice];
  if (wet > 0) {
    const send = ctx.createGain();
    send.gain.value = wet;
    panner.connect(send).connect(reverbSend(ctx, destination));
  }

  source.start(at);
  source.stop(until + release + 0.05);
}

/**
 * 全体をまとめる段。**曲としての「まとまり」はここで付く。**
 *
 * 声部ごとに作り込んでも、足しただけでは音量がばらついて素人の録音に聞こえる。
 * 軽いコンプレッサで頭を揃え、上と下を少し整えるだけで、
 * 同じ素材が「1 つの曲」として鳴る。
 *
 * @returns 曲を差し込む先。ここへ繋ぐと以後この段を通る
 */
export function createMasterBus(ctx: BaseAudioContext, destination: AudioNode): GainNode {
  const input = ctx.createGain();
  input.gain.value = 1;

  // 低いほうの濁りを落とす。和太鼓の下が溜まると全体が曇る
  const highpass = ctx.createBiquadFilter();
  highpass.type = 'highpass';
  highpass.frequency.value = 34;

  // 軽く糊付けする。潰しに行くと躍動が消えるので、掛かるのは頭だけ
  const glue = ctx.createDynamicsCompressor();
  glue.threshold.value = -18;
  glue.knee.value = 22;
  glue.ratio.value = 2.6;
  glue.attack.value = 0.012;
  glue.release.value = 0.22;

  const output = ctx.createGain();
  // コンプレッサで頭が下がったぶんを戻す。実測でピーク 0.31 だったので、
  // 効果音と重なっても割れない範囲で持ち上げる
  output.gain.value = 1.7;

  input.connect(highpass).connect(glue).connect(output).connect(destination);
  return input;
}
