/**
 * 1 音ぶんの波形を計算する。
 *
 * ## なぜオシレータを繋ぐのをやめたか
 *
 * 前の実装は Web Audio のオシレータを組み合わせていた ——
 * 尺八はサイン波 1 本、箏は三角波と矩形波。
 * **それはファミコンの音源そのもの**で、どれだけ譜面を良くしても
 * 「8bit 風の和風」から出られなかった（実際そう指摘された）。
 *
 * 単純な波形が安っぽく聞こえる理由ははっきりしている。
 *
 * - 倍音の比が整数のまま動かない（本物は鳴っているあいだ変わる）
 * - 全部の音が寸分違わず同じ（本物は 1 音ごとに違う）
 * - 雑音成分が無い（本物は弦の擦れ・息・打面の鳴りを必ず含む）
 *
 * オシレータの組み合わせでこれを作るのは難しい。**標本を自分で計算して
 * `AudioBuffer` に焼く**ほうが、やれることが桁違いに増える。
 *
 * ## ここは Web Audio を知らない
 *
 * `Float32Array` を埋めるだけの純関数として書く。`compose.ts` と同じ理由で、
 * **ブラウザ無しでテストできる** —— 減衰しているか、倍音がどれだけ豊かか、
 * 1 音ごとに違うか、いずれも数字で確かめられる。
 *
 * ## 乱数は種から
 *
 * `Math.random()` は使わない（ESLint で禁止）。同じ音は何度計算しても
 * 同じ波形になる —— でないと「同じ曲」にならないし、テストも書けない。
 */

/** 決定的な乱数。線形合同法で十分にノイズらしくなる */
export function noiseGen(seed: number): () => number {
  let state = seed >>> 0 || 1;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return (state / 0xffffffff) * 2 - 1;
  };
}

/**
 * 正弦波の表。**`Math.sin` を毎標本呼ぶと、標本を焼くだけでコマ落ちする。**
 *
 * 実測で 1 オクターブぶんの焼き込みに 373ms 掛かり、バトルに入った瞬間
 * 29fps まで落ちていた。表引き + 線形補間なら聴感上の差は無い。
 *
 * 添字は「周期のどこか」（0〜1）で持つ —— 角度で持つと 2π を掛ける手間が要る
 */
const SINE_BITS = 12;
const SINE_SIZE = 1 << SINE_BITS;
const SINE = new Float32Array(SINE_SIZE + 1);
for (let i = 0; i <= SINE_SIZE; i++) SINE[i] = Math.sin((2 * Math.PI * i) / SINE_SIZE);

/** @param turns 周期のどこか。1 で 1 周（範囲外でも折り返す） */
function sineAt(turns: number): number {
  const wrapped = turns - Math.floor(turns);
  const scaled = wrapped * SINE_SIZE;
  const index = scaled | 0;
  const frac = scaled - index;
  const a = SINE[index] ?? 0;
  const b = SINE[index + 1] ?? 0;
  return a + (b - a) * frac;
}

/** 1 極ローパス。係数は 0（通さない）〜1（素通し） */
function onePole(coefficient: number): (x: number) => number {
  let y = 0;
  return (x) => {
    y += coefficient * (x - y);
    return y;
  };
}

/** カットオフ（Hz）から 1 極ローパスの係数へ */
function poleCoefficient(cutoff: number, sampleRate: number): number {
  const c = 1 - Math.exp((-2 * Math.PI * cutoff) / sampleRate);
  return Math.max(0.0001, Math.min(1, c));
}

export interface RenderOptions {
  sampleRate: number;
  /** 基音（Hz） */
  freq: number;
  /** 決定的な乱数の種。音ごとに変えると 1 音ずつ表情が変わる */
  seed: number;
}

/**
 * 撥弦（箏）。**Karplus-Strong の拡張。**
 *
 * 弦の物理そのものを回す —— 長さ `sampleRate / freq` の遅延線に
 * 雑音を詰めて弾き、1 周するたびに隣どうしを平均して高い倍音から削る。
 * 三角波を減衰させたのとは似ても似つかない、**弦の音**になる。
 *
 * 本物らしさを決めているのは次の 3 つ。
 *
 * - **爪の当たる位置**（`pickPosition`）—— 励振を少しずらして引くと櫛形の
 *   谷ができ、特定の倍音が消える。箏の「ポン」という胴の鳴りはここで決まる
 * - **減衰は倍音ごとに違う**（ループ内のローパス）—— 高い倍音ほど速く消える。
 *   全部同じ速さで消すと、シンセのパッドを短く切った音になる
 * - **1 音ごとに種を変える** —— 同じ高さでも励振の雑音が違うので、
 *   連打が機械の連射に聞こえない
 */
