/**
 * 隠し要素の解放。
 *
 * いまのところ隠しキャラ **MASA** の 1 件だけ。
 *
 * ## 鍵は 2 つある
 *
 * 1. **合言葉** —— 知っている人がいつでも呼び出せる
 * 2. **腕前** —— `SECRET_STAR_GATE` に届けば、知らなくても向こうから出てくる
 *
 * 当初は 1 だけでした。「同じ棚に置くと『○○をクリアすると解放』と出てしまい、
 * 隠れていることにならない」という理由です。理屈は通っていますが、
 * **合言葉を知らない人には永久に存在しない**ことになります。
 * ゲームでいちばん強い駒を、遊んでいるだけの人が一生見られないのは損が大きい。
 *
 * そこで 2 を足しました。ただの通過点では出ません。**S5 を ★5 で勝つ** ——
 * ★は 1 段ずつしか開かないので、S5 に 5 回勝ち上がる必要があり、
 * 要求戦力は ★1 の約 6.4 倍（`sim/star.ts`）。育てていないと届きません。
 * 「本編を進めた」ではなく「腕前が一定に達した」ことの証明になっています。
 *
 * 条件は `idolUnlockStage` には**置きません**。あちらに置くと育成画面に
 * 「S5 をクリアすると解放」と先出しされてしまい、条件ごとネタバレになります。
 *
 * ## 合言葉の入り方
 *
 * ホーム画面でキーボードから打つ（`useSecretCode`）。スマホには物理キーが無いので、
 * タイトルの連打も同じ扱いにしてある —— 隠し要素が
 * 「PC を持っている人だけのもの」になるのは避けたい。
 *
 * ## 解放を保存しないもの・するもの
 *
 * 腕前で開いたぶんは `bestStar` から**毎回導きます**（保存しない）。条件を
 * 変えたときに、保存済みの解放だけが古い条件のまま残るのを避けるためです。
 * 合言葉のほうは入力という出来事なので、`save.secrets` に記録しないと復元できません。
 */
import type { SaveData } from './save';

/** 隠しキャラの ID と合言葉。合言葉は大文字小文字を区別しない */
export const SECRET_CODES: Record<string, string> = {
  GM: 'MASA',
};

/**
 * 合言葉を知らなくても届く条件。**そのステージに、その★で勝つ**。
 *
 * S5 は本編 10 本の折り返し。ここを ★5 で勝てる人は、
 * 残りの本編を素の戦力でも押し切れる位置にいます（`docs/design/04-content.md`）。
 * 早すぎると本編が消化試合になり、遅すぎると使う場面が無い
 */
export const SECRET_STAR_GATE: Record<string, { stage: string; star: number }> = {
  GM: { stage: 'S5', star: 5 },
};

/** タイトル連打で解放するときの回数。誤爆しない程度に多く、諦めない程度に少なく */
export const TAP_COUNT = 7;

/** 腕前のほうの条件を満たしているか */
export function secretGateMet(save: SaveData, idolId: string): boolean {
  const gate = SECRET_STAR_GATE[idolId];
  if (!gate) return false;
  return (save.bestStar[gate.stage] ?? 0) >= gate.star;
}

export function isSecretUnlocked(save: SaveData, idolId: string): boolean {
  return save.secrets.includes(idolId) || secretGateMet(save, idolId);
}

/**
 * 解放済みなのに、まだプレイヤーへ知らせていない隠しキャラ。
 *
 * 解放そのものは導けますが、**知らせたかどうかは出来事**なので
 * `save.seenSecrets` に記録するしかありません（導こうとすると、
 * ホームを開くたびに同じ通知が出続ける）
 */
export function unseenSecrets(save: SaveData): string[] {
  return Object.keys(SECRET_CODES).filter(
    (id) => isSecretUnlocked(save, id) && !save.seenSecrets.includes(id),
  );
}

/** 知らせ済みにする。すでに済んでいれば同じセーブをそのまま返す */
export function markSecretSeen(save: SaveData, idolId: string): SaveData {
  if (save.seenSecrets.includes(idolId)) return save;
  return { ...save, seenSecrets: [...save.seenSecrets, idolId] };
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
