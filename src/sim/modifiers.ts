/**
 * 強化の合流点（docs/design/05-architecture.md 5.5）。
 *
 * すべての強化系統がここで最終ステータスに合流する。
 * 系統を追加するときは「どのプールに入れるか」を決めるだけでよく、
 * 計算順序の判断がコード中に散らばらないようにする。
 *
 * - **加算プール（addPct）**: 才能ボード / ラン内カード。同じ器に足し込む
 * - **乗算プール（mulPct）**: 衣装セット / 覚醒分岐 / ポジション強化 / センター。枠が有限
 * - **定数加算（flat）**: 開始時の声援など
 */
import type { IdolType } from '../data/schema/common';

export type StatKey =
  | 'atk'
  | 'range'
  | 'attackSpeed'
  | 'critRate'
  | 'critDmg'
  | 'cheerGain'
  | 'voltageGain'
  | 'slowPower'
  /** 状態異常の**継続時間**。効果量（slowPower）とは別枠 */
  | 'statusDuration'
  /** 範囲攻撃の半径 */
  | 'aoeRadius'
  /** Echo の 1 スタックあたりのダメージ */
  | 'echoPower';

/** 上限のあるステータス（03-progression.md E-3） */
const CAPS: Partial<Record<StatKey, number>> = {
  critRate: 1,
  attackSpeed: 2.5, // +150%
};

export interface ModifierPool {
  addPct: Partial<Record<StatKey, number>>;
  mulPct: Partial<Record<StatKey, number[]>>;
  flat: Partial<Record<StatKey, number>>;
  /** 系統ごとの攻撃力加算。全体バフと分けて持つ */
  typeAddPct: Partial<Record<IdolType, number>>;
}

export function emptyPool(): ModifierPool {
  return { addPct: {}, mulPct: {}, flat: {}, typeAddPct: {} };
}

export function addPct(pool: ModifierPool, key: StatKey, value: number): void {
  pool.addPct[key] = (pool.addPct[key] ?? 0) + value;
}

export function addTypePct(pool: ModifierPool, type: IdolType, value: number): void {
  pool.typeAddPct[type] = (pool.typeAddPct[type] ?? 0) + value;
}

export function mulPct(pool: ModifierPool, key: StatKey, value: number): void {
  (pool.mulPct[key] ??= []).push(value);
}

export function addFlat(pool: ModifierPool, key: StatKey, value: number): void {
  pool.flat[key] = (pool.flat[key] ?? 0) + value;
}

/**
 * base に対して全プールを合成する。
 *
 * 1. flat を加算
 * 2. addPct を合算して (1 + Σ) を掛ける
 * 3. mulPct を順に掛ける
 * 4. 上限でクランプ
 */
export function resolveStat(
  base: number,
  key: StatKey,
  pools: readonly ModifierPool[],
  type?: IdolType,
): number {
  let value = base;

  for (const pool of pools) {
    value += pool.flat[key] ?? 0;
  }

  let additive = 0;
  for (const pool of pools) {
    additive += pool.addPct[key] ?? 0;
    if (key === 'atk' && type) additive += pool.typeAddPct[type] ?? 0;
  }
  value *= 1 + additive;

  for (const pool of pools) {
    for (const factor of pool.mulPct[key] ?? []) value *= factor;
  }

  const cap = CAPS[key];
  return cap !== undefined ? Math.min(value, cap) : value;
}
