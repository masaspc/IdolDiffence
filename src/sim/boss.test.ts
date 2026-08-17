/**
 * ボス 4 種（04-content.md 4.3）。
 *
 * どちらも「数値が大きい敵」ではなく**問いを出す敵**なので、
 * 見るのは HP ではなく挙動 —— 属性が一周すること、レーンが止まること。
 */
import { describe, expect, it } from 'vitest';
import { createWorld, type BattleWorld } from './world';
import { runHeadless } from '../core/loop';
import { autoplay } from './autoplay';
import { bossStageIds, getEnemy, getIdol, getStage, rosterIds } from '../data';
import { levelAtkMultiplier } from '../meta/progression';
import { STAGE_PLANS } from '../balance/plans';
import { phaseAttribute } from './systems/boss';
import { buildPaths, nearestLane } from './path';
import { applyStatus, isImmobilized, type Enemy } from './entities';
import { vec } from '../core/vec';

/** 参照盤面で 1 ライブ通しで回す。ボスが湧くところまで持たせるために要る */
function worldWithPlan(stageId: string, subscribe: (world: BattleWorld) => void): BattleWorld {
  const plan = STAGE_PLANS[stageId];
  if (!plan) throw new Error(`${stageId} の参照盤面が無い`);
  const world = createWorld(stageId, 20260816, {
    atkByIdol: Object.fromEntries(
      rosterIds.map((id) => [id, getIdol(id).base.atk * levelAtkMultiplier(30)]),
    ),
    party: plan.party,
    center: plan.center,
  });
  subscribe(world);
  autoplay(world, { plan: plan.placements, useSpecial: true });
  return world;
}

describe('データ', () => {
  it('ボスは 4 種で、どれもボスステージに出る', () => {
    expect(bossStageIds).toEqual(['B1', 'B2', 'B3', 'B4']);
    for (const stageId of bossStageIds) {
      const used = new Set(
        getStage(stageId).waves.flatMap((wave) => wave.spawns.map((s) => s.enemy)),
      );
      expect([...used].some((id) => getEnemy(id).traits.boss)).toBe(true);
    }
  });

  it('ボスを通すと観客が大きく減る（倒すのが目的になる）', () => {
    // leak が軽いと「素通しさせて完走」が成立してしまい、ボス戦にならない
    for (const id of [
      'e_boss_utsushi',
      'e_boss_hagoromo',
      'e_boss_tsuki_no_o',
      'e_boss_hagoromo_ten',
    ]) {
      expect(getEnemy(id).leak).toBeGreaterThan(30);
    }
  });
});

describe('偽アカウント（フェーズ変化）', () => {
  const traits = getEnemy('e_boss_utsushi').traits;
  const base = getEnemy('e_boss_utsushi').attr;

  it('3 すくみを一周する（1 系統に寄せる編成が通じない）', () => {
    expect(base).toBe('glare');
    expect(traits.phases?.map((p) => p.attr)).toEqual(['noise', 'silence']);
  });

  it('残 HP でフェーズが進む', () => {
    expect(phaseAttribute(traits, base, 1.0)).toBe('glare');
    expect(phaseAttribute(traits, base, 0.8)).toBe('glare');
    expect(phaseAttribute(traits, base, 0.66)).toBe('noise');
    expect(phaseAttribute(traits, base, 0.4)).toBe('noise');
    expect(phaseAttribute(traits, base, 0.33)).toBe('silence');
    expect(phaseAttribute(traits, base, 0.01)).toBe('silence');
  });

  it('一気に削っても途中のフェーズで止まらない', () => {
    // 高い順に見て「最初に一致したもの」を採る実装だと、
    // 100% → 10% の一撃で喧噪のまま止まってしまう
    expect(phaseAttribute(traits, base, 0.1)).toBe('silence');
  });

  it('フェーズを持たない敵はそのまま', () => {
    const plain = getEnemy('e_walker');
    expect(phaseAttribute(plain.traits, plain.attr, 0.01)).toBe(plain.attr);
  });

  it('盤面でも属性が切り替わる', () => {
    // 参照盤面で通しで回す。1 人置いただけだとボスが湧く前に観客が尽きる
    const seen: string[] = [];
    const world = worldWithPlan('B1', (w) => w.events.on('bossPhase', (e) => seen.push(e.attr)));
    expect(seen.length).toBeGreaterThan(0);
    expect(['noise', 'silence']).toContain(seen[0]);
    expect(world.snapshot().killed).toBeGreaterThan(0);
  });
});

