/**
 * 才能ボード（03-progression.md ⑧）。
 *
 * ポイントの出どころは設計ではプロデューサーランクだが、ランクは M4。
 * それまでは**ステージの初回クリア（+2）とランク S の初回達成（+1）**で配る。
 * ステージ 7 本で最大 21 ポイント、1 ブランチを埋めるのに 17 なので、
 * **全部は取れない**。どこに寄せるかを選ばせるのが狙い。
 */
import { getTalent, talents } from '../data';
import type { TalentMods, TalentNode } from '../data/schema/talent';
import type { IdolType } from '../data/schema/common';
import type { SaveData } from './save';

/** ステージ初回クリアで入るポイント */
export const POINTS_PER_CLEAR = 2;
/** ランク S（観客 100）の初回達成で入るポイント */
export const POINTS_PER_PERFECT = 1;
/** 振り直しの費用。惜しくはあるが、試すのを諦めるほどではない額 */
export const RESPEC_COST = 800;

export const talentIds = Object.keys(talents);

/** 到達済みの実績から才能ポイントの総量を求める。セーブに数を持たない */
export function totalTalentPoints(save: SaveData): number {
  let total = 0;
  for (const progress of Object.values(save.stageProgress)) {
    if (progress.cleared) total += POINTS_PER_CLEAR;
    if (progress.bestAudience >= 100) total += POINTS_PER_PERFECT;
  }
  return total;
}

export function spentTalentPoints(save: SaveData): number {
  return save.talents.reduce((sum, id) => sum + (talents[id]?.cost ?? 0), 0);
}

export function remainingTalentPoints(save: SaveData): number {
  return totalTalentPoints(save) - spentTalentPoints(save);
}

export type TalentBlock =
  | null
  | 'taken'
  | 'no-points'
  | 'requires'
  | 'keystone-taken'
  | 'unknown';

/** @returns 取れない理由。取れるなら null */
export function talentBlocker(save: SaveData, id: string): TalentBlock {
  const node = talents[id];
  if (!node) return 'unknown';
  if (save.talents.includes(id)) return 'taken';
  // キーストーンの排他は**前提より先に**見る。後ろに置くと、もう取れないほうの
  // 枝へ 8 pt 注ぎ込んでから「取れません」と分かることになる
  if (node.tier === 'keystone' && hasKeystone(save, node.branch)) return 'keystone-taken';
  if (!node.requires.every((req) => save.talents.includes(req))) return 'requires';
  if (remainingTalentPoints(save) < node.cost) return 'no-points';
  return null;
}

export function hasKeystone(save: SaveData, branch: IdolType): boolean {
  return save.talents.some((id) => {
    const node = talents[id];
    return node?.tier === 'keystone' && node.branch === branch;
  });
}

export function takeTalent(save: SaveData, id: string): SaveData {
  if (talentBlocker(save, id) !== null) return save;
  return { ...save, talents: [...save.talents, id] };
}

/** 全リセット。1 ノードずつ返せると、前提ノードだけ外れた壊れた状態を作れてしまう */
export function respecTalents(save: SaveData): SaveData {
  if (save.talents.length === 0 || save.funds < RESPEC_COST) return save;
  return { ...save, funds: save.funds - RESPEC_COST, talents: [] };
}

/**
 * 取得済みノードの効果を合算する。
 *
 * ここで畳んでおいて、sim には**結果だけ**を渡す。
 * sim がセーブの形を知ってしまうと、ヘッドレス計測が回しづらくなる。
 */
export interface TalentEffects {
  /** 系統を問わない加算（ModifierPool の addPct 相当） */
  atkPct: number;
  rangePct: number;
  attackSpeedPct: number;
  critRateAdd: number;
  critDmgAdd: number;
  cheerGainPct: number;
  voltageGainPct: number;
  statusPowerPct: number;
  statusDurationPct: number;
  aoeRadiusPct: number;
  echoPowerPct: number;
  /** 系統ごとの攻撃力加算 */
  typeAtkPct: Partial<Record<IdolType, number>>;
  echoMaxStacksAdd: number;
  killSpeedStack: { perKill: number; max: number } | null;
}

export function emptyTalentEffects(): TalentEffects {
  return {
    atkPct: 0,
    rangePct: 0,
    attackSpeedPct: 0,
    critRateAdd: 0,
    critDmgAdd: 0,
    cheerGainPct: 0,
    voltageGainPct: 0,
    statusPowerPct: 0,
    statusDurationPct: 0,
    aoeRadiusPct: 0,
    echoPowerPct: 0,
    typeAtkPct: {},
    echoMaxStacksAdd: 0,
    killSpeedStack: null,
  };
}

const SUM_KEYS = [
  'atkPct',
  'rangePct',
  'attackSpeedPct',
  'critRateAdd',
  'critDmgAdd',
  'cheerGainPct',
  'voltageGainPct',
  'statusPowerPct',
  'statusDurationPct',
  'aoeRadiusPct',
  'echoPowerPct',
] as const satisfies readonly (keyof TalentMods & keyof TalentEffects)[];

export function resolveTalents(save: SaveData): TalentEffects {
  const out = emptyTalentEffects();

  for (const id of save.talents) {
    const node: TalentNode | undefined = talents[id];
    if (!node) continue; // 消えたノードを持つ古いセーブは黙って無視する
    const mods = node.mods;

    for (const key of SUM_KEYS) out[key] += mods[key] ?? 0;
    if (mods.typeAtkPct !== undefined) {
      out.typeAtkPct[node.branch] = (out.typeAtkPct[node.branch] ?? 0) + mods.typeAtkPct;
    }
    out.echoMaxStacksAdd += mods.echoMaxStacksAdd ?? 0;
    if (mods.killSpeedStack) {
      // 同じキーストーンを二重に取ることはないので、強い方を採る
      const current = out.killSpeedStack;
      out.killSpeedStack =
        !current || mods.killSpeedStack.max > current.max ? mods.killSpeedStack : current;
    }
  }
  return out;
}

/** UI 用。ブランチごとの取得数 */
export function takenByBranch(save: SaveData): Record<IdolType, number> {
  const counts: Record<IdolType, number> = { vocal: 0, dance: 0, visual: 0 };
  for (const id of save.talents) {
    const node = talents[id];
    if (node) counts[node.branch] += 1;
  }
  return counts;
}

export { getTalent };
