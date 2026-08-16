/**
 * ウェーブ進行と敵生成。
 *
 * スポーンは楽曲の小節単位で定義されているので、ステージ読み込み時に
 * 「何ミリ秒に何を出すか」へ展開しておく。実行時は先頭から消化するだけ。
 */
import type { Stage } from '../../data/schema/stage';
import type { Song } from '../../data/schema/song';
import { tempoMul } from '../../data/schema/song';

export interface ScheduledSpawn {
  /** 曲頭からの経過時間（ミリ秒） */
  atMs: number;
  enemyId: string;
  lane: number;
  /** このスポーンが属するウェーブ。HP スケーリングに使う */
  waveIndex: number;
}

/** ウェーブごとの HP 倍率。`1 + 0.18 × (wave - 1)`（02-core-battle.md 2.10） */
export function waveHpMultiplier(waveIndex: number): number {
  return 1 + 0.18 * waveIndex;
}

/**
 * スポーン表を時刻順に展開する。
 *
 * テンポ正規化（`tempoMul = tempoBase / bpm`）を出現数へ適用する。
 * 高 BPM の曲は 1 小節が短いぶん、同じ小節数でも敵が密になりすぎるため。
 * 端数は繰り越して総数のズレを最小化する。
 *
 * **出現間隔も同じ係数で縮める**。数だけ増やして間隔を据え置くと、
 * 増えた分がウェーブの尻からはみ出し、HUD が次のセクションを表示しているのに
 * 前のウェーブの敵が湧き続ける（最悪、大サビを越えて曲の外へこぼれる）。
 * 間隔を `interval / tempo` にすると、密度だけが変わり占有する小節数は保たれる。
 */
export function buildSpawnSchedule(stage: Stage, song: Song): ScheduledSpawn[] {
  const msPerBar = (60000 / song.bpm) * song.beatsPerBar;
  const tempo = tempoMul(song);
  const schedule: ScheduledSpawn[] = [];

  let waveStartBar = 0;
  let countCarry = 0;

  stage.waves.forEach((wave, waveIndex) => {
    for (const spawn of wave.spawns) {
      const scaled = spawn.count * tempo + countCarry;
      const count = Math.max(1, Math.round(scaled));
      countCarry = scaled - count;
      const interval = spawn.intervalBars / tempo;

      for (let i = 0; i < count; i++) {
        const bar = waveStartBar + spawn.bar + i * interval;
        schedule.push({
          atMs: bar * msPerBar,
          enemyId: spawn.enemy,
          lane: spawn.lane,
          waveIndex,
        });
      }
    }
    waveStartBar += wave.bars;
  });

  schedule.sort((a, b) => a.atMs - b.atMs);
  return schedule;
}

/**
 * 展開後のスポーンがウェーブの外へはみ出していないか検査する。
 * スキーマの検査は正規化前の値しか見られないので、こちらで実データを確かめる。
 *
 * @returns 問題の説明。空配列なら OK
 */
export function checkScheduleFitsWaves(stage: Stage, song: Song): string[] {
  const msPerBar = (60000 / song.bpm) * song.beatsPerBar;
  const schedule = buildSpawnSchedule(stage, song);
  const errors: string[] = [];

  const waveEndBars: number[] = [];
  let acc = 0;
  for (const wave of stage.waves) {
    acc += wave.bars;
    waveEndBars.push(acc);
  }
  const totalBars = acc;

  for (const spawn of schedule) {
    const bar = spawn.atMs / msPerBar;
    const end = waveEndBars[spawn.waveIndex];
    if (end !== undefined && bar > end) {
      errors.push(
        `テンポ正規化後のスポーンがウェーブ ${spawn.waveIndex} の終端 ${end} 小節を超えています` +
          `（${spawn.enemyId} が ${bar.toFixed(2)} 小節）`,
      );
    }
    if (bar > totalBars) {
      errors.push(`スポーンが曲の終わり ${totalBars} 小節を越えています（${spawn.enemyId}）`);
    }
  }
  // 同じ原因で大量に出るので先頭だけ返す
  return errors.slice(0, 5);
}