describe('状態異常の耐性（02-core-battle.md 2.8）', () => {
  function makeBoss(defId: string): Enemy {
    const def = getEnemy(defId);
    return {
      id: 1,
      defId,
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
      barrier: 0,
      barrierIdleMs: 0,
    };
  }

  it('ボスはどれも耐性を持つ（魅了は必ず無効）', () => {
    for (const id of ['e_boss_utsushi', 'e_boss_hagoromo']) {
      expect(getEnemy(id).traits.resist, id).toEqual({ stun: 0.7, charm: 1, slow: 0.3 });
    }
    // 章が進むほど耐性も上がる。魅了だけは**どのボスでも 1**（永久停止を作らない）
    for (const id of ['e_boss_tsuki_no_o', 'e_boss_hagoromo_ten']) {
      expect(getEnemy(id).traits.resist?.charm, id).toBe(1);
    }
    expect(getEnemy('e_boss_hagoromo_ten').traits.resist?.stun).toBeGreaterThan(
      getEnemy('e_boss_utsushi').traits.resist!.stun,
    );
  });

  it('最後のボスは章の敵の特性を全部持つ', () => {
    // 「数値が大きいだけの敵」にしないための確認。
    // 属性一周・沈黙・蘇生・バリアが 1 体に入っていることが B4 の看板
    const traits = getEnemy('e_boss_hagoromo_ten').traits;
    expect(traits.phases?.length).toBeGreaterThan(1);
    expect(traits.silence).toBeDefined();
    expect(traits.revive).toBeDefined();
    expect(traits.barrier).toBeDefined();
  });

  it('魅了が通らない（永久に足を止められない）', () => {
    // 乃依（Vi2）は 1.5 秒間隔で 2 秒の魅了を撒く。耐性が無いとボスは
    // 出た瞬間から永久に止まり、フェーズ変化も沈黙も一度も出番が無くなる
    expect(getIdol('Vi2').attack.onHit?.[0]?.status).toBe('charm');
    expect(getIdol('Vi2').base.attackIntervalMs).toBeLessThan(2000);

    const boss = makeBoss('e_boss_hagoromo');
    applyStatus(boss, { kind: 'charm', value: 1, remainingMs: 2000 });
    expect(boss.statuses).toHaveLength(0);
    expect(isImmobilized(boss.statuses)).toBe(false);
  });

  it('スタンと減速は短くなるだけで通る（無効ではない）', () => {
    const boss = makeBoss('e_boss_utsushi');
    applyStatus(boss, { kind: 'stun', value: 1, remainingMs: 1000 });
    applyStatus(boss, { kind: 'slow', value: 0.25, remainingMs: 3000 });
    expect(boss.statuses.find((s) => s.kind === 'stun')?.remainingMs).toBeCloseTo(300, 5);
    expect(boss.statuses.find((s) => s.kind === 'slow')?.remainingMs).toBeCloseTo(2100, 5);
  });

  it('耐性の無い雑魚はそのまま', () => {
    const walker = makeBoss('e_walker');
    applyStatus(walker, { kind: 'charm', value: 1, remainingMs: 2000 });
    expect(walker.statuses.find((s) => s.kind === 'charm')?.remainingMs).toBe(2000);
  });
});

describe('強制ログアウト（沈黙）', () => {
  it('沈黙はどのレーンにも届く', () => {
    // 区間の**始点だけ**で距離を測ると、B2 の中央レーンは区間が 1 本しかなく
    // 始点が盤面の左端にあるため、どの配置マスからも「最も遠い」ことになる。
    // すると中央に湧いたボスは的が 0 体で、看板の沈黙を一度も撃たない
    const stage = getStage('B2');
    const paths = buildPaths(stage);
    const covered = new Set(
      stage.placeable.map(([x, y]) => nearestLane(paths, x + 0.5, y + 0.5)),
    );
    expect([...covered].sort()).toEqual([0, 1, 2]);
  });

  it('直線レーンの真横に立つメンバーは、そのレーン扱いになる', () => {
    // (5,3) は中央レーン (0,4)-(15,4) から 0.5 マス。折れ線の角 (7,4) は 1.58 マス先
    const paths = buildPaths(getStage('B2'));
    expect(nearestLane(paths, 5.5, 3.5)).toBe(1);
    expect(nearestLane(paths, 5.5, 5.5)).toBe(1);
  });

  it('中央レーンにもボスが湧く（届かないと看板の能力が死ぬ）', () => {
    const lanes = new Set(
      getStage('B2').waves.flatMap((wave) =>
        wave.spawns.filter((s) => getEnemy(s.enemy).traits.silence).map((s) => s.lane),
      ),
    );
    expect(lanes.has(1)).toBe(true);
  });


  it('レーンのメンバーが止まる', () => {
    let silenced = 0;
    worldWithPlan('B2', (w) => w.events.on('silenced', (e) => (silenced += e.count)));
    expect(silenced).toBeGreaterThan(0);
  });

  it('沈黙中は攻撃できない', () => {
    const world = createWorld('B2', 1, { party: ['V1'], center: null });
    world.addCheer(20_000);
    const unit = world.placeUnit('V1', 9, 2);
    if (typeof unit === 'string') throw new Error(unit);

    unit.silencedMs = 3000;
    const before = world.snapshot().killed;
    runHeadless(2000, (dt) => world.update(dt));
    // 止まっているあいだは 1 体も倒せない
    expect(world.snapshot().killed).toBe(before);
    expect(unit.silencedMs).toBeGreaterThan(0);
  });
});
