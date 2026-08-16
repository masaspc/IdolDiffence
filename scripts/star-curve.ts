/**
 * ★ごとの要求戦力を実測する（02-core-battle.md 2.10）。
 *
 * 設計は「★10 で ★1 の約 60 倍」。恒久強化をすべて積んだときの到達点と
 * 一致させてあるので、ここがずれると「★10 が最終目標」でなくなる。
 *
 *   npx tsx scripts/star-curve.ts S5
 */
import { createWorld } from '../src/sim/world';
import { autoplay } from '../src/sim/autoplay';
import { getIdol, rosterIds } from '../src/data';
import { levelAtkMultiplier } from '../src/meta/progression';
import { STAGE_PLANS } from '../src/balance/plans';
import { MAX_STAR, starRuleText } from '../src/sim/star';

const SEED = 20260816;
const stageId = process.argv[2] ?? 'S5';
const sp = STAGE_PLANS[stageId]!;

/** その★をクリアできる最小の「攻撃力倍率」を二分探索で求める */
function requiredPower(star: number): number | null {
  const wins = (mul: number): boolean => {
    const meta = {
      atkByIdol: Object.fromEntries(rosterIds.map((id) => [id, getIdol(id).base.atk * mul])),
      party: sp.party,
      center: sp.center,
      star,
    };
    return autoplay(createWorld(stageId, SEED, meta), { plan: sp.placements, useSpecial: true })
      .snapshot.won;
  };
  if (!wins(400)) return null;
  let lo = 0.2;
  let hi = 400;
  for (let i = 0; i < 12; i++) {
    const mid = Math.sqrt(lo * hi);
    if (wins(mid)) hi = mid;
    else lo = mid;
  }
  return hi;
}

console.log(`${stageId}: ★ごとに必要な攻撃力倍率（Lv1 = ${levelAtkMultiplier(1)}）`);
const base = requiredPower(1);
for (let star = 1; star <= MAX_STAR; star++) {
  const need = requiredPower(star);
  const ratio = need && base ? (need / base).toFixed(1) : '-';
  const rule = starRuleText(star);
  console.log(
    `★${String(star).padStart(2)}  必要倍率 ${need ? need.toFixed(2) : '到達不能'}  ★1 比 ${ratio}×  ${rule ?? ''}`,
  );
}
