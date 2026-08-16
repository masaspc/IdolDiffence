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
import { getIdol, rosterIds } from '../src/data';
import { levelAtkMultiplier } from '../src/meta/progression';
import { minimalPlan, PLAN_STAGES, STAGE_PLANS } from '../src/balance/plans';

const SEED = 20260816;

/** 育成段階を再現する。レベルだけを変えて他は同条件にする */
function metaAt(stageId: string, level: number): BattleMeta {
  const plan = STAGE_PLANS[stageId];
  return {
    atkByIdol: Object.fromEntries(
      rosterIds.map((id) => [id, getIdol(id).base.atk * levelAtkMultiplier(level)]),
    ),
    party: plan?.party ?? [],
    center: plan?.center ?? null,
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
  options: { useSpecial?: boolean; worstCard?: boolean } = {},
): Row {
  const world = createWorld(stageId, SEED, metaAt(stageId, level));
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
  rows.push(run(`${stageId} 無配置`, stageId, 1, []));
  rows.push(run(`${stageId} Lv1・3枚のみ`, stageId, 1, minimalPlan(stageId)));
  rows.push(run(`${stageId} Lv1・フル強化`, stageId, 1, full, { useSpecial: true }));
  rows.push(run(`${stageId} Lv10・フル強化`, stageId, 10, full, { useSpecial: true }));
  rows.push(run(`${stageId} Lv20・フル強化`, stageId, 20, full, { useSpecial: true }));
  rows.push(run(`${stageId} Lv30・フル強化`, stageId, 30, full, { useSpecial: true }));
  rows.push(
    run(`${stageId} Lv20・別のカード選択`, stageId, 20, full, { useSpecial: true, worstCard: true }),
  );
}

const width = (text: string): number =>
  [...text].reduce((n, c) => n + (c.charCodeAt(0) > 0xff ? 2 : 1), 0);
const pad = (text: string, w: number): string => text + ' '.repeat(Math.max(0, w - width(text)));

console.log(pad('条件', 28), '結果   観客  撃破 漏れ 残声援 カード 必殺');
for (const row of rows) {
  console.log(
    pad(row.label, 28),
    row.won ? '完走  ' : '中断  ',
    String(row.audience).padStart(4),
    String(row.killed).padStart(5),
    String(row.leaked).padStart(4),
    String(row.cheerLeft).padStart(6),
    String(row.cards).padStart(6),
    String(row.specials).padStart(4),
  );
}
