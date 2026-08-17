/**
 * ヘッドレスのバランス検証。
 *
 * 感想ではなく数字で見るために、育成段階 × 強化の使い方を総当たりする
 * （docs/design/07-roadmap.md M2 / M3 の計測）。
 *
 *   npx tsx scripts/probe.ts          # 全ステージ
 *   npx tsx scripts/probe.ts S4 S5    # 指定したステージだけ
 */
import { createWorld, type BattleMeta } from '../src/sim/world';
import { autoplay, type Placement } from '../src/sim/autoplay';
import { getTalent } from '../src/data';
import { resolveTalents, type TalentEffects } from '../src/meta/talents';
import { createNewSave, type CostumeInstance, type SaveData } from '../src/meta/save';
import { equipCostume, resolvePartyCostumes } from '../src/meta/costumes';
import { COSTUME_SLOTS, SLOT_MAIN_STATS } from '../src/data/schema/costume';
import { minimalPlan, PLAN_STAGES, STAGE_PLANS, type Investment } from '../src/balance/plans';
import { balanceMeta, investmentOf } from '../src/balance/investment';

const SEED = 20260816;

/**
 * 才能ボードを 1 ブランチぶん取り切った状態。
 * 「才能に投資するとどれだけ変わるか」を 1 行で見るために使う
 */
function fullBranchTalents(branch: 'vo' | 'da' | 'vi'): TalentEffects {
  const ids: string[] = [];
  // 片方の枝を末端まで。キーストーンは 1 つしか取れない
  for (const suffix of ['s1', 's2', 's3', 'm1', 'm2', 'k1', 's4', 's5', 's6', 'm3', 'm4']) {
    const id = `${branch}_${suffix}`;
    getTalent(id); // 存在しなければここで落ちる
    ids.push(id);
  }
  return resolveTalents({ ...createNewSave(), talents: ids });
}

/**
 * 出撃メンバー全員に、指定シリーズの UR を 4 スロットぶん着せたセーブ。
 * 「衣装に振り切るとどこまで行くか」を 1 行で見るために使う（03 E-2 の 2.9 倍）
 */
