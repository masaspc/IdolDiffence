/**
 * 衣装（03-progression.md ⑨）。
 *
 * ハクスラ的なランダム性で周回動機を作る枠。1 着ずつが乱数で生まれるので、
 * **定義（シリーズとセット効果）は JSON、実体はセーブ**に置く。
 *
 * ## 乱数はセーブに持つ
 *
 * ドロップも錬成も `Math.random()` は使わない（ESLint で禁止）。
 * セーブが `rngState` を持ち、引くたびに進める。こうしておくと
 * - ヘッドレスでドロップ分布を測れる
 * - 不具合の再現に「このセーブ」を渡すだけで済む
 * - リロードして引き直す、が効かない
 *
 * ## 何を per-idol にするか
 *
 * 戦闘のステータスは**着ている本人だけ**に効く。
 * 一方でセット効果のうち経済とグローバル（声援獲得・月華・開始時声援・
 * Echo の最大スタック）は「誰の数値か」を決められないので、
 * **出撃メンバーの中の最大値**を採る。合算にすると全員に同じセットを着せるのが
 * 常に最適になり、スロットを配る判断が消える。
 */
import { createRng, seedFromString, type Rng } from '../core/rng';
import { getSeries, seriesIds } from '../data';
import {
  COSTUME_RARITIES,
  COSTUME_SLOTS,
  MAX_ENHANCE,
  SLOT_MAIN_STATS,
  SUB_STAT_COUNT,
  type CostumeRarity,
  type CostumeSlot,
  type CostumeStat,
  type SetBonus,
} from '../data/schema/costume';
import type { CostumeInstance, SaveData } from './save';

/**
 * レアリティごとのメインステータス量。
 *
 * 4 スロット合計で恒久強化の目標 2.9 倍（03 E-2）に届く配分。
 * UR をフル強化した ATK% は 1 着で +36%、4 スロットぶんで概ね 2.2 倍。
 * 残りはセット効果とクリティカルで埋まる。
 */
const MAIN_BASE: Record<CostumeStat, Record<CostumeRarity, number>> = {
  atkPct: { R: 0.06, SR: 0.1, SSR: 0.15, UR: 0.2 },
  rangePct: { R: 0.04, SR: 0.06, SSR: 0.09, UR: 0.12 },
  attackSpeedPct: { R: 0.05, SR: 0.08, SSR: 0.12, UR: 0.16 },
  critRateAdd: { R: 0.04, SR: 0.07, SSR: 0.1, UR: 0.14 },
  critDmgAdd: { R: 0.1, SR: 0.18, SSR: 0.28, UR: 0.4 },
  cheerGainPct: { R: 0.04, SR: 0.07, SSR: 0.1, UR: 0.14 },
  voltageGainPct: { R: 0.04, SR: 0.07, SSR: 0.1, UR: 0.14 },
  statusPowerPct: { R: 0.05, SR: 0.08, SSR: 0.12, UR: 0.16 },
  statusDurationPct: { R: 0.06, SR: 0.1, SSR: 0.15, UR: 0.2 },
  aoeRadiusPct: { R: 0.04, SR: 0.06, SSR: 0.09, UR: 0.12 },
  echoPowerPct: { R: 0.06, SR: 0.1, SSR: 0.15, UR: 0.2 },
};

/** 副次ステータス 1 段ぶんの量。メインより明確に小さくして、主従を保つ */
const SUB_STEP: Record<CostumeStat, number> = {
  atkPct: 0.025,
  rangePct: 0.02,
  attackSpeedPct: 0.022,
  critRateAdd: 0.018,
  critDmgAdd: 0.05,
  cheerGainPct: 0.02,
  voltageGainPct: 0.02,
  statusPowerPct: 0.022,
  statusDurationPct: 0.03,
  aoeRadiusPct: 0.02,
  echoPowerPct: 0.03,
};

const ALL_STATS = Object.keys(SUB_STEP) as CostumeStat[];

/** メインは強化 +15 で 1.8 倍になる */
const MAIN_ENHANCE_PER_LEVEL = 0.8 / MAX_ENHANCE;

