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

      for (let i = 0; i < count; i++) {
        const bar = waveStartBar + spawn.bar + i * spawn.intervalBars;
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
