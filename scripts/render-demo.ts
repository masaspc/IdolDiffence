/**
 * BGM を WAV に書き出す。
 *
 * **音は聞かないと分からない。** 譜面が正しいかは数字で確かめられるが
 * （`compose.test.ts`）、「ファミコンに聞こえるかどうか」は数字では出ない。
 * ブラウザを立ち上げずに耳で確かめられるように、ここで書き出す。
 *
 *   npx tsx scripts/render-demo.ts                 # reply を 16 小節
 *   npx tsx scripts/render-demo.ts ray_cpk 24 out.wav
 *
 * Web Audio は使わない ―― `audio/render.ts` の波形をそのまま並べて混ぜる。
 * つまり**ブラウザで鳴る音と同じ素材**だが、残響とコンプレッサは通っていない
 * （あちらは Web Audio のノードなので、ここでは近似だけ入れてある）。
 */
import { writeFileSync } from 'node:fs';
import { composeBar, sectionMap, type Note, type Voice } from '../src/audio/compose';
import { styleOf } from '../src/audio/bgm';
import { getSong, getStage } from '../src/data';
import { midiToFreq } from '../src/audio/scale';
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
} from '../src/audio/render';

const SAMPLE_RATE = 44100;

/** `synth.ts` の RECIPES と同じ組み合わせ。あちらと揃えておかないと別の音になる */
const RECIPES: Record<Voice, { seconds: number; pitched: boolean; render: (out: Float32Array, freq: number, seed: number) => void }> = {
  koto: { seconds: 2.2, pitched: true, render: (o, f, s) => pluck(o, { sampleRate: SAMPLE_RATE, freq: f, seed: s }) },
  shakuhachi: { seconds: 3.4, pitched: true, render: (o, f, s) => breath(o, { sampleRate: SAMPLE_RATE, freq: f, seed: s }) },
  bass: { seconds: 3.0, pitched: true, render: (o, f, s) => lowString(o, { sampleRate: SAMPLE_RATE, freq: f, seed: s }) },
  musicbox: { seconds: 3.2, pitched: true, render: (o, f, s) => strike(o, { sampleRate: SAMPLE_RATE, freq: f, seed: s, tail: 1.1 }) },
  bell: { seconds: 3.6, pitched: true, render: (o, f, s) => strike(o, { sampleRate: SAMPLE_RATE, freq: f, seed: s, tail: 1.6 }) },
  taiko: { seconds: 0.9, pitched: false, render: (o, _f, s) => membrane(o, { sampleRate: SAMPLE_RATE, freq: 62, seed: s }) },
  hat: { seconds: 0.22, pitched: false, render: (o, _f, s) => clave(o, { sampleRate: SAMPLE_RATE, freq: 0, seed: s }) },
};

const PAN: Record<Voice, number> = {
  taiko: 0, bass: 0, shakuhachi: -0.06, koto: 0.34, hat: -0.3, bell: 0.18, musicbox: -0.14,
};
const LEVEL: Record<Voice, number> = {
  taiko: 0.85, hat: 0.3, koto: 0.4, shakuhachi: 0.5, bass: 0.45, bell: 0.32, musicbox: 0.5,
};
const REVERB: Record<Voice, number> = {
  taiko: 0.1, hat: 0.08, koto: 0.34, shakuhachi: 0.36, bass: 0.04, bell: 0.55, musicbox: 0.5,
};

/**
 * 前の実装（オシレータの組み合わせ）。**比べるために残してある。**
 *
 * 尺八はサイン波 1 本、箏は三角波と矩形波、太鼓は下がるサイン波。
 * これがファミコンに聞こえていた正体で、聞き比べないと
 * 「良くなった」と言っているだけになる。`--before` で切り替わる
 */
