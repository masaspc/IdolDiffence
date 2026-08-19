/**
 * BPM を原曲の実測値へ変えたので、影響を受けたステージの `hpMul` を測り直す。
 *
 * **狙いは「変更前と同じ手応え」を取り戻すこと。** 想定レベル帯を人が
 * 決め直すのではなく、**旧 BPM での結果を正解として**、新 BPM でそれに
 * いちばん近づく hpMul を探す。難度表は測って決める（04-content.md）という
 * このリポジトリの流儀そのまま。
 *
 *   npx tsx scripts/retune-hpmul.ts
 */
import { createWorld } from '../src/sim/world';
import { autoplay } from '../src/sim/autoplay';
import { songs, stages } from '../src/data';
import { STAGE_PLANS } from '../src/balance/plans';
import { balanceMeta } from '../src/balance/investment';

const SEED = 20260816;
/** 手応えを見る育成レベル。ここでの勝敗の並びが「難度の指紋」になる */
const LEVELS = [1, 5, 10, 15, 20, 25, 30];

/** 旧 BPM。原曲の実測値へ差し替える前の値 */
const OLD_BPM: Record<string, number> = {
  reply: 132,
  ray_cpk: 148,
  hoshifuru_umi: 118,
  shunkan: 172,
};

interface Profile {
  won: boolean[];
  audience: number[];
}

function profile(stageId: string): Profile {
  const plan = STAGE_PLANS[stageId];
  const won: boolean[] = [];
  const audience: number[] = [];
  for (const level of LEVELS) {
    const world = createWorld(stageId, SEED, balanceMeta(stageId, level));
    const { snapshot } = autoplay(world, {
      plan: plan?.placements ?? [],
      useSpecial: true,
    });
    won.push(snapshot.won);
    audience.push(snapshot.audience);
  }
  return { won, audience };
}

/** 勝敗の並びのズレ（重い）＋ 観客数のズレ（軽い）。小さいほど旧に近い */
function distance(a: Profile, b: Profile): number {
  let d = 0;
  for (let i = 0; i < a.won.length; i++) {
    if (a.won[i] !== b.won[i]) d += 100;
    d += Math.abs((a.audience[i] ?? 0) - (b.audience[i] ?? 0)) / 10;
  }
  return d;
}

const affected = Object.entries(stages)
  .filter(([, s]) => OLD_BPM[s.song] !== undefined)
  .map(([id]) => id)
  .sort();

console.log(`対象 ${affected.length} ステージ / 全 ${Object.keys(stages).length}`);
const result: Record<string, number> = {};

for (const stageId of affected) {
  const stage = stages[stageId]!;
  const song = songs[stage.song]!;
  const newBpm = song.bpm;
  const oldBpm = OLD_BPM[stage.song]!;
  const baseline = stage.hpMul;

  // 1) 旧 BPM での結果を「正解」として取る
  song.bpm = oldBpm;
  const want = profile(stageId);
  song.bpm = newBpm;

  // 2) 新 BPM で hpMul を振り、正解にいちばん近いものを採る。
  //
  // **方向を決め打ちしない。** BPM を上げると実時間は縮む（難しくなる）が、
  // 出現数も減る（易しくなる）ので、どちらへ倒れるかは曲と盤面による。
  // 上下に広く振ってから、いちばん近い値の周りを細かく詰める
  const coarse = [0.3, 0.45, 0.6, 0.75, 0.9, 1.0, 1.15, 1.35, 1.6, 2.0, 2.5];
  const round = (v: number): number => Math.max(0.05, Math.round(v * 100) / 100);
  let best = { hpMul: baseline, d: Infinity };
  for (const k of coarse) {
    const hpMul = round(baseline * k);
    stage.hpMul = hpMul;
    const d = distance(want, profile(stageId));
    if (d < best.d) best = { hpMul, d };
  }
  // 粗探しの当たりの周辺（±20%）を 5 点で詰める
  for (const k of [0.85, 0.925, 1.075, 1.15]) {
    const hpMul = round(best.hpMul * k);
    stage.hpMul = hpMul;
    const d = distance(want, profile(stageId));
    if (d < best.d) best = { hpMul, d };
  }
  const cands: number[] = [];

  void cands;
  stage.hpMul = best.hpMul;
  result[stageId] = best.hpMul;
  const mark = best.hpMul === baseline ? '据置' : `${baseline} → ${best.hpMul}`;
  console.log(
    `${stageId.padEnd(4)} ${stage.song.padEnd(14)} ${oldBpm}→${newBpm}  hpMul ${mark.padEnd(16)} ズレ ${best.d.toFixed(1)}`,
  );
}

console.log('\n--- 採用値（stages.json へ書き戻す）---');
console.log(JSON.stringify(result, null, 2));
