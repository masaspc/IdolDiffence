/**
 * ユニットのステータス解決。
 *
 * 育成（メタ）→ ポジション強化 → 覚醒分岐 → ラン内カード → スペシャル の順に合流させる。
 * **毎フレームは計算しない**。強化・カード・スペシャルの変化時にだけ呼ぶ
 * （docs/design/05-architecture.md 5.3）。
 */
import { getIdol } from '../data';
import type { AwakeningKey } from '../data/schema/idol';
import { emptyPool, mulPct, resolveStat, type ModifierPool } from './modifiers';
import type { ResolvedAttack, Unit } from './entities';
import type { CellType } from '../data/schema/common';

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
export function applyCellBonus(pool: ModifierPool, cellType: CellType | undefined): void {
  switch (cellType) {
    case 'runway': // 花道: 射程が伸びる
      mulPct(pool, 'range', 1.15);
      break;
    case 'audience': // 客席サイド: 声援は稼げるが火力は落ちる
      mulPct(pool, 'atk', 0.9);
      mulPct(pool, 'cheerGain', 1.2);
      break;
    case 'monitor': // モニター前: 状態異常が濃くなる
      mulPct(pool, 'slowPower', 1.25);
      break;
    default: // 本舞台
      mulPct(pool, 'atk', 1.1);
      break;
  }
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

/**
 * ユニットの実効ステータスを解決して書き戻す。
 *
 * @param runPool ラン内カードなど、全ユニット共通の強化
 * @param specialActive スペシャルライブ発動中か
 */
export function resolveUnit(
  unit: Unit,
  runPool: ModifierPool,
  specialActive: boolean,
  cellType?: CellType,
): void {
  const def = getIdol(unit.idolId);
  const position = POSITION_LEVELS[unit.level - 1] ?? POSITION_LEVELS[0];
  const branch = unit.awakening ? def.awakening?.[unit.awakening] : undefined;

  // ポジション強化・覚醒・スペシャル・マスの種別は乗算プールへ
  // （枠が有限なので暴走しにくい）
  const local = emptyPool();
  applyCellBonus(local, cellType);
  mulPct(local, 'atk', position.atk);
  mulPct(local, 'range', position.range);
  mulPct(local, 'attackSpeed', position.speed);
  if (specialActive) {
    mulPct(local, 'atk', SPECIAL_ATK_MUL);
    mulPct(local, 'attackSpeed', SPECIAL_SPEED_MUL);
  }

  const pools = [runPool, local];

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

  unit.attack = resolveAttack(unit, branch ? unit.awakening : null, runPool, local);
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

  // 減速の効果量はカードでも伸びる
  const slowPower = resolveStat(1, 'slowPower', [runPool, local]);
  const baseOnHit = branch?.onHit ?? def.attack.onHit;
  const onHit = baseOnHit
    ? {
        ...baseOnHit,
        value:
          baseOnHit.status === 'slow'
            ? (mods?.slowValue ?? baseOnHit.value) * slowPower
            : baseOnHit.value,
      }
    : undefined;

  return {
    kind,
    radius,
    canHitFlying: def.attack.canHitFlying,
    skillMul: def.attack.skillMul,
    multiTarget: mods?.multiTarget ?? 1,
    onHit,
  };
}
