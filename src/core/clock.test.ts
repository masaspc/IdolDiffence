import { describe, expect, it, vi } from 'vitest';
import { GameClock, type BeatInfo } from './clock';

const BPM = 120; // 1 拍 = 500ms、1 小節 = 2000ms

describe('GameClock', () => {
  it('BPM から拍長と小節長を導く', () => {
    const clock = new GameClock(BPM, 4);
    expect(clock.msPerBeat).toBe(500);
    expect(clock.msPerBar).toBe(2000);
  });

  it('advance で sim 時刻が進む', () => {
    const clock = new GameClock(BPM);
    clock.advance(1000);
    expect(clock.now).toBe(1000);
    expect(clock.absoluteBeat).toBe(2);
    expect(clock.bar).toBe(0);
  });

  it('小節をまたぐと bar が増える', () => {
    const clock = new GameClock(BPM);
    clock.advance(2000);
    expect(clock.bar).toBe(1);
  });

  it('ポーズ中は進まない', () => {
    const clock = new GameClock(BPM);
    clock.pause();
    const applied = clock.advance(1000);
    expect(applied).toBe(0);
    expect(clock.now).toBe(0);
  });

  it('resume で再開する', () => {
    const clock = new GameClock(BPM);
    clock.pause();
    clock.advance(1000);
    clock.resume();
    clock.advance(500);
    expect(clock.now).toBe(500);
  });

  it('速度倍率が時刻の進みに掛かる', () => {
    const clock = new GameClock(BPM);
    clock.setSpeed(3);
    expect(clock.advance(100)).toBe(300);
    expect(clock.now).toBe(300);
  });

  it('跨いだ拍を 1 つずつ順番に通知する', () => {
    const clock = new GameClock(BPM);
    const beats: BeatInfo[] = [];
    // 2500ms = 5 拍ぶんを一気に進めても、5 回に分けて通知される。
    // 小節単位で定義されたスポーンを取りこぼさないために必要。
    clock.advance(2500, (info) => beats.push(info));
    expect(beats.map((b) => b.absoluteBeat)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(beats.map((b) => b.bar)).toEqual([0, 0, 0, 0, 1, 1]);
    expect(beats.map((b) => b.beat)).toEqual([0, 1, 2, 3, 0, 1]);
  });

  it('同じ拍を二度通知しない', () => {
    const clock = new GameClock(BPM);
    const onBeat = vi.fn();
    clock.advance(100, onBeat);
    clock.advance(100, onBeat);
    clock.advance(100, onBeat);
    expect(onBeat).toHaveBeenCalledTimes(1); // 拍 0 のみ
  });

  it('カード選択では sim が止まり、決定後は次の小節頭から再開する', () => {
    const clock = new GameClock(BPM);
    clock.advance(2500); // 1 小節 + 250ms
    clock.beginChoice();

    expect(clock.advance(5000)).toBe(0);
    expect(clock.now).toBe(2500);

    clock.endChoice();
    expect(clock.now).toBe(4000); // 次の小節境界へスナップ
    expect(clock.bar).toBe(2);
    expect(clock.currentState).toBe('running');
  });

  it('ちょうど小節境界にいるときは 1 小節飛ばさない', () => {
    const clock = new GameClock(BPM);
    clock.advance(2000);
    clock.beginChoice();
    clock.endChoice();
    expect(clock.now).toBe(2000);
  });

  it('barProgress が小節内の進捗を 0..1 で返す', () => {
    const clock = new GameClock(BPM);
    clock.advance(500);
    expect(clock.barProgress).toBeCloseTo(0.25);
    clock.advance(500);
    expect(clock.barProgress).toBeCloseTo(0.5);
  });

  it('不正な BPM と速度を拒否する', () => {
    expect(() => new GameClock(0)).toThrow();
    expect(() => new GameClock(120).setSpeed(0)).toThrow();
  });

  it('reset で初期状態に戻る', () => {
    const clock = new GameClock(BPM);
    clock.advance(5000);
    clock.setSpeed(2);
    clock.pause();
    clock.reset();
    expect(clock.now).toBe(0);
    expect(clock.playbackSpeed).toBe(1);
    expect(clock.isRunning).toBe(true);
  });
});
