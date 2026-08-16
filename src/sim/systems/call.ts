/**
 * コール & レスポンス（02-core-battle.md 2.9）。
 *
 * タワーディフェンスは基本的に見ているだけになりがちなので、**任意参加**の
 * 能動操作を入れる。サビのあいだ、小節の頭にコールのタイミングが来る。
 *
 * ## 設計の要点
 *
 * - **押さなくてもクリアできる。** 上手い人が 10〜15% 得をする程度に留める。
 *   ここを強くすると「リズムゲームが上手い人だけが勝つ TD」になり、
 *   盤面を読む面白さが押し出される。
 * - **Miss にペナルティを置かない。** 罰があると、自信の無い人は
 *   「押さない」が最適解になり、任意参加のはずが実質強制になる。
 * - **切れる。** 切ったときは Good 相当を自動で配る（06-ui-ux.md 6.7）。
 *   リズム操作が苦手／できない人が、それだけの理由で不利にならないように。
 */

export type CallJudge = 'perfect' | 'good' | 'miss';

/** Perfect の許容ずれ（ミリ秒） */
export const PERFECT_MS = 80;
/** Good の許容ずれ（ミリ秒）。これを外れると Miss */
export const GOOD_MS = 160;

/** Perfect のボルテージ加算 */
export const PERFECT_VOLTAGE = 3;
/** Good のボルテージ加算 */
export const GOOD_VOLTAGE = 1.5;
/** Perfect の全体攻撃力バフ */
export const PERFECT_ATK_PCT = 0.05;
/** 同バフの持続 */
export const PERFECT_BUFF_MS = 3000;

/**
 * ずれから判定を出す。
 * @param offsetMs 目標からのずれ。早くても遅くても符号は問わない
 */
export function judgeCall(offsetMs: number): CallJudge {
  const off = Math.abs(offsetMs);
  if (off <= PERFECT_MS) return 'perfect';
  if (off <= GOOD_MS) return 'good';
  return 'miss';
}

/** 判定ごとのボルテージ加算 */
export function callVoltage(judge: CallJudge): number {
  if (judge === 'perfect') return PERFECT_VOLTAGE;
  if (judge === 'good') return GOOD_VOLTAGE;
  return 0;
}

/**
 * コールを受け付ける区間か。**サビと大サビだけ**。
 *
 * 全編で受け付けると「曲のあいだずっと連打する作業」になる。
 * 山場に限ると、押す/押さないが盤面の忙しさとぶつかって判断になる。
 */
export function isCallSection(section: string | undefined): boolean {
  return section === 'chorus' || section === 'finale';
}
