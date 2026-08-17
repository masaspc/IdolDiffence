/**
 * ツクヨミの空（`sky.ts`）。
 *
 * 絵そのものは測れないが、**原作に合っているかどうかの分かれ目**は測れる ——
 * 第 1 章の空に月が無いこと、章が進むと月が大きくなること、
 * 飾りが毎回同じ並びで出ること。
 *
 * ここが崩れると「名前は原作だが空は別世界」に静かに戻る。
 */
import { describe, expect, it } from 'vitest';
import { skyDrifters } from './sky';
import { chapterIndexOf, getStage, stageOrder } from '../data';

describe('空の飾り', () => {
  it('同じステージなら毎回同じ空になる', () => {
    expect(skyDrifters('S1')).toEqual(skyDrifters('S1'));
  });

  it('ステージが違えば並びも違う', () => {
    expect(skyDrifters('S1')).not.toEqual(skyDrifters('S20'));
  });

  it('魚群・飛行船・蒸気機関車がそろっている', () => {
    // 原作のツクヨミの空にあるもの。1 つでも欠けると「和風の街」で止まる
    for (const stageId of ['S1', 'S15', 'B4']) {
      const kinds = new Set(skyDrifters(stageId).map((d) => d.kind));
      expect(kinds, stageId).toEqual(new Set(['fish', 'airship', 'train']));
    }
  });

  it('飾りは画面の上寄りに出る（盤面と重ならない）', () => {
    for (const stageId of stageOrder) {
      for (const drifter of skyDrifters(stageId)) {
        expect(drifter.y, `${stageId} ${drifter.kind}`).toBeGreaterThanOrEqual(0);
        expect(drifter.y, `${stageId} ${drifter.kind}`).toBeLessThan(0.85);
        expect(drifter.speed).toBeGreaterThan(0);
      }
    }
  });
});

describe('章と空', () => {
  it('第 1 章はツクヨミなので月が出ない', () => {
    // ツクヨミの空にあるのは月ではなく巨大なミラーボール（原作）。
    // ここに普通の月を描いていたのが、いちばん大きな取り違えだった
    for (const stageId of ['S1', 'S5', 'S10', 'B2']) {
      expect(chapterIndexOf(stageId), stageId).toBe(0);
    }
  });

  it('第 2 章から月が昇り、第 3 章でいちばん大きくなる', () => {
    expect(chapterIndexOf('S11')).toBe(1);
    expect(chapterIndexOf('B3')).toBe(1);
    expect(chapterIndexOf('S21')).toBe(2);
    expect(chapterIndexOf('B4')).toBe(2);
  });

  it('全ステージがどこかの章に属する', () => {
    for (const stageId of stageOrder) {
      expect(chapterIndexOf(stageId), stageId).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('会場の見た目', () => {
  it('ヤチヨのライブは水に覆われる', () => {
    // 原作でヤチヨのライブは「ステージが一面水で覆われ、観客は海の中にいるよう」。
    // S3（ライブワールド「銀波」）と S10（ヤチヨ城・天守）がそれ
    expect(getStage('S3').scenery).toBe('water');
    expect(getStage('S10').scenery).toBe('water');
  });

  it('既定は常夜の街', () => {
    expect(getStage('S1').scenery).toBe('street');
    const water = stageOrder.filter((id) => getStage(id).scenery === 'water');
    // 全部を水にすると、水であること自体が意味を持たなくなる
    expect(water.length).toBeLessThan(stageOrder.length / 4);
  });
});
