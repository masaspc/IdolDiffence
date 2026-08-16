/**
 * ユニットのステータス解決。
 *
 * 育成（メタ）→ センター → ポジション強化 → 覚醒分岐 → ラン内カード → スペシャル
 * の順に合流させる。
 * **毎フレームは計算しない**。強化・カード・スペシャル・配置の変化時にだけ呼ぶ
 * （docs/design/05-architecture.md 5.3）。
 */
import { getIdol } from '../data';
import type {
  AwakeningBranch,
  AwakeningKey,
  CenterPassive,
  Knockback,
  OnHit,
} from '../data/schema/idol';
import { addPct, emptyPool, mulPct, resolveStat, type ModifierPool } from './modifiers';
import type { ResolvedAttack, ResolvedAura, Unit } from './entities';
import type { CellType, IdolType } from '../data/schema/common';

/**
 * ポジション強化の倍率（03-progression.md ①）。
 *
 * Lv3 で打ち止めにしていたが、終盤は声援が数千単位で余っていた
 * （実測でフル強化後に 2000〜6000）。使い道が無い資源は判断を消すだけなので、
 * **6 段階**まで伸ばして受け皿にする。
 * Lv4 以降はコストの伸びを大きくして、「1 人を極めるか、頭数を増やすか」を選ばせる。
 */
export const POSITION_LEVELS = [
  { atk: 1.0, range: 1.0, speed: 1.0 },
  { atk: 1.45, range: 1.1, speed: 1.05 },
  { atk: 2.1, range: 1.2, speed: 1.12 },
  { atk: 2.85, range: 1.26, speed: 1.18 },
  { atk: 3.7, range: 1.32, speed: 1.24 },
  { atk: 4.7, range: 1.4, speed: 1.32 },
] as const;

export const MAX_POSITION_LEVEL = POSITION_LEVELS.length;
/** 覚醒分岐を選ぶレベル */
export const AWAKENING_LEVEL = 3;

/**
 * Lv+1 にかかる声援。配置コストに対する倍率。
 * 累計は Lv6 で配置コストの 17 倍。かぐや（30）なら 510 声援かかる
 */
export const UPGRADE_COST_RATIO = [0.8, 1.6, 2.8, 4.4, 6.4] as const;

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

export function upgradeCost(baseCost: number, currentLevel: number): number | null {
  const ratio = UPGRADE_COST_RATIO[currentLevel - 1];
  return ratio === undefined ? null : Math.round(baseCost * ratio);
}

/**
 * 衣装のセット効果のうち、`ModifierPool` の語彙に無いもの。
 * 増えるたびに `StatKey` を足すと、どの系統も使わない器が並ぶことになる。
 */
export interface CostumeCombatBonus {
  defIgnoreAdd: number;
  shieldPierce: number;
  specialDmgPct: number;
}

export interface ResolveOptions {
  /** ラン内カードなど、全ユニット共通の強化 */
  runPool: ModifierPool;
  /** 才能ボード（恒久）。加算プールとして runPool と同列に合流させる */
  talentPool?: ModifierPool;
  /** 衣装（このユニットが着ているぶん）。同じく加算プール */
  costumePool?: ModifierPool;
  /** 衣装のうち、ステータスの器に載らないもの（03-progression.md ⑨） */
  costume?: CostumeCombatBonus | undefined;
  /** センター（編成で 1 人）と配置マスの種別 */
  center?: CenterPassive | undefined;
  cellType?: CellType | undefined;
  specialActive: boolean;
  /** 味方オーラ（V2「かさね」など）による ATK 加算の合計 */
  allyAtkPct?: number;
  /** フォーメーションの倍率（乗算） */
  formation?: { atkMul: number; attackSpeedMul: number; rangeMul: number };
  /** 撃破の積み重ねによる攻撃速度（才能「ステップアップ」） */
  killSpeedBonus?: number;
  /** Echo 1 スタックあたりの素の毎秒ダメージ。強化前の基準値 */
  baseEchoDps: number;
}

/**
 * ユニットの実効ステータスを解決して書き戻す。
 */
