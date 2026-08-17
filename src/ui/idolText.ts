/**
 * アイドルの能力を**日本語の文**にする。
 *
 * ## なぜ画面から切り離すか
 *
 * `idols.json` は `skillMul: 0.9` `defIgnore: 0.4` のような素の値しか持たない。
 * 画面にそのまま出しても「0.9 が何なのか」は伝わらないし、かといって
 * JSON に説明文を書き足すと、数値を変えたときに文だけ古いまま残る
 * （衣装の実効値・ランクと同じ罠）。**数値から文を導く**のが正しい形。
 *
 * DOM に触らないので、文言そのものをテストで固定できる。
 */
import { getIdol, getStage } from '../data';
import type {
  AffinityDef,
  AwakeningBranch,
  BranchMods,
  EvolutionDef,
  IdolDef,
  OnHit,
} from '../data/schema/idol';

const pct = (value: number): string => `${Math.round(value * 100)}%`;
/** 倍率を「+20%」「-25%」の形へ。1 との差で読ませる */
const delta = (mul: number): string => {
  const diff = Math.round((mul - 1) * 100);
  return `${diff >= 0 ? '+' : ''}${diff}%`;
};
const sec = (ms: number): string => `${(ms / 1000).toFixed(ms % 1000 === 0 ? 0 : 1)} 秒`;

export const TYPE_LABEL: Record<string, string> = {
  vocal: '歌',
  dance: 'ダンス',
  visual: 'ヴィジュアル',
};

/** 3 すくみ（02-core-battle.md 2.5）。系統ごとに「有利な相手」が違う */
export const TYPE_STRONG_AGAINST: Record<string, string> = {
  vocal: '静寂',
  dance: '喧噪',
  visual: '虚飾',
};

export const ATTACK_KIND_LABEL: Record<string, string> = {
  single: '単体',
  aoe_ring: '範囲',
  pierce_line: '貫通',
};

const STATUS_LABEL: Record<OnHit['status'], string> = {
  slow: '減速',
  echo: 'Echo（継続ダメージ）',
  charm: '魅了',
  stun: 'スタン',
  vulnerable: '脆弱',
};

/** 命中時効果 1 つぶんの説明 */
export function onHitText(onHit: OnHit): string {
  const label = STATUS_LABEL[onHit.status];
  switch (onHit.status) {
    case 'slow':
      return `${label} -${pct(onHit.value)}（${sec(onHit.durationMs)}）`;
    case 'vulnerable':
      return `${label} +${pct(onHit.value)}（${sec(onHit.durationMs)}）`;
    case 'echo':
      return `${label} ${onHit.value} スタック（${sec(onHit.durationMs)}）`;
    default:
      // 魅了とスタンは「止まるか止まらないか」しかない。効くのは時間だけ
      return `${label}（${sec(onHit.durationMs)}）`;
  }
}

/**
 * 攻撃の説明。**数値の羅列にせず、何ができるかから書く。**
 * 「範囲 1.5」より「半径 1.5 マスをまとめて巻き込む」のほうが、
 * 置く場所を決めるのに使える。
 *
 * @param evolution 解放済みの進化。渡すと**進化後の値**で書く。
 *   攻撃力だけ進化後で、範囲は素のまま、では画面のなかで食い違う
 */
export function attackLines(def: IdolDef, evolution?: EvolutionDef | null): string[] {
  const a = def.attack;
  const mods = evolution?.mods;
  const lines: string[] = [];

  const kind = mods?.toAoe !== undefined ? 'aoe_ring' : a.kind;
  const baseRadius = mods?.toAoe ?? a.radius;
  const radius = Math.round(baseRadius * (mods?.radiusMul ?? 1) * 100) / 100;

  if (kind === 'aoe_ring') {
    lines.push(`狙った敵を中心に、半径 ${radius} マスをまとめて巻き込む`);
  } else if (kind === 'pierce_line') {
    lines.push(`自分から狙った敵へ伸びる直線上を、まとめて貫く（太さ ${radius} マス）`);
  } else {
    lines.push('狙った敵 1 体を撃つ');
  }

  const canFly = a.canHitFlying || mods?.grantFlying === true;
  lines.push(
    canFly
      ? '飛行する敵にも届く'
      : '飛行する敵には届かない（ダンスの原則。覚醒や進化で越えられる）',
  );

  const defIgnore = Math.min(1, a.defIgnore + (mods?.defIgnoreAdd ?? 0));
  if (defIgnore > 0) lines.push(`相手の防御を ${pct(defIgnore)} 無視する`);
  if (mods?.multiTarget !== undefined) lines.push(`同時に ${mods.multiTarget} 体まで狙う`);
  if (a.execute) {
    lines.push(`HP が ${pct(a.execute.threshold)} 以下の敵に ${a.execute.mul} 倍`);
  }
  if (a.knockback) {
    lines.push(`${a.knockback.everyHits} 発ごとに ${a.knockback.distance} マス押し戻す`);
  }
  if (a.alwaysEffective) {
    lines.push('系統の相性を無視して、どの属性の敵にも常に有利');
  }
  for (const onHit of a.onHit) {
    const scaled =
      onHit.status === 'slow' && mods?.slowValue !== undefined
        ? { ...onHit, value: Math.max(onHit.value, mods.slowValue) }
        : onHit;
    lines.push(`命中で ${onHitText(scaled)}`);
  }

  return lines;
}

