import { describe, expect, it } from 'vitest';
import { createWorld } from './world';
import { runHeadless, FIXED_STEP_MS } from '../core/loop';
import { autoplay } from './autoplay';

const SEED = 20260816;

describe('BattleWorld', () => {
  it('ステージと楽曲を読み込める', () => {
    const world = createWorld('S1', SEED);
    expect(world.stage.name).toBe('ツクヨミ辺境・路地裏ステージ');
    expect(world.song.bpm).toBe(132);
  });

  it('未知のステージは例外', () => {
    expect(() => createWorld('S999', SEED)).toThrow();
  });

  it('開始時の声援と観客ゲージ', () => {
    const snap = createWorld('S1', SEED).snapshot();
    expect(snap.cheer).toBe(150);
    expect(snap.audience).toBe(100);
    expect(snap.voltage).toBe(0);
  });

  it('声援が時間とともに増える', () => {
    const world = createWorld('S1', SEED);
    const before = world.snapshot().cheer;
    runHeadless(1000, (dt) => world.update(dt));
    const after = world.snapshot().cheer;
    // 満タン時 6.0/秒
    expect(after - before).toBeGreaterThanOrEqual(5);
    expect(after - before).toBeLessThanOrEqual(7);
  });

  it('声援は負にならない', () => {
    const world = createWorld('S1', SEED);
    world.addCheer(-10000);
    expect(world.snapshot().cheer).toBe(0);
  });

  it('足りない声援は消費できない', () => {
    const world = createWorld('S1', SEED);
    expect(world.spendCheer(1000)).toBe(false);
    expect(world.snapshot().cheer).toBe(150);
    expect(world.spendCheer(30)).toBe(true);
    expect(world.snapshot().cheer).toBe(120);
  });

  it('月華ゲージが小節ごとに溜まり、100 を超えない', () => {
    const world = createWorld('S1', SEED);
    runHeadless(10_000, (dt) => world.update(dt));
    const snap = world.snapshot();
    expect(snap.voltage).toBeGreaterThan(0);
    expect(snap.voltage).toBeLessThanOrEqual(100);

    world.addVoltage(1000);
    expect(world.snapshot().voltage).toBe(100);
  });

  it('観客ゲージが 0 になるとライブ中断', () => {
    const world = createWorld('S1', SEED);
    world.leakAudience(100);
    const snap = world.snapshot();
    expect(snap.audience).toBe(0);
    expect(snap.finished).toBe(true);
    expect(snap.won).toBe(false);
  });

  it('観客ゲージは 0 を下回らない', () => {
    const world = createWorld('S1', SEED);
    world.leakAudience(9999);
    expect(world.snapshot().audience).toBe(0);
  });

  it('ウェーブがセクションの順に進む', () => {
    const world = createWorld('S1', SEED);
    expect(world.currentWave?.section).toBe('intro');
    expect(world.currentWave?.startBar).toBe(0);

    // イントロは 8 小節。1 小節 = 4 拍 / 132BPM ≒ 1818ms
    const msPerBar = world.clock.msPerBar;
    runHeadless(msPerBar * 8 + FIXED_STEP_MS, (dt) => world.update(dt));
    expect(world.currentWave?.section).toBe('verse');
  });

  it('迎撃しなければ観客が尽きて終了する', () => {
    // 完走できるケースは battle.test.ts の「経路沿いに置けば完走できる」で見る
    const world = createWorld('S1', SEED);
    const { snapshot } = autoplay(world);
    expect(snapshot.finished).toBe(true);
    expect(snapshot.won).toBe(false);
  });

  it('同じ seed なら同じ結果になる（決定性）', () => {
    const run = (): string => {
      const world = createWorld('S1', SEED);
      runHeadless(30_000, (dt) => world.update(dt));
      return JSON.stringify(world.snapshot());
    };
    expect(run()).toBe(run());
  });
});
