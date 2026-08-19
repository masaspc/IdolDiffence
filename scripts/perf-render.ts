/**
 * **描画**の 1 フレームを実機で測る（07-roadmap.md M6「敵 200 体で 60fps」）。
 *
 * `scripts/perf.ts` で測れるのは sim と読み出しだけで、Canvas 2D の描画は
 * ブラウザが無いと測れない。ここはそのブラウザ側 ―― 開発サーバーを立てて
 * このページを開くと、敵を水増しした盤面を実際に描いて時間を並べる。
 *
 *   npm run dev
 *   → http://localhost:5173/scripts/perf-render.html?stage=S30&star=10&factor=6
 *
 * `npx tsx scripts/perf-render-run.ts` が Chromium で同じことを自動でやる。
 *
 * 実時間を読むのはここが**描画の計測そのもの**だから。sim には持ち込まない。
 */
import { createWorld } from '../src/sim/world';
import { Renderer, type HoverState } from '../src/render/renderer';
import { FIXED_STEP_MS } from '../src/core/loop';
import { stages } from '../src/data';
import { STAGE_PLANS } from '../src/balance/plans';
import { balanceMeta } from '../src/balance/investment';

const SEED = 20260816;
const BUDGET_MS = 1000 / 60;

const params = new URLSearchParams(location.search);
const stageId = params.get('stage') ?? 'S30';
const star = Number(params.get('star') ?? '10');
const factor = Number(params.get('factor') ?? '6');
const maxFrames = Number(params.get('frames') ?? '3600');

/** `scripts/perf.ts` の inflate と同じ。実在の密度では 200 体に届かない */
function inflate(id: string, mul: number): void {
  const stage = stages[id];
  if (!stage) throw new Error(`unknown stage: ${id}`);
  for (const wave of stage.waves) {
    for (const spawn of wave.spawns) {
      spawn.count *= mul;
      spawn.intervalBars /= mul;
    }
  }
}

interface Sample {
  enemies: number;
  drawMs: number;
}

const HOVER: HoverState = {
  cell: null,
  pendingIdolId: null,
  pendingRange: 0,
  pendingValid: false,
  selectedUnitId: null,
};

function quantile(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0;
}

function report(samples: readonly Sample[], maxEnemies: number): string {
  const EDGES = [0, 10, 20, 40, 60, 80, 100, 150, 200, 300];
  const lines: string[] = [
    `${stageId} ★${star} ×${factor}: ${samples.length} frames, 同時最大 ${maxEnemies} 体`,
    `dpr=${window.devicePixelRatio} canvas=${innerWidth}x${Math.round(innerHeight * 0.6)}`,
    '',
    '敵の数ごとの draw（ms）',
    '  敵      frames   p50     p99     max     予算比(p99)',
  ];
  for (let i = 0; i < EDGES.length; i++) {
    const lo = EDGES[i] ?? 0;
    const hi = EDGES[i + 1] ?? Infinity;
    const hit = samples.filter((s) => s.enemies >= lo && s.enemies < hi);
    if (hit.length === 0) continue;
    const ms = hit.map((s) => s.drawMs).sort((a, b) => a - b);
    const label = hi === Infinity ? `${lo}+` : `${lo}-${hi - 1}`;
    lines.push(
      `  ${label.padEnd(8)}${String(hit.length).padStart(6)}  ` +
        `${quantile(ms, 0.5).toFixed(3).padStart(6)}  ${quantile(ms, 0.99).toFixed(3).padStart(6)}  ` +
        `${(ms[ms.length - 1] ?? 0).toFixed(3).padStart(6)}  ` +
        `${((quantile(ms, 0.99) / BUDGET_MS) * 100).toFixed(1)}%`,
    );
  }
  const all = samples.map((s) => s.drawMs).sort((a, b) => a - b);
  lines.push(
    '',
    `全体: p50 ${quantile(all, 0.5).toFixed(3)}ms / p99 ${quantile(all, 0.99).toFixed(3)}ms / ` +
      `max ${(all[all.length - 1] ?? 0).toFixed(3)}ms（予算 ${BUDGET_MS.toFixed(2)}ms）`,
  );
  const over = all.filter((ms) => ms > BUDGET_MS).length;
  lines.push(`予算超え: ${over} / ${all.length} frames (${((over / all.length) * 100).toFixed(2)}%)`);
  return lines.join('\n');
}

function main(): void {
  if (factor > 1) inflate(stageId, factor);
  const canvas = document.getElementById('board') as HTMLCanvasElement;
  const out = document.getElementById('out') as HTMLPreElement;
  const world = createWorld(stageId, SEED, { ...balanceMeta(stageId, 1, 'bare'), star });
  const renderer = new Renderer(canvas, world);
  renderer.resize(innerWidth, innerHeight * 0.6, window.devicePixelRatio || 1);

  const plan = STAGE_PLANS[stageId]?.placements ?? [];
  const samples: Sample[] = [];
  let cursor = 0;
  let maxEnemies = 0;

  // **requestAnimationFrame で回す。** ここで while ループを回すと合成が
  // 走らないまま数字だけが出て、「速い」と言った描画が画面に出ていない
  const step = (): void => {
    for (let n = 0; n < 4 && samples.length < maxFrames; n++) {
      world.update(FIXED_STEP_MS);
      const snap = world.snapshot();
      if (snap.offers) world.chooseCard(snap.offers[0]?.id ?? '');
      else if (world.specialReady) world.activateSpecial();
      else {
        const next = plan[cursor];
        if (next && typeof world.placeUnit(next.idolId, next.x, next.y) !== 'string') cursor++;
      }
      const t0 = performance.now();
      renderer.draw(snap, HOVER, 0);
      const t1 = performance.now();
      if (snap.enemies.length > maxEnemies) maxEnemies = snap.enemies.length;
      samples.push({ enemies: snap.enemies.length, drawMs: t1 - t0 });
      if (snap.finished) {
        out.textContent = report(samples, maxEnemies);
        (window as unknown as { __perfDone: boolean }).__perfDone = true;
        return;
      }
    }
    if (samples.length >= maxFrames) {
      out.textContent = report(samples, maxEnemies);
      (window as unknown as { __perfDone: boolean }).__perfDone = true;
      return;
    }
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

main();
