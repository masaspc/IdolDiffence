/**
 * 衣装（03-progression.md ⑨）。
 *
 * ハクスラ枠なので、**乱数が絡む部分こそ性質で縛る**。
 * 「たまたまこの seed だとこう出る」を固定してもデータを 1 行触ると壊れるだけなので、
 * 見るのは「必ず成り立つこと」（決定的であること・所持数が合うこと・
 * 装備が二重にならないこと・セット効果が上乗せされること）にする。
 */
import { describe, expect, it } from 'vitest';
import { createNewSave, DEFAULT_RNG_STATE, type CostumeInstance, type SaveData } from './save';
import {
  SALVAGE_COUNT,
  emptyCostumeEffects,
  enhanceBlocker,
  enhanceCost,
  enhanceCostume,
  equipCostume,
  equippedCostume,
  grantDrops,
  isEquipped,
  mainValue,
  resolveCostumes,
  resolvePartyCostumes,
  salvageBlocker,
  salvageCostumes,
  subValue,
  unequipSlot,
  wearerOf,
  dropCount,
} from './costumes';
import { applyReward, calcReward } from './progression';
import { COSTUME_SLOTS, MAX_ENHANCE, SLOT_MAIN_STATS } from '../data/schema/costume';
import { costumeSeries, seriesIds } from '../data';
import { createWorld } from '../sim/world';

/** 決まった数だけ引いたセーブ */
function withDrops(count: number, funds = 100_000): SaveData {
  const { save } = grantDrops({ ...createNewSave(), funds }, count);
  return save;
}

/** シリーズとスロットを指定した 1 着を手で作る。セット効果の検証用 */
function craft(id: string, seriesId: string, slot: CostumeInstance['slot']): CostumeInstance {
  return {
    id,
    seriesId,
    slot,
    rarity: 'SSR',
    mainStat: SLOT_MAIN_STATS[slot][0] ?? 'atkPct',
    subs: [],
    enhance: 0,
  };
}

/** 4 スロットぶんを同じシリーズで着せたセーブ */
function fullSet(seriesId: string, idolId = 'V1'): SaveData {
  const costumes = COSTUME_SLOTS.map((slot, index) => craft(`x${index}`, seriesId, slot));
  let save: SaveData = { ...createNewSave(), costumes, costumeSeq: costumes.length };
  for (const costume of costumes) save = equipCostume(save, idolId, costume.id);
  return save;
}

describe('データ', () => {
  it('シリーズは竹取物語の五つの難題で 5 つ', () => {
    expect(seriesIds).toHaveLength(5);
    for (const id of seriesIds) {
      expect(costumeSeries[id]?.name).toBeTruthy();
      expect(costumeSeries[id]?.flavor).toBeTruthy();
    }
  });

  it('すべてのスロットにメインステータスがある', () => {
    for (const slot of COSTUME_SLOTS) {
      expect(SLOT_MAIN_STATS[slot].length).toBeGreaterThan(0);
    }
  });
});

