/**
 * バランスの CI 検証（07-roadmap.md M3）。
 *
 * 個々のシステムが動くことは他のテストが見ている。ここが見るのは
 * **ステージ全体を通したときに、育成が結果に効く曲線になっているか**。
 * 数値を触ると真っ先に壊れる場所なので、壊れたら意図した変更か確かめること。
 * 実測は `npx tsx scripts/probe.ts` で一覧できる。
 *
 * ここで固定しているのは「クリアできる／できない」の境界だけで、
 * 観客数のような細かい値は見ない。seed と参照盤面に過剰適合させると、
 * データを 1 行変えるたびにテストを書き直す羽目になる。
 */
import { describe, expect, it } from 'vitest';
import { createWorld, type BattleMeta } from '../sim/world';
import { autoplay } from '../sim/autoplay';
import {
  bossStageIds,
  canonIds,
  getIdol,
  getStage,
  mainStageIds,
  rosterIds,
  SECRET_IDS,
  stageOrder,
} from '../data';
import { levelAtkMultiplier, MAX_LEVEL } from '../meta/progression';
import { PLAN_STAGES, STAGE_PLANS, type Investment } from './plans';
import { balanceMeta, investmentOf } from './investment';

const SEED = 20260816;
/** 1 ステージあたり 0.2〜0.6 秒かかる。既定の 5 秒では足りない */
const TIMEOUT = 60_000;

function metaAt(stageId: string, level: number): BattleMeta {
  const plan = STAGE_PLANS[stageId];
  return {
    atkByIdol: Object.fromEntries(
      rosterIds.map((id) => [id, getIdol(id).base.atk * levelAtkMultiplier(level)]),
    ),
    party: plan?.party ?? [],
    center: plan?.center ?? null,
  };
}

function play(stageId: string, level: number, placements = true) {
  const plan = STAGE_PLANS[stageId];
  // ステージが仮定する恒久強化を込みで測る。S11 以降はレベルが上限なので、
  // 素の値だけで見ると「上限まで育てても勝てない壁」に見えてしまう
  const world = createWorld(stageId, SEED, balanceMeta(stageId, level));
  const { snapshot } = autoplay(world, {
    plan: placements ? (plan?.placements ?? []) : [],
    useSpecial: true,
  });
  return snapshot;
}

function wins(stageId: string, level: number, placements = true): boolean {
  return play(stageId, level, placements).won;
}

/** 恒久強化の段階を明示して回す。段階の効き目そのものを見るとき用 */
function winsAt(stageId: string, investment: Investment): boolean {
  const plan = STAGE_PLANS[stageId];
  const world = createWorld(stageId, SEED, balanceMeta(stageId, MAX_LEVEL, investment));
  return autoplay(world, { plan: plan?.placements ?? [], useSpecial: true }).snapshot.won;
}

/** その段階のひとつ手前 */
const PREVIOUS: Record<Investment, Investment | null> = {
  bare: null,
  talents: 'bare',
  full: 'talents',
  max: 'full',
};

