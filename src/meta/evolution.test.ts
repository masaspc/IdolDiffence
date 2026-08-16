/**
 * 進化（03-progression.md ⑦-2）。
 *
 * 「初期メンバーが終盤で使えなくなる」への答えなので、
 * **本当に終盤まで戦える数字になっているか**を盤面で確かめるところまで見る。
 * 解放条件だけを検証しても、弱いままの進化を通してしまう。
 */
import { describe, expect, it } from 'vitest';
import { createNewSave, loadSave, migrate, type SaveData } from './save';
import {
  canEvolve,
  displayName,
  evolutionOf,
  evolve,
  evolveBlocker,
  evolvedForBattle,
  isEvolved,
} from './evolution';
import { canonIds, getIdol } from '../data';
import { createWorld } from '../sim/world';
import { STARTER_IDS } from './save';

/** 進化の条件をすべて満たしたセーブ */
function ready(idolId = 'V1'): SaveData {
  const evolution = getIdol(idolId).evolution;
  if (!evolution) throw new Error(`${idolId} は進化を持たない`);
  return {
    ...createNewSave(),
    funds: evolution.cost,
    idolLevels: { [idolId]: evolution.requires.level },
    stageProgress: {
      [evolution.requires.stage]: { cleared: true, bestAudience: 80, plays: 3 },
    },
  };
}

describe('データ', () => {
  it('初期メンバーの 3 人が進化を持つ', () => {
    for (const id of STARTER_IDS) {
      expect(evolutionOf(id), `${id} に進化が無い`).not.toBeNull();
    }
  });

  it('原作メンバーで進化を持つのは初期の 3 人だけ（後発組は素で強い）', () => {
    const withEvolution = canonIds.filter((id) => evolutionOf(id) !== null);
    expect(withEvolution).toEqual([...STARTER_IDS]);
  });

  it('進化すると必ず強くなる', () => {
    for (const id of STARTER_IDS) {
      const evolution = evolutionOf(id);
      expect(evolution?.atkMul).toBeGreaterThan(1);
      expect(evolution?.rangeMul).toBeGreaterThanOrEqual(1);
    }
  });

  /** 進化を反映した毎秒期待値 */
  function evolvedDps(id: string): number {
    const d = getIdol(id);
    const e = evolutionOf(id);
    if (!e) throw new Error(`${id} に進化が無い`);
    const interval = (d.base.attackIntervalMs * (e.mods.attackIntervalMul ?? 1)) / 1000;
    const crit = d.base.critRate + (e.mods.critRateAdd ?? 0);
    return (
      (d.base.atk * e.atkMul * d.attack.skillMul * (1 + crit * (0.5 + d.base.critDmg))) / interval
    );
  }

  function plainDps(id: string): number {
    const d = getIdol(id);
    return (
      (d.base.atk * d.attack.skillMul * (1 + d.base.critRate * (0.5 + d.base.critDmg))) /
      (d.base.attackIntervalMs / 1000)
    );
  }

  it('進化は「少し強い」では済まない —— 3 倍以上', () => {
    // 進化は一度きりの恒久解放なので、レベルを 2〜3 上げたのと
    // 同じ体感では押す理由にならない。段が変わったと分かる幅にする
    for (const id of STARTER_IDS) {
      expect(evolvedDps(id) / plainDps(id), `${id} の進化が弱い`).toBeGreaterThan(3);
    }
  });

  it('射程も伸びる（置ける場所そのものが変わる）', () => {
    for (const id of STARTER_IDS) {
      expect(evolutionOf(id)?.rangeMul, `${id}`).toBeGreaterThanOrEqual(1.4);
    }
  });

  it('数値だけでなく、できることが増える', () => {
    // 「攻撃力が上がるだけ」だと、進化しても盤面の組み方は変わらない。
    // 3 人それぞれに**別の**解禁を置く
    const kaguya = evolutionOf('V1')?.mods;
    const ayaha = evolutionOf('D1')?.mods;
    const yachiyo = evolutionOf('Vi1')?.mods;

    // かぐや: 声の輪が広がり、守りを抜く
    expect(kaguya?.radiusMul).toBeGreaterThan(1.5);
    expect(kaguya?.defIgnoreAdd).toBeGreaterThan(0);
    // 彩葉: 同時に捌き、**ダンスの原則（対空不可）を越える**
    expect(ayaha?.multiTarget).toBeGreaterThanOrEqual(4);
    expect(ayaha?.grantFlying).toBe(true);
    expect(getIdol('D1').attack.canHitFlying, '素の彩葉は対空できない前提').toBe(false);
    // ヤチヨ: 単体だったものが範囲になり、止める力が跳ね上がる
    expect(yachiyo?.toAoe).toBeGreaterThan(0);
    expect(getIdol('Vi1').attack.kind, '素のヤチヨは単体').toBe('single');
    expect(yachiyo?.slowValue).toBeGreaterThan(0.5);
  });

  it('3 人の伸び幅がそろっている（1 人だけ桁が違わない）', () => {
    const ratios = STARTER_IDS.map((id) => evolvedDps(id) / plainDps(id));
    expect(Math.max(...ratios) / Math.min(...ratios)).toBeLessThan(1.5);
  });
});