describe('ドロップ', () => {
  it('負けても 1 着は出る（プレイが無駄にならない）', () => {
    expect(dropCount(false, 0)).toBeGreaterThan(0);
    expect(dropCount(true, 60)).toBeGreaterThan(dropCount(false, 0));
    expect(dropCount(true, 100)).toBeGreaterThan(dropCount(true, 60));
  });

  it('引いた数だけ所持が増え、ID は重複しない', () => {
    const save = withDrops(20);
    expect(save.costumes).toHaveLength(20);
    expect(new Set(save.costumes.map((c) => c.id)).size).toBe(20);
  });

  it('同じセーブからは同じものが出る（決定的）', () => {
    const a = grantDrops(createNewSave(), 5).dropped;
    const b = grantDrops(createNewSave(), 5).dropped;
    expect(a).toEqual(b);
  });

  it('引くたびに乱数が進む（同じものが出続けない）', () => {
    const first = grantDrops(createNewSave(), 1);
    const second = grantDrops(first.save, 1);
    expect(second.save.rngState).not.toBe(first.save.rngState);
    // 20 着も引けば、まったく同じ組み合わせばかりにはならない
    const many = grantDrops(createNewSave(), 20).dropped;
    const shapes = new Set(many.map((c) => `${c.seriesId}/${c.slot}/${c.rarity}`));
    expect(shapes.size).toBeGreaterThan(1);
  });

  it('リロードして引き直せない（セーブに状態が乗る）', () => {
    const save = createNewSave();
    expect(save.rngState).toBe(DEFAULT_RNG_STATE);
    expect(grantDrops(save, 1).save.rngState).not.toBe(DEFAULT_RNG_STATE);
  });

  it('出るのは実在するシリーズとスロットだけ', () => {
    for (const costume of withDrops(40).costumes) {
      expect(seriesIds).toContain(costume.seriesId);
      expect(COSTUME_SLOTS).toContain(costume.slot);
      expect(SLOT_MAIN_STATS[costume.slot]).toContain(costume.mainStat);
    }
  });

  it('副次はメインと重複しない（同じ器が 2 行並ばない）', () => {
    for (const costume of withDrops(40).costumes) {
      expect(costume.subs.map((s) => s.stat)).not.toContain(costume.mainStat);
      expect(new Set(costume.subs.map((s) => s.stat)).size).toBe(costume.subs.length);
    }
  });

  it('レアリティが高いほど副次が多い', () => {
    const expected = { R: 1, SR: 2, SSR: 3, UR: 4 };
    for (const costume of withDrops(60).costumes) {
      expect(costume.subs).toHaveLength(expected[costume.rarity]);
    }
  });

  it('リザルトでセーブに入る（表示と食い違わない）', () => {
    const outcome = { stageId: 'S1', won: true, audience: 100, killed: 50 };
    const { save, dropped } = applyReward(createNewSave(), outcome, calcReward(outcome));
    expect(dropped).toHaveLength(dropCount(true, 100));
    // 画面に出した衣装が、そのままセーブに入っていること
    for (const drop of dropped) {
      expect(save.costumes.find((c) => c.id === drop.id)).toEqual(drop);
    }
  });
});

describe('強化', () => {
  it('資金を払って +1 され、メインが伸びる', () => {
    const save = withDrops(1);
    const costume = save.costumes[0]!;
    const before = mainValue(costume);
    const cost = enhanceCost(costume)!;

    const next = enhanceCostume(save, costume.id);
    const upgraded = next.costumes[0]!;
    expect(upgraded.enhance).toBe(1);
    expect(next.funds).toBe(save.funds - cost);
    expect(mainValue(upgraded)).toBeGreaterThan(before);
  });

  it('3 の倍数ごとに副次が 1 段だけ伸びる', () => {
    // 副次を複数持つものを選ぶ（R は 1 個しかなく、伸び先が固定になる）
    const save = withDrops(30);
    const target = save.costumes.find((c) => c.subs.length >= 3)!;
    let current = save;
    const rollsAt: number[] = [];
    for (let i = 0; i < 6; i++) {
      current = enhanceCostume(current, target.id);
      const now = current.costumes.find((c) => c.id === target.id)!;
      rollsAt.push(now.subs.reduce((sum, s) => sum + s.rolls, 0));
    }
    const base = target.subs.length;
    // +1,+2 は据え置き / +3 で 1 段 / +4,+5 据え置き / +6 でもう 1 段
    expect(rollsAt).toEqual([base, base, base + 1, base + 1, base + 1, base + 2]);
  });

  it('上限まで上げると打ち止め', () => {
    let save = withDrops(1, 10_000_000);
    const id = save.costumes[0]!.id;
    for (let i = 0; i < MAX_ENHANCE; i++) save = enhanceCostume(save, id);
    expect(save.costumes[0]!.enhance).toBe(MAX_ENHANCE);
    expect(enhanceBlocker(save, id)).toBe('max');
    expect(enhanceCostume(save, id)).toBe(save);
  });

  it('資金が足りなければ何も起きない', () => {
    const save = { ...withDrops(1), funds: 0 };
    expect(enhanceBlocker(save, save.costumes[0]!.id)).toBe('funds');
    expect(enhanceCostume(save, save.costumes[0]!.id)).toBe(save);
  });

  it('知らない ID は無視する', () => {
    const save = withDrops(1);
    expect(enhanceBlocker(save, 'nope')).toBe('not-found');
    expect(enhanceCostume(save, 'nope')).toBe(save);
  });
});

