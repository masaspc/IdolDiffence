/**
 * ユニットのステータス解決。
 *
 * 育成（メタ）→ センター → ポジション強化 → 覚醒分岐 → ラン内カード → スペシャル
 * の順に合流させる。
 * **毎フレームは計算しない**。強化・カード・スペシャル・配置の変化時にだけ呼ぶ
 * （docs/design/05-architecture.md 5.3）。
 */
import { getIdol } from '../data';
import type { AwakeningKey, CenterPassive } from '../data/schema/idol';
import { addPct, emptyPool, mulPct, resolveStat, type ModifierPool } from './modifiers';
import type { ResolvedAttack, ResolvedAura, Unit } from './entities';
import type { CellType, IdolType } from '../data/schema/common';

/** ポジション強化の倍率（03-progression.md ①） */
export const POSITION_LEVELS = [
  { atk: 1.0, range: 1.0, speed: 1.0 },
  { atk: 1.45, range: 1.1, speed: 1.05 },
  { atk: 2.1, range: 1.2, speed: 1.12 },
] as const;

/** Lv+1 にかかる声援。配置コストに対する倍率 */
export const UPGRADE_COST_RATIO = [0.8, 1.6] as const;

/**
 * 配置マスの種別ボーナス（02-core-battle.md 2.1）。
 * 「どこに置くか」を射程だけの問題にしないための味付け。
 */
export function applyCellBonus(
  pool: ModifierPool,
  cellType: CellType | undefined,
  type: IdolType,
): void {
  switch (cellType) {
    case 'runway': // 花道: 射程が伸びる
      mulPct(pool, 'range', 1.15);
      break;
    case 'audience': // 客席サイド: 声援は稼げるが火力は落ちる
      mulPct(pool, 'atk', 0.9);
      mulPct(pool, 'cheerGain', 1.2);
      break;
    // モニター前: **ヴィジュアル系スキルの効果時間 +25%**。
    // 「効果量」ではなく「時間」で、対象はヴィジュアルだけ。
    // 全系統の減速量を伸ばす作りにすると、妨害が本業でない系統を
    // モニター前へ置くのが常に得になり、マスの性格が消える
    case 'monitor':
      if (type === 'visual') mulPct(pool, 'statusDuration', 1.25);
      break;
    default: // 本舞台
      mulPct(pool, 'atk', 1.1);
      break;
  }
}

/**
 * センターパッシブのうち、**ユニットごとに効くもの**を乗算プールへ積む
 * （03-progression.md ⑤）。全体に掛かるので、加算プールに入れると
 * カードとの二重供給になる。
 *
 * 声援獲得と月華の蓄積は**ユニットのステータスではなく経済**なので、
 * ここには入れない。ここへ入れると各ユニットのローカルプールに積まれるだけで、
 * `BattleWorld` の経済計算（`runPool` しか見ない）には一切届かない。
 * それらは `centerEconomyPool()` が別に返す。
 */
export function applyCenterPassive(pool: ModifierPool, center: CenterPassive | undefined): void {
  const mods = center?.mods;
  if (!mods) return;
  if (mods.atkMul !== undefined) mulPct(pool, 'atk', mods.atkMul);
  if (mods.attackSpeedMul !== undefined) mulPct(pool, 'attackSpeed', mods.attackSpeedMul);
  if (mods.rangeMul !== undefined) mulPct(pool, 'range', mods.rangeMul);
  if (mods.slowPowerMul !== undefined) mulPct(pool, 'slowPower', mods.slowPowerMul);
  if (mods.critRateAdd !== undefined) addPct(pool, 'critRate', mods.critRateAdd);
}

/**
 * センターパッシブのうち、**盤面全体の経済に効くもの**だけを集めたプール。
 * `BattleWorld` が声援の自然回復と月華の蓄積を解決するときに合流させる。
 */
export function centerEconomyPool(center: CenterPassive | undefined): ModifierPool {
  const pool = emptyPool();
  const mods = center?.mods;
  if (!mods) return pool;
  if (mods.cheerGainMul !== undefined) mulPct(pool, 'cheerGain', mods.cheerGainMul);
  if (mods.voltageGainMul !== undefined) mulPct(pool, 'voltageGain', mods.voltageGainMul);
  return pool;
}

/** スペシャルライブ中の補正（02-core-battle.md 2.3） */
export const SPECIAL_ATK_MUL = 1.3;
export const SPECIAL_SPEED_MUL = 1.5;
/** スペシャル中は敵も減速する */
export const SPECIAL_ENEMY_SPEED_MUL = 0.7;

export function upgradeCost(baseCost: number, currentLevel: 1 | 2 | 3): number | null {
  const ratio = UPGRADE_COST_RATIO[currentLevel - 1];
  return ratio === undefined ? null : Math.round(baseCost * ratio);
}

export interface ResolveOptions {
  /** ラン内カードなど、全ユニット共通の強化 */
  runPool: ModifierPool;
  /** センター（編成で 1 人）と配置マスの種別 */
  center?: CenterPassive | undefined;
  cellType?: CellType | undefined;
  specialActive: boolean;
  /** 味方オーラ（V2「かさね」など）による ATK 加算の合計 */
  allyAtkPct?: number;
}