/** 強化 1 回あたりの費用。レアリティが高いほど重い */
const ENHANCE_COST: Record<CostumeRarity, number> = { R: 60, SR: 120, SSR: 240, UR: 400 };

/** 錬成に必要な素材数（同じレアリティ）。1 着に化ける */
export const SALVAGE_COUNT = 3;

/** 抽選の重み。UR は狙って出るものではない */
const RARITY_WEIGHT: Record<CostumeRarity, number> = { R: 55, SR: 30, SSR: 12, UR: 3 };

export function enhanceCost(costume: CostumeInstance): number | null {
  if (costume.enhance >= MAX_ENHANCE) return null;
  // 後半ほど重くする。+12 から +15 は「最後に 1 着だけ」の投資になる
  return Math.round(ENHANCE_COST[costume.rarity] * (1 + costume.enhance * 0.25));
}

/** 表示・計算用に解決したメインステータス */
export function mainValue(costume: CostumeInstance): number {
  const base = MAIN_BASE[costume.mainStat][costume.rarity];
  return base * (1 + costume.enhance * MAIN_ENHANCE_PER_LEVEL);
}

/** 副次ステータスの実効値。`rolls` は「何段ぶん伸びたか」 */
export function subValue(stat: CostumeStat, rolls: number): number {
  return SUB_STEP[stat] * rolls;
}

// --- 生成 ---

/**
 * セーブの乱数を 1 手進めて使う。
 *
 * `rngState` を書き戻すのを忘れると同じものが延々と出るので、
 * **引く側は必ずこの関数を通す**。
 */
function withRng<T>(save: SaveData, fn: (rng: Rng) => T): { save: SaveData; value: T } {
  const rng = createRng(save.rngState);
  const value = fn(rng);
  return { save: { ...save, rngState: rng.getState() }, value };
}

function weightedRarity(rng: Rng, floor: CostumeRarity | null): CostumeRarity {
  // 型を 1 つに揃える。三項の両辺でタプルと配列が混ざると、
  // union に対する reduce の引数が string へ広がってしまう
  const candidates: readonly CostumeRarity[] = floor
    ? COSTUME_RARITIES.slice(COSTUME_RARITIES.indexOf(floor))
    : COSTUME_RARITIES;
  const total = candidates.reduce((sum, r) => sum + RARITY_WEIGHT[r], 0);
  let roll = rng.next() * total;
  for (const rarity of candidates) {
    roll -= RARITY_WEIGHT[rarity];
    if (roll <= 0) return rarity;
  }
  return candidates[candidates.length - 1] ?? 'R';
}

/**
 * 1 着を作る。
 *
 * 副次ステータスは**メインと重複させない**。同じ器に main と sub が入ると、
 * 表示が「ATK% +20% / ATK% +2.5%」のように二重になって読みにくい。
 */
function roll(rng: Rng, id: string, rarity: CostumeRarity, slot: CostumeSlot): CostumeInstance {
  const seriesId = rng.pick(seriesIds) ?? seriesIds[0] ?? '';
  const mainStat = rng.pick(SLOT_MAIN_STATS[slot]) ?? 'atkPct';

  const pool = ALL_STATS.filter((stat) => stat !== mainStat);
  const subs: { stat: CostumeStat; rolls: number }[] = [];
  for (let i = 0; i < SUB_STAT_COUNT[rarity] && pool.length > 0; i++) {
    const index = rng.int(0, pool.length - 1);
    const stat = pool.splice(index, 1)[0];
    if (stat) subs.push({ stat, rolls: 1 });
  }

  return { id, seriesId, slot, rarity, mainStat, subs, enhance: 0 };
}

/**
 * ライブのリザルトで配るドロップ。
 *
 * 「負けても撃破ぶんは入る」（`calcReward`）と揃えて、**負けても 1 着は出る**。
 * ゼロにすると、負けた回のプレイが完全な無駄になり再挑戦の意欲を折る。
 */
export function dropCount(won: boolean, audience: number): number {
  if (!won) return 1;
  return audience >= 100 ? 3 : 2;
}