describe('装備', () => {
  it('スロットに着せられる', () => {
    const save = withDrops(6);
    const costume = save.costumes[0]!;
    const next = equipCostume(save, 'V1', costume.id);
    expect(equippedCostume(next, 'V1', costume.slot)?.id).toBe(costume.id);
    expect(isEquipped(next, costume.id)).toBe(true);
    expect(wearerOf(next, costume.id)).toBe('V1');
  });

  it('1 着を 2 人が着ることはない（移すと前の人から外れる）', () => {
    const save = withDrops(6);
    const costume = save.costumes[0]!;
    let next = equipCostume(save, 'V1', costume.id);
    next = equipCostume(next, 'D1', costume.id);
    expect(equippedCostume(next, 'V1', costume.slot)).toBeNull();
    expect(equippedCostume(next, 'D1', costume.slot)?.id).toBe(costume.id);
    expect(wearerOf(next, costume.id)).toBe('D1');
  });

  it('同じスロットは 1 着だけ（着せ替えで前のものが外れる）', () => {
    const save = withDrops(30);
    const [a, b] = save.costumes.filter((c) => c.slot === 'stage');
    if (!a || !b) throw new Error('ステージ衣装が 2 着以上必要');
    let next = equipCostume(save, 'V1', a.id);
    next = equipCostume(next, 'V1', b.id);
    expect(equippedCostume(next, 'V1', 'stage')?.id).toBe(b.id);
    expect(isEquipped(next, a.id)).toBe(false);
  });

  it('外せる', () => {
    const save = withDrops(6);
    const costume = save.costumes[0]!;
    const equippedSave = equipCostume(save, 'V1', costume.id);
    const next = unequipSlot(equippedSave, 'V1', costume.slot);
    expect(equippedCostume(next, 'V1', costume.slot)).toBeNull();
    expect(isEquipped(next, costume.id)).toBe(false);
  });
});

describe('錬成', () => {
  it('同じレアリティ 3 着が 1 着になる', () => {
    const save = withDrops(60);
    const rarity = save.costumes[0]!.rarity;
    const ids = save.costumes
      .filter((c) => c.rarity === rarity)
      .slice(0, SALVAGE_COUNT)
      .map((c) => c.id);
    if (ids.length < SALVAGE_COUNT) throw new Error('同レアリティが 3 着必要');

    const { save: next, created } = salvageCostumes(save, ids);
    expect(created).not.toBeNull();
    expect(created?.rarity).toBe(rarity); // レアリティは上がらない
    expect(next.costumes).toHaveLength(save.costumes.length - SALVAGE_COUNT + 1);
    for (const id of ids) expect(next.costumes.find((c) => c.id === id)).toBeUndefined();
  });

  it('レアリティが混ざっていると錬成できない', () => {
    const save = withDrops(60);
    const rarities = [...new Set(save.costumes.map((c) => c.rarity))];
    if (rarities.length < 2) throw new Error('レアリティが 2 種以上必要');
    const a = save.costumes.filter((c) => c.rarity === rarities[0]).slice(0, 2);
    const b = save.costumes.filter((c) => c.rarity === rarities[1]).slice(0, 1);
    const ids = [...a, ...b].map((c) => c.id);
    expect(salvageBlocker(save, ids)).toBe('mixed-rarity');
    expect(salvageCostumes(save, ids).created).toBeNull();
  });

  it('着用中のものは溶かせない（外し忘れで消えない）', () => {
    const save = withDrops(60);
    const rarity = save.costumes[0]!.rarity;
    const picked = save.costumes.filter((c) => c.rarity === rarity).slice(0, SALVAGE_COUNT);
    if (picked.length < SALVAGE_COUNT) throw new Error('同レアリティが 3 着必要');
    const equipped = equipCostume(save, 'V1', picked[0]!.id);
    expect(salvageBlocker(equipped, picked.map((c) => c.id))).toBe('equipped');
  });

  it('枚数が足りなければ実行できない', () => {
    const save = withDrops(6);
    expect(salvageBlocker(save, [save.costumes[0]!.id])).toBe('not-enough');
    // 同じものを 3 回選んでも成立しない
    const same = [save.costumes[0]!.id, save.costumes[0]!.id, save.costumes[0]!.id];
    expect(salvageBlocker(save, same)).toBe('not-enough');
  });
});

