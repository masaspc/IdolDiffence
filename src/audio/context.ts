/**
 * AudioContext の入り口。
 *
 * ## 1 つだけ作って使い回す
 *
 * ブラウザは同時に持てる AudioContext の数を制限している。ステージへ入るたびに
 * 作ると、何本か遊んだところで作れなくなって**無音のまま何も言わずに壊れる**。
 *
 * ## ユーザー操作の前には作らない
 *
 * 自動再生の制限で、操作より前に作った AudioContext は `suspended` のまま動かない。
 * ここでは「呼ばれたときに初めて作る」形にして、最初の呼び出しを
 * 出撃ボタン（＝クリック）の側から起こす。
 *
 * ## 音が出せない環境でも落ちない
 *
 * テスト（Node）や Web Audio を持たないブラウザでは `null` を返す。
 * 呼び出し側は毎回 null を確かめる —— 音が出ないことはゲームの進行に
 * 一切影響しない（sim は音を知らない）。
 */

let ctx: AudioContext | null = null;
let unavailable = false;

type AudioContextCtor = new () => AudioContext;

function ctor(): AudioContextCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as {
    AudioContext?: AudioContextCtor;
    webkitAudioContext?: AudioContextCtor;
  };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

/**
 * 共有の AudioContext。**ユーザー操作の中から呼ぶこと。**
 * 音が使えない環境では `null`（以後は作り直しを試みない）
 */
export function audioContext(): AudioContext | null {
  if (unavailable) return null;
  if (ctx) return ctx;
  const Ctor = ctor();
  if (!Ctor) {
    unavailable = true;
    return null;
  }
  try {
    ctx = new Ctor();
  } catch {
    unavailable = true;
    return null;
  }
  return ctx;
}

/**
 * 止まっていたら動かす。
 *
 * タブを戻したときや、操作より前に作られてしまったときに `suspended` になる。
 * `resume()` は Promise を返すが、待つ必要はない —— 動くまでのあいだは
 * 予約が空振りするだけで、次のフレームには追いつく
 */
export function resumeAudio(): void {
  const context = audioContext();
  if (context && context.state === 'suspended') void context.resume();
}
