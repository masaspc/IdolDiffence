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
  /**
   * この効果を付けたアイドル ID。いまは echo の貢献度集計だけが使う。
   *
   * echo は複数人で重なるが、毎秒ダメージは**最も強い 1 人のぶん**で計算する
   * （`applyStatus` 参照）ので、その 1 人に全額を付ける。スタックの出どころを
   * 人数ぶん覚えて按分するほどの差は出ないし、敵 1 体ごとに表を持つのは重い
   */
  sourceId?: string;
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
  /**
   * 残りの蘇生回数（`traits.revive`）。
   *
   * 定義側ではなく**個体**に持つ。定義を書き換えると、同じ敵が 2 体目から
   * 蘇らなくなる（定義は全個体で共有している）
   */
  revivesLeft: number;
  /** 残りのバリア量（`traits.barrier`）。HP とは別枠 */
  barrier: number;
  /** 最後にバリアを削られてからの経過。満タンへ戻すまでの猶予を数える */
  barrierIdleMs: number;
}

/** バリアの最大値。個体の最大 HP から決まる */
export function maxBarrier(enemy: Enemy): number {
  const barrier = enemy.traits.barrier;
  return barrier ? enemy.maxHp * barrier.ratio : 0;
}

/**
 * バリアの回復。**削るのをやめると満タンへ戻る**。
 * 少しずつ削る盤面を罰し、「一点に集めて一気に割る」を答えにする
 */
export function tickBarrier(enemy: Enemy, dtMs: number): void {
  const barrier = enemy.traits.barrier;
  if (!barrier) return;
  const max = maxBarrier(enemy);
  if (enemy.barrier >= max) return;
  enemy.barrierIdleMs += dtMs;
  if (enemy.barrierIdleMs >= barrier.regenAfterMs) enemy.barrier = max;
}

/**
 * バリアで受け止める。
 *
 * 猶予は**当たっているあいだ**進まない —— 割り切ったあとも同じ。
 * 「バリアを削っているあいだだけ」にすると、割ってから HP を殴り続けている最中に
 * 盾が丸ごと戻ってきて、「集めて一気に割ってから削り切る」という答えが成立しない。
 *
 * @returns HP へ通すぶんのダメージ
 */
export function absorbByBarrier(enemy: Enemy, amount: number): number {
  if (!enemy.traits.barrier) return amount;
  enemy.barrierIdleMs = 0;
  if (enemy.barrier <= 0) return amount;
  const absorbed = Math.min(enemy.barrier, amount);
  enemy.barrier -= absorbed;
  return amount - absorbed;
}

/**
 * 手負いになると速くなる（`traits.enrage`）。石上麻呂。
 * @returns 移動速度に掛ける倍率
 */
export function enrageFactor(enemy: Enemy): number {
  const enrage = enemy.traits.enrage;
  if (!enrage) return 1;
  return enemy.hp / enemy.maxHp <= enrage.at ? enrage.speedMul : 1;
}

/**
 * 特定系統への耐性（`traits.typeGuard`）。阿倍御主人「火鼠の裘」。
 * @returns 直接攻撃のダメージに掛ける倍率
 */
export function typeGuardFactor(enemy: Enemy, type: IdolType): number {
  const guard = enemy.traits.typeGuard;
  if (!guard || guard.type !== type) return 1;
  return 1 - guard.reduction;
}

/**
 * 守り手による軽減（`traits.link`）。
 *
 * 守り手が**生きていて範囲内にいる**あいだだけ成立する。
 * 守り手を先に落とせば軽減は消えるので、これは「順番を変えろ」という問いになる。
 *
 * @returns 直接攻撃のダメージに掛ける倍率
 */
export function linkFactor(enemy: Enemy, enemies: readonly Enemy[]): number {
  const link = enemy.traits.link;
  if (!link) return 1;
  const r2 = link.radius * link.radius;
  for (const other of enemies) {
    if (other === enemy || !other.alive || other.defId !== link.guardian) continue;
    const dx = other.pos.x - enemy.pos.x;
    const dy = other.pos.y - enemy.pos.y;
    if (dx * dx + dy * dy <= r2) return 1 - link.reduction;
  }
  return 1;
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
  /** 3 すくみを無視して常に有利。隠しキャラ MASA だけが持つ */
  alwaysEffective: boolean;
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
  /**
   * バリアに吸われたぶん（`traits.barrier`）。HP には通っていない。
   *
   * 通っていない数字を素の色で出すと「削れているのに減らない」に見え、
   * かといって 0 とだけ出すと**盾があと少しなのか戻ったばかりなのか**が分からない。
   * 別枠にして、削れていること自体は見せる
   */
  absorbed?: boolean;
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

/**
 * 状態異常の耐性（02-core-battle.md 2.8）。効果時間に `1 - resist` を掛ける。
 * 定義の無い種類は 0（そのまま通る）。
 */
export function statusResist(enemy: Enemy, kind: StatusKind): number {
  const resist = enemy.traits.resist;
  if (!resist) return 0;
  if (kind === 'stun') return resist.stun;
  if (kind === 'charm') return resist.charm;
  if (kind === 'slow') return resist.slow;
  return 0;
}

export function applyStatus(
  enemy: Enemy,
  incoming: StatusEffect,
  echoMaxStacks = ECHO_MAX_STACKS,
): void {
  // 耐性は**付ける瞬間に効果時間へ畳む**。判定側で毎フレーム割るのではなく
  // ここで一度だけ縮めるので、上書き規則（強い方・長い方）が耐性後の値で働く
  const resist = statusResist(enemy, incoming.kind);
  if (resist >= 1) return;
  if (resist > 0) incoming = { ...incoming, remainingMs: incoming.remainingMs * (1 - resist) };

  const existing = enemy.statuses.find((s) => s.kind === incoming.kind);
  if (!existing) {
    enemy.statuses.push({ ...incoming, accumulator: 0 });
    return;
  }

  if (incoming.kind === 'echo') {
    // Echo はスタックする。上限までは重ねられ、時間は最新で更新
    existing.stacks = Math.min(echoMaxStacks, (existing.stacks ?? 1) + (incoming.stacks ?? 1));
    // 毎秒ダメージを更新したときは**貢献者も一緒に**更新する。
    // 片方だけ動かすと、他人の火力が別人の貢献度に積まれる
    if ((incoming.dps ?? 0) > (existing.dps ?? 0)) {
      existing.dps = incoming.dps ?? 0;
      if (incoming.sourceId === undefined) delete existing.sourceId;
      else existing.sourceId = incoming.sourceId;
    }
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
