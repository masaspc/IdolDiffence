/**
 * リザルトの貢献度（03-progression.md ⑫ / 06-ui-ux.md）。
 *
 * 「誰がどれだけ出したか」を出すからには、**盤面で起きたダメージが全部入る**
 * ことが前提になる。抜けがあると、割合そのものが嘘になる。
 */
import { describe, expect, it } from 'vitest';
import { createWorld, type BattleWorld } from './world';
import { runHeadless } from '../core/loop';
import { applyStatus, type Enemy, type StatusEffect } from './entities';
import { getEnemy } from '../data';
import { vec } from '../core/vec';

function total(world: BattleWorld): number {
  return world.snapshot().contribution.reduce((sum, c) => sum + c.damage, 0);
}

function makeEnemy(): Enemy {
  const def = getEnemy('e_walker');
  return {
    id: 1,
    defId: 'e_walker',
    name: def.name,
    attr: def.attr,
    hp: def.hp,
    maxHp: def.hp,
    def: def.def,
    baseSpeed: def.speed,
    flying: def.flying,
    radius: def.radius,
    leak: def.leak,
    bounty: def.bounty,
    traits: def.traits,
    lane: 0,
    pathIndex: 0,
    pathT: 0,
    progress: 0,
    pos: vec(0, 0),
    prevPos: vec(0, 0),
    statuses: [],
    alive: true,
    revivesLeft: 0,
  };
}

function echo(sourceId: string, dps: number): StatusEffect {
  return { kind: 'echo', value: 1, remainingMs: 4000, stacks: 1, dps, sourceId };
}

describe('Echo の出どころ', () => {
  it('付けた本人を覚える', () => {
    const enemy = makeEnemy();
    applyStatus(enemy, echo('V1', 18));
    expect(enemy.statuses[0]?.sourceId).toBe('V1');
  });

  it('毎秒ダメージを更新した人が貢献者になる', () => {
    // 重なった Echo は「いちばん強い 1 人」の dps で計算する。
    // dps だけ更新して貢献者を据え置くと、他人の火力が別人の棒グラフに積まれる
    const enemy = makeEnemy();
    applyStatus(enemy, echo('V1', 18));
    applyStatus(enemy, echo('V3', 30));
    expect(enemy.statuses[0]?.dps).toBe(30);
    expect(enemy.statuses[0]?.sourceId).toBe('V3');
  });

  it('弱い Echo が後から来ても貢献者は変わらない', () => {
    const enemy = makeEnemy();
    applyStatus(enemy, echo('V3', 30));
    applyStatus(enemy, echo('V1', 18));
    expect(enemy.statuses[0]?.dps).toBe(30);
    expect(enemy.statuses[0]?.sourceId).toBe('V3');
  });
});

/** セットリストの ◆ は sim を止める。誰かが選ばないと時間が進まない */
function step(world: BattleWorld, ms: number): void {
  runHeadless(ms, (dt) => {
    world.update(dt);
    const offers = world.snapshot().offers;
    const first = offers?.[0];
    if (first) world.chooseCard(first.id);
  });
}

describe('盤面の貢献度', () => {
  it('Echo のぶんも入る（本人が盤面から消えた後でも）', () => {
    // かぐや（V1）の覚醒 B「ラップコール」は命中ごとに Echo を重ねる。
    // Echo の実ダメージは `updateEnemies` 側で入るので直撃とは別の経路を通り、
    // 繋ぎ忘れると棒グラフから Echo が丸ごと消える
    const world = createWorld('S3', 20260816, { party: ['V1'], center: null });
    world.addCheer(100_000);

    const unit = world.placeUnit('V1', 5, 3);
    if (typeof unit === 'string') throw new Error(unit);
    while (unit.level < 3 && world.upgradeUnit(unit.id) === null);
    expect(world.chooseAwakening(unit.id, 'B')).toBe(true);

    step(world, 25_000);
    const before = total(world);
    expect(before).toBeGreaterThan(0);

    // 本人を売る。これ以降に増えるぶんは Echo しかありえない
    expect(world.sellUnit(unit.id)).toBe(true);
    step(world, 3_000);

    expect(total(world)).toBeGreaterThan(before);
    expect(world.snapshot().contribution[0]?.idolId).toBe('V1');
  });

  it('過剰キル分は数えない', () => {
    // 素のダメージで数えると、硬い敵にとどめを刺した 1 人だけが不当に伸びる。
    // 一撃が敵の HP を大きく超える編成で、合計が「殴った回数 × 攻撃力」に
    // ならないことを見る
    const oneShot = 200_000;
    const world = createWorld('S1', 7, {
      party: ['V1'],
      center: null,
      atkByIdol: { V1: oneShot },
    });
    world.addCheer(100_000);
    const unit = world.placeUnit('V1', 4, 6);
    if (typeof unit === 'string') throw new Error(unit);

    step(world, 30_000);
    const killed = world.snapshot().killed;
    expect(killed).toBeGreaterThan(5);
    // 削れた HP の合計。1 体ぶんの HP は攻撃力よりずっと小さい
    expect(total(world)).toBeGreaterThan(0);
    expect(total(world)).toBeLessThan(killed * oneShot * 0.1);
  });
});
