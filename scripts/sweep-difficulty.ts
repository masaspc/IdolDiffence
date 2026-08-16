/**
 * hpMul を振って、育成レベルごとのクリア可否を見る調整用スクリプト。
 *   npx tsx scripts/sweep-difficulty.ts
 */
import { createWorld } from '../src/sim/world';
import { autoplay, type Placement } from '../src/sim/autoplay';
import { getIdol, rosterIds, stages } from '../src/data';
import { levelAtkMultiplier } from '../src/meta/progression';

const SEED = 20260816;
const meta = (level: number) => ({
  atkByIdol: Object.fromEntries(
    rosterIds.map((id) => [id, getIdol(id).base.atk * levelAtkMultiplier(level)]),
  ),
});

const PLANS: Record<string, Placement[]> = {
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

const stageId = process.argv[2] ?? 'S3';
const plan = PLANS[stageId] ?? [];
const original = stages[stageId]!.hpMul;

console.log(`${stageId} (現行 hpMul=${original})`);
console.log('hpMul  Lv1   Lv5   Lv10  Lv15  Lv20  Lv30');
// 現行値とその周辺を必ず含める。含めないと採用値の境界を検証できない
const current = stages[stageId]!.hpMul;
const candidates = [...new Set([
  current * 0.5, current * 0.75, current, current * 1.25, current * 1.5, current * 2,
].map((v) => Math.round(v * 100) / 100))].sort((a, b) => a - b);

for (const hpMul of candidates) {
  stages[stageId]!.hpMul = hpMul;
  const cells = [1, 5, 10, 15, 20, 30].map((level) => {
    const world = createWorld(stageId, SEED, meta(level));
    const { snapshot } = autoplay(world, { plan, useSpecial: true });
    return (snapshot.won ? `○${snapshot.audience}` : `×${snapshot.killed}`).padEnd(6);
  });
  console.log(String(hpMul).padEnd(6), cells.join(''));
}
stages[stageId]!.hpMul = original;
