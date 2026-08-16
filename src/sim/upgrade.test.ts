/**
 * M2 の強化系統：ポジション強化・覚醒分岐・セットリスト・スペシャル。
 */
import { describe, expect, it } from 'vitest';
import { createWorld } from './world';
import { runHeadless } from '../core/loop';
import { cards, getIdol } from '../data';
import { autoplay } from './autoplay';

const SEED = 20260816;

/** 声援を潤沢にして、強化そのものを試せる状態にする */
function richWorld() {
  const world = createWorld('S1', SEED);
  world.addCheer(5000);
  return world;
}

describe('ポジション強化', () => {
  it('Lv を上げると攻撃力と射程が伸びる', () => {
    const world = richWorld();
    const unit = world.placeUnit('D1', 4, 6);
    if (typeof unit === 'string') throw new Error(unit);

    const before = world.snapshot().units[0]!;
    expect(world.upgradeUnit(unit.id)).toBeNull();
    const after = world.snapshot().units[0]!;

    expect(after.level).toBe(2);
    expect(after.atk).toBeGreaterThan(before.atk);
    expect(after.range).toBeGreaterThan(before.range);
  });

  it('声援が足りなければ強化できない', () => {
    const world = createWorld('S1', SEED);
    const unit = world.placeUnit('D1', 4, 6);
    if (typeof unit === 'string') throw new Error(unit);
    world.addCheer(-10_000);
    expect(world.upgradeUnit(unit.id)).toBe('insufficient-cheer');
  });

  it('Lv3 より上には上げられない', () => {
    const world = richWorld();
    const unit = world.placeUnit('D1', 4, 6);
    if (typeof unit === 'string') throw new Error(unit);
    world.upgradeUnit(unit.id);
    world.upgradeUnit(unit.id);
    expect(world.snapshot().units[0]?.level).toBe(3);
    expect(world.upgradeUnit(unit.id)).toBe('max-level');
  });

  it('売却額は強化ぶんも含む', () => {
    const world = richWorld();
    const unit = world.placeUnit('D1', 4, 6);
    if (typeof unit === 'string') throw new Error(unit);
    world.upgradeUnit(unit.id);

    const invested = world.snapshot().units[0]!.investedCost;
    const before = world.snapshot().cheer;
    world.sellUnit(unit.id);
    expect(world.snapshot().cheer - before).toBe(Math.floor(invested * 0.6));
  });
});

describe('覚醒分岐', () => {
  it('Lv3 になるまで選べない', () => {
    const world = richWorld();
    const unit = world.placeUnit('V1', 8, 5);
    if (typeof unit === 'string') throw new Error(unit);
    expect(world.chooseAwakening(unit.id, 'A')).toBe(false);

    world.upgradeUnit(unit.id);
    world.upgradeUnit(unit.id);
    expect(world.snapshot().units[0]?.awaitingAwakening).toBe(true);
    expect(world.chooseAwakening(unit.id, 'A')).toBe(true);
  });

  it('一度選んだら変更できない', () => {
    const world = richWorld();
    const unit = world.placeUnit('V1', 8, 5);
    if (typeof unit === 'string') throw new Error(unit);
    world.upgradeUnit(unit.id);
    world.upgradeUnit(unit.id);
    world.chooseAwakening(unit.id, 'A');
    expect(world.chooseAwakening(unit.id, 'B')).toBe(false);
    expect(world.snapshot().units[0]?.awakening).toBe('A');
  });

  it('A と B で攻撃の挙動が変わる（数値だけの差ではない）', () => {
    const build = (branch: 'A' | 'B') => {
      const world = richWorld();
      const unit = world.placeUnit('V1', 8, 5);
      if (typeof unit === 'string') throw new Error(unit);
      world.upgradeUnit(unit.id);
      world.upgradeUnit(unit.id);
      world.chooseAwakening(unit.id, branch);
      return world.snapshot().units[0]!;
    };

    const a = build('A'); // フルコーラス: 遅いが範囲が広い
    const b = build('B'); // ラップコール: 速いが範囲が狭い
    expect(a.attackRadius).toBeGreaterThan(b.attackRadius);
  });

  it('覚醒名がスナップショットに出る', () => {
    const world = richWorld();
    const unit = world.placeUnit('Vi1', 12, 5);
    if (typeof unit === 'string') throw new Error(unit);
    world.upgradeUnit(unit.id);
    world.upgradeUnit(unit.id);
    world.chooseAwakening(unit.id, 'B');
    expect(world.snapshot().units[0]?.awakeningName).toBe('モデレート');
  });

  it('覚醒 A の管理者権限で単体攻撃が範囲化する', () => {
    const world = richWorld();
    const unit = world.placeUnit('Vi1', 12, 5);
    if (typeof unit === 'string') throw new Error(unit);
    expect(world.snapshot().units[0]?.attackKind).toBe('single');
    world.upgradeUnit(unit.id);
    world.upgradeUnit(unit.id);
    world.chooseAwakening(unit.id, 'A');
    expect(world.snapshot().units[0]?.attackKind).toBe('aoe_ring');
  });
});

