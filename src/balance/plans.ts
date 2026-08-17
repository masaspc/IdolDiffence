/**
 * ヘッドレス計測で使う「そこそこの盤面」。
 *
 * 人間の最適解ではなく**下限の目安**。これで届かないなら、上手いプレイでも
 * 相当きついということが分かればよい。probe と sweep-difficulty が同じ盤面を
 * 見ていないと比較にならないので、両者からここを参照する。
 *
 * `upgradeTo` は声援が足りる範囲でしか進まない（`autoplay.applyUpgrades`）。
 * ポジション強化を 6 段階へ伸ばしたとき、上限を 3 のままにしておくと
 * **余った声援を使い切らない盤面**で計測することになり、実際のプレイより
 * 弱く見積もってしまう。前衛は 6、後衛は 4 を上限にして、余剰を吸わせる。
 */
import type { Placement } from '../sim/autoplay';

/**
 * そのステージに挑む時点で、プレイヤーが持っていると仮定する恒久強化。
 *
 * ## なぜ段階が要るのか
 *
 * S1〜S10 は**素のレベルだけ**で測ってきた。レベル上限が 30 なので、
 * 「Lv30 で全ステージ勝てる」で曲線が閉じていた。
 *
 * S11 以降（月の都の章）は**その先**にある。レベルはもう上限なので、
 * 素の値で難度を上げると「上限まで育てても勝てない壁」になる。
 * この章が要求するのは才能ボード・進化・衣装 —— 03-progression.md E-2 の
 * 恒久強化そのもので、S10 までのあいだに積み上がっているはずのもの。
 *
 * **仮定を明示しないと測れない。** 「Lv30 で勝てるか」だけを見ていると、
 * 才能も衣装も無い盤面で 20 ステージぶんの難度を作ることになり、
 * 実際のプレイ（全部積んだ状態）とかけ離れる。
 */
export type Investment =
  /** 素のレベルだけ。才能も進化も衣装も無い（S1〜B2） */
  | 'bare'
  /** 才能ボードを 1 枝ぶん + 初期 3 人の進化（S11〜S15） */
  | 'talents'
  /** さらに衣装 SSR+9 相当（S16〜B3） */
  | 'full';

export interface StagePlan {
  /** 出撃メンバー。そのステージに挑む時点で解放されている 5 人を想定する */
  party: string[];
  center: string;
  placements: Placement[];
  /** 恒久強化の仮定。省略は `bare` */
  investment?: Investment;
}