export function resolveUnit(unit: Unit, options: ResolveOptions): void {
  const def = getIdol(unit.idolId);
  const position = POSITION_LEVELS[unit.level - 1] ?? POSITION_LEVELS[0];
  const branches = activeBranches(unit);

  // ポジション強化・覚醒・スペシャル・マスの種別・センターは乗算プールへ
  // （枠が有限なので暴走しにくい）
  const local = emptyPool();
  applyCellBonus(local, options.cellType, unit.type);
  applyCenterPassive(local, options.center);
  mulPct(local, 'atk', position.atk);
  mulPct(local, 'range', position.range);
  mulPct(local, 'attackSpeed', position.speed);
  // 進化（Ray）はポジション強化と同じ乗算枠。加算側へ入れると
  // カードや才能と混ざって、進化で得た伸びが見えなくなる
  const evolution = unit.evolved ? def.evolution : undefined;
  if (evolution) {
    mulPct(local, 'atk', evolution.atkMul);
    mulPct(local, 'range', evolution.rangeMul);
  }
  if (options.specialActive) {
    // 「蓬莱の玉の枝」4 着はスペシャル中だけ乗る。
    // ここへ掛けると、ダメージ計算に衣装専用の経路を足さずに済む
    mulPct(local, 'atk', SPECIAL_ATK_MUL * (1 + (options.costume?.specialDmgPct ?? 0)));
    mulPct(local, 'attackSpeed', SPECIAL_SPEED_MUL);
  }
  if (options.formation) {
    mulPct(local, 'atk', options.formation.atkMul);
    mulPct(local, 'attackSpeed', options.formation.attackSpeedMul);
    mulPct(local, 'range', options.formation.rangeMul);
  }
  if (options.killSpeedBonus) mulPct(local, 'attackSpeed', 1 + options.killSpeedBonus);

  // 味方オーラは「同じ器に足し込む」加算側。近くに何人いても線形に伸びる
  const allyAtk = options.allyAtkPct ?? 0;
  const selfAtk = sumMod(branches, 'auraToSelfAtk');
  if (allyAtk + selfAtk !== 0) addPct(local, 'atk', allyAtk + selfAtk);

  const talentPool = options.talentPool ?? emptyPool();
  const costumePool = options.costumePool ?? emptyPool();
  const pools = [options.runPool, talentPool, costumePool, local];

  unit.atk = resolveStat(unit.baseAtk, 'atk', pools, unit.type);
  unit.range = resolveStat(def.base.range, 'range', pools);
  unit.critRate = Math.min(
    1,
    resolveStat(def.base.critRate, 'critRate', pools) + sumMod(branches, 'critRateAdd'),
  );
  unit.critDmg = resolveStat(def.base.critDmg, 'critDmg', pools);

  // 攻撃速度は「間隔」の逆数として効かせる
  const speed = resolveStat(1, 'attackSpeed', pools);
  const intervalMul = mulMod(branches, 'attackIntervalMul');
  unit.attackIntervalMs = (def.base.attackIntervalMs * intervalMul) / speed;

  // Echo の威力は**付ける本人**の強化で決まる。才能・カード・衣装がここで合流する
  unit.echoDps = options.baseEchoDps * resolveStat(1, 'echoPower', pools);

  unit.attack = resolveAttack(unit, branches, pools, options.costume);
  unit.aura = resolveUnitAura(unit);
}

/**
 * このユニットに乗っている「枝」。
 *
 * Lv3 で選んだ覚醒 1 つと、Lv6 で自動的に付く**もう一方**（03-progression.md ②）、
 * それに進化（⑦-2）を加えたもの。Lv3 の選択は「どちらを先に手に入れるか」の
 * 判断になり、6 まで伸ばせた 1 人だけが両方を得る。
 *
 * 進化を**覚醒と同じ形で**混ぜているのは、攻撃解決に分岐を足さないため。
 * `radiusMul` や `multiTarget` のような既存の指定をそのまま書けるので、
 * 進化のためだけの配線が `resolveAttack` に増えない。
 * ただし `onHit` は持たせない（持たせると基本の命中時効果を**置き換えて**しまい、
 * 進化しただけで減速やスタンが消えることになる）。
 */
function activeBranches(unit: Unit): AwakeningBranch[] {
  const def = getIdol(unit.idolId);
  const keys: AwakeningKey[] = [];
  if (unit.awakening) keys.push(unit.awakening);
  if (unit.awakeningSecond) keys.push(unit.awakeningSecond);
  const branches = keys
    .map((key) => def.awakening?.[key])
    .filter((b): b is AwakeningBranch => !!b);

  const evolution = unit.evolved ? def.evolution : undefined;
  if (evolution) {
    branches.push({ name: evolution.name, desc: evolution.desc, mods: evolution.mods });
  }
  return branches;
}

type NumericMod = 'critRateAdd' | 'defIgnoreAdd' | 'auraToSelfAtk';
type MulMod = 'attackIntervalMul' | 'radiusMul' | 'auraRadiusMul' | 'auraPowerMul';

function sumMod(branches: readonly AwakeningBranch[], key: NumericMod): number {
  return branches.reduce((sum, b) => sum + (b.mods[key] ?? 0), 0);
}

function mulMod(branches: readonly AwakeningBranch[], key: MulMod): number {
  return branches.reduce((product, b) => product * (b.mods[key] ?? 1), 1);
}

