/**
 * 隠しキャラ MASA（`meta/secrets.ts`）。
 *
 * 見るべきは 2 つ ——
 * **通常の進行では絶対に出てこない**ことと、**出たときは本当に最強**であること。
 * どちらが崩れても隠しキャラの意味が無い。
 */
import { describe, expect, it } from 'vitest';
import { createNewSave, type SaveData } from './save';
import { isUnlocked, unlockedIds } from './progression';
import { matchSecret, SECRET_CODES, unlockSecret } from './secrets';
import { canonIds, getIdol, rosterIds, SECRET_IDS, stageOrder } from '../data';

function fullyCleared(): SaveData {
  const save = createNewSave();
  return {
    ...save,
    stageProgress: Object.fromEntries(
      stageOrder.map((id) => [id, { cleared: true, bestAudience: 100, plays: 9 }]),
    ),
    bestStar: Object.fromEntries(stageOrder.map((id) => [id, 10])),
    totalExp: 9_999_999,
  };
}

describe('隠しキャラは隠れている', () => {
  it('新規セーブでは持っていない', () => {
    for (const id of SECRET_IDS) expect(isUnlocked(createNewSave(), id)).toBe(false);
  });

  it('全ステージを ★10 でクリアしても出てこない', () => {
    for (const id of SECRET_IDS) expect(isUnlocked(fullyCleared(), id)).toBe(false);
  });

  it('原作の 12 人とは別枠。ロスターの人数にも編成の候補にも混ざらない', () => {
    expect(canonIds).toHaveLength(12);
    expect(rosterIds).toHaveLength(13);
    for (const id of SECRET_IDS) expect(canonIds).not.toContain(id);
    expect(unlockedIds(fullyCleared())).toEqual([...canonIds]);
  });
});

describe('合言葉', () => {
  it('打ち切ると解放される', () => {
    const save = unlockSecret(createNewSave(), 'GM');
    expect(isUnlocked(save, 'GM')).toBe(true);
    expect(unlockedIds(save)).toContain('GM');
  });

  it('末尾で一致する（打ち間違えても続けて打てばよい）', () => {
    expect(matchSecret('xyzmasa')).toBe('GM');
    expect(matchSecret('MASA')).toBe('GM');
    expect(matchSecret('masb')).toBeNull();
    expect(matchSecret('mas')).toBeNull();
  });

  it('二重に解放しても増えない（同じ参照を返す）', () => {
    const once = unlockSecret(createNewSave(), 'GM');
    expect(unlockSecret(once, 'GM')).toBe(once);
  });

  it('合言葉の表とロスターの隠し枠が一致している', () => {
    expect(Object.keys(SECRET_CODES).sort()).toEqual([...SECRET_IDS].sort());
  });
});

describe('MASA は最強である', () => {
  const masa = getIdol('GM');
  const others = canonIds.map((id) => getIdol(id));

  it('素の攻撃力・射程・クリティカルが原作の誰よりも上', () => {
    expect(masa.base.atk).toBeGreaterThan(Math.max(...others.map((o) => o.base.atk)));
    expect(masa.base.range).toBeGreaterThan(Math.max(...others.map((o) => o.base.range)));
    expect(masa.base.critRate).toBeGreaterThan(Math.max(...others.map((o) => o.base.critRate)));
    expect(masa.base.critDmg).toBeGreaterThan(Math.max(...others.map((o) => o.base.critDmg)));
  });

  it('毎秒の期待値でも原作の誰よりも上', () => {
    // 攻撃力だけ高くて攻撃間隔が長い、では「最強」にならない
    const dps = (id: string): number => {
      const d = getIdol(id);
      const crit = 1 + d.base.critRate * (0.5 + d.base.critDmg);
      return (d.base.atk * d.attack.skillMul * crit) / (d.base.attackIntervalMs / 1000);
    };
    expect(dps('GM')).toBeGreaterThan(Math.max(...canonIds.map(dps)));
  });

  it('3 すくみを無視して常に有利（この特権を持つのは MASA だけ）', () => {
    expect(masa.attack.alwaysEffective).toBe(true);
    for (const id of canonIds) {
      expect(getIdol(id).attack.alwaysEffective, `${id} が相性を無視している`).toBe(false);
    }
  });

  it('防御を完全に無視する', () => {
    expect(masa.attack.defIgnore).toBe(1);
  });

  it('4 種の状態異常をまとめて撒く（原作勢は多くても 1 種）', () => {
    expect(new Set(masa.attack.onHit.map((o) => o.status)).size).toBe(4);
    for (const id of canonIds) {
      expect(getIdol(id).attack.onHit.length, `${id}`).toBeLessThanOrEqual(1);
    }
  });

  it('センターパッシブが全項目で原作の誰よりも強い', () => {
    const mods = masa.centerPassive?.mods;
    expect(mods).toBeDefined();
    if (!mods) return;
    const best = (key: 'atkMul' | 'attackSpeedMul' | 'rangeMul' | 'cheerGainMul'): number =>
      Math.max(...others.map((o) => o.centerPassive?.mods[key] ?? 1));
    expect(mods.atkMul).toBeGreaterThan(best('atkMul'));
    expect(mods.attackSpeedMul).toBeGreaterThan(best('attackSpeedMul'));
    expect(mods.rangeMul).toBeGreaterThan(best('rangeMul'));
    expect(mods.cheerGainMul).toBeGreaterThan(best('cheerGainMul'));
    // 配置コストは下がるほど強い
    expect(mods.costMul).toBeLessThan(
      Math.min(...others.map((o) => o.centerPassive?.mods.costMul ?? 1)),
    );
  });

  it('オーラも原作の誰よりも広く重い', () => {
    const aura = masa.aura;
    expect(aura).toBeDefined();
    if (!aura) return;
    const auras = others.map((o) => o.aura).filter((a) => a !== undefined);
    expect(aura.radius).toBeGreaterThan(Math.max(...auras.map((a) => a.radius)));
    expect(aura.allyAtkPct).toBeGreaterThan(Math.max(...auras.map((a) => a.allyAtkPct)));
    expect(aura.enemyDefPct).toBeGreaterThan(Math.max(...auras.map((a) => a.enemyDefPct)));
  });
});
