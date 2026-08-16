/**
 * フォーメーションボーナス（03-progression.md ④）。
 *
 * 配置の**関係**からパッシブが自動で立つ。「射程が届くか」だけだった配置判断に、
 * 「誰の隣に置くか」を足すのが狙い。
 *
 * ## 設計からの変更: 「隣接」の定義
 *
 * 設計は「隣接 8 マス」（グリッド上で隣り合う）としていたが、実際のステージでは
 * 配置マスがおおむね **2 マス間隔**で置かれており、グリッド上で隣り合うことがない。
 * そのままでは 1 つも成立しないので、**配置マスとして隣り合っているか**で判定する
 * （実測した最近傍距離は 1.0〜2.24 なので、しきい値は 2.25）。
 * 盤面の意味は変わらない ——「近くに固めるか、散らして射程を稼ぐか」の判断は同じ。
 */
import { withinRange } from '../../core/vec';
import type { IdolType } from '../../data/schema/common';
import type { UnitTag } from '../../data/schema/idol';
import type { EntityId } from '../entities';

/** 配置マスとして隣り合っているとみなす距離 */
export const ADJACENT = 2.25;
/** 三角形の判定はやや緩く見る。3 マスが密に固まる盤面は多くない */
export const TRIO_RANGE = 3.2;

export type FormationId = 'pair_type' | 'pair_tag' | 'trio' | 'line' | 'center_guard';

export interface FormationHit {
  id: FormationId;
  name: string;
  desc: string;
  /** 効果を受けるユニット */
  unitIds: EntityId[];
}

/** ユニットごとの倍率。乗算で掛ける（幾何的に上限があるので暴走しない） */
export interface UnitFormationMods {
  atkMul: number;
  attackSpeedMul: number;
  rangeMul: number;
}

export interface FormationResult {
  /** ユニット ID -> 倍率 */
  byUnit: Map<EntityId, UnitFormationMods>;
  /** 盤面全体に掛かる月華の蓄積倍率 */
  voltageMul: number;
  /** HUD に出す成立中のボーナス */
  hits: FormationHit[];
}

export interface FormationUnit {
  id: EntityId;
  idolId: string;
  type: IdolType;
  cell: { x: number; y: number };
  pos: { x: number; y: number };
  tags: readonly UnitTag[];
}

const EMPTY: UnitFormationMods = { atkMul: 1, attackSpeedMul: 1, rangeMul: 1 };

/**
 * 成立しているボーナスをすべて数える。
 *
 * 配置が変わったときにだけ呼ぶ（毎フレームではない）。
 * ユニット数は最大でも十数体なので、総当たりで足りる。
 */
