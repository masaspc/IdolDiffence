/**
 * ★難度（02-core-battle.md 2.10）。
 *
 * ★は 1〜10。**HP だけに掛けない。** HP だけを膨らませると、
 * 殴り合いが間延びするだけで「何が難しくなったのか」が伝わらない。
 * HP・防御・出現密度の 3 軸に分散させる。
 *
 * ```
 * HP(★)   = base × 1.35 ^ (★-1)
 * DEF(★)  = base + 18 × (★-1)
 * 出現数(★) = base × 1.08 ^ (★-1)
 * 報酬(★)  = base × 1.15 ^ (★-1)
 * ```
 *
 * 3 つを掛け合わせた**要求戦力**は ★10 で約 60 倍。これは恒久強化を
 * すべて積んだときの到達点（03-progression.md E-2）と一致させてある。
 */
import type { IdolType } from '../data/schema/common';

export const MIN_STAR = 1;
export const MAX_STAR = 10;

/** ★7 以降で追加ルールが付く。数値インフレだけで難しくしない */
export const RULE_STAR = 7;

/**
 * ★ごとの係数。
 *
 * 設計では「★7 以降は追加ルールのぶんだけ係数を下げる」としていたが、
 * **実測したら下げる必要が無かった**。系統ペナルティは 3 系統のうち 1 つの
 * 攻撃力 -20% なので、編成全体では -7% 程度にしかならない。
 * 割引を入れると ★10 の要求戦力が 46 倍まで落ち、設計の 60 倍から外れる。
 *
 * 実測値（S5 の参照盤面、`npx tsx scripts/star-curve.ts`）:
 * ★1 = 1.0× / ★5 = 6.4× / ★7 = 16.5× / ★10 = **61.3×**
 */
export interface StarCoefficients {
  hpMul: number;
  defAdd: number;
  countMul: number;
  rewardMul: number;
}

const HP_BASE = 1.35;
const DEF_STEP = 18;
const COUNT_BASE = 1.08;
const REWARD_BASE = 1.15;

export function starCoefficients(star: number): StarCoefficients {
  const step = clampStar(star) - 1;
  return {
    hpMul: Math.pow(HP_BASE, step),
    defAdd: DEF_STEP * step,
    countMul: Math.pow(COUNT_BASE, step),
    rewardMul: Math.pow(REWARD_BASE, step),
  };
}

export function clampStar(star: number): number {
  if (!Number.isFinite(star)) return MIN_STAR;
  return Math.min(MAX_STAR, Math.max(MIN_STAR, Math.round(star)));
}

/**
 * ★7 以降の追加ルール。
 *
 * 「特定系統の攻撃力 -20%」を ★ごとに巡回させる。固定にすると
 * その系統を編成から外すだけで無効化できてしまい、ルールが判断を生まない。
 * 巡回すれば「★ごとに編成を組み替える」動機になる。
 *
 * @returns 弱くなる系統。無ければ null
 */
export function weakenedType(star: number): IdolType | null {
  const s = clampStar(star);
  if (s < RULE_STAR) return null;
  const order: IdolType[] = ['vocal', 'dance', 'visual'];
  return order[(s - RULE_STAR) % order.length] ?? null;
}

/** 追加ルールの弱体量 */
export const WEAKEN_PCT = 0.2;

/** UI 用の説明文。ルールが無ければ null */
export function starRuleText(star: number): string | null {
  const type = weakenedType(star);
  if (!type) return null;
  const label = { vocal: '歌', dance: 'ダンス', visual: 'ヴィジュアル' }[type];
  return `${label}の攻撃力 -${Math.round(WEAKEN_PCT * 100)}%`;
}