/**
 * ユニットの実効ステータスを解決して書き戻す。
 */
export function resolveUnit(unit: Unit, options: ResolveOptions): void {
  const def = getIdol(unit.idolId);
  const position = POSITION_LEVELS[unit.level - 1] ?? POSITION_LEVELS[0];
  const branch = unit.awakening ? def.awakening?.[unit.awakening] : undefined;

  // ポジション強化・覚醒・スペシャル・マスの種別・センターは乗算プールへ
  // （枠が有限なので暴走しにくい）
  const local = emptyPool();
  applyCellBonus(local, options.cellType, unit.type);
  applyCenterPassive(local, options.center);
  mulPct(local, 'atk', position.atk);
  mulPct(local, 'range', position.range);
  mulPct(local, 'attackSpeed', position.speed);
  if (options.specialActive) {
    mulPct(local, 'atk', SPECIAL_ATK_MUL);
    mulPct(local, 'attackSpeed', SPECIAL_SPEED_MUL);
  }

  // 味方オーラは「同じ器に足し込む」加算側。近くに何人いても線形に伸びる
  const allyAtk = options.allyAtkPct ?? 0;
  const selfAtk = branch?.mods.auraToSelfAtk ?? 0;
  if (allyAtk + selfAtk !== 0) addPct(local, 'atk', allyAtk + selfAtk);

  const pools = [options.runPool, local];

  unit.atk = resolveStat(unit.baseAtk, 'atk', pools, unit.type);
  unit.range = resolveStat(def.base.range, 'range', pools);
  unit.critRate = Math.min(
    1,
    resolveStat(def.base.critRate, 'critRate', pools) + (branch?.mods.critRateAdd ?? 0),
  );
  unit.critDmg = resolveStat(def.base.critDmg, 'critDmg', pools);

  // 攻撃速度は「間隔」の逆数として効かせる
  const speed = resolveStat(1, 'attackSpeed', pools);
  const intervalMul = branch?.mods.attackIntervalMul ?? 1;
  unit.attackIntervalMs = (def.base.attackIntervalMs * intervalMul) / speed;

  unit.attack = resolveAttack(unit, branch ? unit.awakening : null, options.runPool, local);
  unit.aura = resolveUnitAura(unit);
}

function resolveAttack(
  unit: Unit,
  awakening: AwakeningKey | null,
  runPool: ModifierPool,
  local: ModifierPool,
): ResolvedAttack {
  const def = getIdol(unit.idolId);
  const branch = awakening ? def.awakening?.[awakening] : undefined;
  const mods = branch?.mods;

  let kind = def.attack.kind;
  let radius = def.attack.radius;
  if (mods?.toAoe) {
    kind = 'aoe_ring';
    radius = mods.toAoe;
  }
  if (mods?.radiusMul) radius *= mods.radiusMul;

  // 減速の効果量はカードでも伸びる。継続時間はモニター前のマスで伸びる
  const slowPower = resolveStat(1, 'slowPower', [runPool, local]);
  const durationMul = resolveStat(1, 'statusDuration', [runPool, local]);
  const baseOnHit = branch?.onHit ?? def.attack.onHit;
  const onHit = baseOnHit.map((entry) => ({
    ...entry,
    value: entry.status === 'slow' ? (mods?.slowValue ?? entry.value) * slowPower : entry.value,
    durationMs: entry.durationMs * durationMul,
  }));

  const knockback = branch?.knockback ?? def.attack.knockback;

  return {
    kind,
    radius,
    canHitFlying: def.attack.canHitFlying || (mods?.grantFlying ?? false),
    skillMul: def.attack.skillMul,
    multiTarget: mods?.multiTarget ?? 1,
    defIgnore: Math.min(1, def.attack.defIgnore + (mods?.defIgnoreAdd ?? 0)),
    execute: def.attack.execute,
    knockback,
    resetCooldownOnKill: mods?.resetCooldownOnKill ?? false,
    onHit,
  };
}

/**
 * オーラだけを解決する。
 *
 * オーラは「定義 + 覚醒」だけで決まり、受け手のステータスには依存しない。
 * ステータス解決より**先に**全員ぶんを確定させておくことで、
 * 「まだ解決していない味方のオーラを取りこぼす」順序依存を防ぐ。
 */
export function resolveUnitAura(unit: Unit): ResolvedAura | null {
  const def = getIdol(unit.idolId);
  if (!def.aura) return null;

  const awakening: AwakeningKey | null = unit.awakening;
  const mods = awakening ? def.awakening?.[awakening]?.mods : undefined;
  // 「独唱」はオーラを捨てて自身の ATK に変える。捨てた側が残っていると二度取りになる
  if (mods?.auraToSelfAtk !== undefined) return null;

  const radiusMul = mods?.auraRadiusMul ?? 1;
  const powerMul = mods?.auraPowerMul ?? 1;
  return {
    radius: def.aura.radius * radiusMul,
    allyAtkPct: def.aura.allyAtkPct * powerMul,
    enemyDefPct: Math.min(0.9, def.aura.enemyDefPct * powerMul),
  };
}
