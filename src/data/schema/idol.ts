import { z } from 'zod';
import { idolTypeSchema } from './common';

/**
 * 命中時に付与する状態異常。
 *
 * **配列で持つ**。「魅了しつつ脆弱も付ける」のように 1 発で 2 つ乗せる覚醒があり、
 * 単数で持つと `onHit2` のような場当たりのフィールドが増えていく。
 */
export const onHitSchema = z.object({
  status: z.enum(['slow', 'echo', 'charm', 'stun', 'vulnerable']),
  /**
   * 効果量。
   * - slow: 減速率（0.25 = -25%）
   * - echo: 付与スタック数
   * - vulnerable: 被ダメージ増加率（0.3 = +30%）
   * - charm / stun: 未使用（時間だけが効く）
   */
  value: z.number(),
  durationMs: z.number().positive(),
});

/** 一定回数の命中ごとに経路を押し戻す。D2「たまくだき」・V3 覚醒「咆哮」 */
export const knockbackSchema = z.object({
  /** 何発ごとに発生するか */
  everyHits: z.number().int().positive(),
  /** 押し戻す距離（マス単位） */
  distance: z.number().positive(),
});

/** HP が閾値以下の敵に倍率を掛ける。D3「ひねずみ」 */
export const executeSchema = z.object({
  /** 発動する HP 割合（0.3 = 30% 以下） */
  threshold: z.number().min(0).max(1),
  mul: z.number().positive(),
});

export const attackSchema = z.object({
  /**
   * - single: 単体
   * - aoe_ring: 対象を中心とした円
   * - pierce_line: 自分から対象へ伸びる直線上を貫通（V3「ながれ」）
   */
  kind: z.enum(['single', 'aoe_ring', 'pierce_line']),
  skillMul: z.number().positive(),
  /** aoe_ring の半径 / pierce_line の線の太さ（マス単位） */
  radius: z.number().nonnegative().default(0),
  /** 飛行敵を攻撃できるか。歌とヴィジュアルは true、ダンスは false */
  canHitFlying: z.boolean(),
  /** 防御無視（0.4 = DEF の 40% を無視） */
  defIgnore: z.number().min(0).max(1).default(0),
  execute: executeSchema.optional(),
  knockback: knockbackSchema.optional(),
  onHit: z.array(onHitSchema).default([]),
});

/**
 * 常時発動のオーラ。攻撃とは別枠で、配置している限り効き続ける。
 * V2「かさね」（味方バフ）と Vi3「たまのえだ」（敵デバフ + 味方バフ）で使う。
 */
export const auraSchema = z.object({
  name: z.string().min(1),
  desc: z.string().min(1),
  /** 効果範囲（マス単位）。自分自身は含まない */
  radius: z.number().positive(),
  /** 範囲内の味方の ATK 加算（0.2 = +20%） */
  allyAtkPct: z.number().default(0),
  /** 範囲内の敵の DEF 低下（0.35 = -35%） */
  enemyDefPct: z.number().min(0).max(1).default(0),
});

/**
 * 覚醒分岐（03-progression.md ②）。ポジション Lv3 到達時に A/B から 1 つを選ぶ。
 * 単なる数値上昇ではなく、攻撃の挙動そのものが変わるようにしている。
 */
export const awakeningBranchSchema = z.object({
  name: z.string().min(1),
  desc: z.string().min(1),
  mods: z
    .object({
      attackIntervalMul: z.number().positive().optional(),
      radiusMul: z.number().positive().optional(),
      critRateAdd: z.number().optional(),
      /** 単体攻撃を同時 N 体へ */
      multiTarget: z.number().int().positive().optional(),
      /** 単体攻撃を範囲化する。値は半径 */
      toAoe: z.number().positive().optional(),
      /** onHit の slow の効果量を上書きする */
      slowValue: z.number().optional(),
      /** 対空を獲得する。ダンスが対空を得る唯一の経路（04-content.md 対空のルール） */
      grantFlying: z.boolean().optional(),
      /** 防御無視を上乗せする */
      defIgnoreAdd: z.number().optional(),
      /** 撃破時に攻撃間隔を即座に空ける。D3 覚醒「追撃」 */
      resetCooldownOnKill: z.boolean().optional(),
      /** オーラの範囲倍率 */
      auraRadiusMul: z.number().positive().optional(),
      /** オーラの効果量倍率 */
      auraPowerMul: z.number().positive().optional(),
      /** オーラを捨てて自身の ATK に変換する。V2 覚醒「独唱」 */
      auraToSelfAtk: z.number().optional(),
    })
    .default({}),
  /** 指定した場合、基本攻撃の onHit を置き換える */
  onHit: z.array(onHitSchema).optional(),
  knockback: knockbackSchema.optional(),
});

/**
 * センターパッシブ（03-progression.md ⑤）。編成で 1 人だけ選び、ライブ中は固定。
 * 全体に掛かるので**乗算プール**へ入れる（枠が有限なので暴走しにくい）。
 */
export const centerPassiveSchema = z.object({
  name: z.string().min(1),
  desc: z.string().min(1),
  mods: z
    .object({
      atkMul: z.number().positive().optional(),
      attackSpeedMul: z.number().positive().optional(),
      rangeMul: z.number().positive().optional(),
      cheerGainMul: z.number().positive().optional(),
      voltageGainMul: z.number().positive().optional(),
      slowPowerMul: z.number().positive().optional(),
      critRateAdd: z.number().optional(),
      /** 配置コスト倍率（0.92 = -8%） */
      costMul: z.number().positive().optional(),
      /** スペシャルライブの持続時間を延ばす */
      specialDurationAddMs: z.number().optional(),
    })
    .default({}),
});

/** ユニットタグ。フォーメーションの配置条件として使う（04-content.md ユニットタグ） */
export const unitTagSchema = z.enum(['kaguya', 'gonan', 'tsukuyomi']);

export const idolSchema = z.object({
  name: z.string().min(1),
  /** 表示用の短縮名。HUD の配置パレットで使う */
  shortName: z.string().min(1),
  type: idolTypeSchema,
  cost: z.number().positive(),
  tags: z.array(unitTagSchema).default([]),
  base: z.object({
    atk: z.number().positive(),
    /** 射程（マス単位） */
    range: z.number().positive(),
    attackIntervalMs: z.number().positive(),
    critRate: z.number().min(0).max(1).default(0.05),
    critDmg: z.number().nonnegative().default(0.5),
  }),
  attack: attackSchema,
  aura: auraSchema.optional(),
  centerPassive: centerPassiveSchema.optional(),
  awakening: z.object({ A: awakeningBranchSchema, B: awakeningBranchSchema }).optional(),
});

export const idolsSchema = z.record(z.string(), idolSchema);

export type OnHit = z.infer<typeof onHitSchema>;
export type Knockback = z.infer<typeof knockbackSchema>;
export type Execute = z.infer<typeof executeSchema>;
export type AttackDef = z.infer<typeof attackSchema>;
export type AuraDef = z.infer<typeof auraSchema>;
export type AwakeningBranch = z.infer<typeof awakeningBranchSchema>;
export type CenterPassive = z.infer<typeof centerPassiveSchema>;
export type UnitTag = z.infer<typeof unitTagSchema>;
export type IdolDef = z.infer<typeof idolSchema>;
export type Idols = z.infer<typeof idolsSchema>;
export type AwakeningKey = 'A' | 'B';