describe('セットリスト', () => {
  it('◆ で 3 枚提示され、sim が止まる', () => {
    const world = createWorld('S1', SEED);
    runHeadless(120_000, (dt) => world.update(dt), () => world.snapshot().offers !== null);

    const snap = world.snapshot();
    expect(snap.offers).toHaveLength(3);
    expect(snap.clockState).toBe('choosing');

    const barBefore = world.clock.bar;
    runHeadless(5000, (dt) => world.update(dt));
    expect(world.clock.bar).toBe(barBefore); // 選択中は進まない
  });

  it('選ぶと効果が乗り、ライブが再開する', () => {
    const world = createWorld('S1', SEED);
    world.addCheer(5000);
    const unit = world.placeUnit('D1', 4, 6);
    if (typeof unit === 'string') throw new Error(unit);

    runHeadless(120_000, (dt) => world.update(dt), () => world.snapshot().offers !== null);
    const atkBefore = world.snapshot().units[0]!.atk;
    const offers = world.snapshot().offers!;

    expect(world.chooseCard(offers[0]!.id)).toBe(true);
    expect(world.snapshot().offers).toBeNull();
    expect(world.snapshot().clockState).toBe('running');
    expect(world.snapshot().takenCards).toHaveLength(1);

    // 効果の種類によっては攻撃力が変わらないカードもあるので、
    // 「下がっていない」ことだけを保証する
    expect(world.snapshot().units[0]!.atk).toBeGreaterThanOrEqual(atkBefore);
  });

  it('提示されていないカードは選べない', () => {
    const world = createWorld('S1', SEED);
    runHeadless(120_000, (dt) => world.update(dt), () => world.snapshot().offers !== null);
    expect(world.chooseCard('存在しないカード')).toBe(false);
  });

  it('同じ ◆ で二度提示されない', () => {
    const world = createWorld('S1', SEED);
    runHeadless(120_000, (dt) => world.update(dt), () => world.snapshot().offers !== null);
    world.chooseCard(world.snapshot().offers![0]!.id);

    // 選択直後に同じウェーブで再提示されないこと
    runHeadless(2000, (dt) => world.update(dt));
    expect(world.snapshot().offers).toBeNull();
  });
});

describe('スペシャルライブ', () => {
  it('月華が満タンでないと撃てない', () => {
    const world = createWorld('S1', SEED);
    expect(world.specialReady).toBe(false);
    expect(world.activateSpecial()).toBe(false);
  });

  it('満タンなら発動し、ゲージが空になる', () => {
    const world = createWorld('S1', SEED);
    world.addVoltage(1000);
    expect(world.specialReady).toBe(true);
    expect(world.activateSpecial()).toBe(true);
    expect(world.snapshot().voltage).toBe(0);
    expect(world.snapshot().specialRemainingMs).toBeGreaterThan(0);
  });

  it('発動中は攻撃力が上がる', () => {
    const world = createWorld('S1', SEED);
    world.addCheer(5000);
    world.placeUnit('D1', 4, 6);
    const before = world.snapshot().units[0]!.atk;

    world.addVoltage(1000);
    world.activateSpecial();
    expect(world.snapshot().units[0]!.atk).toBeGreaterThan(before);
  });

  it('時間が切れると元に戻る', () => {
    const world = createWorld('S1', SEED);
    world.addCheer(5000);
    world.placeUnit('D1', 4, 6);
    const before = world.snapshot().units[0]!.atk;

    world.addVoltage(1000);
    world.activateSpecial();
    runHeadless(9000, (dt) => world.update(dt));

    expect(world.snapshot().specialRemainingMs).toBe(0);
    expect(world.snapshot().units[0]!.atk).toBeCloseTo(before);
  });

  it('発動中は重ねて撃てない', () => {
    const world = createWorld('S1', SEED);
    world.addVoltage(1000);
    world.activateSpecial();
    world.addVoltage(1000);
    expect(world.specialReady).toBe(false);
  });

  it('発動中は月華が溜まらない（終了と同時の連発を防ぐ）', () => {
    const world = createWorld('S1', SEED);
    world.addCheer(5000);
    world.placeUnit('D1', 4, 6);
    world.addVoltage(1000);
    world.activateSpecial();

    // 撃破も小節も進むが、蓄積は 0 のまま
    runHeadless(6000, (dt) => world.update(dt));
    expect(world.snapshot().specialRemainingMs).toBeGreaterThan(0);
    expect(world.snapshot().voltage).toBe(0);
  });
});

