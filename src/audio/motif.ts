/**
 * 動機（モチーフ）とその変形。
 *
 * ## なぜこれが要るのか
 *
 * 最初の実装は、音階の音を**ハッシュで選んで並べていた**。決定的なので
 * 毎回同じには鳴るが、それは「同じでたらめ」でしかなく、旋律ではなかった。
 * 曲ごとの違いも調と打ち方だけで、7 曲が実質同じ曲だった。
 *
 * **記憶に残る旋律を作るのは、繰り返しと変形。** 短い動機（3〜5 音）を決めて、
 * 移高・反行・逆行・拡大・断片化で展開する —— クラシックの主題労作と同じ道具立てで、
 * 手続き的な音楽生成でも中心になる考え方。
 *
 * ここは音の高さと長さだけを扱う。Web Audio も音階も知らないので、
 * **ブラウザ無しでテストできる**（変形が正しいかは数字で確かめられる）。
 */

export interface Motif {
  /** 音階上の度数。和音の根音からの相対で持つ */
  degrees: readonly number[];
  /** 各音の長さ（拍）。`degrees` と同じ長さ */
  beats: readonly number[];
}

/** 合計の長さ（拍） */
export function motifBeats(motif: Motif): number {
  return motif.beats.reduce((sum, b) => sum + b, 0);
}

/** 移高。全体を `by` 度ぶん上下させる */
export function transpose(motif: Motif, by: number): Motif {
  return { degrees: motif.degrees.map((d) => d + by), beats: motif.beats };
}

/**
 * 反行。**最初の音を軸に上下をひっくり返す。**
 *
 * 上がる旋律が下がる旋律になるが、音程の並びは同じなので
 * 「同じ動機だ」と分かる。間奏で使うと、同じ曲のまま景色が変わる
 */
export function invert(motif: Motif): Motif {
  const axis = motif.degrees[0] ?? 0;
  return {
    degrees: motif.degrees.map((d) => axis * 2 - d),
    beats: motif.beats,
  };
}

/** 逆行。後ろから読む。応答の楽句に使うと「返事」に聞こえる */
export function retrograde(motif: Motif): Motif {
  return {
    degrees: [...motif.degrees].reverse(),
    beats: [...motif.beats].reverse(),
  };
}

/** これより短い切れ端は鳴らさない（拍） */
const MIN_TAIL = 0.25;

/** 浮動小数の誤差を落とす。2.3999999999999995 のような長さを譜面に残さない */
const tidy = (value: number): number => Math.round(value * 10000) / 10000;

/** 拡大 / 縮小。長さだけを倍率で変える（音の並びは変えない） */
export function scaleTime(motif: Motif, factor: number): Motif {
  return {
    degrees: motif.degrees,
    beats: motif.beats.map((b) => tidy(b * factor)),
  };
}

/**
 * 決まった長さへ引き伸ばす / 詰める。
 *
 * `scaleTime` に倍率を直接書くと、動機の長さが曲ごとに違うぶん
 * 端数が出る（0.575 拍のような譜面に残せない長さ）。
 * **行き先の拍数で指定すれば、どの曲でも小節にぴったり収まる。**
 */
export function stretchTo(motif: Motif, beats: number): Motif {
  const total = motifBeats(motif);
  if (total <= 0) return motif;
  return scaleTime(motif, beats / total);
}

/** 断片化。頭から `count` 音だけ取る */
export function fragment(motif: Motif, count: number): Motif {
  const n = Math.max(1, Math.min(count, motif.degrees.length));
  return { degrees: motif.degrees.slice(0, n), beats: motif.beats.slice(0, n) };
}

/** 連結。断片を繰り返して 1 小節を埋めるときに使う */
export function concat(a: Motif, b: Motif): Motif {
  return {
    degrees: [...a.degrees, ...b.degrees],
    beats: [...a.beats, ...b.beats],
  };
}

/**
 * 埋まるまで繰り返す。縮小した動機を並べて「詰める」ときに使う。
 *
 * 回数ではなく**行き先の拍数**で指定する。回数で書くと、動機の長さが違う曲で
 * 小節が半分だけ埋まったり溢れたりする
 */
export function repeatTo(motif: Motif, beats: number): Motif {
  const total = motifBeats(motif);
  if (total <= 0) return motif;
  let out = motif;
  let guard = 0;
  while (motifBeats(out) < beats - 1e-9 && guard++ < 16) out = concat(out, motif);
  return out;
}

