import type { Vec2 } from '../core/vec';
import type { Attribute, IdolType } from '../data/schema/common';
import type { AttackDef } from '../data/schema/idol';
import type { Effectiveness } from './damage';

export type EntityId = number;

/** 状態異常。M1 は減速のみ。値は最大のものが適用される */
export interface StatusEffect {
  kind: 'slow';
  value: number;
  remainingMs: number;
}

export interface Enemy {
  id: EntityId;
  defId: string;
  name: string;
  attr: Attribute;
  hp: number;
  maxHp: number;
  def: number;
  baseSpeed: number;
  flying: boolean;
  radius: number;
  leak: number;
  bounty: number;

  lane: number;
  /** 現在のウェイポイント区間 */
  pathIndex: number;
  /** 区間内の進捗 0..1 */
  pathT: number;
  /** 経路全体の進捗（マス単位の累積距離）。ターゲティングの「先頭」判定に使う */
  progress: number;
  /** 描画用のセル座標 */
  pos: Vec2;
  /** 補間描画用の前フレーム座標 */
  prevPos: Vec2;

  statuses: StatusEffect[];
  alive: boolean;
}

export interface Unit {
  id: EntityId;
  idolId: string;
  name: string;
  shortName: string;
  type: IdolType;
  cell: { x: number; y: number };
  /** セル中心のワールド座標 */
  pos: Vec2;
  cost: number;
  atk: number;
  range: number;
  attackIntervalMs: number;
  critRate: number;
  critDmg: number;
  attack: AttackDef;
  cooldownMs: number;
  /** 直近の攻撃対象。描画のためだけに保持する */
  lastTargetPos: Vec2 | null;
  lastAttackAgeMs: number;
}

/** ダメージ表示・攻撃演出。決定的に生成されるので sim に置いてよい */
export interface FloatingText {
  x: number;
  y: number;
  amount: number;
  crit: boolean;
  effectiveness: Effectiveness;
  ageMs: number;
  lifeMs: number;
}

/** 減速は最大値のみ適用（重複しない） */
export function slowFactor(statuses: readonly StatusEffect[]): number {
  let max = 0;
  for (const status of statuses) {
    if (status.kind === 'slow' && status.value > max) max = status.value;
  }
  // 減速の上限は -75%
  return 1 - Math.min(max, 0.75);
}

export function applyStatus(enemy: Enemy, incoming: StatusEffect): void {
  const existing = enemy.statuses.find((s) => s.kind === incoming.kind);
  if (!existing) {
    enemy.statuses.push({ ...incoming });
    return;
  }
  // 強い方を採用し、時間は長い方に更新する
  if (incoming.value > existing.value) existing.value = incoming.value;
  if (incoming.remainingMs > existing.remainingMs) existing.remainingMs = incoming.remainingMs;
}

export function tickStatuses(enemy: Enemy, dtMs: number): void {
  if (enemy.statuses.length === 0) return;
  for (let i = enemy.statuses.length - 1; i >= 0; i--) {
    const status = enemy.statuses[i];
    if (!status) continue;
    status.remainingMs -= dtMs;
    if (status.remainingMs <= 0) enemy.statuses.splice(i, 1);
  }
}
