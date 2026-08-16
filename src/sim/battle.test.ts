/**
 * M1 のバトル挙動。配置・撃破・漏れ・勝敗を、実際にステージを回して確かめる。
 */
import { describe, expect, it } from 'vitest';
import { createWorld } from './world';
import { runHeadless } from '../core/loop';
import { autoplay } from './autoplay';
import { slowFactor, applyStatus, tickStatuses, type Enemy } from './entities';

const SEED = 20260816;

describe('配置', () => {
  it('配置マスに置けて、声援が減る', () => {
    const world = createWorld('S1', SEED);
    const result = world.placeUnit('D1', 4, 6);
    expect(typeof result).not.toBe('string');
    expect(world.snapshot().cheer).toBe(125); // 150 - 25
    expect(world.snapshot().units).toHaveLength(1);
  });

  it('配置マス以外には置けない', () => {
    const world = createWorld('S1', SEED);
    expect(world.placeUnit('D1', 0, 0)).toBe('not-placeable');
    expect(world.snapshot().cheer).toBe(150);
  });

  it('経路上には置けない', () => {
    const world = createWorld('S1', SEED);
    // (3,4) は (0,4)→(6,4) の経路上
    expect(world.placeUnit('D1', 3, 4)).toBe('not-placeable');
  });

  it('同じマスには重ねられない', () => {
    const world = createWorld('S1', SEED);
    world.placeUnit('D1', 4, 6);
    expect(world.placeUnit('V1', 4, 6)).toBe('occupied');
  });

  it('声援が足りなければ置けない', () => {
    const world = createWorld('S1', SEED);
    world.addCheer(-140); // 残り 10
    expect(world.placeUnit('D1', 4, 6)).toBe('insufficient-cheer');
  });

  it('売却で 60% が返る', () => {
    const world = createWorld('S1', SEED);
    const unit = world.placeUnit('Vi1', 8, 5);
    if (typeof unit === 'string') throw new Error(unit);
    expect(world.snapshot().cheer).toBe(115); // 150 - 35
    expect(world.sellUnit(unit.id)).toBe(true);
    expect(world.snapshot().cheer).toBe(136); // + floor(35 * 0.6) = 21
    expect(world.snapshot().units).toHaveLength(0);
  });

  it('存在しないユニットの売却は false', () => {
    const world = createWorld('S1', SEED);
    expect(world.sellUnit(9999)).toBe(false);
  });
});

describe('戦闘', () => {
  it('射程内の敵にダメージが入り、撃破すると声援が増える', () => {
    const world = createWorld('S1', SEED);
    world.placeUnit('D1', 4, 6);
    const cheerAfterPlace = world.snapshot().cheer;

    const { snapshot } = autoplay(world, { maxMs: 60_000 });
    expect(snapshot.killed).toBeGreaterThan(0);
    // 自然回復ぶんを差し引いても、撃破報酬が入っている
    expect(snapshot.cheer).toBeGreaterThan(cheerAfterPlace);
  });

  it('配置しなければ 1 体も倒せない', () => {
    const world = createWorld('S1', SEED);
    const { snapshot } = autoplay(world, { maxMs: 60_000 });
    expect(snapshot.killed).toBe(0);
    expect(snapshot.leaked).toBeGreaterThan(0);
  });

  it('敵が漏れると観客ゲージが減る', () => {
    const world = createWorld('S1', SEED);
    const { snapshot } = autoplay(world, { maxMs: 90_000 });
    expect(snapshot.audience).toBeLessThan(100);
  });
});

describe('勝敗', () => {
  it('無配置なら観客が尽きて中断する', () => {
    const world = createWorld('S1', SEED);
    const { snapshot } = autoplay(world);
    expect(snapshot.finished).toBe(true);
    expect(snapshot.won).toBe(false);
    expect(snapshot.audience).toBe(0);
  });

  it('経路沿いに置けば完走できる', () => {
    const world = createWorld('S1', SEED);
    const { snapshot } = autoplay(world, {
      plan: [
        { idolId: 'D1', x: 4, y: 6 },
        { idolId: 'V1', x: 8, y: 5 },
        { idolId: 'Vi1', x: 12, y: 5 },
      ],
    });
    expect(snapshot.finished).toBe(true);
    expect(snapshot.won).toBe(true);
    expect(snapshot.killed).toBeGreaterThan(100);
  });

  it('決着後は状態が動かない', () => {
    const world = createWorld('S1', SEED);
    autoplay(world);
    const before = JSON.stringify(world.snapshot());
    runHeadless(5_000, (dt) => world.update(dt));
    expect(JSON.stringify(world.snapshot())).toBe(before);
  });

  it('決着後は配置できない', () => {
    const world = createWorld('S1', SEED);
    autoplay(world);
    expect(world.placeUnit('D1', 4, 6)).toBe('finished');
  });

  it('同じ seed と同じ操作なら同じ結果になる（決定性）', () => {
    const play = (): string => {
      const world = createWorld('S1', SEED);
      const { snapshot } = autoplay(world, { plan: [{ idolId: 'D1', x: 4, y: 6 }] });
      return `${snapshot.won}/${snapshot.audience}/${snapshot.killed}/${snapshot.leaked}`;
    };
    expect(play()).toBe(play());
  });
});

describe('状態異常', () => {
  // `traits` は耐性の判定で読むので、空でも持たせる
  const makeEnemy = (): Enemy => ({ statuses: [], traits: { boss: false } }) as unknown as Enemy;

  it('減速は最大値のみ適用される', () => {
    expect(slowFactor([{ kind: 'slow', value: 0.25, remainingMs: 100 }])).toBeCloseTo(0.75);
    expect(
      slowFactor([
        { kind: 'slow', value: 0.25, remainingMs: 100 },
        { kind: 'slow', value: 0.1, remainingMs: 100 },
      ]),
    ).toBeCloseTo(0.75);
  });

  it('減速の上限は -75%', () => {
    expect(slowFactor([{ kind: 'slow', value: 0.99, remainingMs: 100 }])).toBeCloseTo(0.25);
  });

  it('同種は強い方・長い方に更新される', () => {
    const enemy = makeEnemy();
    applyStatus(enemy, { kind: 'slow', value: 0.1, remainingMs: 1000 });
    applyStatus(enemy, { kind: 'slow', value: 0.25, remainingMs: 500 });
    expect(enemy.statuses).toHaveLength(1);
    expect(enemy.statuses[0]?.value).toBeCloseTo(0.25);
    expect(enemy.statuses[0]?.remainingMs).toBe(1000);
  });

  it('時間が切れると消える', () => {
    const enemy = makeEnemy();
    applyStatus(enemy, { kind: 'slow', value: 0.25, remainingMs: 100 });
    tickStatuses(enemy, 50);
    expect(enemy.statuses).toHaveLength(1);
    tickStatuses(enemy, 60);
    expect(enemy.statuses).toHaveLength(0);
  });
});