export function evaluateFormations(
  units: readonly FormationUnit[],
  centerIdolId: string | null,
): FormationResult {
  const byUnit = new Map<EntityId, UnitFormationMods>();
  const hits: FormationHit[] = [];
  let voltageMul = 1;

  const mods = (id: EntityId): UnitFormationMods => {
    const existing = byUnit.get(id);
    if (existing) return existing;
    const created = { ...EMPTY };
    byUnit.set(id, created);
    return created;
  };

  // --- 同系統ペア: 双方の ATK +12% ---
  forEachAdjacentPair(units, ADJACENT, (a, b) => {
    if (a.type !== b.type) return;
    mods(a.id).atkMul *= 1.12;
    mods(b.id).atkMul *= 1.12;
    hits.push({
      id: 'pair_type',
      name: '同系統ペア',
      desc: '同じ系統を隣り合わせた。双方の攻撃力 +12%',
      unitIds: [a.id, b.id],
    });
  });

  // --- 同ユニットペア: 双方の攻撃速度 +10% ---
  // 原作の関係（かぐや・いろP / Black onyX など）を配置条件へ変換したもの
  // （03-progression.md ⑪ ユニット絆）
  forEachAdjacentPair(units, ADJACENT, (a, b) => {
    if (!a.tags.some((tag) => b.tags.includes(tag))) return;
    mods(a.id).attackSpeedMul *= 1.1;
    mods(b.id).attackSpeedMul *= 1.1;
    hits.push({
      id: 'pair_tag',
      name: '同ユニット',
      desc: '同じユニットの 2 人が並んだ。双方の攻撃速度 +10%',
      unitIds: [a.id, b.id],
    });
  });

  // --- 3 系統の三角形: 3 人の攻撃速度 +15%、全体の月華蓄積 +10% ---
  for (let i = 0; i < units.length; i++) {
    for (let j = i + 1; j < units.length; j++) {
      for (let k = j + 1; k < units.length; k++) {
        const trio = [units[i], units[j], units[k]];
        if (!trio.every(Boolean)) continue;
        const [a, b, c] = trio as [FormationUnit, FormationUnit, FormationUnit];
        if (new Set([a.type, b.type, c.type]).size !== 3) continue;
        if (
          !withinRange(a.pos, b.pos, TRIO_RANGE) ||
          !withinRange(b.pos, c.pos, TRIO_RANGE) ||
          !withinRange(a.pos, c.pos, TRIO_RANGE)
        ) {
          continue;
        }
        for (const unit of [a, b, c]) mods(unit.id).attackSpeedMul *= 1.15;
        voltageMul *= 1.1;
        hits.push({
          id: 'trio',
          name: '三色の陣',
          desc: '3 系統を固めた。攻撃速度 +15%、月華の蓄積 +10%',
          unitIds: [a.id, b.id, c.id],
        });
      }
    }
  }

  // --- 一列: 同じ行か列に 3 人以上。両端の射程 +30% ---
  // 設計は「5 人が一直線」だったが、1 行に 5 マス並ぶステージは 2 つしかない。
  // 3 人なら全ステージで狙えて、かつ偶然には揃わない
  for (const line of collectLines(units)) {
    const ends = [line[0], line[line.length - 1]];
    for (const unit of ends) {
      if (unit) mods(unit.id).rangeMul *= 1.3;
    }
    hits.push({
      id: 'line',
      name: '一列ダンス',
      desc: '3 人以上が一直線。両端の射程 +30%',
      unitIds: ends.filter((u): u is FormationUnit => u !== undefined).map((u) => u.id),
    });
  }

  // --- センター護衛: センターの隣に 2 人以上。センターの ATK +25% ---
  // 設計は「スキル CT -20%」だが、アクティブスキルは M4。
  // 「守られているぶん前に出られる」という同じ筋の効果へ置き換えた
  const center = centerIdolId ? units.find((u) => u.idolId === centerIdolId) : undefined;
  if (center) {
    const guards = units.filter(
      (u) => u.id !== center.id && withinRange(center.pos, u.pos, ADJACENT),
    );
    if (guards.length >= 2) {
      mods(center.id).atkMul *= 1.25;
      hits.push({
        id: 'center_guard',
        name: 'センター護衛',
        desc: 'センターの隣に 2 人以上。センターの攻撃力 +25%',
        unitIds: [center.id],
      });
    }
  }

  return { byUnit, voltageMul, hits };
}

export function formationModsFor(
  result: FormationResult,
  id: EntityId,
): UnitFormationMods {
  return result.byUnit.get(id) ?? EMPTY;
}

function forEachAdjacentPair(
  units: readonly FormationUnit[],
  range: number,
  visit: (a: FormationUnit, b: FormationUnit) => void,
): void {
  for (let i = 0; i < units.length; i++) {
    for (let j = i + 1; j < units.length; j++) {
      const a = units[i];
      const b = units[j];
      if (!a || !b) continue;
      if (withinRange(a.pos, b.pos, range)) visit(a, b);
    }
  }
}

/**
 * 同じ行・列に 3 人以上が**隣接して連なっている**組を集める。
 * 端と端が離れていても行が同じなら成立、では「たまたま揃った」が増えてしまう。
 */
function collectLines(units: readonly FormationUnit[]): FormationUnit[][] {
  const lines: FormationUnit[][] = [];

  for (const axis of ['row', 'col'] as const) {
    const groups = new Map<number, FormationUnit[]>();
    for (const unit of units) {
      const key = axis === 'row' ? unit.cell.y : unit.cell.x;
      const list = groups.get(key) ?? [];
      list.push(unit);
      groups.set(key, list);
    }

    for (const group of groups.values()) {
      if (group.length < 3) continue;
      const sorted = [...group].sort((a, b) =>
        axis === 'row' ? a.cell.x - b.cell.x : a.cell.y - b.cell.y,
      );

      let run: FormationUnit[] = [];
      const flush = (): void => {
        if (run.length >= 3) lines.push(run);
        run = [];
      };
      for (const unit of sorted) {
        const previous = run[run.length - 1];
        if (previous && !withinRange(previous.pos, unit.pos, ADJACENT)) flush();
        run.push(unit);
      }
      flush();
    }
  }
  return lines;
}
