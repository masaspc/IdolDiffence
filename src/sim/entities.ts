import type { Vec2 } from '../core/vec';
import type { Attribute, IdolType } from '../data/schema/common';
import type { AttackDef, AwakeningKey, Execute, Knockback, OnHit } from '../data/schema/idol';
import type { EnemyTraits } from '../data/schema/enemy';
import type { Effectiveness } from './damage';

export type EntityId = number;

/**
 * 状態異常の種別。
 * - slow: 移動速度低下。最大値のみ適用（重複しない）
 * - echo: 独立にスタックし、毎秒ダメージ（02-core-battle.md 2.8）
 * - charm / stun: 移動を止める。効果は同じで、由来と表示が違う
 *   （魅了 = Vi2「まどわし」／スタン = V3 覚醒「子守唄」）
 * - vulnerable: 被ダメージ増加
 */
export type StatusKind = 'slow' | 'echo' | 'charm' | 'stun' | 'vulnerable';

export interface StatusEffect {
  kind: StatusKind;
  value: number;
  remainingMs: number;
  /** echo のスタック数 */
  stacks?: number;
  /** echo の 1 スタックあたりの毎秒ダメージ */
  dps?: number;
  /** echo の端数ダメージ持ち越し */
  accumulator?: number;
}

/** Echo の最大スタック。才能ボードのキーストーン「無限旋律」で 8 まで伸びる */
export const ECHO_MAX_STACKS = 5;

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
  traits: EnemyTraits;

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

/** 攻撃の実効パラメータ。覚醒とカードを反映した後の姿 */
export interface ResolvedAttack {
  kind: AttackDef['kind'];
  radius: number;
  canHitFlying: boolean;
  skillMul: number;
  /** 単体攻撃が同時に狙える数。覚醒 A「乱舞」で増える */
  multiTarget: number;
  /** 防御無視（0..1） */
  defIgnore: number;
  /**
   * 前面シールドの貫通（0..1）。1 でシールドを完全に無視する。
   * 衣装セット「仏の御石の鉢」4 着でのみ得られる（03-progression.md ⑨）
   */
  shieldPierce: number;
  execute: Execute | undefined;
  knockback: Knockback | undefined;
  /** 撃破時に攻撃間隔を即座に空ける。D3 覚醒「追撃」 */
  resetCooldownOnKill: boolean;
  onHit: readonly OnHit[];
}

/** 配置している限り効き続けるオーラ。解決済みの実効値 */
export interface ResolvedAura {
  radius: number;
  allyAtkPct: number;
  enemyDefPct: number;
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
  /** 累計投入コスト。売却額の算出に使う */
  investedCost: number;
  /** ポジション強化のレベル 1〜6 */
  level: number;
  /** Lv3 で選んだ覚醒分岐。未選択なら null */
  awakening: AwakeningKey | null;
  /** Lv6 で自動的に付く、選ばなかった方の分岐 */
  awakeningSecond: AwakeningKey | null;
  /**
   * 進化（Ray）を解放済みか。ホームで恒久解放するものなので、ラン中は変わらない。
   * ポジション強化と違って**配置した瞬間から**乗る
   */
  evolved: boolean;

  /** 育成（メタ）を反映した基礎攻撃力。ラン中は変わらない */
  baseAtk: number;

  // --- 解決後のステータス。強化・カードの変化時のみ再計算する ---
  atk: number;
  range: number;
  attackIntervalMs: number;
  critRate: number;
  critDmg: number;
  attack: ResolvedAttack;
  aura: ResolvedAura | null;
  /**
   * 沈黙の残り時間（ミリ秒）。0 より大きいあいだは攻撃できない。
   * 最終ボス「強制ログアウト」がレーンごとに掛ける
   */
  silencedMs: number;
  /**
   * このユニットが付ける Echo の毎秒ダメージ（1 スタックあたり）。
   *
   * **付けた本人の強化で決まる。** world がひとつの値を配ると、
   * 才能はともかく衣装（着ている人ごとに違う）を反映できない。
   * 付与時に状態へ焼き付けるので、あとから着替えても既に付いた Echo は変わらない
   */
  echoDps: number;

  cooldownMs: number;
  /** ノックバックの発動間隔を数えるための命中カウンタ */
  hitCount: number;
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

/** 魅了・スタン中は移動しない */
export function isImmobilized(statuses: readonly StatusEffect[]): boolean {
  return statuses.some((s) => s.kind === 'charm' || s.kind === 'stun');
}

export function isCharmed(statuses: readonly StatusEffect[]): boolean {
  return statuses.some((s) => s.kind === 'charm');
}

/** 被ダメージ増加。最大値のみ適用 */
export function vulnerability(statuses: readonly StatusEffect[]): number {
  let max = 0;
  for (const status of statuses) {
    if (status.kind === 'vulnerable' && status.value > max) max = status.value;
  }
  return max;
}

export function applyStatus(
  enemy: Enemy,
  incoming: StatusEffect,
  echoMaxStacks = ECHO_MAX_STACKS,
): void {
  const existing = enemy.statuses.find((s) => s.kind === incoming.kind);
  if (!existing) {
    enemy.statuses.push({ ...incoming, accumulator: 0 });
    return;
  }

  if (incoming.kind === 'echo') {
    // Echo はスタックする。上限までは重ねられ、時間は最新で更新
    existing.stacks = Math.min(echoMaxStacks, (existing.stacks ?? 1) + (incoming.stacks ?? 1));
    existing.dps = Math.max(existing.dps ?? 0, incoming.dps ?? 0);
    existing.remainingMs = Math.max(existing.remainingMs, incoming.remainingMs);
    return;
  }

  // それ以外は強い方を採用し、時間は長い方に更新する
  if (incoming.value > existing.value) existing.value = incoming.value;
  if (incoming.remainingMs > existing.remainingMs) existing.remainingMs = incoming.remainingMs;
}

/**
 * 状態異常の時間経過。
 * @returns Echo による今フレームの累計ダメージ
 */
export function tickStatuses(enemy: Enemy, dtMs: number): number {
  if (enemy.statuses.length === 0) return 0;

  let echoDamage = 0;
  for (let i = enemy.statuses.length - 1; i >= 0; i--) {
    const status = enemy.statuses[i];
    if (!status) continue;

    if (status.kind === 'echo') {
      const perMs = ((status.dps ?? 0) * (status.stacks ?? 1)) / 1000;
      echoDamage += perMs * Math.min(dtMs, Math.max(0, status.remainingMs));
    }

    status.remainingMs -= dtMs;
    if (status.remainingMs <= 0) enemy.statuses.splice(i, 1);
  }
  return echoDamage;
}

export function echoStacks(statuses: readonly StatusEffect[]): number {
  return statuses.find((s) => s.kind === 'echo')?.stacks ?? 0;
}