export function pluck(out: Float32Array, options: RenderOptions): void {
  const { sampleRate, freq, seed } = options;
  const period = Math.max(2, Math.round(sampleRate / freq));
  const random = noiseGen(seed);

  // 励振。雑音をやや鈍らせる（そのままだと爪ではなく針で弾いた音になる）
  const line = new Float32Array(period);
  const soften = onePole(0.55);
  for (let i = 0; i < period; i++) line[i] = soften(random());

  // 爪の当たる位置。弦の 1/5 あたりを弾くと 5 倍音が消える
  const pick = Math.max(1, Math.round(period * 0.22));
  const shifted = new Float32Array(period);
  for (let i = 0; i < period; i++) {
    shifted[i] = (line[i] ?? 0) - (line[(i + pick) % period] ?? 0);
  }

  // 高い弦ほど速く減る。低音を伸ばさないと箏ではなく琵琶に寄る
  const damping = Math.min(0.999, 0.9962 + 60 / (freq + 900) / 100);
  const loop = onePole(poleCoefficient(Math.min(sampleRate * 0.4, freq * 5.5), sampleRate));

  let index = 0;
  let previous = 0;
  for (let i = 0; i < out.length; i++) {
    const current = shifted[index] ?? 0;
    out[i] = current;
    // 弦の反射。隣と平均して高域を削り、少しずつ小さくする
    const filtered = loop((current + previous) * 0.5);
    shifted[index] = filtered * damping;
    previous = current;
    index = (index + 1) % period;
  }

  // 爪が触れる瞬間の音。これが無いと「柔らかい弦」で止まる
  const clickLen = Math.min(out.length, Math.round(sampleRate * 0.006));
  const click = noiseGen(seed ^ 0x9e3779b9);
  for (let i = 0; i < clickLen; i++) {
    out[i] = (out[i] ?? 0) + click() * 0.18 * (1 - i / clickLen);
  }
}

/**
 * 気鳴（尺八）。**息で鳴らす管。**
 *
 * サイン波 1 本との差は、鳴っているあいだ**中身が動き続ける**こと。
 *
 * - 倍音ごとに独立した揺らぎを持たせる（位相が少しずつずれていく）。
 *   これが無いと、どれだけ倍音を足しても「合成された音」に聞こえる
 * - 息の雑音を最後まで混ぜる。頭では強く、伸ばすと落ち着く ——
 *   尺八のむら息はここ
 * - 音程そのものがゆっくり揺れる。**まっすぐな音程は人が出せない音**で、
 *   まっすぐな時点で機械に聞こえる
 * - ビブラートは遅れて掛かる。最初から掛けると electronic になる
 */
export function breath(out: Float32Array, options: RenderOptions): void {
  const { sampleRate, freq, seed } = options;
  const random = noiseGen(seed);
  const drift = noiseGen(seed ^ 0x5bf03635);

  // 倍音の構成。管楽器なので基音が強く、奇数倍音がやや勝つ
  const partials = [1, 0.5, 0.32, 0.14, 0.08, 0.05];
  const phases = partials.map(() => 0);
  // 倍音ごとの微妙なずれ。完全な整数比だとオルガンになる
  const detunes = partials.map((_, i) => (i === 0 ? 1 : 1 + drift() * 0.0016 * (i + 1)));

  const breathFilter = onePole(
    poleCoefficient(Math.min(sampleRate * 0.45, freq * 3.2), sampleRate),
  );
  const bodyFilter = onePole(poleCoefficient(Math.min(sampleRate * 0.45, freq * 6), sampleRate));

  // 音程のゆらぎ。ゆっくり動く乱数を 1 本
  let wander = 0;
  const wanderStep = onePole(poleCoefficient(1.4, sampleRate));

  const attack = 0.055;
  const decay = 3.6;
  // 指数減衰を掛け算で進める（毎標本の `Math.exp` を避ける）
  const airStep = Math.exp(-1 / (sampleRate * 0.09));
  let airFall = 1;
  const bodyStep = Math.exp(-1 / (sampleRate * decay));
  let bodyFall = 1;
  for (let i = 0; i < out.length; i++) {
    const t = i / sampleRate;
    wander = wanderStep(drift());
    // ビブラートは 0.35 秒かけて効き始める
    const vibratoDepth = 0.011 * Math.min(1, Math.max(0, (t - 0.25) / 0.35));
    const bend = 1 + wander * 0.006 + sineAt(5.1 * t) * vibratoDepth;

    let sample = 0;
    for (let p = 0; p < partials.length; p++) {
      phases[p] = (phases[p] ?? 0) + (freq * (p + 1) * (detunes[p] ?? 1) * bend) / sampleRate;
      sample += sineAt(phases[p] ?? 0) * (partials[p] ?? 0);
    }
    sample = bodyFilter(sample * 0.36);

    // 息。頭は強く、伸ばすと落ち着く。
    // 減衰は毎標本 `Math.exp` を呼ばず、掛け算で進める
    const air = breathFilter(random()) * (0.09 + 0.5 * airFall);
    airFall *= airStep;
    let level: number;
    if (t < attack) {
      level = t / attack;
    } else {
      bodyFall *= bodyStep;
      level = bodyFall;
    }
    out[i] = (sample + air) * level;
  }
}

