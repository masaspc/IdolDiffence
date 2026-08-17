/**
 * 隠しキャラ MASA（`meta/secrets.ts`）。
 *
 * 見るべきは 3 つ ——
 * **ただ本編を進めただけでは出てこない**こと、**腕前が届けば出てくる**こと、
 * そして**出たときは本当に最強**であること。どれが崩れても隠しキャラの意味が無い。
 */
import { describe, expect, it } from 'vitest';
import { createNewSave, migrate, type SaveData } from './save';
import { isUnlocked, unlockedIds } from './progression';
import {
  markSecretSeen,
  matchSecret,
  SECRET_CODES,
  SECRET_STAR_GATE,
  unlockSecret,
  unseenSecrets,
} from './secrets';
import { canonIds, getIdol, idolUnlockStage, rosterIds, SECRET_IDS, stageOrder } from '../data';

/** 本編を全部クリアした状態。★は「挑んだ最低限」の 1 のまま */
function fullyCleared(star = 1): SaveData {
  const save = createNewSave();
  return {
    ...save,
    stageProgress: Object.fromEntries(
      stageOrder.map((id) => [id, { cleared: true, bestAudience: 100, plays: 9 }]),
    ),
    bestStar: Object.fromEntries(stageOrder.map((id) => [id, star])),
    totalExp: 9_999_999,
  };
}

/** S5 だけを指定の★で勝った状態 */
function s5At(star: number): SaveData {
  const save = createNewSave();
  return { ...save, bestStar: { S5: star } };
}

describe('隠しキャラは隠れている', () => {
  it('新規セーブでは持っていない', () => {
    for (const id of SECRET_IDS) expect(isUnlocked(createNewSave(), id)).toBe(false);
  });

  it('本編を全部クリアしても、★を上げていなければ出てこない', () => {
    // 「先に進んだ」ではなく「腕前が届いた」ことを条件にしている。
    // S10 まで ★1 で通した人には、まだ出ない
    for (const id of SECRET_IDS) expect(isUnlocked(fullyCleared(1), id)).toBe(false);
  });

  it('原作の 12 人とは別枠。ロスターの人数にも編成の候補にも混ざらない', () => {
    expect(canonIds).toHaveLength(12);
    expect(rosterIds).toHaveLength(13);
    for (const id of SECRET_IDS) expect(canonIds).not.toContain(id);
    expect(unlockedIds(fullyCleared(1))).toEqual([...canonIds]);
  });

  it('解放の条件は育成画面に先出しされない（`idolUnlockStage` に載せない）', () => {
    // 載せると「S5 をクリアすると解放」と出てしまい、条件ごとネタバレになる
    for (const id of SECRET_IDS) expect(idolUnlockStage[id]).toBeNull();
  });
});

describe('腕前で登場する（S5 ★5）', () => {
  const gate = SECRET_STAR_GATE['GM'];

  it('条件が S5 の ★5 である', () => {
    expect(gate).toEqual({ stage: 'S5', star: 5 });
  });

  it('★4 までは出ない。★5 で出る', () => {
    expect(isUnlocked(s5At(4), 'GM')).toBe(false);
    expect(isUnlocked(s5At(5), 'GM')).toBe(true);
  });

  it('★を超えても出たままになる', () => {
    expect(isUnlocked(s5At(10), 'GM')).toBe(true);
  });

  it('他のステージを ★10 で勝っても、S5 が届いていなければ出ない', () => {
    // 条件は「どこかで★を稼いだ」ではなく「S5 で ★5」。
    // 易しいステージの周回で開いてしまうと、腕前の証明にならない
    const elsewhere: SaveData = {
      ...createNewSave(),
      bestStar: Object.fromEntries(stageOrder.filter((id) => id !== 'S5').map((id) => [id, 10])),
    };
    expect(isUnlocked(elsewhere, 'GM')).toBe(false);
  });

  it('腕前で開いたぶんはセーブに書かない（条件を変えれば結果も変わる）', () => {
    const save = s5At(5);
    expect(save.secrets).toEqual([]);
    // ★の記録を取り消せば、解放も消える
    expect(isUnlocked({ ...save, bestStar: {} }, 'GM')).toBe(false);
  });

  it('編成の候補に入る', () => {
    expect(unlockedIds(s5At(5))).toContain('GM');
  });
});

describe('登場の知らせ', () => {
  it('解放された時点で 1 件たまる', () => {
    expect(unseenSecrets(createNewSave())).toEqual([]);
    expect(unseenSecrets(s5At(5))).toEqual(['GM']);
  });

  it('見せたら二度と出ない', () => {
    const seen = markSecretSeen(s5At(5), 'GM');
    expect(unseenSecrets(seen)).toEqual([]);
    // 二重に印を付けても同じ参照（無駄な保存を避ける）
    expect(markSecretSeen(seen, 'GM')).toBe(seen);
  });

  it('合言葉で開いたときも知らせる', () => {
    // 打った本人は知っているが、何も起きないと入力が通ったのか分からない
    expect(unseenSecrets(unlockSecret(createNewSave(), 'GM'))).toEqual(['GM']);
  });

  it('移行してきたセーブでは、合言葉ぶんを知らせ済みにする', () => {
    // 自分で打って呼び出した人に、いまさら「登場しました」と出すのはおかしい
    const migrated = migrate({ ...createNewSave(), version: 8, secrets: ['GM'] });
    expect(migrated.seenSecrets).toEqual(['GM']);
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