describe('バランス', () => {
  it('参照盤面は原作の 12 人だけで組む', () => {
    // 隠しキャラ（MASA）を混ぜると、持っていない人にとっての難度が測れなくなる。
    // 難度の基準は**誰でも到達できる戦力**で置く
    for (const stageId of stageOrder) {
      const plan = STAGE_PLANS[stageId];
      for (const id of plan?.party ?? []) {
        expect(canonIds, `${stageId} の参照盤面に ${id} が入っている`).toContain(id);
      }
      for (const placement of plan?.placements ?? []) {
        expect(SECRET_IDS, `${stageId} の配置に隠しキャラが入っている`).not.toContain(
          placement.idolId,
        );
      }
    }
  });

  it(
    '隠しキャラを入れると難度の曲線が消える（だから基準には入れない）',
    () => {
      // MASA は「全部やり切った人への上がり」。曲線の外にいることを**測って**確かめる。
      // ここが崩れる = 最強のつもりが最強でない、か、基準に混ざっている
      const plan = STAGE_PLANS['S10'];
      if (!plan) throw new Error('S10 の参照盤面が無い');
      const world = createWorld('S10', SEED, {
        ...metaAt('S10', 1),
        party: [...plan.party.slice(0, 4), 'GM'],
        center: 'GM',
      });
      const { snapshot } = autoplay(world, {
        // 半分を MASA に差し替える
        plan: plan.placements.map((p, i) => (i % 2 === 0 ? { ...p, idolId: 'GM' } : p)),
        useSpecial: true,
      });
      // 原作勢は Lv20 で初めて完走する（下の「最終盤」の検証）。MASA は Lv1 で満点
      expect(wins('S10', 1)).toBe(false);
      expect(snapshot.won).toBe(true);
      expect(snapshot.audience).toBe(100);
    },
    TIMEOUT,
  );

  it('参照盤面はすべてのステージに用意されている', () => {
    // 並び順は問わない（表示順とファイル内の順序は別物）。**漏れが無いこと**だけ見る
    expect([...PLAN_STAGES].sort()).toEqual([...stageOrder].sort());
    for (const stageId of stageOrder) {
      const plan = STAGE_PLANS[stageId];
      expect(plan?.placements.length ?? 0).toBeGreaterThan(0);
      expect(plan?.party).toContain(plan?.center);
    }
  });

  it(
    '何も置かなければどのステージも負ける',
    () => {
      for (const stageId of stageOrder) {
        expect(wins(stageId, 30, false), `${stageId} が無配置で勝ててしまう`).toBe(false);
      }
    },
    TIMEOUT,
  );

  it(
    '最大レベルまで育てればすべてのステージをクリアできる',
    () => {
      for (const stageId of stageOrder) {
        expect(wins(stageId, 30), `${stageId} が Lv30 でもクリアできない`).toBe(true);
      }
    },
    TIMEOUT,
  );

  it(
    'S1 はチュートリアルなので育成なしでクリアできる',
    () => {
      expect(wins('S1', 1)).toBe(true);
    },
    TIMEOUT,
  );

  it(
    '中盤（S3・S4）は育成 Lv10 で届く',
    () => {
      expect(wins('S3', 1), 'S3 が無育成で勝ててしまう').toBe(false);
      expect(wins('S3', 10)).toBe(true);
      expect(wins('S4', 10)).toBe(true);
    },
    TIMEOUT,
  );

  it(
    '終盤（S5〜S7）は Lv10 では届かず、Lv20 で届く',
    () => {
      for (const stageId of ['S5', 'S6', 'S7']) {
        expect(wins(stageId, 10), `${stageId} が Lv10 で勝ててしまう`).toBe(false);
        expect(wins(stageId, 20), `${stageId} が Lv20 で勝てない`).toBe(true);
      }
    },
    TIMEOUT,
  );

  it(
    '最終盤（S8〜S10）は Lv15 では届かず、Lv25 で届く',
    () => {
      for (const stageId of ['S8', 'S9', 'S10']) {
        expect(wins(stageId, 15), `${stageId} が Lv15 で勝ててしまう`).toBe(false);
        expect(wins(stageId, 25), `${stageId} が Lv25 で勝てない`).toBe(true);
      }
    },
    TIMEOUT,
  );

  it(
    'ボスは Lv30 なら取りこぼさず倒し切れる',
    () => {
      // ボスの leak は重い（45 / 40）。素通しすると観客が大きく減るので、
      // **観客 100 = ボスを 1 体も通していない**の意味になる
      for (const stageId of bossStageIds) {
        expect(play(stageId, 30).audience, `${stageId} が Lv30 でも取りこぼす`).toBe(100);
      }
    },
    TIMEOUT,
  );

  it(
    '最終ボス（B2）は Lv10 では完走できない',
    () => {
      expect(wins('B2', 10)).toBe(false);
    },
    TIMEOUT,
  );

  it('ボスは寄り道と最後に置かれ、本編の前提にはならない', () => {
    // B1 をクリアしないと S7 が開かない、という形にはしない
    expect(bossStageIds).toEqual(['B1', 'B2', 'B3', 'B4']);
    expect(mainStageIds).toHaveLength(30);
  });
});

/**
 * 月の都の章（S11〜B3）。
 *
 * ここは**レベルでは測れない**。S10 の時点でレベルは上限（30）に届いているので、
 * 難度を上げると「上限まで育てても勝てない壁」になる。この章が要求するのは
 * 才能ボード・進化・衣装 —— 恒久強化（03-progression.md E-2）のほう。
 *
 * だから見るのは「Lv いくつで届くか」ではなく
 * **「その段階なら届き、ひとつ手前では届かない」**。
 */
