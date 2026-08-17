/**
 * ロスターの形（04-content.md 4.1〜4.2）。
 *
 * 原作の 12 人を 歌 4 / ダンス 4 / ヴィジュアル 4 で揃えている。
 * ここが崩れると、3 すくみ（02-core-battle.md 2.5）のどれかが
 * 「選べる人がいない系統」になり、相性を考える意味が薄れる。
 */
import { describe, expect, it } from 'vitest';
import {
  canonIds,
  chapters,
  getIdol,
  idolUnlockStage,
  rosterIds,
  SECRET_IDS,
  stageOrder,
} from '../data';

describe('原作の 12 人', () => {
  it('系統が 4 / 4 / 4 で揃っている', () => {
    const count = { vocal: 0, dance: 0, visual: 0 };
    for (const id of canonIds) count[getIdol(id).type]++;
    expect(count).toEqual({ vocal: 4, dance: 4, visual: 4 });
  });

  it('全員に解放条件の欄がある（表から漏れると永久に出てこない）', () => {
    for (const id of rosterIds) {
      expect(idolUnlockStage, `${id} が解放の表に無い`).toHaveProperty(id);
    }
  });

  it('解放条件は実在するステージを指している', () => {
    for (const id of canonIds) {
      const gate = idolUnlockStage[id];
      if (gate === null || gate === undefined) continue;
      expect(stageOrder, `${id} の解放条件 ${gate} が無い`).toContain(gate);
    }
  });

  it('隠しキャラだけがステージ解放を持たない（初期メンバーを除く）', () => {
    const noGate = canonIds.filter((id) => (idolUnlockStage[id] ?? null) === null);
    expect(noGate).toEqual(['V1', 'D1', 'Vi1']);
    for (const id of SECRET_IDS) expect(idolUnlockStage[id]).toBeNull();
  });
});

describe('M5 で加わった 3 人', () => {
  it('諌山 真実 は「彩葉の友人」を 2 人にする', () => {
    // 04-content.md の「まだ実装していない登場人物」に書いてあった予定どおり
    const friends = canonIds.filter((id) => getIdol(id).tags.includes('ayaha_friend'));
    expect(friends.sort()).toEqual(['V4', 'Vi3']);
  });

  it('FUSHI はヤチヨと同じ「ツクヨミの案内役」（原作でヤチヨの相棒）', () => {
    const guides = canonIds.filter((id) => getIdol(id).tags.includes('tsukuyomi_guide'));
    expect(guides.sort()).toEqual(['Vi1', 'Vi4']);
  });

  it('犬DOGE はかぐやと同じ「かぐやの相棒」（かぐやが作った犬）', () => {
    const partners = canonIds.filter((id) => getIdol(id).tags.includes('kaguya_partner'));
    expect(partners.sort()).toEqual(['D4', 'V1']);
  });

  it('人型でない 2 体は人型のリグを使わない', () => {
    // 髪型と服を載せる作りへ通すと「獣耳の女の子」になり、原作と食い違う
    expect(getIdol('D4').art?.form).toBe('dog');
    expect(getIdol('Vi4').art?.form).toBe('seaslug');
    for (const id of canonIds) {
      if (id === 'D4' || id === 'Vi4') continue;
      expect(getIdol(id).art?.form, `${id}`).toBe('human');
    }
  });

  it('犬DOGE は対空を持たない（ダンスの原則。覚醒 B でだけ得る）', () => {
    expect(getIdol('D4').attack.canHitFlying).toBe(false);
    expect(getIdol('D4').awakening?.B.mods.grantFlying).toBe(true);
  });

  it('コスト帯が既存とぶつからない（選ぶ理由が値段でも分かれる）', () => {
    const costs = canonIds.map((id) => getIdol(id).cost);
    expect(new Set(costs).size).toBe(costs.length);
  });
});

/**
 * 配置コストあたりの毎秒期待値。
 *
 * 系統をまたいで比べても意味が無い（ダンスは単体高火力、ヴィジュアルは支援）ので、
 * **同じ系統のなかで**見る。範囲攻撃や状態異常はここに入らないが、
 * 「素の殴り合いで話にならない」を検出するには足りる。
 */
function dpsPerCost(id: string): number {
  const d = getIdol(id);
  const crit = 1 + d.base.critRate * (0.5 + d.base.critDmg);
  return (d.base.atk * d.attack.skillMul * crit) / (d.base.attackIntervalMs / 1000) / d.cost;
}

describe('後から足した 3 人が置き去りにならない', () => {
  // 初出のときは 真実 0.85 / 犬DOGE 3.65 / FUSHI 0.93 で、
  // どれも同系統の最下位付近だった。同じコストのまま底上げしてある
  const LATECOMERS: Record<string, string> = { V4: 'vocal', D4: 'dance', Vi4: 'visual' };

  it('同じ系統のなかで最下位ではない', () => {
    for (const [id, type] of Object.entries(LATECOMERS)) {
      const peers = canonIds.filter((other) => getIdol(other).type === type && other !== id);
      const worst = Math.min(...peers.map(dpsPerCost));
      expect(dpsPerCost(id), `${id} が同系統の最下位`).toBeGreaterThan(worst);
    }
  });

  it('といって全系統の頂点でもない（既存を置き換えてしまわない）', () => {
    const best = Math.max(...canonIds.map(dpsPerCost));
    for (const id of Object.keys(LATECOMERS)) {
      expect(dpsPerCost(id), `${id} が全体の頂点`).toBeLessThan(best);
    }
  });

  it('配置コストは据え置き（強くしたのは中身だけ）', () => {
    expect(getIdol('V4').cost).toBe(40);
    expect(getIdol('D4').cost).toBe(20);
    expect(getIdol('Vi4').cost).toBe(65);
  });
});

/**
 * 章の区切り（表示用）。
 *
 * `stageOrder` から切り出しているので、並びを足したときに**どこかの章に
 * 必ず入る**ことだけ見る。章に入れ忘れたステージはホーム画面から消える。
 */
describe('章の区切り', () => {
  it('全ステージがちょうど 1 回ずつ入る', () => {
    expect(chapters.flatMap((c) => [...c.stages])).toEqual([...stageOrder]);
  });

  it('どの章も空でなく、見出しが付いている', () => {
    for (const chapter of chapters) {
      expect(chapter.stages.length, `${chapter.name} が空`).toBeGreaterThan(0);
      expect(chapter.name.length).toBeGreaterThan(0);
      expect(chapter.lead.length).toBeGreaterThan(0);
    }
  });
});
