/**
 * ヘッドレスのバランス検証（簡易版）。
 *
 * M2 の判断ポイントで「なぜ勝てたのか / 負けたのか」を切り分けられるよう、
 * 本格的な CI 検証より先に最小限のランナーを用意しておく
 * （docs/design/07-roadmap.md M2 の計測）。
 *
 *   npx tsx src/balance/probe.ts
 */
import { createWorld } from '../sim/world';
import { runHeadless } from '../core/loop';
import { rosterIds } from '../data';

interface Placement {
  idolId: string;
  x: number;
  y: number;
}

interface RunResult {
  label: string;
  won: boolean;
  audience: number;
  killed: number;
  leaked: number;
  cheerLeft: number;
  placed: number;
  elapsedSec: number;
}

/**
 * 配置は「声援が貯まり次第、リストの順に置いていく」という
 * 素朴な AI で行う。人間の最適配置ではないが、下限の目安になる。
 */
function run(label: string, plan: Placement[], seed = 20260816): RunResult {
  const world = createWorld('S1', seed);
  let cursor = 0;
  let elapsedMs = 0;

  runHeadless(
    10 * 60 * 1000,
    (dt) => {
      world.update(dt);
      elapsedMs += dt;
      const next = plan[cursor];
      if (next && world.canPlace(next.idolId, next.x, next.y) === null) {
        world.placeUnit(next.idolId, next.x, next.y);
        cursor++;
      }
    },
    () => world.snapshot().finished,
  );

  const snap = world.snapshot();
  return {
    label,
    won: snap.won,
    audience: snap.audience,
    killed: snap.killed,
    leaked: snap.leaked,
    cheerLeft: snap.cheer,
    placed: cursor,
    elapsedSec: Math.round(elapsedMs / 1000),
  };
}

// S1 の配置マス: (2,2)(3,3)(4,6)(5,2)(8,3)(8,5)(9,2)(11,4)(12,5)(13,2)
// 経路は (0,4)→(6,4)→(6,7)→(11,7)→(15,5)
const NEAR_PATH: Placement[] = [
  { idolId: 'D1', x: 4, y: 6 }, // 序盤の縦区間をカバー
  { idolId: 'V1', x: 8, y: 5 }, // 花道。下段の横区間に届く
  { idolId: 'Vi1', x: 12, y: 5 }, // 終盤の減速役
  { idolId: 'D1', x: 11, y: 4 },
  { idolId: 'V1', x: 3, y: 3 },
  { idolId: 'D1', x: 8, y: 3 },
  { idolId: 'V1', x: 2, y: 2 },
  { idolId: 'Vi1', x: 5, y: 2 },
];

const FAR: Placement[] = [
  { idolId: 'V1', x: 2, y: 2 },
  { idolId: 'V1', x: 5, y: 2 },
  { idolId: 'V1', x: 9, y: 2 },
  { idolId: 'V1', x: 13, y: 2 },
];

const results: RunResult[] = [
  run('無配置', []),
  run('射程外に固める（悪手）', FAR),
  run('ダンス 1 枚だけ', [{ idolId: 'D1', x: 4, y: 6 }]),
  run('経路沿いに 3 枚', NEAR_PATH.slice(0, 3)),
  run('経路沿いにフル', NEAR_PATH),
];

for (const id of rosterIds) {
  results.push(run(`${id} だけで固める`, NEAR_PATH.map((p) => ({ ...p, idolId: id }))));
}

const pad = (text: string, width: number): string =>
  text + ' '.repeat(Math.max(0, width - [...text].reduce((n, c) => n + (c.charCodeAt(0) > 0xff ? 2 : 1), 0)));

console.log(pad('編成', 26), '結果   観客  撃破 漏れ 残声援 配置 経過');
for (const r of results) {
  console.log(
    pad(r.label, 26),
    r.won ? '完走  ' : '中断  ',
    String(r.audience).padStart(4),
    String(r.killed).padStart(5),
    String(r.leaked).padStart(4),
    String(r.cheerLeft).padStart(6),
    String(r.placed).padStart(4),
    `${r.elapsedSec}s`,
  );
}