/** @returns 更新後のセーブと、今回出た衣装 */
export function grantDrops(
  save: SaveData,
  count: number,
  floor: CostumeRarity | null = null,
): { save: SaveData; dropped: CostumeInstance[] } {
  let current = save;
  const dropped: CostumeInstance[] = [];

  for (let i = 0; i < count; i++) {
    const seq = current.costumeSeq + 1;
    const result = withRng(current, (rng) => {
      const rarity = weightedRarity(rng, floor);
      const slot = rng.pick(COSTUME_SLOTS) ?? 'stage';
      return roll(rng, `c${seq}`, rarity, slot);
    });
    dropped.push(result.value);
    current = {
      ...result.save,
      costumeSeq: seq,
      costumes: [...result.save.costumes, result.value],
    };
  }
  return { save: current, dropped };
}

// --- 強化 ---

export type EnhanceBlock = null | 'not-found' | 'max' | 'funds';

export function enhanceBlocker(save: SaveData, costumeId: string): EnhanceBlock {
  const costume = save.costumes.find((c) => c.id === costumeId);
  if (!costume) return 'not-found';
  const cost = enhanceCost(costume);
  if (cost === null) return 'max';
  if (save.funds < cost) return 'funds';
  return null;
}

/**
 * 強化 +1。**3 の倍数ごとに副次ステータスが 1 つ伸びる**（03-progression.md ⑨）。
 *
 * 伸びる先は既存の副次からランダムに 1 つ。R（副次 1 個）だと同じところしか
 * 伸びないが、それはレアリティの差として意図している。
 */
export function enhanceCostume(save: SaveData, costumeId: string): SaveData {
  if (enhanceBlocker(save, costumeId) !== null) return save;
  const costume = save.costumes.find((c) => c.id === costumeId);
  if (!costume) return save;
  const cost = enhanceCost(costume);
  if (cost === null) return save;

  const next = costume.enhance + 1;
  const bumpsSub = next % 3 === 0 && costume.subs.length > 0;

  const result = withRng(save, (rng) => (bumpsSub ? rng.int(0, costume.subs.length - 1) : -1));
  const upgraded: CostumeInstance = {
    ...costume,
    enhance: next,
    subs: costume.subs.map((sub, index) =>
      index === result.value ? { ...sub, rolls: sub.rolls + 1 } : sub,
    ),
  };

  return {
    ...result.save,
    funds: result.save.funds - cost,
    costumes: result.save.costumes.map((c) => (c.id === costumeId ? upgraded : c)),
  };
}

// --- 錬成 ---

export type SalvageBlock = null | 'not-enough' | 'equipped' | 'mixed-rarity';

/**
 * 錬成できるか。**同じレアリティ 3 着**を 1 着に変える。
 * 装備中のものは選べない（外し忘れで消えると取り返しがつかない）。
 */
export function salvageBlocker(save: SaveData, costumeIds: readonly string[]): SalvageBlock {
  if (costumeIds.length !== SALVAGE_COUNT) return 'not-enough';
  const picked = costumeIds.map((id) => save.costumes.find((c) => c.id === id));
  if (picked.some((c) => c === undefined)) return 'not-enough';
  if (new Set(costumeIds).size !== SALVAGE_COUNT) return 'not-enough';
  if (costumeIds.some((id) => isEquipped(save, id))) return 'equipped';
  const rarity = picked[0]?.rarity;
  if (picked.some((c) => c?.rarity !== rarity)) return 'mixed-rarity';
  return null;
}

/**
 * 錬成。3 着を溶かして同じレアリティの 1 着にする（副次は引き直し）。
 *
 * 「増えすぎた R を捨てる」だけでなく、**狙ったシリーズを引き直す**手段でもある。
 * レアリティは上がらない。上げられるようにすると、周回で UR が確定してしまう。
 */