describe('効果の解決', () => {
  it('着ていなければ効果ゼロ', () => {
    expect(resolveCostumes(createNewSave(), 'V1')).toEqual(emptyCostumeEffects());
  });

  it('メインと副次が合算される', () => {
    const save = withDrops(6);
    const costume = save.costumes.find((c) => c.mainStat === 'atkPct' && c.subs.length > 0);
    if (!costume) throw new Error('攻撃力メインの衣装が必要');
    const effects = resolveCostumes(equipCostume(save, 'V1', costume.id), 'V1');

    let expected = mainValue(costume);
    for (const sub of costume.subs) {
      if (sub.stat === 'atkPct') expected += subValue(sub.stat, sub.rolls);
    }
    expect(effects.stats.atkPct).toBeCloseTo(expected, 6);
  });

  it('2 着でセット効果が付く', () => {
    const costumes = [craft('a', 'tama', 'stage'), craft('b', 'tama', 'mic')];
    let save: SaveData = { ...createNewSave(), costumes };
    for (const costume of costumes) save = equipCostume(save, 'V1', costume.id);

    const effects = resolveCostumes(save, 'V1');
    expect(effects.sets).toEqual([{ seriesId: 'tama', count: 2, tier: 2 }]);
    // 「蓬莱の玉の枝」2 着は ATK +12%。メインぶんに上乗せされる
    expect(effects.stats.atkPct).toBeGreaterThan(mainValue(costumes[0]!) + 0.11);
  });

  it('4 着は 2 着ぶんに**上乗せ**される（置き換えではない）', () => {
    const two = resolveCostumes(
      (() => {
        const costumes = [craft('a', 'kubitama', 'stage'), craft('b', 'kubitama', 'mic')];
        let save: SaveData = { ...createNewSave(), costumes };
        for (const c of costumes) save = equipCostume(save, 'V1', c.id);
        return save;
      })(),
      'V1',
    );
    const four = resolveCostumes(fullSet('kubitama'), 'V1');

    // 龍の首の玉: 2 着でクリティカル率 +10%、4 着でクリティカルダメージ +50%。
    // 4 着そろえるとアクセサリー（メインがクリティカル率）も入るので、
    // セット効果ぶんはメインに**上乗せ**された形で出る
    const accessory = craft('acc', 'kubitama', 'accessory');
    expect(two.stats.critRateAdd).toBeCloseTo(0.1, 6);
    expect(two.stats.critDmgAdd ?? 0).toBe(0);
    expect(four.stats.critRateAdd).toBeCloseTo(0.1 + mainValue(accessory), 6);
    expect(four.stats.critDmgAdd).toBeCloseTo(0.5, 6);
    expect(four.sets).toEqual([{ seriesId: 'kubitama', count: 4, tier: 4 }]);
  });

  it('セット効果はプールに載らないものも運ぶ', () => {
    const hachi = resolveCostumes(fullSet('hachi'), 'V1');
    expect(hachi.defIgnoreAdd).toBeCloseTo(0.2, 6);
    expect(hachi.shieldPierce).toBeCloseTo(0.5, 6);

    const tama = resolveCostumes(fullSet('tama'), 'V1');
    expect(tama.specialDmgPct).toBeCloseTo(0.35, 6);

    const kawa = resolveCostumes(fullSet('kawagoromo'), 'V1');
    expect(kawa.echoMaxStacksAdd).toBe(2);

    const koyasu = resolveCostumes(fullSet('koyasugai'), 'V1');
    expect(koyasu.startCheer).toBe(200);
  });

  it('シリーズがバラバラならセットは成立しない', () => {
    const costumes = [craft('a', 'tama', 'stage'), craft('b', 'hachi', 'mic')];
    let save: SaveData = { ...createNewSave(), costumes };
    for (const c of costumes) save = equipCostume(save, 'V1', c.id);
    expect(resolveCostumes(save, 'V1').sets).toEqual([]);
  });

  it('消えたシリーズを持つ古いセーブでも落ちない', () => {
    const costumes = [craft('a', 'no_such_series', 'stage')];
    const save = equipCostume({ ...createNewSave(), costumes }, 'V1', 'a');
    expect(() => resolveCostumes(save, 'V1')).not.toThrow();
  });

  it('グローバル項は編成内の最大値を採る（合算しない）', () => {
    // 全員に同じセットを着せるのが常に最適、にならないようにするため
    let save = fullSet('koyasugai', 'V1');
    const more = COSTUME_SLOTS.map((slot, i) => craft(`y${i}`, 'koyasugai', slot));
    save = { ...save, costumes: [...save.costumes, ...more] };
    for (const c of more) save = equipCostume(save, 'D1', c.id);

    const resolved = resolvePartyCostumes(save, ['V1', 'D1']);
    expect(resolved.startCheer).toBe(200); // 400 にはならない
  });
});

