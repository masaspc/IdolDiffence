/**
 * 決定的な擬似乱数生成器（mulberry32）。
 *
 * sim 内の乱数はすべてここを経由する。同じ seed + 同じ入力列なら必ず同じ結果になり、
 * リプレイとヘッドレスのバランス検証が成立する（docs/design/02-core-battle.md 2.11）。
 * `Math.random()` の直接使用は ESLint で禁止している。
 */
export interface Rng {
  /** 0 以上 1 未満 */
  next(): number;
  /** min 以上 max 未満 */
  range(min: number, max: number): number;
  /** min 以上 max 以下の整数 */
  int(min: number, max: number): number;
  /** 確率 p (0..1) で true */
  chance(p: number): boolean;
  /** 配列から 1 つ選ぶ。空配列なら undefined */
  pick<T>(items: readonly T[]): T | undefined;
  /** 現在の内部状態。セーブ／リプレイ用 */
  getState(): number;
  /** 内部状態を復元する */
  setState(state: number): void;
}

export function createRng(seed: number): Rng {
  let state = seed >>> 0;

  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  return {
    next,
    range: (min, max) => min + next() * (max - min),
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    chance: (p) => next() < p,
    pick: <T>(items: readonly T[]): T | undefined =>
      items.length === 0 ? undefined : items[Math.floor(next() * items.length)],
    getState: () => state,
    setState: (s) => {
      state = s >>> 0;
    },
  };
}

/**
 * 文字列から seed を作る。ステージ ID などから再現可能な seed を導くのに使う。
 * FNV-1a 32bit。
 */
export function seedFromString(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * 実乱数から seed を 1 つ引く。**ライブ開始時に 1 回だけ**呼び、
 * 以降は必ず createRng 経由にすること。この seed をリザルトに記録すれば再現できる。
 */
export function randomSeed(): number {
  return Math.floor(Math.random() * 0xffffffff) >>> 0;
}