export function salvageCostumes(
  save: SaveData,
  costumeIds: readonly string[],
): { save: SaveData; created: CostumeInstance | null } {
  if (salvageBlocker(save, costumeIds) !== null) return { save, created: null };
  const rarity = save.costumes.find((c) => c.id === costumeIds[0])?.rarity;
  if (!rarity) return { save, created: null };

  const seq = save.costumeSeq + 1;
  const result = withRng(save, (rng) => {
    const slot = rng.pick(COSTUME_SLOTS) ?? 'stage';
    return roll(rng, `c${seq}`, rarity, slot);
  });

  const remaining = result.save.costumes.filter((c) => !costumeIds.includes(c.id));
  return {
    save: { ...result.save, costumeSeq: seq, costumes: [...remaining, result.value] },
    created: result.value,
  };
}

// --- 装備 ---

export function equippedIds(save: SaveData, idolId: string): Partial<Record<CostumeSlot, string>> {
  return save.equipped[idolId] ?? {};
}

export function equippedCostume(
  save: SaveData,
  idolId: string,
  slot: CostumeSlot,
): CostumeInstance | null {
  const id = equippedIds(save, idolId)[slot];
  return id ? (save.costumes.find((c) => c.id === id) ?? null) : null;
}

export function isEquipped(save: SaveData, costumeId: string): boolean {
  return Object.values(save.equipped).some((slots) =>
    Object.values(slots).some((id) => id === costumeId),
  );
}

/** 誰が着ているか。UI で「◯◯が着用中」と出すため */
export function wearerOf(save: SaveData, costumeId: string): string | null {
  for (const [idolId, slots] of Object.entries(save.equipped)) {
    if (Object.values(slots).some((id) => id === costumeId)) return idolId;
  }
  return null;
}

/**
 * 着せる。
 *
 * **他のアイドルが着ていたら黙って剥がす。** 「先に外してください」を出すと、
 * 誰が着ているかを探して画面を往復させることになる。1 着は 1 人しか着られない
 * という制約さえ守れれば、移し替えは自動でよい。
 */
export function equipCostume(save: SaveData, idolId: string, costumeId: string): SaveData {
  const costume = save.costumes.find((c) => c.id === costumeId);
  if (!costume) return save;

  const equipped: SaveData['equipped'] = {};
  for (const [owner, slots] of Object.entries(save.equipped)) {
    const cleaned: Partial<Record<CostumeSlot, string>> = {};
    for (const slot of COSTUME_SLOTS) {
      const id = slots[slot];
      if (id !== undefined && id !== costumeId) cleaned[slot] = id;
    }
    equipped[owner] = cleaned;
  }
  equipped[idolId] = { ...equipped[idolId], [costume.slot]: costumeId };
  return { ...save, equipped };
}

export function unequipSlot(save: SaveData, idolId: string, slot: CostumeSlot): SaveData {
  const slots = save.equipped[idolId];
  if (!slots || slots[slot] === undefined) return save;
  const cleaned: Partial<Record<CostumeSlot, string>> = {};
  for (const key of COSTUME_SLOTS) {
    const id = slots[key];
    if (id !== undefined && key !== slot) cleaned[key] = id;
  }
  return { ...save, equipped: { ...save.equipped, [idolId]: cleaned } };
}

// --- 効果の解決 ---

export interface CostumeEffects {
  /** 加算プールへ流すぶん */
  stats: Partial<Record<CostumeStat, number>>;
  defIgnoreAdd: number;
  shieldPierce: number;
  specialDmgPct: number;
  /** 経済・グローバル。編成内の最大値を採る */
  echoMaxStacksAdd: number;
  startCheer: number;
  /** 成立中のセット。UI 表示用 */
  sets: { seriesId: string; count: number; tier: 2 | 4 }[];
}

export function emptyCostumeEffects(): CostumeEffects {
  return {
    stats: {},
    defIgnoreAdd: 0,
    shieldPierce: 0,
    specialDmgPct: 0,
    echoMaxStacksAdd: 0,
    startCheer: 0,
    sets: [],
  };
}