function fullCostumes(party: readonly string[], seriesId: string, enhance: number): SaveData {
  const costumes: CostumeInstance[] = [];
  let seq = 0;
  for (const idolId of party) {
    for (const slot of COSTUME_SLOTS) {
      costumes.push({
        id: `p${seq++}`,
        seriesId,
        slot,
        rarity: 'UR',
        mainStat: SLOT_MAIN_STATS[slot][0] ?? 'atkPct',
        subs: [],
        enhance,
      });
    }
    void idolId;
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

/**
 * 育成段階を再現する。
 *
 * ## 土台をどこに置くか
 *
 * 行ごとに**土台の段階を明示して受け取る**。以前は暗黙に
 * 「そのステージの既定値」を敷いていたが、それだと月の都の章（S11 以降）で
 * 表の意味が壊れる ―― 既定の土台に才能が入っているので
 * 「Lv20・フル強化」と「Lv20・才能フル(歌)」が同じ行になり、
 * S16 以降は衣装の行も既定の才能を引きずって**単独の効き目が読めない**。
 *
 * レベルの並び（Lv1〜Lv30）は既定の段階を土台にする ―― あの章は素の値では
 * 全行が「負け」で埋まり、レベルの効き目が何も読み取れない。
 * 単独の効き目を見る行（才能だけ・衣装だけ）は `bare` から組む。
 */
function metaAt(
  stageId: string,
  level: number,
  investment: Investment,
  talents?: TalentEffects,
  costumeSeries?: string,
): BattleMeta {
  const plan = STAGE_PLANS[stageId];
  const party = plan?.party ?? [];
  const base = balanceMeta(stageId, level, investment);
  return {
    ...base,
    ...(talents ? { talents } : {}),
    ...(costumeSeries
      ? { costumes: resolvePartyCostumes(fullCostumes(party, costumeSeries, 15), party) }
      : {}),
  };
}

interface Row {
  label: string;
  won: boolean;
  audience: number;
  killed: number;
  leaked: number;
  cheerLeft: number;
  cards: number;
  specials: number;
}

function run(
  label: string,
  stageId: string,
  level: number,
  plan: readonly Placement[],
  options: {
    useSpecial?: boolean;
    worstCard?: boolean;
    /** 土台の段階。省略するとステージの既定値 */
    investment?: Investment;
    talents?: TalentEffects;
    costumeSeries?: string;
  } = {},
): Row {
  const world = createWorld(
    stageId,
    SEED,
    metaAt(
      stageId,
      level,
      options.investment ?? investmentOf(stageId),
      options.talents,
      options.costumeSeries,
    ),
  );
  const result = autoplay(world, {
    plan,
    ...(options.useSpecial === undefined ? {} : { useSpecial: options.useSpecial }),
    // カード選択が結果に効くかを見るため、別の取り方も走らせる
    ...(options.worstCard ? { pickCard: (offers) => offers[offers.length - 1]?.id ?? null } : {}),
  });
  const s = result.snapshot;
  return {
    label,
    won: s.won,
    audience: s.audience,
    killed: s.killed,
    leaked: s.leaked,
    cheerLeft: s.cheer,
    cards: result.cardsPicked,
    specials: result.specialsUsed,
  };
}

const requested = process.argv.slice(2);
const targets = requested.length > 0 ? requested : PLAN_STAGES;

const rows: Row[] = [];
for (const stageId of targets) {
  const full = STAGE_PLANS[stageId]?.placements ?? [];
  const tier = investmentOf(stageId);
  // レベルの並びが乗っている土台。S1〜B2 は素のまま、月の都の章は既定の段階
  const base = tier === 'bare' ? '' : `[${tier}] `;
  rows.push(run(`${stageId} ${base}無配置`, stageId, 1, []));
  rows.push(run(`${stageId} ${base}Lv1・3枚のみ`, stageId, 1, minimalPlan(stageId)));
  rows.push(run(`${stageId} ${base}Lv1・フル強化`, stageId, 1, full, { useSpecial: true }));
  rows.push(run(`${stageId} ${base}Lv10・フル強化`, stageId, 10, full, { useSpecial: true }));
  rows.push(run(`${stageId} ${base}Lv20・フル強化`, stageId, 20, full, { useSpecial: true }));
  rows.push(run(`${stageId} ${base}Lv30・フル強化`, stageId, 30, full, { useSpecial: true }));
  rows.push(
    run(`${stageId} ${base}Lv20・別のカード選択`, stageId, 20, full, {
      useSpecial: true,
      worstCard: true,
    }),
  );
  // 以下 2 行は**素（bare）から**組む。既定の段階を土台にすると、
  // 月の都の章では才能が二重に入って「才能だけの効き目」が読めなくなる
  rows.push(
    run(`${stageId} [bare] Lv20・才能フル(歌)`, stageId, 20, full, {
      useSpecial: true,
      investment: 'bare',
      talents: fullBranchTalents('vo'),
    }),
  );
  // 衣装に振り切った状態。恒久強化の到達点（03 E-2 の 2.9 倍）が
  // 効きすぎていないかを見る
  rows.push(
    run(`${stageId} [bare] Lv20・衣装UR+15(玉の枝)`, stageId, 20, full, {
      useSpecial: true,
      investment: 'bare',
      costumeSeries: 'tama',
    }),
  );
  // 比較の基準。上の 2 行と同じ土台（素）で、強化を何も足さないもの
  rows.push(
    run(`${stageId} [bare] Lv20・強化なし`, stageId, 20, full, {
      useSpecial: true,
      investment: 'bare',
    }),
  );
}

const width = (text: string): number =>
  [...text].reduce((n, c) => n + (c.charCodeAt(0) > 0xff ? 2 : 1), 0);
const pad = (text: string, w: number): string => text + ' '.repeat(Math.max(0, w - width(text)));

console.log(pad('条件', 34), '結果   観客  撃破 漏れ 残声援 カード 必殺');
for (const row of rows) {
  console.log(
    pad(row.label, 34),
    row.won ? '完走  ' : '中断  ',
    String(row.audience).padStart(4),
    String(row.killed).padStart(5),
    String(row.leaked).padStart(4),
    String(row.cheerLeft).padStart(6),
    String(row.cards).padStart(6),
    String(row.specials).padStart(4),
  );
}
