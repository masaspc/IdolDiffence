/**
 * 音階と音高。
 *
 * **和の響きは音階で決まる。** 楽器の音色をいくら和風に寄せても、
 * 長音階のまま鳴らすと「和風の音がする洋楽」にしかならない。
 * 逆に音階さえ日本のものなら、単純な矩形波でも和に聞こえる。
 *
 * ここは Web Audio に触らない。音を出す前の「どの高さを鳴らすか」だけを扱うので、
 * ブラウザ無しでテストできる。
 */

/**
 * 使う音階。いずれも 5 音（ペンタトニック）。
 *
 * - `miyakobushi`（都節）—— 半音を 2 つ含む。いちばん「和」が濃い。
 *   箏や三味線の定番で、暗く艶のある響きになる
 * - `ritsu`（律）—— 雅楽の音階。半音が無く、開けた明るさが出る
 * - `insen`（陰旋）—— 都節の変種。上行と下行で表情が変わる
 */
export type ScaleName = 'miyakobushi' | 'ritsu' | 'insen' | 'yonanuki';

/** 主音からの半音数 */
const SCALES: Record<ScaleName, readonly number[]> = {
  miyakobushi: [0, 1, 5, 7, 8],
  ritsu: [0, 2, 5, 7, 9],
  insen: [0, 1, 5, 7, 10],
  // ヨナ抜き長音階（長音階から 4 度と 7 度を抜いたもの）。
  // 半音を含まないので、都節と並べるといちばん明るい
  yonanuki: [0, 2, 4, 7, 9],
};

/**
 * 音階の第 `degree` 音を MIDI ノート番号で返す。
 *
 * `degree` は**オクターブをまたいで連続**する。5 を渡せば主音の 1 オクターブ上、
 * -1 なら下のオクターブの最高音。旋律を書くときに
 * 「オクターブをまたぐ」を気にしなくて済む
 */
export function scaleNote(root: number, scale: ScaleName, degree: number): number {
  const steps = SCALES[scale];
  const size = steps.length;
  // JS の % は負の数で負を返すので、床除算で回す
  const octave = Math.floor(degree / size);
  const index = degree - octave * size;
  return root + octave * 12 + (steps[index] ?? 0);
}

/**
 * 和音の構成音（音階上の度数）。
 *
 * **三和音は積まない。** 5 音音階に 3 度堆積を乗せると濁りやすく、
 * 単純な波形では特に汚くなる。和風の定番どおり**四度堆積**にする ——
 * 5 音音階では「1 つ飛ばし」がほぼ 4 度になるので、度数 +2 ずつ重ねる。
 * sus4 的な、解決を急がない響きになる。
 */
export function chordDegrees(root: number): number[] {
  return [root, root + 2, root + 4];
}

/** MIDI ノート番号 → 周波数（Hz）。A4 = 69 = 440Hz */
export function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

/**
 * 決定的な擬似乱数。**`Math.random()` は使えない**（決定性のため
 * eslint で禁じてある）し、ここで使うと同じ小節が毎回違う旋律になり、
 * 「曲」として覚えられない。
 *
 * 同じ (曲, 小節, 位置) からは必ず同じ値が出る。曲は毎回まったく同じに鳴り、
 * それでいて小節ごとには変化する。
 */
export function hash01(...parts: (number | string)[]): number {
  let h = 0x811c9dc5;
  for (const part of parts) {
    const text = typeof part === 'number' ? part.toString(36) : part;
    for (let i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    h ^= 0x5f;
    h = Math.imul(h, 0x01000193);
  }
  return ((h >>> 0) % 100_000) / 100_000;
}

/** `hash01` から整数を選ぶ（0 以上 `count` 未満） */
export function hashPick(count: number, ...parts: (number | string)[]): number {
  return Math.floor(hash01(...parts) * count) % count;
}