describe('解放条件', () => {
  it('条件を満たせば進化できる', () => {
    expect(evolveBlocker(ready(), 'V1')).toBeNull();
  });

  it('進化を持たないキャラは対象外', () => {
    expect(evolveBlocker(ready(), 'V2')).toBe('no-evolution');
  });

  it('ステージ・レベル・資金のどれが欠けても止まる', () => {
    const base = ready();
    expect(evolveBlocker({ ...base, stageProgress: {} }, 'V1')).toBe('stage');
    expect(evolveBlocker({ ...base, idolLevels: { V1: 1 } }, 'V1')).toBe('level');
    expect(evolveBlocker({ ...base, funds: 0 }, 'V1')).toBe('funds');
  });

  it('足りない理由は満たしやすい順に返る（資金より先にステージ）', () => {
    const nothing = { ...ready(), stageProgress: {}, idolLevels: { V1: 1 }, funds: 0 };
    expect(evolveBlocker(nothing, 'V1')).toBe('stage');
  });

  it('二度は解放できない', () => {
    const once = evolve(ready(), 'V1');
    expect(isEvolved(once, 'V1')).toBe(true);
    expect(evolveBlocker(once, 'V1')).toBe('already');
  });
});

describe('解放', () => {
  it('資金を払って解放される', () => {
    const before = ready();
    const after = evolve(before, 'V1');
    expect(after.funds).toBe(before.funds - getIdol('V1').evolution!.cost);
    expect(after.evolved).toEqual(['V1']);
  });

  it('条件を満たさなければ何も起きない（同じ参照が返る）', () => {
    const poor = { ...ready(), funds: 0 };
    expect(evolve(poor, 'V1')).toBe(poor);
  });

  it('表示名が進化後のものになる', () => {
    expect(displayName(createNewSave(), 'V1')).toBe('かぐや');
    expect(displayName(evolve(ready(), 'V1'), 'V1')).toContain('Ray');
  });

  it('手で書き換えた知らない ID は sim へ渡さない', () => {
    const dirty: SaveData = { ...createNewSave(), evolved: ['V1', 'V2', 'no_such_idol'] };
    // V1 は進化を持つが未解放でも渡る（解放済みの記録がセーブの真実）。
    // V2 は進化そのものが無く、no_such_idol は存在しない
    expect(evolvedForBattle(dirty)).toEqual(['V1']);
  });
});

describe('セーブ', () => {
  it('新規セーブは未進化', () => {
    expect(createNewSave().evolved).toEqual([]);
  });

  it('v3 のセーブは未進化として移行される', () => {
    const v3 = { ...createNewSave(), version: 3 } as unknown as Record<string, unknown>;
    delete v3.evolved;
    expect(migrate(v3).evolved).toEqual([]);
  });

  it('保存して読み直しても解放が残る', () => {
    const saved = evolve(ready(), 'V1');
    const storage = { getItem: () => JSON.stringify(saved) };
    expect(loadSave(storage).data.evolved).toEqual(['V1']);
  });
});

