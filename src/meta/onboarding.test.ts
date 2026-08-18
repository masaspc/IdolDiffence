/**
 * 段階解放（`onboarding.ts`）。
 *
 * **見張りたいのは 2 つ。** 新規プレイヤーの最初の画面が絞れていること、
 * そして塞いだせいで勝てなくなる回が無いこと。
 *
 * 前者が崩れると 1 本目で全系統が並び、後者が崩れると
 * 「難しくなる回で、いちばん強い手札を取り上げる」ことになる。
 */
import { describe, expect, it } from 'vitest';
import {
  FEATURE_LABEL,
  FEATURE_NOTE,
  isOpen,
  lockedForBattle,
  nextUnlock,
  openFeatures,
  unlockedBy,
  type Feature,
} from './onboarding';
import { createNewSave, type SaveData } from './save';
import { stageOrder } from '../data';

/** 指定したステージまでクリアしたセーブ */
function clearedThrough(...stageIds: string[]): SaveData {
  const save = createNewSave();
  return {
    ...save,
    stageProgress: Object.fromEntries(
      stageIds.map((id) => [id, { cleared: true, bestAudience: 100, plays: 1 }]),
    ),
  };
}

const ALL: Feature[] = [
  'setlist',
  'special',
  'lesson',
  'party',
  'formation',
  'talents',
  'costumes',
  'center',
  'star',
  'songLevel',
  'achievements',
];

describe('最初の画面', () => {
  it('新規プレイヤーには何も開いていない', () => {
    // 配置とポジション強化だけで 1 本目を通す。ここに 1 つでも混ざると、
    // 「初見が説明なしで S3 まで」が成り立たなくなる
    expect(openFeatures(createNewSave())).toEqual([]);
  });

  it('S1 では セットリストも月華も封印されている', () => {
    expect(lockedForBattle(createNewSave()).sort()).toEqual(['setlist', 'special']);
  });

  it('S1 をクリアするとセットリストと編成が開く', () => {
    // S1 クリアで仲間が 2 人増えるので、編成にちょうど意味が出る
    expect(unlockedBy('S1').sort()).toEqual(['party', 'setlist']);
    const save = clearedThrough('S1');
    expect(lockedForBattle(save)).toEqual(['special']);
  });

  it('S2 をクリアすると月華と育成が開く', () => {
    // **S3 は月華が無いと勝てない**（Lv5・フル配置で月華ありは 5 seed 中 3 勝、
    // 無しは 1 勝）。設計書どおり「S3 クリアで開く」にすると、
    // ちょうど難しくなる回で最も強い手札を取り上げることになっていた
    expect(unlockedBy('S2').sort()).toEqual(['lesson', 'special']);
    expect(lockedForBattle(clearedThrough('S1', 'S2'))).toEqual([]);
  });

  it('新規プレイヤーには仕組みそのものが渡らない（表示だけ隠さない）', () => {
    // **隠すのと塞ぐのは別。** 楽曲レベルのラベルを消しただけのときは
    // ソロパート（×1.6）が S1 から使えたままだったし、センターの行を消しても
    // 編成画面のボタンからは選べていた。判定は渡す側・変更する側にも要る
    const save = createNewSave();
    expect(isOpen(save, 'songLevel'), 'ソロパート').toBe(false);
    expect(isOpen(save, 'center'), 'センター').toBe(false);
    expect(isOpen(save, 'costumes'), '衣装').toBe(false);
  });

  it('1 ステージにつき新しい仕組みは 1 つずつ増える', () => {
    const counts = ['S1', 'S2', 'S3'].map((id) => unlockedBy(id).length);
    // S3 では何も開かない ―― 前の 2 本で開いたものを使う回
    expect(counts).toEqual([2, 2, 0]);
    // バトル中の仕組み（sim が変わるもの）は 1 本につき 1 つ
    const inBattle = ['S1', 'S2'].map(
      (id) => unlockedBy(id).filter((f) => f === 'setlist' || f === 'special').length,
    );
    expect(inBattle).toEqual([1, 1]);
  });
});

describe('開く順', () => {
  it('進めるほど増える（減りはしない）', () => {
    let previous = 0;
    const cleared: string[] = [];
    for (const stageId of stageOrder.slice(0, 12)) {
      cleared.push(stageId);
      const count = openFeatures(clearedThrough(...cleared)).length;
      expect(count, stageId).toBeGreaterThanOrEqual(previous);
      previous = count;
    }
  });

  it('S10 まで進めば全部開く', () => {
    const save = clearedThrough(...stageOrder.slice(0, stageOrder.indexOf('S10') + 1));
    expect(openFeatures(save).sort()).toEqual([...ALL].sort());
    expect(nextUnlock(save)).toBeNull();
  });

  it('次に開くものが分かる（進行が止まったように見せない）', () => {
    // 隠すだけだと「もう何も増えない」に見える
    expect(nextUnlock(createNewSave())).toEqual({ feature: 'party', stageId: 'S1' });
    expect(nextUnlock(clearedThrough('S1'))?.stageId).toBe('S2');
    expect(nextUnlock(clearedThrough('S1', 'S2'))?.stageId).toBe('S5');
  });

  it('開く条件のステージは実在する', () => {
    for (const feature of ALL) {
      const next = unlockedBy('S1');
      void next;
      // 各要素がどこかのステージで開くこと
      const gate = stageOrder.find((id) => unlockedBy(id).includes(feature));
      expect(gate, feature).toBeDefined();
    }
  });
});

describe('文言', () => {
  it('全要素に名前と説明がある', () => {
    // 開いたことだけ知らせても、何ができるのかが分からないと開いた意味が無い
    for (const feature of ALL) {
      expect(FEATURE_LABEL[feature], feature).toBeTruthy();
      expect(FEATURE_NOTE[feature]?.length, feature).toBeGreaterThan(8);
    }
  });
});

describe('セーブには持たない', () => {
  it('進捗だけで決まる（同じ進捗なら同じ結果）', () => {
    // 保存すると、解放条件を変えたときに古いセーブだけが食い違う
    const a = clearedThrough('S1', 'S2', 'S3');
    const b = { ...clearedThrough('S1', 'S2', 'S3'), funds: 99999, talents: ['vo_s1'] };
    expect(openFeatures(a)).toEqual(openFeatures(b));
  });

  it('クリアしていない進捗（プレイしただけ）では開かない', () => {
    const save = {
      ...createNewSave(),
      stageProgress: { S1: { cleared: false, bestAudience: 40, plays: 9 } },
    };
    expect(isOpen(save, 'setlist')).toBe(false);
  });
});
