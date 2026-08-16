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

export interface StagePlan {
  /** 出撃メンバー。そのステージに挑む時点で解放されている 5 人を想定する */
  party: string[];
  center: string;
  placements: Placement[];
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
};

export const PLAN_STAGES = Object.keys(STAGE_PLANS);

/** 最初の 3 枚だけを置く「最低限」プラン */
export function minimalPlan(stageId: string): Placement[] {
  return (STAGE_PLANS[stageId]?.placements ?? [])
    .slice(0, 3)
    .map(({ idolId, x, y }) => ({ idolId, x, y }));
}
