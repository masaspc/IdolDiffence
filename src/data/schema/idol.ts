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
 * 攻撃の挙動を書き換える指定。覚醒分岐と進化で**同じ形**を使う。
 *
 * 形を揃えておくと、`resolveUnit` は「乗っている枝」を集めて畳むだけで済み、
 * 進化のために攻撃解決へ分岐を足さずに済む（sim/unitStats.ts `activeBranches`）。
 */
export const branchModsSchema = z
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
  .default({});

/**
 * 覚醒分岐（03-progression.md ②）。ポジション Lv3 到達時に A/B から 1 つを選ぶ。
 * 単なる数値上昇ではなく、攻撃の挙動そのものが変わるようにしている。
 */
export const awakeningBranchSchema = z.object({
  name: z.string().min(1),
  desc: z.string().min(1),
  mods: branchModsSchema,
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

/**
 * ユニットタグ。フォーメーションの配置条件として使う（04-content.md ユニットタグ）。
 * **すべて原作にある関係**をそのまま持ってきている（本作で作ったグループ分けではない）。
 */
export const unitTagSchema = z.enum([
  /** 原作のユニット「かぐや・いろPチャンネル」 */
  'kaguya_irop',
  /** 原作のプロゲーマーグループ「Black onyX」 */
  'black_onyx',
  /** 仮想空間ツクヨミのライバー */
  'tsukuyomi_liver',
  /** 彩葉の友人 */
  'ayaha_friend',
]);

/**
 * 盤面のドット絵を組み立てるための指定（render/sprites.ts）。
 *
 * **原作の外見の再現ではない。** 各キャラクターの容姿は一次情報で確認できていないため
 * （04-content.md の未確認事項）、ここで決めているのは
 * **盤面で誰がどこにいるかを見分けるための記号**でしかない。
 * 公式のビジュアルが確認できたら、手描きのスプライトへ差し替える。
 */
const hexColor = z.string().regex(/^#[0-9a-f]{6}$/i);

export const spriteArtSchema = z.object({
  hairStyle: z.enum(['long', 'bob', 'short', 'twin', 'ponytail', 'spiky', 'updo']),
  /** 髪の色 */
  hair: hexColor,
  /** インナーカラー。かぐやの特徴として記事で確認できたもの */
  hairInner: hexColor.optional(),
  /** 服の主色 */
  outfit: hexColor,
  /** スカート・袴などの副色 */
  outfit2: hexColor.optional(),
  /** 差し色。省略すると系統色を使う */
  accent: hexColor.optional(),
  eye: hexColor.optional(),
  /** アイシャドー。彩葉の「赤いアイシャドー」 */
  eyeShadow: hexColor.optional(),
  body: z.enum(['skirt', 'pants', 'kimono']).default('skirt'),
  /**
   * 頭のモチーフ。**原作で確認できた形だけ**を入れる
   * （かぐや=兎 / 彩葉=狐 / オタ公=犬 / ヤチヨ=和傘）
   */
  accessory: z.enum(['none', 'rabbit', 'fox', 'dog', 'umbrella']).default('none'),
  /** 三日月の髪飾り（かぐや） */
  crescent: z.boolean().default(false),
  /** 額の装飾（彩葉） */
  foreheadMark: z.boolean().default(false),
  /** 腹部のマスコットの色（ヤチヨのメンダコ） */
  mascot: hexColor.optional(),
});

/**
 * 進化（03-progression.md ⑦-2）。
 *
 * 初期メンバーの 3 人は配置コストが軽いぶん素の火力が低く、終盤は編成から
 * 落ちてしまう。**恒久の解放**をひとつ挟んで、同じキャラを終盤まで使える形にする。
 *
 * レベル上げ（`levelUp`）との違いは、
 * - 一度きりで、資金だけでなく**到達したステージとレベル**を要求する
 * - 数値だけでなく攻撃の挙動と見た目が変わる
 * ので、「育て続ければいつか強い」ではなく「ここで一段変わる」になること。
 *
 * 名前は劇中歌に由来する（04-content.md 4.1 の出典表）。
 */
export const evolutionSchema = z.object({
  name: z.string().min(1),
  shortName: z.string().min(1),
  desc: z.string().min(1),
  /** 解放条件。両方を満たして初めて資金を払える */
  requires: z.object({
    /** クリア済みでなければならないステージ */
    stage: z.string().min(1),
    /** 必要なアイドルレベル */
    level: z.number().int().positive(),
  }),
  /** 解放にかかる資金 */
  cost: z.number().nonnegative(),
  /** 基礎攻撃力の倍率。ポジション強化と同じ乗算プールへ入る */
  atkMul: z.number().positive().default(1),
  rangeMul: z.number().positive().default(1),
  /** 覚醒分岐と同じ形。常時乗る 1 枝として解決される */
  mods: branchModsSchema,
  /** 進化後の見た目。省略すると元の `art` を使う */
  art: spriteArtSchema.optional(),
});

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
  art: spriteArtSchema.optional(),
  aura: auraSchema.optional(),
  centerPassive: centerPassiveSchema.optional(),
  awakening: z.object({ A: awakeningBranchSchema, B: awakeningBranchSchema }).optional(),
  evolution: evolutionSchema.optional(),
});

export const idolsSchema = z.record(z.string(), idolSchema);

export type OnHit = z.infer<typeof onHitSchema>;
export type Knockback = z.infer<typeof knockbackSchema>;
export type Execute = z.infer<typeof executeSchema>;
export type AttackDef = z.infer<typeof attackSchema>;
export type AuraDef = z.infer<typeof auraSchema>;
export type SpriteArt = z.infer<typeof spriteArtSchema>;
export type BranchMods = z.infer<typeof branchModsSchema>;
export type AwakeningBranch = z.infer<typeof awakeningBranchSchema>;
export type EvolutionDef = z.infer<typeof evolutionSchema>;
export type CenterPassive = z.infer<typeof centerPassiveSchema>;
export type UnitTag = z.infer<typeof unitTagSchema>;
export type IdolDef = z.infer<typeof idolSchema>;
export type Idols = z.infer<typeof idolsSchema>;
export type AwakeningKey = 'A' | 'B';