const BEFORE: Record<Voice, (out: Float32Array, freq: number) => void> = {
  shakuhachi: (out, freq) => {
    for (let i = 0; i < out.length; i++) {
      const t = i / SAMPLE_RATE;
      const vib = 1 + Math.sin(2 * Math.PI * 5.2 * t) * 0.012 * Math.min(1, t / 0.35);
      out[i] = Math.sin(2 * Math.PI * freq * vib * t) * Math.exp(-t / 1.6);
    }
  },
  koto: (out, freq) => {
    for (let i = 0; i < out.length; i++) {
      const t = i / SAMPLE_RATE;
      const tri = Math.abs(((freq * t) % 1) * 4 - 2) - 1;
      const sq = ((freq * 2.01 * t) % 1) < 0.5 ? 1 : -1;
      out[i] = (tri + sq * 0.16) * Math.exp(-t / 0.5);
    }
  },
  bass: (out, freq) => {
    for (let i = 0; i < out.length; i++) {
      const t = i / SAMPLE_RATE;
      out[i] = (Math.abs(((freq * t) % 1) * 4 - 2) - 1) * Math.exp(-t / 1.2);
    }
  },
  musicbox: (out, freq) => {
    for (let i = 0; i < out.length; i++) {
      const t = i / SAMPLE_RATE;
      out[i] =
        (Math.sin(2 * Math.PI * freq * t) + Math.sin(2 * Math.PI * freq * 2.76 * t) * 0.42) *
        Math.exp(-t / 1.1);
    }
  },
  bell: (out, freq) => {
    for (let i = 0; i < out.length; i++) {
      const t = i / SAMPLE_RATE;
      out[i] =
        (Math.sin(2 * Math.PI * freq * t) + Math.sin(2 * Math.PI * freq * 2.76 * t) * 0.5) *
        Math.exp(-t / 1.6);
    }
  },
  taiko: (out) => {
    for (let i = 0; i < out.length; i++) {
      const t = i / SAMPLE_RATE;
      const f = 160 * Math.exp(-t / 0.05) + 46;
      out[i] = Math.sin(2 * Math.PI * f * t) * Math.exp(-t / 0.14);
    }
  },
  hat: (out) => {
    const random = noiseGen(7);
    let high = 0;
    for (let i = 0; i < out.length; i++) {
      const t = i / SAMPLE_RATE;
      const n = random();
      high = n - high * 0.02;
      out[i] = high * Math.exp(-t / 0.02) * 0.3;
    }
  },
};

const zoneMidi = (midi: number): number => Math.round(midi / 12) * 12;

function hashSeed(key: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash || 1;
}

const bank = new Map<string, Float32Array>();

function sample(voice: Voice, midi: number): Float32Array {
  const recipe = RECIPES[voice];
  const reference = recipe.pitched ? zoneMidi(midi) : 60;
  const key = `${voice}:${reference}`;
  const cached = bank.get(key);
  if (cached) return cached;
  const data = new Float32Array(Math.floor(SAMPLE_RATE * recipe.seconds));
  if (before) BEFORE[voice](data, midiToFreq(reference));
  else recipe.render(data, midiToFreq(reference), hashSeed(key));
  normalize(data);
  fadeEdges(data, SAMPLE_RATE);
  bank.set(key, data);
  return data;
}

/** 残響。ブラウザ側の ConvolverNode の代わりに、素朴な畳み込みを 1 本 */
function makeImpulse(): Float32Array[] {
  const length = Math.floor(SAMPLE_RATE * 1.4);
  return [0, 1].map((channel) => {
    const random = noiseGen(channel === 0 ? 0x6d2b79f5 : 0x1b56c4e9);
    const data = new Float32Array(length);
    let low = 0;
    for (let i = 0; i < length; i++) {
      const decay = Math.pow(1 - i / length, 2.4);
      low += 0.35 * (random() * decay - low);
      data[i] = low * (i < SAMPLE_RATE * 0.018 ? 0.15 : 1);
    }
    return data;
  });
}

const args = process.argv.slice(2).filter((a) => a !== '--before');
const before = process.argv.includes('--before');
const songId = args[0] ?? 'reply';
const bars = Number(args[1] ?? 16);
const outPath = args[2] ?? `demo-${songId}${before ? '-before' : ''}.wav`;

const song = getSong(songId);
const style = styleOf(song);
// ステージの構成をそのまま使う。曲がどう展開するかまで込みで聞ける
const stageId = ['S1', 'S2', 'S3', 'S5', 'S4', 'S11', 'S14'].find(
  (id) => getStage(id).song === songId,
);
const sections = stageId ? sectionMap(getStage(stageId).waves) : [];

const secPerBeat = 60 / song.bpm;
const secPerBar = secPerBeat * song.beatsPerBar;
const total = Math.ceil((bars * secPerBar + 4) * SAMPLE_RATE);
const dryL = new Float32Array(total);
const dryR = new Float32Array(total);
const wetL = new Float32Array(total);
const wetR = new Float32Array(total);