/** 攻撃の挙動を書き換える指定（覚醒・進化で共通の器） */
export function modLines(mods: BranchMods): string[] {
  const lines: string[] = [];
  if (mods.attackIntervalMul !== undefined) {
    // 間隔は小さいほど速い。「×0.6」だけだと速いのか遅いのか読めない
    lines.push(
      mods.attackIntervalMul < 1
        ? `攻撃間隔 ${delta(mods.attackIntervalMul)}（速くなる）`
        : `攻撃間隔 ${delta(mods.attackIntervalMul)}（遅くなる）`,
    );
  }
  if (mods.radiusMul !== undefined) lines.push(`攻撃範囲 ${delta(mods.radiusMul)}`);
  if (mods.toAoe !== undefined) lines.push(`単体攻撃が半径 ${mods.toAoe} マスの範囲になる`);
  if (mods.multiTarget !== undefined) lines.push(`同時に ${mods.multiTarget} 体まで狙う`);
  if (mods.critRateAdd !== undefined) {
    lines.push(`クリティカル率 +${pct(mods.critRateAdd)}`);
  }
  if (mods.slowValue !== undefined) lines.push(`減速が -${pct(mods.slowValue)} に強まる`);
  if (mods.grantFlying === true) lines.push('飛行する敵にも届くようになる');
  if (mods.defIgnoreAdd !== undefined) {
    lines.push(`相手の防御をさらに ${pct(mods.defIgnoreAdd)} 無視する`);
  }
  if (mods.resetCooldownOnKill === true) lines.push('撃破すると次の一撃をすぐ撃てる');
  if (mods.auraRadiusMul !== undefined) lines.push(`オーラの範囲 ${delta(mods.auraRadiusMul)}`);
  if (mods.auraPowerMul !== undefined) lines.push(`オーラの効果量 ${delta(mods.auraPowerMul)}`);
  if (mods.auraToSelfAtk !== undefined) {
    lines.push(`オーラを捨てて、自分の攻撃力 +${pct(mods.auraToSelfAtk)}`);
  }
  return lines;
}

/** 覚醒分岐の説明。`onHit` を持つ枝は基本の命中時効果を置き換える */
export function branchLines(branch: AwakeningBranch): string[] {
  const lines = modLines(branch.mods);
  if (branch.onHit) {
    for (const onHit of branch.onHit) lines.push(`命中で ${onHitText(onHit)}（置き換え）`);
  }
  if (branch.knockback) {
    lines.push(
      `${branch.knockback.everyHits} 発ごとに ${branch.knockback.distance} マス押し戻す`,
    );
  }
  return lines;
}

/** 進化の説明。ステータス倍率と挙動の変化を分けずに 1 つの並びで出す */
export function evolutionLines(evolution: EvolutionDef): string[] {
  const lines: string[] = [];
  if (evolution.atkMul !== 1) lines.push(`攻撃力 ${delta(evolution.atkMul)}`);
  if (evolution.rangeMul !== 1) lines.push(`射程 ${delta(evolution.rangeMul)}`);
  return [...lines, ...modLines(evolution.mods)];
}

/** 進化の解放条件 */
export function evolutionRequirement(evolution: EvolutionDef): string {
  const stage = getStage(evolution.requires.stage).name;
  return `${stage} をクリア・Lv${evolution.requires.level}・¥${evolution.cost.toLocaleString()}`;
}

/** 名指しの相性（04-content.md 4.1）。相手の名前まで出す */
export function affinityText(rule: AffinityDef): string {
  const partners = rule.with.map((id) => getIdol(id).shortName).join('／');
  const effects: string[] = [];
  if (rule.atkPct !== 0) effects.push(`攻撃力 ${rule.atkPct > 0 ? '+' : ''}${pct(rule.atkPct)}`);
  if (rule.attackSpeedPct !== 0) {
    effects.push(`攻撃速度 ${rule.attackSpeedPct > 0 ? '+' : ''}${pct(rule.attackSpeedPct)}`);
  }
  return `${partners} と隣り合うと ${effects.join('、')}`;
}

/** オーラ（常時発動）の説明 */
export function auraLines(def: IdolDef): string[] {
  const aura = def.aura;
  if (!aura) return [];
  const lines = [`半径 ${aura.radius} マスに常時かかる`];
  if (aura.allyAtkPct > 0) lines.push(`範囲内の味方の攻撃力 +${pct(aura.allyAtkPct)}`);
  if (aura.enemyDefPct > 0) lines.push(`範囲内の敵の防御 -${pct(aura.enemyDefPct)}`);
  return lines;
}

/** センターパッシブ。編成で 1 人だけ選び、ライブ中は盤面全体に効く */
export function centerLines(def: IdolDef): string[] {
  const mods = def.centerPassive?.mods;
  if (!mods) return [];
  const lines: string[] = [];
  const push = (value: number | undefined, label: string): void => {
    if (value !== undefined && value !== 1) lines.push(`${label} ${delta(value)}`);
  };
  push(mods.atkMul, '全体の攻撃力');
  push(mods.attackSpeedMul, '全体の攻撃速度');
  push(mods.rangeMul, '全体の射程');
  push(mods.cheerGainMul, '声援の獲得');
  push(mods.voltageGainMul, '月華の蓄積');
  push(mods.slowPowerMul, '状態異常の効果量');
  push(mods.costMul, '配置コスト');
  if (mods.critRateAdd !== undefined) {
    lines.push(`全体のクリティカル率 +${pct(mods.critRateAdd)}`);
  }
  if (mods.specialDurationAddMs !== undefined) {
    lines.push(`月華の解放が ${sec(mods.specialDurationAddMs)}長く続く`);
  }
  return lines;
}
