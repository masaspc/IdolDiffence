import { z } from 'zod';

/**
 * 衣装（03-progression.md ⑨）。
 *
 * ハクスラ的なランダム性で周回動機を作る枠。**定義（シリーズとセット効果）は
 * ここ、生成された 1 着ずつの実体は meta/costumes.ts** が持つ。
 * 実体は乱数で無数に増えるので JSON には置けない。
 */

/** 4 スロット。同じスロットには 1 着しか着られない */
export const costumeSlotSchema = z.enum(['stage', 'accessory', 'mic', 'makeup']);

export const costumeRaritySchema = z.enum(['R', 'SR', 'SSR', 'UR']);

/**
 * 副次ステータスの語彙。
 *
 * カードや才能と同じ器（modifiers.ts）へ流し込めるものだけに絞る。
 * ここを広げると、衣装のためだけの計算経路が sim に増えていく。
 */
export const costumeStatSchema = z.enum([
  'atkPct',
  'rangePct',
  'attackSpeedPct',
  'critRateAdd',
  'critDmgAdd',
  'cheerGainPct',
  'voltageGainPct',
  'statusPowerPct',
  'statusDurationPct',
  'aoeRadiusPct',
  'echoPowerPct',
]);

/**
 * セット効果。
 *
 * シリーズ名は竹取物語の**五つの難題**から採っている（本作独自の命名。
 * 原典で誰も持ち帰れなかった宝物を、衣装として身にまとうという見立て）。
 */
export const setBonusSchema = z
  .object({
    /** 副次ステータスと同じ語彙のぶん */
    stats: z.record(costumeStatSchema, z.number()).default({}),
    /** 防御無視の上乗せ（0.2 = DEF の 20% を追加で無視） */
    defIgnoreAdd: z.number().optional(),
    /**
     * 前面シールドの貫通（0.5 = シールドの軽減量を半分打ち消す）。
     *
     * 設計では「Break の効果量 +50%」だが、Break という機構は本作に無い。
     * 実在する「カガミの前面シールド」に読み替えている（04-content.md）
     */
    shieldPierce: z.number().min(0).max(1).optional(),
    /** スペシャルライブ中のダメージ加算（0.35 = +35%） */
    specialDmgPct: z.number().optional(),
    /** Echo の最大スタック加算 */
    echoMaxStacksAdd: z.number().int().optional(),
    /** ライブ開始時の声援 */
    startCheer: z.number().optional(),
  })
  .default({});

export const costumeSeriesSchema = z.object({
  name: z.string().min(1),
  /** 由来の説明。UI に出して「なぜこの名前か」を伝える */
  flavor: z.string().min(1),
  /** 2 着そろったときの効果 */
  two: setBonusSchema,
  /** 4 着そろったときの効果。`two` に**上乗せ**される */
  four: setBonusSchema,
});

export const costumeSeriesMapSchema = z.record(z.string(), costumeSeriesSchema);

export type CostumeSlot = z.infer<typeof costumeSlotSchema>;
export type CostumeRarity = z.infer<typeof costumeRaritySchema>;
export type CostumeStat = z.infer<typeof costumeStatSchema>;
export type SetBonus = z.infer<typeof setBonusSchema>;
export type CostumeSeries = z.infer<typeof costumeSeriesSchema>;
export type CostumeSeriesMap = z.infer<typeof costumeSeriesMapSchema>;

export const COSTUME_SLOTS = ['stage', 'accessory', 'mic', 'makeup'] as const;
export const COSTUME_RARITIES = ['R', 'SR', 'SSR', 'UR'] as const;

export const SLOT_LABEL: Record<CostumeSlot, string> = {
  stage: 'ステージ衣装',
  accessory: 'アクセサリー',
  mic: 'マイク',
  makeup: 'メイク',
};

/**
 * スロットごとのメインステータス（03-progression.md ⑨）。
 *
 * アクセサリーだけは 2 種から抽選する。「引くたびに違う」を 1 スロットだけに
 * 閉じ込めておくと、他のスロットは狙って集められる。
 *
 * メイクは設計では「効果命中 / 効果時間%」だが、**効果命中という機構は本作に無い**
 * （状態異常は必中）。効果時間だけを持たせている。
 */
export const SLOT_MAIN_STATS: Record<CostumeSlot, readonly CostumeStat[]> = {
  stage: ['atkPct'],
  accessory: ['critRateAdd', 'critDmgAdd'],
  mic: ['attackSpeedPct'],
  makeup: ['statusDurationPct'],
};

/** レアリティごとの副次ステータスの数（03-progression.md ⑨） */
export const SUB_STAT_COUNT: Record<CostumeRarity, number> = { R: 1, SR: 2, SSR: 3, UR: 4 };

/** 強化の上限。3 の倍数ごとに副次ステータスが 1 つ伸びる */
export const MAX_ENHANCE = 15;