/**
 * 小節に収める。**はみ出したら切り、余ったら最後の音を伸ばす。**
 *
 * 変形すると長さが変わる（拡大すれば伸びる）。切らずに鳴らすと次の小節の頭と
 * 重なって拍がぼやけるので、ここで必ず 1 小節へ収める。
 */
export function fitToBar(motif: Motif, bars: number): Motif {
  const degrees: number[] = [];
  const beats: number[] = [];
  let used = 0;
  for (let i = 0; i < motif.degrees.length; i++) {
    if (used >= bars - 1e-9) break;
    const full = motif.beats[i] ?? 0;
    const beat = tidy(Math.min(full, bars - used));
    if (beat <= 0) break;
    // 切り詰めた残りが短すぎるなら鳴らさない。小節の終わりに 0.1 拍の欠片が
    // 残ると、旋律ではなく**取りこぼし**に聞こえる。
    // 落としたぶんは下で最後の音を伸ばして埋める
    if (beat < full - 1e-9 && beat < MIN_TAIL && degrees.length > 0) break;
    degrees.push(motif.degrees[i] ?? 0);
    beats.push(beat);
    used += beat;
  }
  if (degrees.length === 0) return { degrees: [0], beats: [bars] };
  // 余りは最後の音を伸ばして埋める。休符で終えると楽句が途切れて聞こえる
  if (used < bars - 1e-9) {
    beats[beats.length - 1] = tidy((beats[beats.length - 1] ?? 0) + (bars - used));
  }
  return { degrees, beats };
}

/**
 * 楽句の終止。**後楽節は主音へ落とす。**
 *
 * 前楽節（問い）と後楽節（答え）で 4 小節を作るのが、いちばん短い「曲の形」。
 * 答えが主音で終わらないと、いつまでも終わらない音の列に聞こえる。
 */
export function resolveToTonic(motif: Motif, range?: Register): Motif {
  if (motif.degrees.length === 0) return motif;
  const degrees = [...motif.degrees];
  // いまの最後の音にいちばん近い主音へ寄せる。遠い主音へ飛ばすと旋律の形が壊れる
  const last = degrees[degrees.length - 1] ?? 0;
  let target = Math.round(last / 5) * 5;
  // ただし音域から外れるなら反対側の主音で終える。
  // 主音は 1 オクターブ（5 度数）おきにあるので、どちらでも終止にはなる ——
  // ここで外れたぶんを `clampRegister` に畳ませると楽句まるごと動いてしまい、
  // 最後の小節だけ急に高く（低く）なる
  if (range && target > range.ceiling) target -= 5;
  else if (range && target < range.floor) target += 5;
  degrees[degrees.length - 1] = target;
  return { degrees, beats: motif.beats };
}

/** 旋律を収める音域（音階上の度数） */
export interface Register {
  ceiling: number;
  floor: number;
}

/**
 * 音域に収める。**上限を超えたらオクターブ単位で下げる。**
 *
 * 和音進行で根音が上がり、セクションでオクターブが乗り、終止で主音へ跳ぶ ——
 * それぞれは正しくても、足し合わせると楽句のたびに音域が上がっていく。
 * 移調で受けると旋律の形が崩れるので、**オクターブ（5 度数）単位**で畳む。
 *
 * @param ceiling これを超える音が出たら下げる（音階上の度数）
 */
export function clampRegister(motif: Motif, ceiling: number): Motif {
  let degrees = [...motif.degrees];
  let guard = 0;
  while (Math.max(...degrees) > ceiling && guard++ < 4) {
    degrees = degrees.map((d) => d - 5);
  }
  return { degrees, beats: motif.beats };
}

/** 動機を「いつ・どの高さで鳴らすか」へ展開する */
export interface PlacedNote {
  /** 小節内の位置（拍） */
  beat: number;
  /** 音階上の度数 */
  degree: number;
  beats: number;
}

export function place(motif: Motif, from = 0): PlacedNote[] {
  const out: PlacedNote[] = [];
  let at = from;
  for (let i = 0; i < motif.degrees.length; i++) {
    const beats = motif.beats[i] ?? 0;
    out.push({ beat: at, degree: motif.degrees[i] ?? 0, beats });
    at += beats;
  }
  return out;
}
