/**
 * 能力の説明文（`ui/idolText.ts`）。
 *
 * **数値から文を導く**ので、数値を変えると文も変わる。
 * ここで固定するのは「読んで意味が取れる形になっているか」で、
 * 具体的な数字そのものではない（データを触るたびに書き直す羽目になる）。
 */
import { describe, expect, it } from 'vitest';
import { canonIds, getIdol, getStage } from '../data';
import { createNewSave, type SaveData } from '../meta/save';
import { unlockSecret } from '../meta/secrets';
import {
  affinityText,
  attackLines,
  auraLines,
  branchLines,
  centerLines,
  evolutionLines,
  evolutionRequirement,
  joinText,
  modLines,
  onHitText,
  TYPE_LABEL,
  TYPE_STRONG_AGAINST,
} from './idolText';
import { evolutionOf } from '../meta/evolution';

describe('命中時効果', () => {
  it('減速と脆弱は符号の向きが逆（片方は -、片方は +）', () => {
    expect(onHitText({ status: 'slow', value: 0.25, durationMs: 3000 })).toBe(
      '減速 -25%（3 秒）',
    );
    expect(onHitText({ status: 'vulnerable', value: 0.3, durationMs: 2500 })).toBe(
      '脆弱 +30%（2.5 秒）',
    );
  });

  it('魅了とスタンは時間だけ書く（効果量が無い）', () => {
    expect(onHitText({ status: 'charm', value: 1, durationMs: 2000 })).toBe('魅了（2 秒）');
    expect(onHitText({ status: 'stun', value: 1, durationMs: 900 })).toBe('スタン（0.9 秒）');
  });

  it('Echo はスタック数で書く（割合ではない）', () => {
    expect(onHitText({ status: 'echo', value: 3, durationMs: 5000 })).toContain('3 スタック');
  });
});

describe('攻撃', () => {
  it('全員ぶんが文になる（空にならない）', () => {
    for (const id of canonIds) {
      expect(attackLines(getIdol(id)).length, `${id} の攻撃に説明が出ない`).toBeGreaterThan(0);
    }
  });

  it('種類ごとに書き分ける', () => {
    expect(attackLines(getIdol('V1'))[0]).toContain('半径');
    expect(attackLines(getIdol('V3'))[0]).toContain('直線');
    expect(attackLines(getIdol('D3'))[0]).toContain('1 体');
  });

  it('対空できるかを必ず書く（配置の判断に要る）', () => {
    expect(attackLines(getIdol('V1')).some((l) => l.includes('飛行'))).toBe(true);
    expect(attackLines(getIdol('D1')).some((l) => l.includes('届かない'))).toBe(true);
  });

  it('隠しキャラの「相性を無視」も出る', () => {
    expect(attackLines(getIdol('GM')).some((l) => l.includes('相性を無視'))).toBe(true);
    for (const id of canonIds) {
      expect(attackLines(getIdol(id)).some((l) => l.includes('相性を無視')), id).toBe(false);
    }
  });
});

describe('倍率の書き方', () => {
  it('攻撃間隔は速いか遅いかを言い添える（×0.6 だけでは読めない）', () => {
    expect(modLines({ attackIntervalMul: 0.6 })[0]).toContain('速くなる');
    expect(modLines({ attackIntervalMul: 1.5 })[0]).toContain('遅くなる');
  });

  it('倍率は 1 との差で書く（×1.8 ではなく +80%）', () => {
    expect(modLines({ radiusMul: 1.8 })[0]).toBe('攻撃範囲 +80%');
    expect(modLines({ auraPowerMul: 0.75 })[0]).toBe('オーラの効果量 -25%');
  });

  it('中身が無ければ 1 行も出さない', () => {
    expect(modLines({})).toEqual([]);
  });
});

describe('覚醒と進化', () => {
  it('覚醒 A / B が両方とも文になる', () => {
    for (const id of canonIds) {
      const awakening = getIdol(id).awakening;
      if (!awakening) continue;
      for (const branch of [awakening.A, awakening.B]) {
        expect(branchLines(branch).length, `${id} の「${branch.name}」が空`).toBeGreaterThan(0);
      }
    }
  });

  it('進化は倍率と挙動の両方が並ぶ', () => {
    for (const id of ['V1', 'D1', 'Vi1']) {
      const evolution = evolutionOf(id);
      if (!evolution) throw new Error(`${id} に進化が無い`);
      const lines = evolutionLines(evolution);
      expect(lines.some((l) => l.startsWith('攻撃力')), `${id}`).toBe(true);
      expect(lines.length, `${id} の進化が数値だけ`).toBeGreaterThan(2);
    }
  });

  it('進化の条件は「何を・どこまで・いくら」がそろう', () => {
    const text = evolutionRequirement(evolutionOf('V1')!);
    expect(text).toContain('クリア');
    expect(text).toContain('Lv');
    expect(text).toContain('¥');
  });
});

describe('相性・オーラ・センター', () => {
  it('相性は相手を名前で出す（ID を見せない）', () => {
    const rule = getIdol('Vi4').affinity.find((a) => a.name === '犬猿の仲');
    if (!rule) throw new Error('FUSHI の犬猿の仲が無い');
    const text = affinityText(rule);
    expect(text).toContain(getIdol('V1').shortName);
    expect(text).toContain(getIdol('D4').shortName);
    expect(text).not.toContain('V1');
    expect(text).toContain('-25%');
  });

  it('オーラを持たない人には 1 行も出さない', () => {
    expect(auraLines(getIdol('V1'))).toEqual([]);
    expect(auraLines(getIdol('Vi3')).length).toBeGreaterThan(0);
  });

  it('センターは全員ぶんが文になる', () => {
    for (const id of canonIds) {
      expect(centerLines(getIdol(id)).length, `${id} のセンターが空`).toBeGreaterThan(0);
    }
  });

  it('配置コストの割引も「-8%」の形で出る', () => {
    expect(centerLines(getIdol('D1')).some((l) => l.includes('配置コスト -8%'))).toBe(true);
  });
});

describe('加入の経緯', () => {
  it('初期メンバーと、ステージで加入した人を書き分ける', () => {
    expect(joinText(createNewSave(), 'V1')).toBe('最初から使える');
    expect(joinText(createNewSave(), 'Vi4')).toContain('をクリアして加入');
  });

  it('隠しキャラは**実際に通った経路**で書く', () => {
    // 鍵は合言葉と腕前の 2 つある。条件を持っていることだけを見て
    // 「S5 を ★5 で勝った」と書くと、合言葉で呼んだ人に身に覚えの無い戦績が付く
    const byCode = unlockSecret(createNewSave(), 'GM');
    expect(joinText(byCode, 'GM')).toContain('合言葉');
    expect(joinText(byCode, 'GM')).not.toContain('★');

    const bySkill: SaveData = { ...createNewSave(), bestStar: { S5: 5 } };
    expect(joinText(bySkill, 'GM')).toContain('★5');
    expect(joinText(bySkill, 'GM')).toContain(getStage('S5').name);
  });

  it('両方の鍵を持っていれば、腕前のほうを書く（そちらは事実だから）', () => {
    const both: SaveData = { ...unlockSecret(createNewSave(), 'GM'), bestStar: { S5: 5 } };
    expect(joinText(both, 'GM')).toContain('★5');
  });
});

describe('用語', () => {
  it('3 系統ぶんのラベルと有利な属性がそろっている', () => {
    for (const type of ['vocal', 'dance', 'visual']) {
      expect(TYPE_LABEL[type]).toBeTruthy();
      expect(TYPE_STRONG_AGAINST[type]).toBeTruthy();
    }
  });
});
