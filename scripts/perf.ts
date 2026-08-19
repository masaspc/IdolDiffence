/**
 * 1 フレームの処理時間を測る（07-roadmap.md M6「敵 200 体で 60fps」）。
 *
 * **60fps を「たぶん出ている」で済ませない。** 予算は 1 フレーム 16.67ms で、
 * そのうち sim（`world.update`）と読み出し（`world.snapshot`）がどれだけ
 * 食うかはここで数字にする。描画（Canvas 2D）はブラウザが要るのでここでは
 * 測れない ―― **測れていないものは測れていないと言う**。
 *
 *   npx tsx scripts/perf.ts            # 全ステージ × ★1/★10 を掃いて最悪ケースを測る
 *   npx tsx scripts/perf.ts S28 10     # ステージと ★ を指定
 *   npx tsx scripts/perf.ts --stress   # 実在しない密度まで水増しして 200 体を作る
 *
 * `performance.now()` を使ってよいのは scripts/** と core/loop.ts だけ
 * （決定性の Lint）。sim の中では絶対に読まない。
 */
import { performance } from 'node:perf_hooks';
import { createWorld, type BattleWorld } from '../src/sim/world';
import { FIXED_STEP_MS } from '../src/core/loop';
import { stageOrder, stages } from '../src/data';
import { STAGE_PLANS } from '../src/balance/plans';
import { balanceMeta } from '../src/balance/investment';

const SEED = 20260816;
/** 60fps の予算 */
const BUDGET_MS = 1000 / 60;
const MAX_FRAMES = 60 * 60 * 10; // 10 分ぶんで打ち切り

interface FrameSample {
  enemies: number;
  updateMs: number;
  snapshotMs: number;
}

interface RunResult {
  stageId: string;
  star: number;
  frames: number;
  maxEnemies: number;
  samples: FrameSample[];
}

/**
 * ブラウザの 1 フレームと同じ順で回す。
 *
 * 実機は `update` を 1 回以上と `snapshot` を 1 回。ここも同じにしておかないと
 * 「速い」と言った数字が実機の数字にならない
 */
function run(stageId: string, star: number, collect: boolean): RunResult {
  const plan = STAGE_PLANS[stageId]?.placements ?? [];
  // 最悪ケースを見たいので、盤面は**弱いまま**（Lv1・強化なし）。
  // 強く育てると敵が即死して数が増えない
  const world: BattleWorld = createWorld(stageId, SEED, {
    ...balanceMeta(stageId, 1, 'bare'),
    star,
  });

  const samples: FrameSample[] = [];
  let maxEnemies = 0;
  let cursor = 0;
  let frames = 0;

  for (; frames < MAX_FRAMES; frames++) {
    const t0 = performance.now();
    world.update(FIXED_STEP_MS);
    const t1 = performance.now();
    const snap = world.snapshot();
    const t2 = performance.now();

    const enemies = snap.enemies.length;
    if (enemies > maxEnemies) maxEnemies = enemies;
    if (collect) samples.push({ enemies, updateMs: t1 - t0, snapshotMs: t2 - t1 });

    if (snap.finished) break;

    // ◆ は sim を止める。選ばないと永遠に進まない（autoplay と同じ扱い）
    if (snap.offers) {
      world.chooseCard(snap.offers[0]?.id ?? '');
      continue;
    }
    if (world.specialReady) world.activateSpecial();

    const next = plan[cursor];
    if (next && typeof world.placeUnit(next.idolId, next.x, next.y) !== 'string') cursor++;
  }

  return { stageId, star, frames, maxEnemies, samples };
}

/**
 * 実在の密度では 200 体に届かないので、**わざと水増しした盤面**を作る。
 *
 * ロードマップの目標は「敵 200 体で 60fps」だが、34 ステージのどこにも
 * 200 体が同時に立つ場面は無い（掃いた結果 85 体が最大）。目標の数字が
 * 実際に何 ms なのかは、密度を上げて測らないと答えられない。
 * **ここで書き換えるのはメモリ上の複製ではなくロード済みのデータそのもの**
 * なので、計測専用のプロセスでしか呼ばない。
 */
