/**
 * ヘッドレスのバランス検証（簡易版）。
 *
 * M2 は「負ける → 育てる → 勝つ」が成立するかの判断ポイント。
 * 感想ではなく数字で見るために、育成段階 × 強化の使い方を総当たりする
 * （docs/design/07-roadmap.md M2 の計測）。
 *
 *   npx tsx src/balance/probe.ts
 */
import { createWorld } from '../sim/world';
import { autoplay, type Placement } from '../sim/autoplay';
import { getIdol, rosterIds } from '../data';
import { levelAtkMultiplier } from '../meta/progression';

const SEED = 20260816;

/** 育成段階を再現する。レベルだけを変えて他は同条件にする */
function metaAtLevel(level: number): { atkByIdol: Record<string, number> } {
  return {
    atkByIdol: Object.fromEntries(
      rosterIds.map((id) => [id, getIdol(id).base.atk * levelAtkMultiplier(level)]),
    ),
  };
}

/** ステージごとの「経路沿いに置く」プラン。人間の最適解ではなく下限の目安 */
const PLANS: Record<string, Placement[]> = {
  S1: [
    { idolId: 'D1', x: 4, y: 6, upgradeTo: 3, awakening: 'A' },
    { idolId: 'V1', x: 8, y: 5, upgradeTo: 3, awakening: 'A' },
    { idolId: 'Vi1', x: 12, y: 5, upgradeTo: 2 },
    { idolId: 'D1', x: 11, y: 4, upgradeTo: 2 },
    { idolId: 'V1', x: 3, y: 3, upgradeTo: 2 },
  ],
  S2: [
    { idolId: 'D1', x: 3, y: 5, upgradeTo: 3, awakening: 'A' },
    { idolId: 'V1', x: 7, y: 4, upgradeTo: 3, awakening: 'A' },
    { idolId: 'Vi1', x: 12, y: 5, upgradeTo: 2 },
    { idolId: 'D1', x: 6, y: 3, upgradeTo: 2 },
    { idolId: 'V1', x: 14, y: 5, upgradeTo: 2 },
    { idolId: 'D1', x: 1, y: 4 },
  ],
  S3: [
    { idolId: 'V1', x: 5, y: 3, upgradeTo: 3, awakening: 'A' },
    { idolId: 'V1', x: 9, y: 2, upgradeTo: 3, awakening: 'A' },
    { idolId: 'D1', x: 9, y: 6, upgradeTo: 3, awakening: 'A' },
    { idolId: 'Vi1', x: 11, y: 2, upgradeTo: 2 },
    { idolId: 'Vi1', x: 11, y: 6, upgradeTo: 2 },
    { idolId: 'D1', x: 2, y: 3, upgradeTo: 2 },
    { idolId: 'D1', x: 2, y: 5, upgradeTo: 2 },
    { idolId: 'V1', x: 13, y: 2 },
  ],
};

/** 最初の 3 枚だけを置く「最低限」プラン */
const minimalPlan = (stageId: string): Placement[] =>
  (PLANS[stageId] ?? []).slice(0, 3).map(({ idolId, x, y }) => ({ idolId, x, y }));

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
  const world = createWorld(stageId, SEED, metaAtLevel(level));
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

const rows: Row[] = [];
for (const stageId of ['S1', 'S2', 'S3']) {
  const full = PLANS[stageId] ?? [];
  rows.push(run(`${stageId} 無配置`, stageId, 1, []));
  rows.push(run(`${stageId} Lv1・3枚のみ`, stageId, 1, minimalPlan(stageId)));
  rows.push(run(`${stageId} Lv1・フル強化`, stageId, 1, full, { useSpecial: true }));
  rows.push(run(`${stageId} Lv10・フル強化`, stageId, 10, full, { useSpecial: true }));
  rows.push(run(`${stageId} Lv20・フル強化`, stageId, 20, full, { useSpecial: true }));
  rows.push(
    run(`${stageId} Lv10・別のカード選択`, stageId, 10, full, { useSpecial: true, worstCard: true }),
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
