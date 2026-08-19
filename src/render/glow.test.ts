/**
 * 敵の足元の光は焼いて使い回す（`renderer.ts` の `enemyGlow`）。
 *
 * ここが見るのは**表が太らないこと**だけ。速さのためのキャッシュが
 * 際限なく増えたら、直したはずの問題が別の形で戻ってくる。
 * 描画そのものの速さは `scripts/perf-render.ts` で実測する。
 */
import { describe, expect, it } from 'vitest';
import { glowKey, glowRadius } from './renderer';
import { attrColor } from './palette';
import { enemies } from '../data';

const ATTRS = ['silence', 'noise', 'vanity'] as const;

describe('敵の足元の光のキャッシュ', () => {
  it('半径は 0.5px 刻みに丸まる', () => {
    expect(glowRadius(12.34)).toBe(12.5);
    expect(glowRadius(12.1)).toBe(12);
    // 0 やマイナスでも描ける大きさに落とす（createRadialGradient が例外を投げる）
    expect(glowRadius(0)).toBe(1);
    expect(glowRadius(-5)).toBe(1);
  });

  it('近い半径は同じ鍵になる', () => {
    expect(glowKey('#abc', 10.1)).toBe(glowKey('#abc', 10.2));
    expect(glowKey('#abc', 10.1)).not.toBe(glowKey('#abc', 10.4));
    expect(glowKey('#abc', 10.1)).not.toBe(glowKey('#def', 10.1));
  });

  it('実データの敵をすべて描いても、焼く枚数は数十枚に収まる', () => {
    // CELL_SIZE は renderer 側の定数。ここは実際に渡る値（radius * CELL_SIZE）を作る
    const CELL = 64;
    const keys = new Set<string>();
    for (const def of Object.values(enemies)) {
      for (const attr of ATTRS) {
        // ★難度と特性で半径が少し動くので、周辺も一緒に入れておく
        for (const scale of [1, 1.05, 1.1, 1.2, 1.35, 1.5]) {
          keys.add(glowKey(attrColor(attr), def.radius * scale * CELL));
        }
      }
    }
    expect(keys.size).toBeGreaterThan(0);
    expect(keys.size).toBeLessThanOrEqual(200);
  });
});