export const STAGE_PLANS: Record<string, StagePlan> = {
  S1: {
    party: ['V1', 'D1', 'Vi1'],
    center: 'V1',
    placements: [
      { idolId: 'D1', x: 4, y: 6, upgradeTo: 6, awakening: 'A' },
      { idolId: 'V1', x: 8, y: 5, upgradeTo: 6, awakening: 'A' },
      { idolId: 'Vi1', x: 12, y: 5, upgradeTo: 4, awakening: 'B' },
      { idolId: 'D1', x: 11, y: 4, upgradeTo: 4, awakening: 'B' },
      { idolId: 'V1', x: 3, y: 3, upgradeTo: 4, awakening: 'B' },
    ],
  },
  S2: {
    party: ['V1', 'D1', 'Vi1', 'V2'],
    center: 'V1',
    placements: [
      { idolId: 'D1', x: 3, y: 5, upgradeTo: 6, awakening: 'A' },
      { idolId: 'V1', x: 7, y: 4, upgradeTo: 6, awakening: 'A' },
      { idolId: 'Vi1', x: 12, y: 5, upgradeTo: 4, awakening: 'B' },
      { idolId: 'V2', x: 6, y: 3, upgradeTo: 4, awakening: 'B' },
      { idolId: 'V1', x: 14, y: 5, upgradeTo: 4, awakening: 'B' },
      { idolId: 'D1', x: 1, y: 4 },
    ],
  },
  S3: {
    party: ['V1', 'D1', 'Vi1', 'V2', 'D2'],
    center: 'V1',
    placements: [
      { idolId: 'V1', x: 5, y: 3, upgradeTo: 6, awakening: 'A' },
      { idolId: 'V1', x: 9, y: 2, upgradeTo: 6, awakening: 'A' },
      { idolId: 'D1', x: 9, y: 6, upgradeTo: 6, awakening: 'A' },
      { idolId: 'Vi1', x: 11, y: 2, upgradeTo: 4, awakening: 'B' },
      { idolId: 'Vi1', x: 11, y: 6, upgradeTo: 4, awakening: 'B' },
      { idolId: 'V2', x: 2, y: 3, upgradeTo: 4, awakening: 'B' },
      { idolId: 'D1', x: 2, y: 5, upgradeTo: 4, awakening: 'B' },
      { idolId: 'V1', x: 13, y: 2 },
    ],
  },
  // S4 はアマツバメ（飛行）が出る。対空を持つ V1 / Vi1 / V2 をゴール寄りに置く
  S4: {
    party: ['V1', 'D1', 'Vi1', 'V2', 'Vi2'],
    center: 'V1',
    placements: [
      { idolId: 'V1', x: 6, y: 4, upgradeTo: 6, awakening: 'A' },
      { idolId: 'V1', x: 8, y: 2, upgradeTo: 6, awakening: 'A' },
      { idolId: 'D1', x: 8, y: 6, upgradeTo: 6, awakening: 'A' },
      { idolId: 'Vi1', x: 10, y: 2, upgradeTo: 4, awakening: 'B' },
      { idolId: 'Vi1', x: 10, y: 6, upgradeTo: 4, awakening: 'B' },
      { idolId: 'V2', x: 12, y: 2, upgradeTo: 4, awakening: 'B' },
      { idolId: 'V2', x: 12, y: 6, upgradeTo: 4, awakening: 'B' },
      { idolId: 'D1', x: 2, y: 2 },
      { idolId: 'D1', x: 2, y: 6 },
    ],
  },
  // S5 は 3 レーンが中央 (y=4) で合流する。合流点の両脇に厚く置く
  S5: {
    party: ['V1', 'D1', 'Vi1', 'V2', 'V3'],
    center: 'V1',
    placements: [
      { idolId: 'V1', x: 9, y: 2, upgradeTo: 6, awakening: 'A' },
      { idolId: 'V1', x: 9, y: 6, upgradeTo: 6, awakening: 'A' },
      { idolId: 'D1', x: 5, y: 3, upgradeTo: 6, awakening: 'A' },
      { idolId: 'D1', x: 5, y: 5, upgradeTo: 6, awakening: 'A' },
      { idolId: 'V2', x: 11, y: 2, upgradeTo: 4, awakening: 'B' },
      { idolId: 'V2', x: 11, y: 6, upgradeTo: 4, awakening: 'B' },
      { idolId: 'Vi1', x: 13, y: 2, upgradeTo: 4, awakening: 'B' },
      { idolId: 'Vi1', x: 13, y: 6, upgradeTo: 4, awakening: 'B' },
      { idolId: 'V3', x: 2, y: 2 },
      { idolId: 'V3', x: 2, y: 6 },
    ],
  },
  // S6 はツキシズク（回復）とムラクモ（分裂）。範囲で数を捌きつつヒーラーを抜く
  S6: {
    party: ['V1', 'D1', 'Vi1', 'V2', 'D3'],
    center: 'V1',
    placements: [
      { idolId: 'V1', x: 5, y: 2, upgradeTo: 6, awakening: 'A' },
      { idolId: 'V1', x: 5, y: 6, upgradeTo: 6, awakening: 'A' },
      { idolId: 'D3', x: 7, y: 2, upgradeTo: 6, awakening: 'A' },
      { idolId: 'D3', x: 7, y: 6, upgradeTo: 6, awakening: 'A' },
      { idolId: 'V2', x: 11, y: 3, upgradeTo: 4, awakening: 'B' },
      { idolId: 'V2', x: 11, y: 5, upgradeTo: 4, awakening: 'B' },
      { idolId: 'Vi1', x: 13, y: 3, upgradeTo: 4, awakening: 'B' },
      { idolId: 'Vi1', x: 13, y: 5, upgradeTo: 4, awakening: 'B' },
      { idolId: 'D1', x: 6, y: 0 },
      { idolId: 'D1', x: 6, y: 8 },
    ],
  },
  // S7 はカガミ（単体カット）。範囲攻撃と DEF 無視で崩す
  S7: {
    party: ['V1', 'D1', 'Vi1', 'V3', 'Vi3'],
    center: 'V1',
    placements: [
      { idolId: 'V1', x: 7, y: 5, upgradeTo: 6, awakening: 'A' },
      { idolId: 'V1', x: 9, y: 5, upgradeTo: 6, awakening: 'A' },
      { idolId: 'V3', x: 14, y: 5, upgradeTo: 6, awakening: 'A' },
      { idolId: 'V3', x: 14, y: 3, upgradeTo: 6, awakening: 'A' },
      { idolId: 'Vi3', x: 7, y: 3, upgradeTo: 4, awakening: 'B' },
      { idolId: 'Vi3', x: 9, y: 3, upgradeTo: 4, awakening: 'B' },
      { idolId: 'V1', x: 1, y: 4, upgradeTo: 4, awakening: 'B' },
      { idolId: 'Vi1', x: 3, y: 4, upgradeTo: 4, awakening: 'B' },
      { idolId: 'D1', x: 1, y: 0 },
      { idolId: 'D1', x: 3, y: 0 },
    ],
  },
  // S8 は トコヤミ（攻撃速度デバフ）が主役。デバフ源を早く抜きたいので、
  // 合流点の手前に単体火力を寄せる
  S8: {
    party: ['V1', 'D3', 'Vi1', 'V3', 'Vi3'],
    center: 'V1',
    placements: [
      { idolId: 'V1', x: 9, y: 2, upgradeTo: 6, awakening: 'A' },
      { idolId: 'V1', x: 9, y: 6, upgradeTo: 6, awakening: 'A' },
      { idolId: 'V3', x: 11, y: 2, upgradeTo: 6, awakening: 'A' },
      { idolId: 'V3', x: 11, y: 6, upgradeTo: 6, awakening: 'A' },
      { idolId: 'D3', x: 5, y: 3, upgradeTo: 6, awakening: 'A' },
      { idolId: 'D3', x: 5, y: 5, upgradeTo: 6, awakening: 'A' },
      { idolId: 'Vi3', x: 13, y: 2, upgradeTo: 4, awakening: 'B' },
      { idolId: 'Vi3', x: 13, y: 6, upgradeTo: 4, awakening: 'B' },
      { idolId: 'Vi1', x: 4, y: 2, upgradeTo: 4, awakening: 'B' },
      { idolId: 'Vi1', x: 4, y: 6, upgradeTo: 4, awakening: 'B' },
    ],
  },
  // S9 は雨で射程 -10%。届かないぶんを配置の密度で補う
  S9: {
    party: ['V1', 'D3', 'Vi1', 'V3', 'Vi3'],
    center: 'V1',
    placements: [
      { idolId: 'V1', x: 9, y: 2, upgradeTo: 6, awakening: 'A' },
      { idolId: 'V1', x: 9, y: 6, upgradeTo: 6, awakening: 'A' },
      { idolId: 'V3', x: 11, y: 2, upgradeTo: 6, awakening: 'A' },
      { idolId: 'V3', x: 11, y: 6, upgradeTo: 6, awakening: 'A' },
      { idolId: 'Vi1', x: 5, y: 3, upgradeTo: 4, awakening: 'A' },
      { idolId: 'Vi1', x: 5, y: 5, upgradeTo: 4, awakening: 'A' },
      { idolId: 'Vi3', x: 13, y: 2, upgradeTo: 4, awakening: 'B' },
      { idolId: 'Vi3', x: 13, y: 6, upgradeTo: 4, awakening: 'B' },
      { idolId: 'D3', x: 4, y: 2, upgradeTo: 4, awakening: 'A' },
      { idolId: 'D3', x: 4, y: 6, upgradeTo: 4, awakening: 'A' },
    ],
  },
  // S10 は総合力テスト。これまでの敵が全部出るので、答えも全部並べる
  S10: {
    party: ['V1', 'D3', 'Vi1', 'V3', 'Vi3'],
    center: 'V1',
    placements: [
      { idolId: 'V1', x: 9, y: 2, upgradeTo: 6, awakening: 'A' },
      { idolId: 'V1', x: 9, y: 6, upgradeTo: 6, awakening: 'A' },
      { idolId: 'V3', x: 11, y: 2, upgradeTo: 6, awakening: 'A' },
      { idolId: 'V3', x: 11, y: 6, upgradeTo: 6, awakening: 'A' },
      { idolId: 'Vi3', x: 13, y: 2, upgradeTo: 6, awakening: 'B' },
      { idolId: 'Vi3', x: 13, y: 6, upgradeTo: 6, awakening: 'B' },
      { idolId: 'D3', x: 5, y: 3, upgradeTo: 4, awakening: 'A' },
      { idolId: 'D3', x: 5, y: 5, upgradeTo: 4, awakening: 'A' },
      { idolId: 'Vi1', x: 4, y: 2, upgradeTo: 4, awakening: 'B' },
      { idolId: 'Vi1', x: 4, y: 6, upgradeTo: 4, awakening: 'B' },
    ],
  },
  // B1 はボスの属性が 3 すくみを一周する。**3 系統を混ぜる**のが答え
  B1: {
    party: ['V1', 'D3', 'Vi1', 'V3', 'Vi3'],
    center: 'V1',
    placements: [
      { idolId: 'V1', x: 9, y: 4, upgradeTo: 6, awakening: 'A' },
      { idolId: 'V3', x: 11, y: 4, upgradeTo: 6, awakening: 'A' },
      { idolId: 'V1', x: 7, y: 4, upgradeTo: 6, awakening: 'A' },
      { idolId: 'Vi3', x: 13, y: 4, upgradeTo: 4, awakening: 'B' },
      { idolId: 'D3', x: 4, y: 6, upgradeTo: 4, awakening: 'A' },
      { idolId: 'Vi1', x: 9, y: 2, upgradeTo: 4, awakening: 'B' },
      { idolId: 'Vi1', x: 11, y: 2, upgradeTo: 4, awakening: 'B' },
      { idolId: 'D3', x: 2, y: 6, upgradeTo: 4, awakening: 'A' },
    ],
  },
  // B2 は 1 レーンが 4 秒沈黙する。**分散**しないと止まっているあいだに抜かれる
  B2: {
    party: ['V1', 'D3', 'Vi1', 'V3', 'Vi3'],
    center: 'V1',
    placements: [
      { idolId: 'V1', x: 9, y: 2, upgradeTo: 6, awakening: 'A' },
      { idolId: 'V1', x: 9, y: 6, upgradeTo: 6, awakening: 'A' },
      { idolId: 'V3', x: 11, y: 2, upgradeTo: 6, awakening: 'A' },
      { idolId: 'V3', x: 11, y: 6, upgradeTo: 6, awakening: 'A' },
      { idolId: 'Vi3', x: 13, y: 2, upgradeTo: 6, awakening: 'B' },
      { idolId: 'Vi3', x: 13, y: 6, upgradeTo: 6, awakening: 'B' },
      { idolId: 'D3', x: 5, y: 3, upgradeTo: 4, awakening: 'A' },
      { idolId: 'D3', x: 5, y: 5, upgradeTo: 4, awakening: 'A' },
      { idolId: 'Vi1', x: 2, y: 2, upgradeTo: 4, awakening: 'B' },
      { idolId: 'Vi1', x: 2, y: 6, upgradeTo: 4, awakening: 'B' },
    ],
  },

  // ===== 月の都の章（S11〜B3） =====
  // ここから先は恒久強化を前提にする（`Investment`）。
  // 盤面は 5 つのテンプレート（合流 3 / 並走 3 / 蛇行 1 / 回廊 2 / 4 レーン）を
  // 使い回しているので、置き場所も**テンプレートごとに同じ骨格**にしてある。

  // S11 石作皇子（撃破でホタルが 4 体）。合流点に範囲を厚く置いて、湧いたぶんごと潰す
  S11: {
    party: ['V1', 'V4', 'V3', 'Vi3', 'D3'],
    center: 'V1',
    investment: 'talents',
    placements: [
      { idolId: 'V1', x: 9, y: 2, upgradeTo: 6, awakening: 'A' },
      { idolId: 'V1', x: 9, y: 6, upgradeTo: 6, awakening: 'A' },
      { idolId: 'V4', x: 11, y: 2, upgradeTo: 6, awakening: 'A' },
      { idolId: 'V4', x: 11, y: 6, upgradeTo: 6, awakening: 'A' },
      { idolId: 'V3', x: 13, y: 2, upgradeTo: 6, awakening: 'A' },
      { idolId: 'V3', x: 13, y: 6, upgradeTo: 6, awakening: 'A' },
      { idolId: 'Vi3', x: 5, y: 3, upgradeTo: 4, awakening: 'B' },
      { idolId: 'Vi3', x: 5, y: 5, upgradeTo: 4, awakening: 'B' },
      { idolId: 'D3', x: 4, y: 2, upgradeTo: 4, awakening: 'A' },
      { idolId: 'D3', x: 4, y: 6, upgradeTo: 4, awakening: 'A' },
    ],
  },
  // S12 車持皇子と工匠の群れ。並走 3 レーンなので、中央の列から両側へ届かせる
  S12: {
    party: ['V1', 'V4', 'V3', 'Vi3', 'D3'],
    center: 'V1',
    investment: 'talents',
    placements: [
      { idolId: 'V1', x: 8, y: 3, upgradeTo: 6, awakening: 'A' },
      { idolId: 'V1', x: 8, y: 5, upgradeTo: 6, awakening: 'A' },
      { idolId: 'V4', x: 5, y: 3, upgradeTo: 6, awakening: 'A' },
      { idolId: 'V4', x: 5, y: 5, upgradeTo: 6, awakening: 'A' },
      { idolId: 'V3', x: 11, y: 3, upgradeTo: 6, awakening: 'A' },
      { idolId: 'V3', x: 11, y: 5, upgradeTo: 6, awakening: 'A' },
      { idolId: 'Vi3', x: 13, y: 3, upgradeTo: 4, awakening: 'B' },
      { idolId: 'Vi3', x: 13, y: 5, upgradeTo: 4, awakening: 'B' },
      { idolId: 'D3', x: 2, y: 3, upgradeTo: 4, awakening: 'A' },
      { idolId: 'D3', x: 2, y: 5, upgradeTo: 4, awakening: 'A' },
    ],
  },
  // S13 阿倍御主人（ヴィジュアルが通らない）。
  // **参照盤面からヴィジュアルを外す**。外して成立することが、この敵の問いの証明
  S13: {
    party: ['V1', 'V2', 'V3', 'D1', 'D3'],
    center: 'V1',
    investment: 'talents',
    placements: [
      { idolId: 'V1', x: 9, y: 2, upgradeTo: 6, awakening: 'A' },
      { idolId: 'V1', x: 9, y: 6, upgradeTo: 6, awakening: 'A' },
      { idolId: 'V3', x: 11, y: 2, upgradeTo: 6, awakening: 'A' },
      { idolId: 'V3', x: 11, y: 6, upgradeTo: 6, awakening: 'A' },
      { idolId: 'D3', x: 13, y: 2, upgradeTo: 6, awakening: 'A' },
      { idolId: 'D3', x: 13, y: 6, upgradeTo: 6, awakening: 'A' },
      { idolId: 'V2', x: 5, y: 3, upgradeTo: 4, awakening: 'B' },
      { idolId: 'V2', x: 5, y: 5, upgradeTo: 4, awakening: 'B' },
      { idolId: 'D1', x: 4, y: 2, upgradeTo: 4, awakening: 'A' },
      { idolId: 'D1', x: 4, y: 6, upgradeTo: 4, awakening: 'A' },
    ],
  },
  // S14 大伴御行（飛行）。**ダンスは原則対空できない**ので、歌とヴィジュアルで組む
  S14: {
    party: ['V1', 'V2', 'V3', 'Vi1', 'Vi3'],
    center: 'V1',
    investment: 'talents',
    placements: [
      { idolId: 'V1', x: 8, y: 3, upgradeTo: 6, awakening: 'A' },
      { idolId: 'V1', x: 8, y: 5, upgradeTo: 6, awakening: 'A' },
      { idolId: 'V2', x: 11, y: 3, upgradeTo: 6, awakening: 'A' },
      { idolId: 'V2', x: 11, y: 5, upgradeTo: 6, awakening: 'A' },
      { idolId: 'V3', x: 5, y: 3, upgradeTo: 6, awakening: 'A' },
      { idolId: 'V3', x: 5, y: 5, upgradeTo: 6, awakening: 'A' },
      { idolId: 'Vi3', x: 13, y: 3, upgradeTo: 4, awakening: 'B' },
      { idolId: 'Vi3', x: 13, y: 5, upgradeTo: 4, awakening: 'B' },
      { idolId: 'Vi1', x: 2, y: 3, upgradeTo: 4, awakening: 'B' },
      { idolId: 'Vi1', x: 2, y: 5, upgradeTo: 4, awakening: 'B' },
    ],
  },
  // S15 石上麻呂（手負いで加速）。蛇行路なので、**折り返しに単体火力を寄せて**
  // 1 体ずつ落とす。範囲で薄く削ると全員が加速して抜けてしまう
  S15: {
    party: ['V1', 'V3', 'D3', 'Vi1', 'Vi3'],
    center: 'V1',
    investment: 'talents',
    placements: [
      { idolId: 'D3', x: 9, y: 5, upgradeTo: 6, awakening: 'A' },
      { idolId: 'D3', x: 12, y: 5, upgradeTo: 6, awakening: 'A' },
      { idolId: 'V3', x: 14, y: 4, upgradeTo: 6, awakening: 'A' },
      { idolId: 'V3', x: 14, y: 2, upgradeTo: 6, awakening: 'A' },
      { idolId: 'V1', x: 6, y: 5, upgradeTo: 6, awakening: 'A' },
      { idolId: 'V1', x: 8, y: 2, upgradeTo: 6, awakening: 'A' },
      { idolId: 'Vi3', x: 5, y: 2, upgradeTo: 4, awakening: 'B' },
      { idolId: 'Vi1', x: 1, y: 5, upgradeTo: 4, awakening: 'B' },
      { idolId: 'Vi1', x: 6, y: 8, upgradeTo: 4, awakening: 'B' },
      { idolId: 'V1', x: 9, y: 8, upgradeTo: 4, awakening: 'A' },
    ],
  },
  // S16 中臣房子（正面からの単体を半減）。範囲で崩す。ここから衣装も前提に入る
  S16: {
    party: ['V1', 'V4', 'V3', 'Vi3', 'D3'],
    center: 'V1',
    investment: 'full',
    placements: [
      { idolId: 'V1', x: 9, y: 2, upgradeTo: 6, awakening: 'A' },
      { idolId: 'V1', x: 9, y: 6, upgradeTo: 6, awakening: 'A' },
      { idolId: 'V4', x: 11, y: 2, upgradeTo: 6, awakening: 'A' },
      { idolId: 'V4', x: 11, y: 6, upgradeTo: 6, awakening: 'A' },
      { idolId: 'V3', x: 13, y: 2, upgradeTo: 6, awakening: 'A' },
      { idolId: 'V3', x: 13, y: 6, upgradeTo: 6, awakening: 'A' },
      { idolId: 'Vi3', x: 5, y: 3, upgradeTo: 4, awakening: 'B' },
      { idolId: 'Vi3', x: 5, y: 5, upgradeTo: 4, awakening: 'B' },
      { idolId: 'D3', x: 2, y: 2, upgradeTo: 4, awakening: 'A' },
      { idolId: 'D3', x: 2, y: 6, upgradeTo: 4, awakening: 'A' },
    ],
  },
  // S17 不死の薬（一度だけ蘇る）。回廊なので置ける場所が少なく、
  // **中央の列に火力を集めて削り続ける**しかない
  S17: {
    party: ['V1', 'V3', 'Vi3', 'D3', 'Vi4'],
    center: 'V1',
    investment: 'full',
    placements: [
      { idolId: 'V1', x: 6, y: 4, upgradeTo: 6, awakening: 'A' },
      { idolId: 'V1', x: 9, y: 4, upgradeTo: 6, awakening: 'A' },
      { idolId: 'V3', x: 12, y: 4, upgradeTo: 6, awakening: 'A' },
      { idolId: 'V3', x: 3, y: 4, upgradeTo: 6, awakening: 'A' },
      { idolId: 'D3', x: 7, y: 1, upgradeTo: 6, awakening: 'A' },
      { idolId: 'D3', x: 7, y: 7, upgradeTo: 6, awakening: 'A' },
      { idolId: 'Vi3', x: 11, y: 1, upgradeTo: 4, awakening: 'B' },
      { idolId: 'Vi3', x: 11, y: 7, upgradeTo: 4, awakening: 'B' },
      { idolId: 'Vi4', x: 3, y: 1, upgradeTo: 4, awakening: 'B' },
      { idolId: 'Vi4', x: 3, y: 7, upgradeTo: 4, awakening: 'B' },
    ],
  },
  // S18 天人（飛行 + 回復）。4 レーンなので**列をまたぐ位置**（y=2/4/6）に置く。
  // 1 マスの差で 2 レーンに届くかどうかが変わる
  S18: {
    party: ['V1', 'V2', 'V3', 'Vi1', 'Vi3'],
    center: 'V1',
    investment: 'full',
    placements: [
      { idolId: 'V1', x: 6, y: 2, upgradeTo: 6, awakening: 'A' },
      { idolId: 'V1', x: 6, y: 6, upgradeTo: 6, awakening: 'A' },
      { idolId: 'V2', x: 10, y: 2, upgradeTo: 6, awakening: 'A' },
      { idolId: 'V2', x: 10, y: 6, upgradeTo: 6, awakening: 'A' },
      { idolId: 'V3', x: 6, y: 4, upgradeTo: 6, awakening: 'A' },
      { idolId: 'V3', x: 10, y: 4, upgradeTo: 6, awakening: 'A' },
      { idolId: 'Vi3', x: 13, y: 2, upgradeTo: 4, awakening: 'B' },
      { idolId: 'Vi3', x: 13, y: 6, upgradeTo: 4, awakening: 'B' },
      { idolId: 'Vi1', x: 2, y: 2, upgradeTo: 4, awakening: 'B' },
      { idolId: 'Vi1', x: 2, y: 6, upgradeTo: 4, awakening: 'B' },
    ],
  },
  // S19 飛ぶ車（DEF 150 + 攻撃速度デバフ）。**DEF 無視**を前へ、デバフ圏外へ火力を置く
  S19: {
    party: ['V1', 'V3', 'V4', 'Vi3', 'D3'],
    center: 'V1',
    investment: 'full',
    placements: [
      { idolId: 'V3', x: 8, y: 3, upgradeTo: 6, awakening: 'A' },
      { idolId: 'V3', x: 8, y: 5, upgradeTo: 6, awakening: 'A' },
      { idolId: 'V1', x: 11, y: 3, upgradeTo: 6, awakening: 'A' },
      { idolId: 'V1', x: 11, y: 5, upgradeTo: 6, awakening: 'A' },
      { idolId: 'V4', x: 5, y: 3, upgradeTo: 6, awakening: 'A' },
      { idolId: 'V4', x: 5, y: 5, upgradeTo: 6, awakening: 'A' },
      { idolId: 'Vi3', x: 13, y: 3, upgradeTo: 4, awakening: 'B' },
      { idolId: 'Vi3', x: 13, y: 5, upgradeTo: 4, awakening: 'B' },
      { idolId: 'D3', x: 2, y: 3, upgradeTo: 4, awakening: 'A' },
      { idolId: 'D3', x: 2, y: 5, upgradeTo: 4, awakening: 'A' },
    ],
  },
  // S20 総合。4 レーン + 射程 -10% + 声援 -15%。これまでの答えを全部並べる
  S20: {
    party: ['V1', 'V3', 'V4', 'Vi3', 'Vi4'],
    center: 'V1',
    investment: 'full',
    placements: [
      { idolId: 'V1', x: 6, y: 2, upgradeTo: 6, awakening: 'A' },
      { idolId: 'V1', x: 6, y: 6, upgradeTo: 6, awakening: 'A' },
      { idolId: 'V3', x: 10, y: 2, upgradeTo: 6, awakening: 'A' },
      { idolId: 'V3', x: 10, y: 6, upgradeTo: 6, awakening: 'A' },
      { idolId: 'V4', x: 6, y: 4, upgradeTo: 6, awakening: 'A' },
      { idolId: 'V4', x: 10, y: 4, upgradeTo: 6, awakening: 'A' },
      { idolId: 'Vi3', x: 13, y: 2, upgradeTo: 4, awakening: 'B' },
      { idolId: 'Vi3', x: 13, y: 6, upgradeTo: 4, awakening: 'B' },
      { idolId: 'Vi4', x: 2, y: 2, upgradeTo: 4, awakening: 'B' },
      { idolId: 'Vi4', x: 2, y: 6, upgradeTo: 4, awakening: 'B' },
    ],
  },
  // B3 月の王。属性が一周し、レーンが沈黙し、一度だけ蘇る。
  // **3 系統を混ぜて 4 レーンへ散らす**のが答え
  B3: {
    party: ['V1', 'V3', 'V4', 'Vi3', 'D3'],
    center: 'V1',
    investment: 'full',
    placements: [
      { idolId: 'V1', x: 6, y: 2, upgradeTo: 6, awakening: 'A' },
      { idolId: 'V1', x: 6, y: 6, upgradeTo: 6, awakening: 'A' },
      { idolId: 'V3', x: 10, y: 2, upgradeTo: 6, awakening: 'A' },
      { idolId: 'V3', x: 10, y: 6, upgradeTo: 6, awakening: 'A' },
      { idolId: 'D3', x: 6, y: 4, upgradeTo: 6, awakening: 'A' },
      { idolId: 'D3', x: 10, y: 4, upgradeTo: 6, awakening: 'A' },
      { idolId: 'V4', x: 13, y: 2, upgradeTo: 4, awakening: 'A' },
      { idolId: 'V4', x: 13, y: 6, upgradeTo: 4, awakening: 'A' },
      { idolId: 'Vi3', x: 2, y: 2, upgradeTo: 4, awakening: 'B' },
      { idolId: 'Vi3', x: 2, y: 6, upgradeTo: 4, awakening: 'B' },
    ],
  },
};

export const PLAN_STAGES = Object.keys(STAGE_PLANS);

/** 最初の 3 枚だけを置く「最低限」プラン */
export function minimalPlan(stageId: string): Placement[] {
  return (STAGE_PLANS[stageId]?.placements ?? [])
    .slice(0, 3)
    .map(({ idolId, x, y }) => ({ idolId, x, y }));
}
