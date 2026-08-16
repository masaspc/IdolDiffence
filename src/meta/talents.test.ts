/**
 * 才能ボード（03-progression.md ⑧）。
 *
 * ここが緩いと「全部取れる」ボードになり、寄せる判断が消える。
 * ポイントの総量・前提・キーストーンの排他を厚めに見る。
 */
import { describe, expect, it } from 'vitest';
import { createNewSave, type SaveData } from './save';
import {
  emptyTalentEffects,
  hasKeystone,
  remainingTalentPoints,
  respecTalents,
  resolveTalents,
  RESPEC_COST,
  takeTalent,
  talentBlocker,
  talentIds,
  totalTalentPoints,
  type TalentEffects,
} from './talents';
import { getIdol, getTalent, stageOrder, talents } from '../data';
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

  it('クリティカルの才能は「率そのもの」に足される（掛け算にしない）', () => {
    // 「クリティカル率 +3%」は 0.05 → 0.08 の意味。
    // 加算プール（1 + Σ を掛ける）へ入れると 0.05 × 1.03 = 0.0515 にしかならず、
    // ノードがほぼ無価値になる。カード（applyCard）も同じ意味で addFlat を使う
    let save = cleared(7, true);
    save = takeChain(save, 'da_s3'); // クリティカル率 +3%
    const world = createWorld('S1', 1, {
      party: ['D1'],
      center: 'D1',
      talents: resolveTalents(save),
    });
    world.addCheer(1000);
    const unit = world.placeUnit('D1', 4, 6);
    if (typeof unit === 'string') throw new Error(unit);
    // D1 の素のクリティカル率は 8%
    expect(unit.critRate).toBeCloseTo(getIdol('D1').base.critRate + 0.03, 5);
  });

  it('クリティカルダメージも同じく足し算', () => {
    let save = cleared(7, true);
    save = takeChain(save, 'da_s6'); // クリティカルダメージ +15%
    const world = createWorld('S1', 1, {
      party: ['D1'],
      center: 'D1',
      talents: resolveTalents(save),
    });
    world.addCheer(1000);
    const unit = world.placeUnit('D1', 4, 6);
    if (typeof unit === 'string') throw new Error(unit);
    expect(unit.critDmg).toBeCloseTo(getIdol('D1').base.critDmg + 0.15, 5);
  });

  it('「状態異常の効果量」は減速だけでなく脆弱にも効く', () => {
    // ヴィジュアルのキーストーン「絶対領域」は攻撃力 -25% を払わせる。
    // 減速しか伸びないと、脆弱を撒く編成では払い損になる
    let save = cleared(7, true);
    save = takeChain(save, 'vi_s2'); // 状態異常の効果量 +6%
    const vulnerableOf = (talents: TalentEffects): number => {
      // センターは置かない。Vi2 のセンターパッシブ「ギャップ」が
      // 状態異常の効果量 +20% を持っていて、才能のぶんと混ざる
      const world = createWorld('S1', 1, { party: ['Vi2'], center: null, talents });
      world.addCheer(20_000);
      const unit = world.placeUnit('Vi2', 4, 6);
      if (typeof unit === 'string') throw new Error(unit);
      // 覚醒 B「煽り耐性ゼロ」で脆弱 +30% が乗る
      for (let level = 1; level < 3; level++) world.upgradeUnit(unit.id);
      world.chooseAwakening(unit.id, 'B');
      return unit.attack.onHit.find((h) => h.status === 'vulnerable')?.value ?? 0;
    };
    expect(vulnerableOf(emptyTalentEffects())).toBeCloseTo(0.3, 5);
    expect(vulnerableOf(resolveTalents(save))).toBeCloseTo(0.3 * 1.06, 5);
  });

  it('「ステップアップ」の累積はウェーブが変わると落ちる', () => {
    // 撃破時にしか期限を見ていないと、**次のウェーブで最初の 1 体を倒すまで**
    // 前のウェーブの累積が乗り続ける。ウェーブは楽曲の時計で進むので、
    // 撃破とは無関係に切り替わる
    let save = cleared(7, true);
    save = takeChain(save, 'da_k1');
    const stack = resolveTalents(save).killSpeedStack;
    expect(stack, 'da_k1 が killSpeedStack を持っていない').not.toBeNull();

    const world = createWorld('S1', 1, {
      party: ['V1', 'D1'],
      center: 'V1',
      talents: resolveTalents(save),
    });
    world.addCheer(20_000);
    world.placeUnit('V1', 8, 5);
    world.placeUnit('D1', 4, 6);

    let peak = 0;
    let previousWave = world.snapshot().wave?.index ?? -1;
    /** ウェーブが切り替わった直後に観測した累積 */
    const atBoundary: number[] = [];

    runHeadless(
      120_000,
      (dt) => {
        world.update(dt);
        const snapshot = world.snapshot();
        // ◆ は sim を止める。選ばないと時計ごと進まない
        const offer = snapshot.offers?.[0];
        if (offer) {
          world.chooseCard(offer.id);
          return;
        }
        const wave = snapshot.wave?.index ?? -1;
        peak = Math.max(peak, snapshot.killSpeedBonus);
        if (wave !== previousWave) {
          previousWave = wave;
          atBoundary.push(snapshot.killSpeedBonus);
        }
      },
      () => world.snapshot().finished,
    );

    // 前提: そもそも累積が育っていないと、落ちたかどうかを見ても意味がない
    expect(peak, '累積がまったく育っていない').toBeGreaterThan(stack!.perKill);
    expect(atBoundary.length, 'ウェーブが 1 度も変わっていない').toBeGreaterThan(0);
    // 切り替わった最初の観測で残っていてよいのは、同じ 1 フレームで
    // 倒せた 1 体ぶんだけ
    for (const value of atBoundary) {
      expect(value).toBeLessThanOrEqual(stack!.perKill + 1e-9);
    }
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