describe('育成の反映', () => {
  it('メタの攻撃力がユニットに乗る', () => {
    const base = getIdol('D1').base.atk;
    const world = createWorld('S1', SEED, { atkByIdol: { D1: base * 2 } });
    world.addCheer(5000);
    // (8,3) は種別なし = 本舞台。ATK +10%
    world.placeUnit('D1', 8, 3);
    expect(world.snapshot().units[0]!.atk).toBeCloseTo(base * 2 * 1.1);
  });
});

describe('配置マスの種別', () => {
  it('本舞台は攻撃力 +10%', () => {
    const world = createWorld('S1', SEED);
    world.addCheer(5000);
    world.placeUnit('D1', 8, 3);
    expect(world.snapshot().units[0]!.atk).toBeCloseTo(getIdol('D1').base.atk * 1.1);
  });

  it('客席サイドは攻撃力が下がる代わりに声援が増える', () => {
    const stage = createWorld('S1', SEED);
    stage.addCheer(5000);
    stage.placeUnit('D1', 4, 6); // audience
    expect(stage.snapshot().units[0]!.atk).toBeCloseTo(getIdol('D1').base.atk * 0.9);

    const withAudience = createWorld('S1', SEED);
    withAudience.addCheer(5000);
    withAudience.placeUnit('D1', 4, 6);
    const plain = createWorld('S1', SEED);
    plain.addCheer(5000);
    plain.placeUnit('D1', 8, 3);

    const before = { a: withAudience.snapshot().cheer, p: plain.snapshot().cheer };
    runHeadless(3000, (dt) => {
      withAudience.update(dt);
      plain.update(dt);
    });
    const gainedAudience = withAudience.snapshot().cheer - before.a;
    const gainedPlain = plain.snapshot().cheer - before.p;
    expect(gainedAudience).toBeGreaterThan(gainedPlain);
  });

  it('花道は射程が伸びる', () => {
    const world = createWorld('S1', SEED);
    world.addCheer(5000);
    world.placeUnit('D1', 8, 5); // runway
    expect(world.snapshot().units[0]!.range).toBeCloseTo(getIdol('D1').base.range * 1.15);
  });
});

describe('データの既定値', () => {
  it('省略された maxStacks が実体化されている', () => {
    // 本番だけパースを飛ばしていた頃は undefined になり、
    // スタック上限の判定 (taken >= maxStacks) が常に false になっていた
    for (const [id, card] of Object.entries(cards)) {
      expect(card.maxStacks, `${id} の maxStacks`).toBeTypeOf('number');
      expect(card.maxStacks).toBeGreaterThan(0);
    }
    expect(cards['vocal_practice']?.maxStacks).toBe(3);
  });
});

describe('決着の扱い', () => {
  it('敗北した tick で撃破が増えない（ログと最終結果が一致する）', () => {
    const world = createWorld('S1', SEED);
    const { snapshot } = autoplay(world);
    expect(snapshot.won).toBe(false);

    const end = world.log.find((entry) => entry.kind === 'battleEnd');
    expect(end?.detail?.killed).toBe(snapshot.killed);
    expect(end?.detail?.audience).toBe(snapshot.audience);
  });
});

describe('計測ログ', () => {
  it('操作と結果が記録され、JSON で書き出せる', () => {
    const world = createWorld('S1', SEED);
    world.addCheer(5000);
    const unit = world.placeUnit('D1', 4, 6);
    if (typeof unit === 'string') throw new Error(unit);
    world.upgradeUnit(unit.id);

    const parsed = JSON.parse(world.exportLog()) as {
      seed: number;
      log: { kind: string }[];
    };
    expect(parsed.seed).toBe(SEED);
    const kinds = parsed.log.map((entry) => entry.kind);
    expect(kinds).toContain('battleStart');
    expect(kinds).toContain('place');
    expect(kinds).toContain('upgrade');
  });
});
