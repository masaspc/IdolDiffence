import { describe, expect, it } from 'vitest';
import { buildSpawnSchedule, checkScheduleFitsWaves, waveHpMultiplier } from './spawn';
import type { Stage } from '../../data/schema/stage';
import { stageSchema } from '../../data/schema/stage';
import type { Song } from '../../data/schema/song';
import { songSchema } from '../../data/schema/song';

const song = (bpm: number): Song =>
  songSchema.parse({ name: 'test', writer: 'test', singer: 'test', bpm, beatsPerBar: 4, tempoBase: 132 });

const stage = (): Stage =>
  stageSchema.parse({
    name: 'テスト',
    grid: { w: 8, h: 6 },
    lanes: [{ waypoints: [[0, 3], [7, 3]] }],
    placeable: [[2, 1]],
    song: 'test',
    waves: [
      { section: 'intro', bars: 8, spawns: [] },
      {
        section: 'verse',
        bars: 16,
        spawns: [{ bar: 1, enemy: 'e_walker', count: 10, intervalBars: 1.5, lane: 0 }],
      },
    ],
  });

describe('waveHpMultiplier', () => {
  it('ウェーブごとに 18% ずつ増える', () => {
    expect(waveHpMultiplier(0)).toBe(1);
    expect(waveHpMultiplier(1)).toBeCloseTo(1.18);
    expect(waveHpMultiplier(7)).toBeCloseTo(2.26);
  });
});

describe('buildSpawnSchedule', () => {
  it('時刻順に並ぶ', () => {
    const schedule = buildSpawnSchedule(stage(), song(132));
    const times = schedule.map((s) => s.atMs);
    expect([...times].sort((a, b) => a - b)).toEqual(times);
  });

  it('基準 BPM では数も間隔もそのまま', () => {
    const schedule = buildSpawnSchedule(stage(), song(132));
    expect(schedule).toHaveLength(10);
    const msPerBar = (60000 / 132) * 4;
    expect(schedule[0]?.atMs).toBeCloseTo(9 * msPerBar); // イントロ 8 小節 + bar1
    expect((schedule[1]!.atMs - schedule[0]!.atMs) / msPerBar).toBeCloseTo(1.5);
  });

  it('低 BPM では数が増え、間隔が縮む', () => {
    const schedule = buildSpawnSchedule(stage(), song(118)); // tempoMul ≒ 1.119
    expect(schedule.length).toBeGreaterThan(10);
    const msPerBar = (60000 / 118) * 4;
    const gap = (schedule[1]!.atMs - schedule[0]!.atMs) / msPerBar;
    expect(gap).toBeLessThan(1.5);
  });

  it('高 BPM では数が減る', () => {
    const schedule = buildSpawnSchedule(stage(), song(172));
    expect(schedule.length).toBeLessThan(10);
  });

  it('テンポ正規化してもウェーブからはみ出さない', () => {
    // 数だけ増やして間隔を据え置くと、増えた分が次のセクションへこぼれる
    for (const bpm of [118, 132, 148, 172]) {
      expect(checkScheduleFitsWaves(stage(), song(bpm))).toEqual([]);
    }
  });

  it('はみ出しを検出できる', () => {
    const broken = stage();
    broken.waves[1]!.spawns[0]!.count = 40; // 16 小節に収まらない
    expect(checkScheduleFitsWaves(broken, song(132)).length).toBeGreaterThan(0);
  });
});
