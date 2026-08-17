/**
 * hpMul を振って、育成レベルごとのクリア可否を見る調整用スクリプト。
 *   npx tsx scripts/sweep-difficulty.ts S5
 */
import { createWorld } from '../src/sim/world';
import { autoplay } from '../src/sim/autoplay';
import { stages } from '../src/data';
import { STAGE_PLANS } from '../src/balance/plans';
import { balanceMeta } from '../src/balance/investment';

const SEED = 20260816;

const stageId = process.argv[2] ?? 'S3';
const stagePlan = STAGE_PLANS[stageId];
const plan = stagePlan?.placements ?? [];

// そのステージが前提とする恒久強化を込みで測る。素の値で振ると、
// 月の都の章（S11 以降）は全行が「負け」になって境界が見えない
const meta = (level: number) => balanceMeta(stageId, level);

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