describe('月の都の章', () => {
  // ID から導かない。`B3` は数字が 3 なので「10 より後」では拾えず、
  // 賢い式にすると章の境目が黙ってずれる
  const moonStages = [
    'S11', 'S12', 'S13', 'S14', 'S15', 'S16', 'S17', 'S18', 'S19', 'S20', 'B3',
  ];

  it('11 本が並び順に入っている（S11〜S20 + B3）', () => {
    expect(stageOrder.slice(12, 23)).toEqual(moonStages);
  });

  it('前半は才能と進化、後半は衣装まで前提にする', () => {
    // 段階を明示しないと、才能も衣装も無い盤面で 20 ステージぶんの
    // 難度を作ることになり、実際のプレイとかけ離れる
    for (const id of ['S11', 'S12', 'S13', 'S14', 'S15']) expect(investmentOf(id)).toBe('talents');
    for (const id of ['S16', 'S17', 'S18', 'S19', 'S20', 'B3']) {
      expect(investmentOf(id)).toBe('full');
    }
    // 第 1 章は素のまま。ここが崩れると S1〜B2 の難度表が意味を失う
    for (const id of stageOrder.slice(0, 12)) {
      expect(investmentOf(id), `${id} の前提が変わっている`).toBe('bare');
    }
  });

  it(
    'ひとつ手前の段階では届かない（恒久強化が効いていることの証明）',
    () => {
      for (const stageId of moonStages) {
        const previous = PREVIOUS[investmentOf(stageId)];
        if (!previous) throw new Error(`${stageId} に手前の段階が無い`);
        expect(winsAt(stageId, previous), `${stageId} が ${previous} で勝ててしまう`).toBe(false);
      }
    },
    TIMEOUT,
  );

  it(
    '想定した段階なら届く',
    () => {
      for (const stageId of moonStages) {
        expect(winsAt(stageId, investmentOf(stageId)), `${stageId} が想定段階で勝てない`).toBe(
          true,
        );
      }
    },
    TIMEOUT,
  );

  it('S13 の参照盤面にヴィジュアルはいない', () => {
    // 阿倍御主人「火鼠の裘」はヴィジュアルを 75% 軽減する。
    // **その系統を外して成立する**ことが、この敵を置いた理由そのもの
    for (const id of STAGE_PLANS['S13']?.party ?? []) {
      expect(getIdol(id).type, `${id} はヴィジュアル`).not.toBe('visual');
    }
  });

  it('S14 の参照盤面にダンスはいない', () => {
    // 大伴御行は飛行。ダンスは原則対空できない（04-content.md）ので、
    // 対空を持つ系統だけで組めることを盤面の側でも示す
    for (const id of STAGE_PLANS['S14']?.party ?? []) {
      expect(getIdol(id).type, `${id} はダンス`).not.toBe('dance');
    }
  });
});

/**
 * 羽衣の章（S21〜B4）。
 *
 * 月の都の章と同じく**恒久強化の段階**で測るが、前提はひとつ上の `max`
 * （衣装 UR+15）。ここが**最後の段階**で、これより先の前提は置けない ——
 * 置いたら「遊べば届く範囲」の外になる。
 */
describe('羽衣の章', () => {
  const hagoromoStages = [
    'S21', 'S22', 'S23', 'S24', 'S25', 'S26', 'S27', 'S28', 'S29', 'S30', 'B4',
  ];

  it('11 本が並び順の最後に入っている（S21〜S30 + B4）', () => {
    expect(stageOrder.slice(23)).toEqual(hagoromoStages);
  });

  it('全部が積み切った段階を前提にする', () => {
    for (const id of hagoromoStages) {
      expect(investmentOf(id), `${id} の前提が違う`).toBe('max');
    }
    // 前の章まではここより手前の段階。ここが崩れると難度表が意味を失う
    for (const id of stageOrder.slice(0, 23)) {
      expect(investmentOf(id), `${id} が最終段階になっている`).not.toBe('max');
    }
  });

  it(
    'ひとつ手前の段階では届かない（衣装を積み切ったことが効いている証明）',
    () => {
      for (const stageId of hagoromoStages) {
        const previous = PREVIOUS[investmentOf(stageId)];
        if (!previous) throw new Error(`${stageId} に手前の段階が無い`);
        expect(winsAt(stageId, previous), `${stageId} が ${previous} で勝ててしまう`).toBe(false);
      }
    },
    TIMEOUT,
  );

  it(
    '想定した段階なら届く',
    () => {
      for (const stageId of hagoromoStages) {
        expect(winsAt(stageId, investmentOf(stageId)), `${stageId} が想定段階で勝てない`).toBe(
          true,
        );
      }
    },
    TIMEOUT,
  );

  it('S23 と S25 の参照盤面にダンスはいない', () => {
    // S23 は陽炎の兵（飛行）、S25 は虚ろの影（ダンスを 70% 軽減）。
    // どちらも**その系統を外して成立する**ことが、敵を置いた理由そのもの
    for (const stageId of ['S23', 'S25']) {
      for (const id of STAGE_PLANS[stageId]?.party ?? []) {
        expect(getIdol(id).type, `${stageId} の ${id} はダンス`).not.toBe('dance');
      }
    }
  });

  it('S24 の盤面は沈む区間と戻る区間の両方に届く', () => {
    // 「同じ敵を 2 回撃てる」がこのステージの答え。配置マスが
    // 片側にしか届かない位置へずれると、蘇る敵を落とし切れなくなる
    const stage = getStage('S24');
    const dipRows = stage.lanes.slice(0, 2).map((lane) => lane.waypoints);
    for (const waypoints of dipRows) {
      const ys = new Set(waypoints.map(([, y]) => y));
      expect(ys.size, '沈まないレーンになっている').toBe(2);
    }
    // y=2 / y=5 の列が置ける
    const keys = new Set(stage.placeable.map(([x, y]) => `${x},${y}`));
    for (const key of ['7,2', '7,5']) expect(keys.has(key), `${key} が置けない`).toBe(true);
  });
});
