/**
 * 恒久強化の段階（`investment.ts`）。
 *
 * ここが崩れると難度の検証が静かに嘘をつく。段階を混ぜて測ってしまうと
 * 「才能を入れた行」と「既定の行」が同じものになり、
 * 何が効いているのか読めないまま数値を決めることになる。
 */
import { describe, expect, it } from 'vitest';
import { balanceMeta, investmentOf } from './investment';
import { STAGE_PLANS } from './plans';

describe('段階の解決', () => {
  it('指定が無いステージは素のまま', () => {
    expect(investmentOf('S1')).toBe('bare');
    expect(investmentOf('B2')).toBe('bare');
  });

  it('月の都の章は指定どおり', () => {
    expect(investmentOf('S11')).toBe('talents');
    expect(investmentOf('S16')).toBe('full');
  });
});

describe('組み立て', () => {
  it('素の段階には才能も進化も衣装も入らない', () => {
    const meta = balanceMeta('S1', 20, 'bare');
    expect(meta.evolved).toBeUndefined();
    expect(meta.costumes).toBeUndefined();
    // 空の才能効果（値がすべてゼロ）であること
    expect(meta.talents?.atkPct ?? 0).toBe(0);
  });

  it('才能の段階では才能と進化が入り、衣装は入らない', () => {
    const meta = balanceMeta('S11', 30, 'talents');
    expect(meta.talents?.atkPct ?? 0).toBeGreaterThan(0);
    expect(meta.evolved).toEqual(['V1', 'D1', 'Vi1']);
    expect(meta.costumes).toBeUndefined();
  });

  it('全部の段階では衣装まで入る', () => {
    const meta = balanceMeta('S16', 30, 'full');
    expect(meta.costumes).toBeDefined();
    expect(meta.evolved).toEqual(['V1', 'D1', 'Vi1']);
  });

  it('段階を明示すればステージの既定値を無視する', () => {
    // **これが計測の独立性を支えている。** `scripts/probe.ts` は
    // 「才能だけ」「衣装だけ」の行を素から組み直すことで、
    // 既定の段階と二重に掛かるのを避けている
    const forced = balanceMeta('S16', 30, 'bare');
    expect(investmentOf('S16')).toBe('full');
    expect(forced.evolved).toBeUndefined();
    expect(forced.costumes).toBeUndefined();
    expect(forced.talents?.atkPct ?? 0).toBe(0);
  });

  it('レベルは段階と独立に振れる', () => {
    const low = balanceMeta('S11', 1);
    const high = balanceMeta('S11', 30);
    expect(high.atkByIdol?.['V1'] ?? 0).toBeGreaterThan(low.atkByIdol?.['V1'] ?? 0);
    // 段階のほうは変わらない
    expect(low.evolved).toEqual(high.evolved);
  });

  it('出撃メンバーは参照盤面と一致する', () => {
    // ここがずれると、衣装を着せる相手と実際に置く相手が食い違う
    for (const stageId of ['S11', 'S16', 'B3']) {
      expect(balanceMeta(stageId, 30).party).toEqual(STAGE_PLANS[stageId]?.party);
    }
  });
});
