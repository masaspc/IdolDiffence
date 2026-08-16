/**
 * hpMul を振って、育成レベルごとのクリア可否を見る調整用スクリプト。
 *   npx tsx scripts/sweep-difficulty.ts S5
 */
import { createWorld } from '../src/sim/world';
import { autoplay } from '../src/sim/autoplay';
import { getIdol, rosterIds, stages } from '../src/data';
import { levelAtkMultiplier } from '../src/meta/progression';
import { STAGE_PLANS } from '../src/balance/plans';

const SEED = 20260816;

const stageId = process.argv[2] ?? 'S3';
const stagePlan = STAGE_PLANS[stageId];
const plan = stagePlan?.placements ?? [];

const meta = (level: number) => ({
  atkByIdol: Object.fromEntries(
    rosterIds.map((id) => [id, getIdol(id).base.atk * levelAtkMultiplier(level)]),
  ),
  party: stagePlan?.party ?? [],
  center: stagePlan?.center ?? null,
});

const target = stages[stageId];
if (!target) throw new Error(`unknown stage: ${stageId}`);
const original = target.hpMul;

console.log(`${stageId} (現行 hpMul=${original})`);
console.log('hpMul  Lv1   Lv5   Lv10  Lv15  Lv20  Lv30');
// 現行値とその周辺を必ず含める。含めないと採用値の境界を検証できない
const candidates = [
  ...new Set(
    [original * 0.5, original * 0.75, original, original * 1.25, original * 1.5, original * 2].map(
      (v) => Math.round(v * 100) / 100,
    ),
  ),
].sort((a, b) => a - b);

for (const hpMul of candidates) {
  target.hpMul = hpMul;
  const cells = [1, 5, 10, 15, 20, 30].map((level) => {
    const world = createWorld(stageId, SEED, meta(level));
    const { snapshot } = autoplay(world, { plan, useSpecial: true });
    return (snapshot.won ? `○${snapshot.audience}` : `×${snapshot.killed}`).padEnd(6);
  });
  console.log(String(hpMul).padEnd(6), cells.join(''));
}
target.hpMul = original;