/**
 * 膜（和太鼓）。**円い膜の振動モード。**
 *
 * 太鼓が音程を持たないのは、倍音が整数比ではなく Bessel 関数の零点の比で
 * 並ぶから。この比で鳴らすだけで、サイン波を下げただけの「キック」から
 * 和太鼓の側へ寄る。胴の共鳴と打面の雑音を足して締める。
 */
export function membrane(out: Float32Array, options: RenderOptions): void {
  const { sampleRate, freq, seed } = options;
  const random = noiseGen(seed);
  // 円形膜の振動モード比（Bessel 関数の零点）
  const modes = [1, 1.593, 2.135, 2.295, 2.653, 2.917];
  const levels = [1, 0.42, 0.28, 0.22, 0.14, 0.1];
  const decays = [0.34, 0.16, 0.11, 0.09, 0.06, 0.05];

  const skin = onePole(poleCoefficient(1400, sampleRate));
  // 位相と音量を掛け算で進める（`strike` と同じ理由）
  const phases = modes.map(() => 0);
  const levelsNow = modes.map((_, m) => levels[m] ?? 0);
  const falls = modes.map((_, m) => Math.exp(-1 / (sampleRate * (decays[m] ?? 0.1))));
  // 叩いた直後は張りが強く、すぐ落ちる（音程が下がって聞こえる）
  const bendStep = Math.exp(-1 / (sampleRate * 0.02));
  let bendFall = 1;
  const hitStep = Math.exp(-1 / (sampleRate * 0.012));
  let hitFall = 1;

  for (let i = 0; i < out.length; i++) {
    const bend = 1 + 0.5 * bendFall;
    bendFall *= bendStep;
    let sample = 0;
    for (let m = 0; m < modes.length; m++) {
      const step = (freq * (modes[m] ?? 1) * bend) / sampleRate;
      const phase = (phases[m] ?? 0) + step;
      phases[m] = phase >= 1 ? phase - 1 : phase;
      sample += sineAt(phase) * (levelsNow[m] ?? 0);
      levelsNow[m] = (levelsNow[m] ?? 0) * (falls[m] ?? 0);
    }
    // 打面が擦れる音。頭の数ミリ秒だけ
    const hit = skin(random()) * hitFall * 0.55;
    hitFall *= hitStep;
    out[i] = sample * 0.42 + hit;
  }
}

/**
 * 打撃（オルゴール・鈴）。**非整数倍音とうなり。**
 *
 * 金属の板や鐘は倍音が整数比から外れる。さらに**同じ倍音を少しずらして 2 本**
 * 重ねると、干渉してゆっくり脈打つ —— このうなりが「本物の鐘」の正体で、
 * 単に倍音をずらしただけの音とここで差が付く。
 */
export function strike(out: Float32Array, options: RenderOptions & { tail: number }): void {
  const { sampleRate, freq, seed, tail } = options;
  const random = noiseGen(seed);
  const ratios = [1, 2.76, 5.4, 8.93, 13.34];
  const levels = [1, 0.44, 0.2, 0.09, 0.04];
  const decays = [1, 0.62, 0.36, 0.2, 0.13];

  // 倍音ごとに「いまの位相」と「いまの音量」を持って、掛け算で進める。
  // 毎標本 `Math.sin` と `Math.exp` を呼ぶと、標本を焼くだけでコマ落ちする
  const voices: { stepA: number; stepB: number; fall: number; level: number }[] = [];
  for (let p = 0; p < ratios.length; p++) {
    const f = freq * (ratios[p] ?? 1);
    if (f > sampleRate * 0.45) continue;
    voices.push({
      stepA: f / sampleRate,
      stepB: (f * 1.0013) / sampleRate,
      fall: Math.exp(-1 / (sampleRate * tail * (decays[p] ?? 0.2))),
      level: levels[p] ?? 0,
    });
  }
  const phasesA = voices.map(() => 0);
  const phasesB = voices.map(() => 0);
  const levelsNow = voices.map((v) => v.level);

  for (let i = 0; i < out.length; i++) {
    let sample = 0;
    for (let p = 0; p < voices.length; p++) {
      const voice = voices[p];
      if (!voice) continue;
      const a = (phasesA[p] ?? 0) + voice.stepA;
      const b = (phasesB[p] ?? 0) + voice.stepB;
      phasesA[p] = a >= 1 ? a - 1 : a;
      phasesB[p] = b >= 1 ? b - 1 : b;
      // うなり。2 本をわずかにずらして重ねる
      sample += (sineAt(a) + sineAt(b)) * 0.5 * (levelsNow[p] ?? 0);
      levelsNow[p] = (levelsNow[p] ?? 0) * voice.fall;
    }
    out[i] = sample * 0.32;
  }

  // 撥が当たる音。これが無いと「柔らかいベル」で止まる
  const clickLen = Math.min(out.length, Math.round(sampleRate * 0.004));
  for (let i = 0; i < clickLen; i++) {
    out[i] = (out[i] ?? 0) + random() * 0.14 * (1 - i / clickLen);
  }
}

