/**
 * プロデューサーランク（03-progression.md ⑫）と楽曲レベル（⑩）。
 *
 * どちらも周回で伸びる軸。**上限まで一直線に伸びない**ことと、
 * ランクが戦力を直接配らないことを固定する。
 */
import { describe, expect, it } from 'vitest';
import { createNewSave, type SaveData } from './save';
import {
  battleExp,
  expToNext,
  MAX_RANK,
  MAX_SONG_LEVEL,
  rankOf,
  rankProgress,
  soloPartForStage,
  soloPartOf,
  songExp,
  songLevelOf,
  talentPointsFromRank,
  TALENT_POINTS_PER_RANK,
} from './rank';
import { applyReward, calcReward } from './progression';
import { totalTalentPoints } from './talents';
import { getStage } from '../data';

describe('プロデューサーランク', () => {
  it('新規はランク 1', () => {
    expect(rankOf(0)).toBe(1);
    expect(rankProgress(0).ratio).toBe(0);
  });

  it('累計経験値で上がり、上限で止まる', () => {
    expect(rankOf(expToNext(1))).toBe(2);
    expect(rankOf(expToNext(1) + expToNext(2))).toBe(3);
    expect(rankOf(1e12)).toBe(MAX_RANK);
    expect(rankProgress(1e12).ratio).toBe(1);
  });

  it('上がるほど重くなる（すぐ上限に着かない）', () => {
    for (let rank = 1; rank < 10; rank++) {
      expect(expToNext(rank + 1)).toBeGreaterThan(expToNext(rank));
    }
  });

  it('完走と観客と★で経験値が伸びる', () => {
    expect(battleExp(true, 100, 1)).toBeGreaterThan(battleExp(false, 0, 1));
    expect(battleExp(true, 100, 1)).toBeGreaterThan(battleExp(true, 50, 1));
    expect(battleExp(true, 100, 5)).toBeGreaterThan(battleExp(true, 100, 1));
  });

  it('負けても経験値は入る（プレイが無駄にならない）', () => {
    expect(battleExp(false, 0, 1)).toBeGreaterThan(0);
  });

  it('ランクが配るのは才能ポイントだけ（戦力バフは持たない）', () => {
    const save: SaveData = { ...createNewSave(), totalExp: expToNext(1) * 3 };
    const rank = rankOf(save.totalExp);
    expect(talentPointsFromRank(save)).toBe((rank - 1) * TALENT_POINTS_PER_RANK);
    // 才能ポイントの総量にちゃんと足されている
    expect(totalTalentPoints(save)).toBe(talentPointsFromRank(save));
  });
});

describe('楽曲レベル', () => {
  it('新規は Lv1', () => {
    expect(songLevelOf(createNewSave(), 'kaguya_rising')).toBe(1);
  });

  it('完走したときだけ習熟度が入る', () => {
    expect(songExp(true, 1)).toBeGreaterThan(0);
    expect(songExp(false, 5)).toBe(0);
  });

  it('★が高いほど早く伸びる', () => {
    expect(songExp(true, 8)).toBeGreaterThan(songExp(true, 1));
  });

  it('上限で止まる', () => {
    const save: SaveData = { ...createNewSave(), songExp: { kaguya_rising: 1e9 } };
    expect(songLevelOf(save, 'kaguya_rising')).toBe(MAX_SONG_LEVEL);
  });

  it('ソロパートはレベルで強く・長く・軽くなる', () => {
    const low = soloPartOf(1);
    const high = soloPartOf(MAX_SONG_LEVEL);
    expect(high.atkMul).toBeGreaterThan(low.atkMul);
    expect(high.durationMs).toBeGreaterThan(low.durationMs);
    expect(high.cooldownMs).toBeLessThan(low.cooldownMs);
    // 回転率が上がっても常時発動にはならない
    expect(high.cooldownMs).toBeGreaterThan(high.durationMs);
  });

  it('楽曲はステージ横断で効く（同じ曲を使う別ステージにも乗る）', () => {
    // 10 ステージに対して曲は 5 曲。S3 で上げた曲は S7 でもそのまま効く
    const songId = getStage('S3').song;
    expect(getStage('S7').song).toBe(songId);
    const save: SaveData = { ...createNewSave(), songExp: { [songId]: 1e9 } };
    expect(soloPartForStage(save, 'S7').atkMul).toBe(soloPartOf(MAX_SONG_LEVEL).atkMul);
  });
});

describe('リザルトからの反映', () => {
  it('完走でランク経験値・楽曲習熟度・★記録がすべて伸びる', () => {
    const outcome = { stageId: 'S1', won: true, audience: 100, killed: 40, star: 3 };
    const { save } = applyReward(createNewSave(), outcome, calcReward(outcome));

    expect(save.totalExp).toBe(battleExp(true, 100, 3));
    expect(save.songExp[getStage('S1').song]).toBe(songExp(true, 3));
    expect(save.bestStar['S1']).toBe(3);
  });

  it('負けたら★の記録は伸びない（挑むだけで解放されない）', () => {
    const outcome = { stageId: 'S1', won: false, audience: 0, killed: 5, star: 6 };
    const { save } = applyReward(createNewSave(), outcome, calcReward(outcome));
    expect(save.bestStar['S1']).toBeUndefined();
    // 経験値は入る
    expect(save.totalExp).toBeGreaterThan(0);
  });

  it('★が高いほど資金も増える', () => {
    const at = (star: number): number =>
      calcReward({ stageId: 'S1', won: true, audience: 100, killed: 40, star }).funds;
    expect(at(5)).toBeGreaterThan(at(1));
    expect(at(10)).toBeGreaterThan(at(5));
  });
});
