/**
 * 才能ボード（03-progression.md ⑧）。
 *
 * ここが緩いと「全部取れる」ボードになり、寄せる判断が消える。
 * ポイントの総量・前提・キーストーンの排他を厚めに見る。
 */
import { describe, expect, it } from 'vitest';
import { createNewSave, type SaveData } from './save';
import {
  hasKeystone,
  remainingTalentPoints,
  respecTalents,
  resolveTalents,
  RESPEC_COST,
  takeTalent,
  talentBlocker,
  talentIds,
  totalTalentPoints,
} from './talents';
import { getTalent, stageOrder, talents } from '../data';
import { createWorld } from '../sim/world';
import { runHeadless } from '../core/loop';

function cleared(count: number, perfect = false): SaveData {
  const save = createNewSave();
  return {
    ...save,
    funds: 100000,
    stageProgress: Object.fromEntries(
      stageOrder.slice(0, count).map((id) => [
        id,
        { cleared: true, bestAudience: perfect ? 100 : 60, plays: 1 },
      ]),
    ),
  };
}

/** 前提を辿って 1 ノードを取り切る */
function takeChain(save: SaveData, id: string): SaveData {
  for (const req of getTalent(id).requires) save = takeChain(save, req);
  return takeTalent(save, id);
}

describe('ボードの形', () => {
  it('3 ブランチ × 12 ノード', () => {
    expect(talentIds).toHaveLength(36);
    for (const branch of ['vocal', 'dance', 'visual'] as const) {
      expect(talentIds.filter((id) => getTalent(id).branch === branch)).toHaveLength(12);
    }
  });

  it('各ブランチにキーストーンが 2 つある（排他で選ばせるため）', () => {
    for (const branch of ['vocal', 'dance', 'visual'] as const) {
      const keys = talentIds.filter(
        (id) => getTalent(id).branch === branch && getTalent(id).tier === 'keystone',
      );
      expect(keys).toHaveLength(2);
    }
  });

  it('前提ノードは必ず存在し、同じブランチにある', () => {
    for (const id of talentIds) {
      const node = getTalent(id);
      for (const req of node.requires) {
        expect(talents[req], `${id} の前提 ${req} が無い`).toBeDefined();
        expect(getTalent(req).branch).toBe(node.branch);
      }
    }
  });

  it('全ノードを取るより、稼げるポイントのほうが少ない（全部は取れない）', () => {
    const everything = talentIds.reduce((sum, id) => sum + getTalent(id).cost, 0);
    const maxPoints = totalTalentPoints(cleared(stageOrder.length, true));
    expect(maxPoints).toBeLessThan(everything);
  });
});

describe('ポイント', () => {
  it('初回クリアで +2、ランク S でさらに +1', () => {
    expect(totalTalentPoints(createNewSave())).toBe(0);
    expect(totalTalentPoints(cleared(3))).toBe(6);
    expect(totalTalentPoints(cleared(3, true))).toBe(9);
  });

  it('足りなければ取れない', () => {
    const save = createNewSave();
    expect(talentBlocker(save, 'vo_s1')).toBe('no-points');
    expect(takeTalent(save, 'vo_s1')).toBe(save);
  });

  it('前提を取っていなければ取れない', () => {
    const save = cleared(7, true);
    expect(talentBlocker(save, 'vo_s2')).toBe('requires');
  });

  it('取ると残りが減る', () => {
    let save = cleared(2); // 4 pt
    save = takeTalent(save, 'vo_s1'); // 1 pt
    expect(remainingTalentPoints(save)).toBe(3);
    expect(talentBlocker(save, 'vo_s1')).toBe('taken');
  });
});

describe('キーストーン', () => {
  it('同じブランチで 2 つ目は取れない', () => {
    let save = cleared(7, true);
    save = takeChain(save, 'vo_k1');
    expect(hasKeystone(save, 'vocal')).toBe(true);
    expect(talentBlocker(save, 'vo_k2')).toBe('keystone-taken');
  });

  it('別のブランチのキーストーンは取れる（ポイントが足りれば）', () => {
    let save = { ...cleared(7, true), funds: 0 };
    save = takeChain(save, 'vo_k1');
    expect(hasKeystone(save, 'dance')).toBe(false);
  });
});

describe('振り直し', () => {
  it('資金を払って全部戻せる', () => {
    let save = cleared(3);
    save = takeTalent(save, 'da_s1');
    const before = save.funds;
    save = respecTalents(save);
    expect(save.talents).toEqual([]);
    expect(save.funds).toBe(before - RESPEC_COST);
  });

  it('資金が足りなければ何も起きない', () => {
    let save = { ...cleared(3), funds: 0 };
    save = takeTalent(save, 'da_s1');
    expect(respecTalents(save).talents).toEqual(['da_s1']);
  });
});

describe('効果の合算', () => {
  it('系統別の攻撃力はブランチごとに積まれる', () => {
    let save = cleared(7, true);
    save = takeChain(save, 'vo_s1'); // 歌の攻撃力 +5%
    const effects = resolveTalents(save);
    expect(effects.typeAtkPct.vocal).toBeCloseTo(0.05);
    expect(effects.typeAtkPct.dance).toBeUndefined();
  });

  it('キーストーン「無限旋律」で Echo の上限が伸びる', () => {
    let save = cleared(7, true);
    save = takeChain(save, 'vo_k2');
    expect(resolveTalents(save).echoMaxStacksAdd).toBe(3);
  });

  it('知らないノード ID は黙って無視する（古いセーブを壊さない）', () => {
    const save: SaveData = { ...createNewSave(), talents: ['no_such_node'] };
    expect(() => resolveTalents(save)).not.toThrow();
    expect(resolveTalents(save).atkPct).toBe(0);
  });
});

describe('盤面への反映', () => {
  it('才能を取ると攻撃力が上がる', () => {
    const atkWith = (talents: string[]): number => {
      const save = { ...cleared(7, true), talents };
      const world = createWorld('S1', 1, {
        party: ['V1'],
        center: 'V1',
        talents: resolveTalents(save),
      });
      world.addCheer(1000);
      const unit = world.placeUnit('V1', 4, 6);
      if (typeof unit === 'string') throw new Error(unit);
      return world.snapshot().units[0]!.atk;
    };
    expect(atkWith(['vo_s1'])).toBeGreaterThan(atkWith([]));
  });

  it('声援獲得の才能が経済に効く', () => {
    const cheerAfter = (talents: string[]): number => {
      const save = { ...cleared(7, true), talents };
      const world = createWorld('S1', 1, {
        party: ['V1'],
        center: 'V1',
        talents: resolveTalents(save),
      });
      runHeadless(5000, (dt) => world.update(dt));
      return world.snapshot().cheer;
    };
    // vi_s4「華」: 声援の獲得 +5%
    expect(cheerAfter(['vi_s1', 'vi_s2', 'vi_s4'])).toBeGreaterThan(cheerAfter([]));
  });
});
