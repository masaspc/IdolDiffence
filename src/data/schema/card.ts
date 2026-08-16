import { z } from 'zod';
import { idolTypeSchema } from './common';

/**
 * セットリストカードの効果。
 * 語彙を絞ることで、カードを増やしても合流点（modifiers.ts）が汚れないようにする。
 */
export const cardEffectSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('atkPct'), value: z.number() }),
  z.object({ kind: z.literal('rangePct'), value: z.number() }),
  z.object({ kind: z.literal('attackSpeedPct'), value: z.number() }),
  z.object({ kind: z.literal('critRate'), value: z.number() }),
  z.object({ kind: z.literal('critDmg'), value: z.number() }),
  z.object({ kind: z.literal('cheerGainPct'), value: z.number() }),
  z.object({ kind: z.literal('voltageGainPct'), value: z.number() }),
  z.object({ kind: z.literal('slowPowerPct'), value: z.number() }),
  z.object({ kind: z.literal('instantCheer'), value: z.number() }),
  z.object({ kind: z.literal('instantVoltage'), value: z.number() }),
  z.object({ kind: z.literal('typeAtkPct'), type: idolTypeSchema, value: z.number() }),
]);

export const cardSchema = z.object({
  name: z.string().min(1),
  rarity: z.enum(['common', 'rare', 'epic']),
  desc: z.string().min(1),
  effects: z.array(cardEffectSchema).min(1),
  /** 同じカードを取れる上限。4 回目以降は抽選から除外される */
  maxStacks: z.number().int().positive().default(3),
});

export const cardsSchema = z.record(z.string(), cardSchema);

export type CardEffect = z.infer<typeof cardEffectSchema>;
export type CardDef = z.infer<typeof cardSchema>;
export type Cards = z.infer<typeof cardsSchema>;

/** レアリティごとの抽選重み（03-progression.md ③） */
export const RARITY_WEIGHT: Record<CardDef['rarity'], number> = {
  common: 55,
  rare: 33,
  epic: 12,
};
