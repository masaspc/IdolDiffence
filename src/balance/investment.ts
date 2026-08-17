/**
 * 「その段階のプレイヤー」を組み立てる。
 *
 * 難度の検証（`balance.test.ts`）と調整スクリプト（`scripts/probe.ts`,
 * `scripts/sweep-difficulty.ts`）が**同じ仮定**で測るための共通の場所。
 * 3 箇所で別々に組み立てていたときは、片方だけ才能を入れ忘れて
 * 「テストは通るのにスクリプトでは勝てない」という食い違いが出た。
 *
 * 段階の意味は `plans.ts` の `Investment` を参照。
 */
import { getIdol, getTalent, rosterIds } from '../data';
import { levelAtkMultiplier } from '../meta/progression';
import { emptyTalentEffects, resolveTalents, type TalentEffects } from '../meta/talents';
import { createNewSave, type CostumeInstance, type SaveData } from '../meta/save';
import { equipCostume, resolvePartyCostumes } from '../meta/costumes';
import { COSTUME_SLOTS, SLOT_MAIN_STATS } from '../data/schema/costume';
import type { BattleMeta } from '../sim/world';
import { STAGE_PLANS, type Investment } from './plans';

/** 進化を解放しているアイドル。進化を持つのは初期 3 人だけ */
const EVOLVED = ['V1', 'D1', 'Vi1'] as const;

/**
 * 才能ボードを 1 枝ぶん取り切った状態。
 *
 * 3 枝のうち「歌」で固定する。枝ごとに測り分けると組み合わせが 3 倍になるうえ、
 * どの枝を選ぶかはプレイヤーの自由なので、**下限の目安**としては 1 枝で足りる
 */
function fullBranch(branch: 'vo' | 'da' | 'vi' = 'vo'): TalentEffects {
  const ids: string[] = [];
  for (const suffix of ['s1', 's2', 's3', 'm1', 'm2', 'k1', 's4', 's5', 's6', 'm3', 'm4']) {
    const id = `${branch}_${suffix}`;
    getTalent(id); // 存在しなければここで落ちる
    ids.push(id);
  }
  return resolveTalents({ ...createNewSave(), talents: ids });
}

/**
 * 出撃メンバー全員に、同じレアリティの衣装を 4 スロットぶん着せたセーブ。
 *
 * 副次効果（`subs`）は入れない。ランダムに付くものなので、
 * 入れると測るたびに結果が変わる
 */
function dressed(party: readonly string[], rarity: 'SSR' | 'UR', enhance: number): SaveData {
  const costumes: CostumeInstance[] = [];
  let seq = 0;
  for (const _ of party) {
    void _;
    for (const slot of COSTUME_SLOTS) {
      costumes.push({
        id: `bal${seq++}`,
        seriesId: 'tama',
        slot,
        rarity,
        mainStat: SLOT_MAIN_STATS[slot][0] ?? 'atkPct',
        subs: [],
        enhance,
      });
    }
  }
  let save: SaveData = { ...createNewSave(), costumes, costumeSeq: seq };
  let index = 0;
  for (const idolId of party) {
    for (let i = 0; i < COSTUME_SLOTS.length; i++) {
      save = equipCostume(save, idolId, costumes[index++]!.id);
    }
  }
  return save;
}

/** そのステージの参照盤面が仮定する段階。未指定は素のレベルだけ */
export function investmentOf(stageId: string): Investment {
  return STAGE_PLANS[stageId]?.investment ?? 'bare';
}

/**
 * 参照盤面をそのまま出撃させるための `BattleMeta`。
 *
 * @param level 育成レベル。段階と独立に振れる（「Lv20 では届かない」を測るため）
 * @param investment 省略するとステージの既定値
 */
export function balanceMeta(
  stageId: string,
  level: number,
  investment: Investment = investmentOf(stageId),
): BattleMeta {
  const plan = STAGE_PLANS[stageId];
  const party = plan?.party ?? [];
  const meta: BattleMeta = {
    atkByIdol: Object.fromEntries(
      rosterIds.map((id) => [id, getIdol(id).base.atk * levelAtkMultiplier(level)]),
    ),
    party,
    center: plan?.center ?? null,
    talents: investment === 'bare' ? emptyTalentEffects() : fullBranch(),
  };
  if (investment !== 'bare') meta.evolved = [...EVOLVED];
  if (investment === 'full') {
    meta.costumes = resolvePartyCostumes(dressed(party, 'SSR', 9), party);
  }
  return meta;
}
