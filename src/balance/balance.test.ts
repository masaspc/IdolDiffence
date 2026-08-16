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
import { bossStageIds, getIdol, mainStageIds, rosterIds, stageOrder } from '../data';
import { levelAtkMultiplier } from '../meta/progression';
import { PLAN_STAGES, STAGE_PLANS } from './plans';

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
  const world = createWorld(stageId, SEED, metaAt(stageId, level));
  const { snapshot } = autoplay(world, {
    plan: placements ? (plan?.placements ?? []) : [],
    useSpecial: true,
  });
  return snapshot;
}

function wins(stageId: string, level: number, placements = true): boolean {
  return play(stageId, level, placements).won;
}

describe('バランス', () => {
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
    expect(bossStageIds).toEqual(['B1', 'B2']);
    expect(mainStageIds).toHaveLength(10);
  });
});