function addBonus(out: CostumeEffects, bonus: SetBonus): void {
  for (const [stat, value] of Object.entries(bonus.stats)) {
    const key = stat as CostumeStat;
    out.stats[key] = (out.stats[key] ?? 0) + value;
  }
  out.defIgnoreAdd += bonus.defIgnoreAdd ?? 0;
  out.shieldPierce = Math.min(1, out.shieldPierce + (bonus.shieldPierce ?? 0));
  out.specialDmgPct += bonus.specialDmgPct ?? 0;
  out.echoMaxStacksAdd += bonus.echoMaxStacksAdd ?? 0;
  out.startCheer += bonus.startCheer ?? 0;
}

/** 1 人ぶんの衣装効果。着ている 4 スロットとセット効果を畳む */
export function resolveCostumes(save: SaveData, idolId: string): CostumeEffects {
  const out = emptyCostumeEffects();
  const bySeries = new Map<string, number>();

  for (const slot of COSTUME_SLOTS) {
    const costume = equippedCostume(save, idolId, slot);
    if (!costume) continue;

    out.stats[costume.mainStat] = (out.stats[costume.mainStat] ?? 0) + mainValue(costume);
    for (const sub of costume.subs) {
      out.stats[sub.stat] = (out.stats[sub.stat] ?? 0) + subValue(sub.stat, sub.rolls);
    }
    bySeries.set(costume.seriesId, (bySeries.get(costume.seriesId) ?? 0) + 1);
  }

  for (const [seriesId, count] of bySeries) {
    // 消えたシリーズを持つ古いセーブは黙って無視する
    const series = costumeSeries(seriesId);
    if (!series) continue;
    if (count >= 2) {
      addBonus(out, series.two);
      out.sets.push({ seriesId, count, tier: 2 });
    }
    // 4 着は 2 着ぶんに**上乗せ**する。置き換えにすると、
    // 4 着目を着けた瞬間に 2 着効果が消えて弱くなる場面が出る
    if (count >= 4) {
      addBonus(out, series.four);
      out.sets[out.sets.length - 1] = { seriesId, count, tier: 4 };
    }
  }
  return out;
}

function costumeSeries(id: string): ReturnType<typeof getSeries> | null {
  try {
    return getSeries(id);
  } catch {
    return null;
  }
}

/**
 * 編成全体に効くぶん。「誰の数値か」を決められないものはここへ集まる。
 *
 * 声援と月華の獲得は**ユニットのステータスではなく経済**なので、
 * 着ている本人のプールへ積んでも `BattleWorld` の計算には一切届かない
 * （センターパッシブで同じことが起きたので `centerEconomyPool` が別にある）。
 */
export interface PartyCostumeEffects {
  byIdol: Record<string, CostumeEffects>;
  echoMaxStacksAdd: number;
  startCheer: number;
  cheerGainPct: number;
  voltageGainPct: number;
}

/**
 * 出撃メンバーぶんをまとめて解決する。
 *
 * 全体に効く項は**最大値**を採る。合算にすると、全員に同じセットを着せるのが
 * 常に最適になってしまい、スロットを配る判断が消える。
 */
export function resolvePartyCostumes(
  save: SaveData,
  party: readonly string[],
): PartyCostumeEffects {
  const byIdol: Record<string, CostumeEffects> = {};
  let echoMaxStacksAdd = 0;
  let startCheer = 0;
  let cheerGainPct = 0;
  let voltageGainPct = 0;

  for (const idolId of party) {
    const effects = resolveCostumes(save, idolId);
    byIdol[idolId] = effects;
    echoMaxStacksAdd = Math.max(echoMaxStacksAdd, effects.echoMaxStacksAdd);
    startCheer = Math.max(startCheer, effects.startCheer);
    cheerGainPct = Math.max(cheerGainPct, effects.stats.cheerGainPct ?? 0);
    voltageGainPct = Math.max(voltageGainPct, effects.stats.voltageGainPct ?? 0);
  }
  return { byIdol, echoMaxStacksAdd, startCheer, cheerGainPct, voltageGainPct };
}

/** 新規セーブの乱数の種。固定値だと全プレイヤーが同じ順で引く */
export function initialRngState(salt: string): number {
  return seedFromString(`idoldiffence:${salt}`);
}
