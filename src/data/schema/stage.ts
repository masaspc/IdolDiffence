import { z } from 'zod';
import { cellSchema, cellTypeSchema, sectionSchema } from './common';

export const laneSchema = z.object({
  /** 経路のウェイポイント。敵はこの上を線形補間で進む */
  waypoints: z.array(cellSchema).min(2),
});

export const spawnSchema = z.object({
  /** セクション内での開始小節（0 始まり） */
  bar: z.number().nonnegative(),
  enemy: z.string().min(1),
  count: z.number().int().positive(),
  /** 1 体ごとの間隔（小節単位） */
  intervalBars: z.number().positive(),
  lane: z.number().int().nonnegative(),
});

export const waveSchema = z.object({
  section: sectionSchema,
  bars: z.number().int().positive(),
  spawns: z.array(spawnSchema),
  /** セットリスト選択ポイント（◆）。このウェーブの終わりで選択させる */
  cardPick: z.boolean().default(false),
});

export const stageSchema = z.object({
  name: z.string().min(1),
  grid: z.object({
    w: z.number().int().positive(),
    h: z.number().int().positive(),
  }),
  lanes: z.array(laneSchema).min(1),
  placeable: z.array(cellSchema),
  /** "x,y" -> マス種別。未指定は 'stage' 扱い */
  cellTypes: z.record(z.string(), cellTypeSchema).default({}),
  song: z.string().min(1),
  hpMul: z.number().positive().default(1),
  /**
   * ステージ固有のギミック（04-content.md 4.4）。
   *
   * 敵の種類だけで差を付けると、後半のステージは「同じ敵が硬くなっただけ」に
   * なる。盤面そのものの条件を変える枠をここに置く。
   */
  modifiers: z
    .object({
      /** 全メンバーの射程倍率。S9「雨のアリーナ」は 0.9（視界が悪い） */
      rangeMul: z.number().positive().optional(),
      /**
       * 自然に溜まる声援の倍率。S17「夜の館」は 0.8（まだ客が入っていない）。
       *
       * **撃破報酬（bounty）には掛からない。** 掛けると「置けないうえに
       * 置いても取り返せない」になり、開幕で詰む。減らすのは
       * 「待っていれば増えるぶん」だけにして、攻めれば取り返せる形にする
       */
      cheerGainMul: z.number().positive().optional(),
      /**
       * 敵の移動速度の倍率。S18「雲上」は 1.15（月の重力）。
       *
       * 射程を削るのと似ているが、**効き方が逆**。射程は置く場所の問題、
       * 速度は削り切る時間の問題で、答えになる強化がそれぞれ違う
       */
      enemySpeedMul: z.number().positive().optional(),
      /** UI に出す説明。プレイヤーが理由を知らないまま弱くならないように */
      note: z.string().optional(),
    })
    .default({}),
  /**
   * 会場の見た目（04-content.md 4.0）。既定は常夜の街。
   *
   * `water` は**ステージが一面水で覆われ、観客が海の中にいるような空間** ——
   * 原作でヤチヨのライブが描かれるときの形。盤面の読みやすさは変えず、
   * 背景の色と波紋だけを差し替える
   */
  scenery: z.enum(['street', 'water']).default('street'),
  /** ボスステージか。ステージ選択で別枠に出す */
  boss: z.boolean().default(false),
  waves: z.array(waveSchema).min(1),
});

export const stagesSchema = z.record(z.string(), stageSchema);

export type Lane = z.infer<typeof laneSchema>;
export type Spawn = z.infer<typeof spawnSchema>;
export type Wave = z.infer<typeof waveSchema>;
export type Stage = z.infer<typeof stageSchema>;
export type Stages = z.infer<typeof stagesSchema>;

/**
 * 経路が通過するマスをすべて集める。
 * 区間を細かくサンプリングして丸めるだけの素朴な実装だが、
 * ウェイポイント間が数マスしかないので十分。
 */
export function collectLaneCells(stage: Stage): Set<string> {
  const cells = new Set<string>();
  for (const lane of stage.lanes) {
    for (let i = 0; i < lane.waypoints.length - 1; i++) {
      const from = lane.waypoints[i];
      const to = lane.waypoints[i + 1];
      if (!from || !to) continue;
      const steps = Math.max(Math.abs(to[0] - from[0]), Math.abs(to[1] - from[1])) * 4;
      for (let s = 0; s <= steps; s++) {
        const t = steps === 0 ? 0 : s / steps;
        const x = Math.round(from[0] + (to[0] - from[0]) * t);
        const y = Math.round(from[1] + (to[1] - from[1]) * t);
        cells.add(`${x},${y}`);
      }
    }
  }
  return cells;
}

/**
 * スキーマだけでは表現できない不変条件。
 * ビルド時の validate:data で使う（docs/design/05-architecture.md 5.6）。
 */
export function checkStageInvariants(id: string, stage: Stage): string[] {
  const errors: string[] = [];
  const { w, h } = stage.grid;

  const inBounds = ([x, y]: readonly [number, number]): boolean =>
    x >= 0 && x < w && y >= 0 && y < h;

  stage.lanes.forEach((lane, i) => {
    lane.waypoints.forEach((wp, j) => {
      if (!inBounds(wp)) {
        errors.push(`${id}: lane[${i}].waypoints[${j}] ${JSON.stringify(wp)} がグリッド外です`);
      }
    });
  });

  const placeableKeys = new Set<string>();
  stage.placeable.forEach((cell, i) => {
    if (!inBounds(cell)) {
      errors.push(`${id}: placeable[${i}] ${JSON.stringify(cell)} がグリッド外です`);
    }
    const key = `${cell[0]},${cell[1]}`;
    if (placeableKeys.has(key)) {
      errors.push(`${id}: placeable に重複したマス ${key} があります`);
    }
    placeableKeys.add(key);
  });

  // 経路上に配置マスがあると、敵とユニットが重なって見える。
  // ウェイポイントだけでなく、区間が通過するマスもすべて塞ぐ。
  const laneCells = collectLaneCells(stage);
  for (const key of placeableKeys) {
    if (laneCells.has(key)) {
      errors.push(`${id}: 配置マス ${key} が経路のウェイポイントと重なっています`);
    }
  }

  for (const key of Object.keys(stage.cellTypes)) {
    if (!placeableKeys.has(key)) {
      errors.push(`${id}: cellTypes の ${key} は placeable に含まれていません`);
    }
  }

  const laneCount = stage.lanes.length;
  stage.waves.forEach((wave, i) => {
    wave.spawns.forEach((spawn, j) => {
      if (spawn.lane >= laneCount) {
        errors.push(`${id}: waves[${i}].spawns[${j}].lane=${spawn.lane} は存在しません`);
      }
      const end = spawn.bar + (spawn.count - 1) * spawn.intervalBars;
      if (end > wave.bars) {
        errors.push(
          `${id}: waves[${i}].spawns[${j}] の最終スポーンが ${end} 小節目で、` +
            `ウェーブ長 ${wave.bars} 小節を超えています`,
        );
      }
    });
  });

  return errors;
}
