/**
 * 設定（06-ui-ux.md 6.7 アクセシビリティ）。
 *
 * **既定値は「誰でも遊べる側」に倒す。** 初回起動でいきなり
 * 点滅と揺れが走り、リズム入力を要求される状態にはしない。
 * 設定画面を開かないまま遊ぶ人がいちばん多い、という前提で決めている。
 *
 * セーブへ持つのは**選んだ値そのもの**で、そこから導ける実効値（文字倍率の
 * 小数など）は持たない。曲線や段階を変えたときに、保存済みの値だけが
 * 古い解釈のまま残るのを避ける（ランク・楽曲レベルと同じ理由）。
 */
import { z } from 'zod';

/**
 * 演出の強さ。光過敏対策として**点滅と画面揺れを段階的に落とす**。
 *
 * - `full`: すべて出す
 * - `reduced`: 画面揺れを止め、点滅の振れ幅を小さくする
 * - `minimal`: 揺れ・点滅・浮遊ダメージ表示をすべて止める
 */
export const effectLevelSchema = z.enum(['full', 'reduced', 'minimal']);
export type EffectLevel = z.infer<typeof effectLevelSchema>;

/** 文字サイズ。HUD は rem ベースなので、根の font-size を動かすだけで通る */
export const textScaleSchema = z.union([z.literal(100), z.literal(125), z.literal(150)]);
export type TextScale = z.infer<typeof textScaleSchema>;

export const settingsSchema = z.object({
  /**
   * コール & レスポンス（02-core-battle.md 2.9）を自分で押すか。
   *
   * **既定は off。** 切っていると Good 相当が自動で入るので、
   * 知らないまま遊んでも損をしない。入れるのは「やりたい人が自分で入れる」形
   */
  call: z.boolean(),
  effects: effectLevelSchema,
  textScale: textScaleSchema,
  /**
   * 系統を色だけで見分けない（色覚）。
   *
   * 形アイコン（♪ / ★ / ♥）は**常に**併記しているので、これは
   * 盤面の敵にも属性の記号を出すかどうかの指定
   */
  attributeGlyphs: z.boolean(),
});

export type Settings = z.infer<typeof settingsSchema>;

export const DEFAULT_SETTINGS: Settings = {
  call: false,
  effects: 'full',
  textScale: 100,
  attributeGlyphs: false,
};

/** 文字サイズの実効倍率。`html` の font-size に掛ける */
export function textScaleRatio(scale: TextScale): number {
  return scale / 100;
}

/** 画面揺れを出してよいか */
export function allowsShake(effects: EffectLevel): boolean {
  return effects === 'full';
}

/** 点滅の振れ幅（0 で完全に止まる） */
export function flashAmount(effects: EffectLevel): number {
  if (effects === 'full') return 1;
  if (effects === 'reduced') return 0.4;
  return 0;
}

/** 浮遊ダメージ表示を出してよいか。最小では数字が飛び交うのも止める */
export function allowsFloatingText(effects: EffectLevel): boolean {
  return effects !== 'minimal';
}

export const EFFECT_LABEL: Record<EffectLevel, string> = {
  full: '標準',
  reduced: '控えめ',
  minimal: '最小',
};
