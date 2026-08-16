/**
 * ボス 2 種（04-content.md 4.3）。
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
  it('ボスは 2 種で、どちらもボスステージに出る', () => {
    expect(bossStageIds).toEqual(['B1', 'B2']);
    for (const stageId of bossStageIds) {
      const used = new Set(
        getStage(stageId).waves.flatMap((wave) => wave.spawns.map((s) => s.enemy)),
      );
      expect([...used].some((id) => getEnemy(id).traits.boss)).toBe(true);
    }
  });

  it('ボスを通すと観客が大きく減る（倒すのが目的になる）', () => {
    // leak が軽いと「素通しさせて完走」が成立してしまい、ボス戦にならない
    for (const id of ['e_boss_utsushi', 'e_boss_hagoromo']) {
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

describe('強制ログアウト（沈黙）', () => {
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
