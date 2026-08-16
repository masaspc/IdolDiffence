/**
 * 隠し要素の解放。
 *
 * いまのところ隠しキャラ **MASA** の 1 件だけ。
 *
 * ## なぜステージ解放にしないのか
 *
 * 他のメンバーはステージクリアで配っている（`idolUnlockStage`）。同じ棚に置くと
 * ホームの「レッスン」に「○○をクリアすると解放」と出てしまい、隠れていない。
 * **合言葉**にすると、知らない人には存在ごと見えず、知っている人だけが呼び出せる。
 *
 * ## 合言葉の入り方
 *
 * ホーム画面でキーボードから打つ（`useSecretCode`）。スマホには物理キーが無いので、
 * タイトルの連打も同じ扱いにしてある —— 隠し要素が
 * 「PC を持っている人だけのもの」になるのは避けたい。
 */
import type { SaveData } from './save';

/** 隠しキャラの ID と合言葉。合言葉は大文字小文字を区別しない */
export const SECRET_CODES: Record<string, string> = {
  GM: 'MASA',
};

/** タイトル連打で解放するときの回数。誤爆しない程度に多く、諦めない程度に少なく */
export const TAP_COUNT = 7;

export function isSecretUnlocked(save: SaveData, idolId: string): boolean {
  return save.secrets.includes(idolId);
}

/**
 * 合言葉に一致する隠しキャラの ID を返す。
 * @param typed 直近の入力（末尾一致で見る。打ち間違えても続けて打てばよい）
 */
export function matchSecret(typed: string): string | null {
  const upper = typed.toUpperCase();
  for (const [idolId, code] of Object.entries(SECRET_CODES)) {
    if (upper.endsWith(code)) return idolId;
  }
  return null;
}

/** 解放を書き込む。すでに解放済みなら同じセーブをそのまま返す（無駄な保存を避ける） */
export function unlockSecret(save: SaveData, idolId: string): SaveData {
  if (save.secrets.includes(idolId)) return save;
  return { ...save, secrets: [...save.secrets, idolId] };
}

/** 合言葉の最大長。入力バッファをこれ以上伸ばさない */
export const MAX_CODE_LENGTH = Math.max(...Object.values(SECRET_CODES).map((c) => c.length));