/**
 * 低音。**土台なので目立たせない。**
 *
 * 鋸波をローパスに通し、軽く歪ませて厚みを出す。歪ませるのは、
 * 純粋な鋸波は倍音が均一すぎて「シンセの低音」に聞こえるから。
 */
export function lowString(out: Float32Array, options: RenderOptions): void {
  const { sampleRate, freq, seed } = options;
  const random = noiseGen(seed);
  const filter = onePole(poleCoefficient(Math.min(sampleRate * 0.4, freq * 4.5), sampleRate));
  let phase = 0;
  // わずかにずらしたもう 1 本。うねりが出て厚くなる
  let phase2 = 0.5;
  const fallStep = Math.exp(-1 / (sampleRate * 1.9));
  let fall = 1;
  for (let i = 0; i < out.length; i++) {
    const t = i / sampleRate;
    phase = (phase + freq / sampleRate) % 1;
    phase2 = (phase2 + (freq * 1.004) / sampleRate) % 1;
    const saw = (phase * 2 - 1) * 0.6 + (phase2 * 2 - 1) * 0.4;
    // 軽い歪み。倍音が偶数寄りになって「胴」が出る
    const driven = Math.tanh(saw * 1.8) * 0.55;
    let level: number;
    if (t < 0.012) {
      level = t / 0.012;
    } else {
      fall *= fallStep;
      level = fall;
    }
    out[i] = filter(driven + random() * 0.006) * level;
  }
}

/**
 * 刻み（締太鼓・拍子木）。木を打つ音。
 *
 * 雑音を帯域で切るだけだと「シャッ」というハイハットになる。
 * 木の板は短い共振を持つので、その帯域を 2 本立てて「カッ」に寄せる
 */
export function clave(out: Float32Array, options: RenderOptions): void {
  const { sampleRate, seed } = options;
  const random = noiseGen(seed);
  const resonances = [2400, 4100];
  const states = resonances.map(() => ({ y1: 0, y2: 0 }));
  for (let i = 0; i < out.length; i++) {
    const t = i / sampleRate;
    const excite = random() * Math.exp(-t / 0.0016);
    let sample = 0;
    for (let r = 0; r < resonances.length; r++) {
      const state = states[r];
      if (!state) continue;
      // 2 次の共振（バンドパス）。木の板の鳴りを 1 本ずつ
      const w = (2 * Math.PI * (resonances[r] ?? 0)) / sampleRate;
      const decay = Math.exp(-1 / (sampleRate * 0.02));
      const y = excite + 2 * decay * Math.cos(w) * state.y1 - decay * decay * state.y2;
      state.y2 = state.y1;
      state.y1 = y;
      sample += y * (r === 0 ? 0.5 : 0.3);
    }
    out[i] = sample * 0.09 * Math.exp(-t / 0.035);
  }
}

/**
 * 波形をならす。合成の結果は音量がまちまちなので、いちばん大きいところで揃える。
 *
 * @returns 掛けた倍率（0 なら無音だった）
 */
export function normalize(out: Float32Array, peak = 0.9): number {
  let max = 0;
  for (const value of out) max = Math.max(max, Math.abs(value));
  if (max === 0) return 0;
  const scale = peak / max;
  for (let i = 0; i < out.length; i++) out[i] = (out[i] ?? 0) * scale;
  return scale;
}

/** 頭と尻のクリックノイズを消す。切れ目で「プツッ」と鳴るのを防ぐ */
export function fadeEdges(out: Float32Array, sampleRate: number): void {
  const head = Math.min(out.length, Math.round(sampleRate * 0.001));
  for (let i = 0; i < head; i++) out[i] = (out[i] ?? 0) * (i / head);
  const tail = Math.min(out.length, Math.round(sampleRate * 0.02));
  for (let i = 0; i < tail; i++) {
    const index = out.length - 1 - i;
    out[index] = (out[index] ?? 0) * (i / tail);
  }
}