function inflate(stageId: string, factor: number): void {
  const stage = stages[stageId];
  if (!stage) throw new Error(`unknown stage: ${stageId}`);
  for (const wave of stage.waves) {
    for (const spawn of wave.spawns) {
      spawn.count *= factor;
      spawn.intervalBars /= factor;
    }
  }
}

function quantile(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) return 0;
  const i = Math.min(sorted.length - 1, Math.floor(q * sorted.length));
  return sorted[i] ?? 0;
}

/** 敵の数で束ねる。「200 体で何 ms か」は束ねないと出てこない */
function buckets(samples: readonly FrameSample[]): void {
  const EDGES = [0, 10, 20, 40, 60, 80, 100, 150, 200, 300];
  console.log('\n敵の数ごとの 1 フレーム（update + snapshot, ms）');
  console.log('  敵      frames   p50     p99     max     予算比(p99)');
  for (let i = 0; i < EDGES.length; i++) {
    const lo = EDGES[i] ?? 0;
    const hi = EDGES[i + 1] ?? Infinity;
    const hit = samples.filter((s) => s.enemies >= lo && s.enemies < hi);
    if (hit.length === 0) continue;
    const total = hit.map((s) => s.updateMs + s.snapshotMs).sort((a, b) => a - b);
    const p50 = quantile(total, 0.5);
    const p99 = quantile(total, 0.99);
    const max = total[total.length - 1] ?? 0;
    const label = hi === Infinity ? `${lo}+` : `${lo}-${hi - 1}`;
    console.log(
      `  ${label.padEnd(8)}${String(hit.length).padStart(6)}  ` +
        `${p50.toFixed(3).padStart(6)}  ${p99.toFixed(3).padStart(6)}  ` +
        `${max.toFixed(3).padStart(6)}  ${((p99 / BUDGET_MS) * 100).toFixed(1)}%`,
    );
  }
}

function main(): void {
  const args = process.argv.slice(2);
  if (args[0] === '--stress') {
    const stageId = args[1] ?? 'S30';
    const star = Number(args[2] ?? '10');
    const factor = Number(args[3] ?? '6');
    inflate(stageId, factor);
    const result = run(stageId, star, true);
    console.log(
      `水増し ${stageId} ★${star} ×${factor}: ${result.frames} frames, 同時最大 ${result.maxEnemies} 体`,
    );
    buckets(result.samples);
    return;
  }
  if (args.length > 0) {
    const stageId = args[0] ?? 'S1';
    const star = Number(args[1] ?? '1');
    const result = run(stageId, star, true);
    console.log(`${stageId} ★${star}: ${result.frames} frames, 同時最大 ${result.maxEnemies} 体`);
    buckets(result.samples);
    return;
  }

  // 掃く。まず「どこがいちばん混むか」を探す
  console.log('全ステージ × ★1 / ★10 —— 同時最大の敵数');
  const found: RunResult[] = [];
  for (const stageId of stageOrder) {
    for (const star of [1, 10]) {
      const r = run(stageId, star, false);
      found.push(r);
    }
  }
  found.sort((a, b) => b.maxEnemies - a.maxEnemies);
  for (const r of found.slice(0, 12)) {
    console.log(`  ${r.stageId.padEnd(4)} ★${String(r.star).padStart(2)}  ${String(r.maxEnemies).padStart(4)} 体  (${r.frames} frames)`);
  }

  const worst = found[0];
  if (!worst) return;
  console.log(`\n最悪ケース ${worst.stageId} ★${worst.star} を測り直す`);
  const timed = run(worst.stageId, worst.star, true);
  buckets(timed.samples);

  const all = timed.samples.map((s) => s.updateMs + s.snapshotMs).sort((a, b) => a - b);
  console.log(
    `\n全体: p50 ${quantile(all, 0.5).toFixed(3)}ms / p99 ${quantile(all, 0.99).toFixed(3)}ms / ` +
      `max ${(all[all.length - 1] ?? 0).toFixed(3)}ms（予算 ${BUDGET_MS.toFixed(2)}ms）`,
  );
  const over = all.filter((ms) => ms > BUDGET_MS).length;
  console.log(`予算超え: ${over} / ${all.length} frames (${((over / all.length) * 100).toFixed(2)}%)`);
}

main();