let shots = 0;
function place(note: Note, barStart: number): void {
  const recipe = RECIPES[note.voice];
  const midi = note.midi ?? 60;
  const data = sample(note.voice, midi);
  const rate = recipe.pitched ? midiToFreq(midi) / midiToFreq(zoneMidi(midi)) : 1;

  const jitter = ((shots++ * 2654435761) >>> 0) / 0xffffffff;
  const level = Math.max(0.0002, note.gain * LEVEL[note.voice]) * (0.92 + jitter * 0.16);
  const pan = Math.max(-1, Math.min(1, PAN[note.voice] + (jitter - 0.5) * 0.12));
  const left = Math.cos(((pan + 1) * Math.PI) / 4);
  const right = Math.sin(((pan + 1) * Math.PI) / 4);

  const start = Math.round((barStart + note.beat * secPerBeat) * SAMPLE_RATE);
  const duration = note.beats * secPerBeat;
  const release = Math.max(0.08, duration * 0.25);
  const span = Math.round((duration + release) * SAMPLE_RATE);
  const send = REVERB[note.voice];

  for (let i = 0; i < span; i++) {
    const index = start + i;
    if (index < 0 || index >= total) break;
    const source = i * rate;
    const s0 = Math.floor(source);
    if (s0 + 1 >= data.length) break;
    // 線形補間。playbackRate と同じことを手で
    const frac = source - s0;
    const value = (data[s0] ?? 0) * (1 - frac) + (data[s0 + 1] ?? 0) * frac;

    const t = i / SAMPLE_RATE;
    let env = Math.min(1, t / 0.004);
    if (t > duration - release) env *= Math.max(0, 1 - (t - (duration - release)) / (release * 2));
    const amp = value * level * env;
    dryL[index] = (dryL[index] ?? 0) + amp * left;
    dryR[index] = (dryR[index] ?? 0) + amp * right;
    wetL[index] = (wetL[index] ?? 0) + amp * left * send;
    wetR[index] = (wetR[index] ?? 0) + amp * right * send;
  }
}

for (let bar = 0; bar < bars; bar++) {
  const section = sections[bar] ?? (bar < 2 ? 'intro' : bar % 8 < 4 ? 'verse' : 'chorus');
  const notes = composeBar(songId, song, style, section, bar);
  for (const note of notes) place(note, bar * secPerBar);
}

// 残響を掛ける（素朴な畳み込み。デモなので速さは気にしない）
const impulse = makeImpulse();
const outL = new Float32Array(total);
const outR = new Float32Array(total);
const channels: [Float32Array, Float32Array, Float32Array, Float32Array][] = [
  [impulse[0] ?? new Float32Array(1), wetL, dryL, outL],
  [impulse[1] ?? new Float32Array(1), wetR, dryR, outR],
];
for (const [ir, src, dry, dst] of channels) {
  // インパルスを間引いて畳み込む。1.4 秒 × 44.1kHz をそのまま回すと終わらない
  const step = 8;
  for (let i = 0; i < total; i++) {
    const value = src[i] ?? 0;
    if (Math.abs(value) < 1e-5) continue;
    for (let j = 0; j < ir.length; j += step) {
      const index = i + j;
      if (index >= total) break;
      dst[index] = (dst[index] ?? 0) + value * (ir[j] ?? 0) * step * 0.18;
    }
  }
  for (let i = 0; i < total; i++) dst[i] = (dst[i] ?? 0) + (dry[i] ?? 0);
}

// まとめの段の代わり。
// **潰しに行かない。** tanh を強く掛けると全部が歪んで、
// せっかく作った音色の違いが消える（一度そうなった）。
// いちばん大きいところで 0.85 に合わせてから、頭だけ軽く丸める
let peak = 0;
for (const data of [outL, outR]) {
  for (const value of data) peak = Math.max(peak, Math.abs(value));
}
const makeup = peak > 0 ? 0.85 / peak : 1;
for (const data of [outL, outR]) {
  for (let i = 0; i < total; i++) {
    const value = (data[i] ?? 0) * makeup;
    data[i] =
      Math.abs(value) < 0.7
        ? value
        : Math.sign(value) * (0.7 + Math.tanh((Math.abs(value) - 0.7) * 2) * 0.28);
  }
}
console.log(`まとめ前のピーク ${peak.toFixed(2)} -> ×${makeup.toFixed(2)}`);

// 16bit PCM の WAV として書き出す
const frames = total;
const buffer = Buffer.alloc(44 + frames * 4);
buffer.write('RIFF', 0);
buffer.writeUInt32LE(36 + frames * 4, 4);
buffer.write('WAVEfmt ', 8);
buffer.writeUInt32LE(16, 16);
buffer.writeUInt16LE(1, 20);
buffer.writeUInt16LE(2, 22);
buffer.writeUInt32LE(SAMPLE_RATE, 24);
buffer.writeUInt32LE(SAMPLE_RATE * 4, 28);
buffer.writeUInt16LE(4, 32);
buffer.writeUInt16LE(16, 34);
buffer.write('data', 36);
buffer.writeUInt32LE(frames * 4, 40);
for (let i = 0; i < frames; i++) {
  buffer.writeInt16LE(Math.round(Math.max(-1, Math.min(1, outL[i] ?? 0)) * 32767), 44 + i * 4);
  buffer.writeInt16LE(Math.round(Math.max(-1, Math.min(1, outR[i] ?? 0)) * 32767), 44 + i * 4 + 2);
}
writeFileSync(outPath, buffer);
console.log(`${song.name} (${songId})${before ? ' [前の実装]' : ''} ${bars} 小節 / ${(total / SAMPLE_RATE).toFixed(1)}s -> ${outPath}`);
