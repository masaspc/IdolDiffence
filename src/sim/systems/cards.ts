/**
 * セットリスト（ローグライト式 3 択）。
 *
 * 選択ポイント（◆）で 3 枚を提示し、選んだ 1 枚の効果をラン内プールへ流し込む
 * （03-progression.md ③）。
 */
import type { Rng } from '../../core/rng';
import { cards as cardData } from '../../data';
import { RARITY_WEIGHT, type CardDef } from '../../data/schema/card';
import type { IdolType } from '../../data/schema/common';
import { addFlat, addPct, addTypePct, type ModifierPool } from '../modifiers';

export interface CardOffer {
  id: string;
  def: CardDef;
}

/** 即時効果は選択時に 1 回だけ適用する */
export interface InstantEffects {
  cheer: number;
  voltage: number;
}

/**
 * 3 枚を抽選する。
 *
 * - すでに上限まで取ったカードは除外する
 * - **編成に含まれる系統のカードは重みを 1.4 倍**にして、噛み合う選択肢を出やすくする
 */
export function drawOffers(
  rng: Rng,
  taken: ReadonlyMap<string, number>,
  deployedTypes: ReadonlySet<IdolType>,
  count = 3,
): CardOffer[] {
  const pool: { id: string; def: CardDef; weight: number }[] = [];

  for (const [id, def] of Object.entries(cardData)) {
    if ((taken.get(id) ?? 0) >= def.maxStacks) continue;
    let weight = RARITY_WEIGHT[def.rarity];
    const matchesDeployed = def.effects.some(
      (effect) => effect.kind === 'typeAtkPct' && deployedTypes.has(effect.type),
    );
    if (matchesDeployed) weight *= 1.4;
    pool.push({ id, def, weight });
  }

  const offers: CardOffer[] = [];
  for (let i = 0; i < count && pool.length > 0; i++) {
    const total = pool.reduce((sum, entry) => sum + entry.weight, 0);
    let roll = rng.next() * total;
    let index = pool.length - 1;
    for (let j = 0; j < pool.length; j++) {
      roll -= pool[j]!.weight;
      if (roll <= 0) {
        index = j;
        break;
      }
    }
    const picked = pool.splice(index, 1)[0];
    if (picked) offers.push({ id: picked.id, def: picked.def });
  }
  return offers;
}

/**
 * カードの効果をプールへ適用する。
 * 継続効果は加算プールへ、即時効果は戻り値で返して呼び出し側が処理する。
 */
export function applyCard(pool: ModifierPool, def: CardDef): InstantEffects {
  const instant: InstantEffects = { cheer: 0, voltage: 0 };

  for (const effect of def.effects) {
    switch (effect.kind) {
      case 'atkPct':
        addPct(pool, 'atk', effect.value);
        break;
      case 'rangePct':
        addPct(pool, 'range', effect.value);
        break;
      case 'attackSpeedPct':
        addPct(pool, 'attackSpeed', effect.value);
        break;
      // クリティカル系は「+6%」を実数加算として扱う。
      // 乗算にすると基礎 5% に対する +6% で 5.3% にしかならず、表記と食い違う
      case 'critRate':
        addFlat(pool, 'critRate', effect.value);
        break;
      case 'critDmg':
        addFlat(pool, 'critDmg', effect.value);
        break;
      case 'cheerGainPct':
        addPct(pool, 'cheerGain', effect.value);
        break;
      case 'voltageGainPct':
        addPct(pool, 'voltageGain', effect.value);
        break;
      case 'slowPowerPct':
        addPct(pool, 'slowPower', effect.value);
        break;
      case 'typeAtkPct':
        addTypePct(pool, effect.type, effect.value);
        break;
      case 'instantCheer':
        instant.cheer += effect.value;
        break;
      case 'instantVoltage':
        instant.voltage += effect.value;
        break;
    }
  }
  return instant;
}