describe('盤面への反映', () => {
  function worldWith(save: SaveData, party: string[]) {
    return createWorld('S1', 1, {
      party,
      center: null,
      costumes: resolvePartyCostumes(save, party),
    });
  }

  const atkOf = (save: SaveData): number => {
    const world = worldWith(save, ['V1']);
    world.addCheer(5000);
    const unit = world.placeUnit('V1', 4, 6);
    if (typeof unit === 'string') throw new Error(unit);
    return world.snapshot().units[0]!.atk;
  };

  it('着せると攻撃力が上がる', () => {
    expect(atkOf(fullSet('tama'))).toBeGreaterThan(atkOf(createNewSave()));
  });

  it('着せた本人にだけ効く', () => {
    const save = fullSet('tama', 'D1');
    // V1 は何も着ていないので、素の値と同じ
    expect(atkOf(save)).toBe(atkOf(createNewSave()));
  });

  it('「仏の御石の鉢」で DEF 無視とシールド貫通が乗る', () => {
    const world = worldWith(fullSet('hachi'), ['V1']);
    world.addCheer(5000);
    const unit = world.placeUnit('V1', 4, 6);
    if (typeof unit === 'string') throw new Error(unit);
    expect(unit.attack.defIgnore).toBeCloseTo(0.2, 6);
    expect(unit.attack.shieldPierce).toBeCloseTo(0.5, 6);
  });

  it('「燕の子安貝」で開始時の声援が増える', () => {
    const plain = worldWith(createNewSave(), ['V1']).snapshot().cheer;
    const rich = worldWith(fullSet('koyasugai'), ['V1']).snapshot().cheer;
    expect(rich - plain).toBe(200);
  });

  it('着ていないアイドルのぶんは盤面に漏れない', () => {
    const world = worldWith(fullSet('hachi', 'D1'), ['V1', 'D1']);
    world.addCheer(20_000);
    const v1 = world.placeUnit('V1', 4, 6);
    if (typeof v1 === 'string') throw new Error(v1);
    expect(v1.attack.defIgnore).toBe(0);
  });
});