function resolveAttack(
  unit: Unit,
  branches: readonly AwakeningBranch[],
  pools: readonly ModifierPool[],
  costume: CostumeCombatBonus | undefined,
): ResolvedAttack {
  const def = getIdol(unit.idolId);

  let kind = def.attack.kind;
  let radius = def.attack.radius;
  // 両方が範囲化を持つことは無いが、片方でも持っていれば範囲になる
  const toAoe = branches.map((b) => b.mods.toAoe).filter((v): v is number => v !== undefined);
  if (toAoe.length > 0) {
    kind = 'aoe_ring';
    radius = Math.max(...toAoe);
  }
  radius *= mulMod(branches, 'radiusMul');
  // 才能「大合唱」などで範囲そのものが伸びる。線の太さ（貫通）にも同じく効かせる
  radius *= resolveStat(1, 'aoeRadius', pools);

  // 状態異常の効果量はカード・才能・センターで伸びる。
  // 継続時間はモニター前のマスで伸びる（別枠）
  const statusPower = resolveStat(1, 'slowPower', pools);
  const durationMul = resolveStat(1, 'statusDuration', pools);
  const slowValue = branches
    .map((b) => b.mods.slowValue)
    .filter((v): v is number => v !== undefined)
    .reduce<number | undefined>((best, v) => (best === undefined ? v : Math.max(best, v)), undefined);

  const onHit = mergeOnHit(def.attack.onHit, branches).map((entry) => ({
    ...entry,
    value: scaleStatusValue(entry, slowValue, statusPower),
    durationMs: entry.durationMs * durationMul,
  }));

  return {
    kind,
    radius,
    canHitFlying: def.attack.canHitFlying || branches.some((b) => b.mods.grantFlying === true),
    skillMul: def.attack.skillMul,
    multiTarget: Math.max(1, ...branches.map((b) => b.mods.multiTarget ?? 1)),
    defIgnore: Math.min(
      1,
      def.attack.defIgnore + sumMod(branches, 'defIgnoreAdd') + (costume?.defIgnoreAdd ?? 0),
    ),
    shieldPierce: Math.min(1, costume?.shieldPierce ?? 0),
    execute: def.attack.execute,
    knockback: bestKnockback(def.attack.knockback, branches),
    resetCooldownOnKill: branches.some((b) => b.mods.resetCooldownOnKill === true),
    onHit,
  };
}

/**
 * 「状態異常の効果量 +N%」を命中時効果へ掛ける。
 *
 * **量を持つものだけ**が対象。減速率と脆弱は 0.25 / 0.30 のような割合なので伸びるが、
 * 魅了とスタンは「止まるか止まらないか」しかなく（効くのは時間だけ）、
 * Echo の `value` はスタック数なので、掛けると意味が変わる
 * （Echo の威力は `echoPower` が別に持つ）。
 *
 * 減速だけを伸ばしていたころは、ヴィジュアルのキーストーン「絶対領域」が
 * 攻撃力 -25% を払わせておきながら脆弱を一切伸ばさず、
 * 「デバフの効果量 +40%」という文言と食い違っていた。
 */
function scaleStatusValue(
  entry: OnHit,
  slowOverride: number | undefined,
  statusPower: number,
): number {
  if (entry.status === 'slow') return (slowOverride ?? entry.value) * statusPower;
  if (entry.status === 'vulnerable') return entry.value * statusPower;
  return entry.value;
}

/**
 * 命中時効果をまとめる。
 *
 * 覚醒が `onHit` を持っていればそれが基本を**置き換える**（従来どおり）。
 * Lv6 で 2 つ乗ったときは両方を合わせ、同じ種別は強い方・長い方を残す。
 */
function mergeOnHit(base: readonly OnHit[], branches: readonly AwakeningBranch[]): OnHit[] {
  const overrides = branches.filter((b) => b.onHit !== undefined);
  const sources = overrides.length > 0 ? overrides.map((b) => b.onHit ?? []) : [base];

  const byStatus = new Map<OnHit['status'], OnHit>();
  for (const list of sources) {
    for (const entry of list) {
      const existing = byStatus.get(entry.status);
      if (!existing) {
        byStatus.set(entry.status, { ...entry });
        continue;
      }
      existing.value = Math.max(existing.value, entry.value);
      existing.durationMs = Math.max(existing.durationMs, entry.durationMs);
    }
  }
  return [...byStatus.values()];
}

/** 発動が速い方を優先し、距離は長い方を採る */
function bestKnockback(
  base: Knockback | undefined,
  branches: readonly AwakeningBranch[],
): Knockback | undefined {
  const all = [base, ...branches.map((b) => b.knockback)].filter(
    (k): k is Knockback => k !== undefined,
  );
  if (all.length === 0) return undefined;
  return {
    everyHits: Math.min(...all.map((k) => k.everyHits)),
    distance: Math.max(...all.map((k) => k.distance)),
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

  const branches = activeBranches(unit);
  // 「独占スクープ」はオーラを捨てて自身の ATK に変える。
  // Lv6 で範囲拡大と同時に持っても、捨てた側が優先される（二度取りにしない）
  if (branches.some((b) => b.mods.auraToSelfAtk !== undefined)) return null;

  const radiusMul = mulMod(branches, 'auraRadiusMul');
  const powerMul = mulMod(branches, 'auraPowerMul');
  return {
    radius: def.aura.radius * radiusMul,
    allyAtkPct: def.aura.allyAtkPct * powerMul,
    enemyDefPct: Math.min(0.9, def.aura.enemyDefPct * powerMul),
  };
}