describe('盤面への反映', () => {
  const atkOf = (evolved: string[]): number => {
    const world = createWorld('S1', 1, { party: ['V1'], center: 'V1', evolved });
    world.addCheer(5000);
    const unit = world.placeUnit('V1', 4, 6);
    if (typeof unit === 'string') throw new Error(unit);
    return world.snapshot().units[0]!.atk;
  };

  it('進化すると攻撃力と射程が伸びる', () => {
    const world = createWorld('S1', 1, { party: ['V1'], center: 'V1', evolved: ['V1'] });
    world.addCheer(5000);
    world.placeUnit('V1', 4, 6);
    const evolvedView = world.snapshot().units[0]!;

    const plain = createWorld('S1', 1, { party: ['V1'], center: 'V1' });
    plain.addCheer(5000);
    plain.placeUnit('V1', 4, 6);
    const plainView = plain.snapshot().units[0]!;

    expect(evolvedView.atk).toBeGreaterThan(plainView.atk);
    expect(evolvedView.range).toBeGreaterThan(plainView.range);
  });

  it('コスト 70 の後発組に見劣りしない火力になる', () => {
    // 「終盤で使えなくなる」への答えなので、ここが要。
    // 素の D1（130）は D3（260）の半分だが、進化後は近いところまで来てほしい
    const evolvedD1 = getIdol('D1').base.atk * (evolutionOf('D1')?.atkMul ?? 1);
    expect(evolvedD1).toBeGreaterThan(getIdol('D3').base.atk * 0.8);
  });

  it('進化していないアイドルには効かない', () => {
    expect(atkOf(['D1'])).toBe(atkOf([]));
  });

  it('名前とドット絵の引き当てキーが進化後のものになる', () => {
    const world = createWorld('S1', 1, { party: ['V1'], center: 'V1', evolved: ['V1'] });
    world.addCheer(5000);
    world.placeUnit('V1', 4, 6);
    const snapshot = world.snapshot();
    expect(snapshot.units[0]!.spriteId).toBe('V1:evolved');
    expect(snapshot.palette[0]!.shortName).toContain('Ray');
    expect(snapshot.centerName).toContain('Ray');
  });

  it('進化の効果は覚醒と重ねられる（Lv3 の分岐を潰さない）', () => {
    const world = createWorld('S1', 1, { party: ['D1'], center: 'D1', evolved: ['D1'] });
    world.addCheer(20_000);
    const unit = world.placeUnit('D1', 4, 6);
    if (typeof unit === 'string') throw new Error(unit);

    // D1 の進化は multiTarget 4、覚醒 A「乱舞」は 3。**強い方が残る**。
    // 底上げで進化が覚醒を上回ったので、ここは「覚醒を選んでも下がらない」
    // ことの確認になった（弱い方で上書きされていないか）
    expect(unit.attack.multiTarget).toBe(4);
    for (let level = 1; level < 3; level++) expect(world.upgradeUnit(unit.id)).toBeNull();
    expect(world.chooseAwakening(unit.id, 'A')).toBe(true);
    expect(unit.attack.multiTarget).toBe(4);
    // 覚醒 B「一閃」のクリ率は進化のぶんと**足し合わさる**（別の器）
    expect(unit.critRate).toBeGreaterThan(getIdol('D1').base.critRate);
  });

  it('進化しても基本の命中時効果は消えない', () => {
    // 進化を覚醒と同じ枝として扱っているので、onHit を持たせると
    // 基本の効果を「置き換え」てしまう。Vi1 の減速が残ることを確かめる
    const world = createWorld('S1', 1, { party: ['Vi1'], center: 'Vi1', evolved: ['Vi1'] });
    world.addCheer(5000);
    const unit = world.placeUnit('Vi1', 4, 6);
    if (typeof unit === 'string') throw new Error(unit);
    const slow = unit.attack.onHit.find((h) => h.status === 'slow');
    expect(slow).toBeDefined();
    // 進化で減速が 0.25 -> 0.35 に強まる
    expect(slow!.value).toBeGreaterThan(0.3);
  });

  it('進化していても canEvolve は編成や解放を無視しない', () => {
    const locked = { ...ready('Vi1'), stageProgress: {} };
    expect(canEvolve(locked, 'Vi1')).toBe(false);
  });
});
