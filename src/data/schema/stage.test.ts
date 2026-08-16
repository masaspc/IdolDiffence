import { describe, expect, it } from 'vitest';
import { checkStageInvariants, stageSchema, type Stage } from './stage';

const base = (): Stage =>
  stageSchema.parse({
    name: 'テスト会場',
    grid: { w: 8, h: 6 },
    lanes: [{ waypoints: [[0, 3], [4, 3], [7, 3]] }],
    placeable: [[2, 1], [5, 5]],
    cellTypes: { '2,1': 'runway' },
    song: 'kaguya_rising',
    waves: [{ section: 'intro', bars: 8, spawns: [] }],
  });

describe('checkStageInvariants', () => {
  it('正しいステージはエラーなし', () => {
    expect(checkStageInvariants('T1', base())).toEqual([]);
  });

  it('グリッド外のウェイポイントを検出する', () => {
    const stage = base();
    stage.lanes[0]!.waypoints[1] = [99, 3];
    expect(checkStageInvariants('T1', stage).join()).toMatch(/グリッド外/);
  });

  it('経路上の配置マスを検出する', () => {
    const stage = base();
    // (3,3) はウェイポイントではないが、(0,3)→(4,3) の区間が通過する
    stage.placeable.push([3, 3]);
    expect(checkStageInvariants('T1', stage).join()).toMatch(/経路のウェイポイントと重なって/);
  });

  it('配置マスの重複を検出する', () => {
    const stage = base();
    stage.placeable.push([2, 1]);
    expect(checkStageInvariants('T1', stage).join()).toMatch(/重複/);
  });

  it('placeable にない cellTypes を検出する', () => {
    const stage = base();
    stage.cellTypes['7,0'] = 'audience';
    expect(checkStageInvariants('T1', stage).join()).toMatch(/placeable に含まれていません/);
  });

  it('存在しないレーンを指すスポーンを検出する', () => {
    const stage = base();
    stage.waves[0]!.spawns.push({ bar: 0, enemy: 'e_walker', count: 1, intervalBars: 1, lane: 3 });
    expect(checkStageInvariants('T1', stage).join()).toMatch(/lane=3 は存在しません/);
  });

  it('ウェーブ長を超えるスポーンを検出する', () => {
    const stage = base();
    stage.waves[0]!.spawns.push({ bar: 6, enemy: 'e_walker', count: 5, intervalBars: 1, lane: 0 });
    expect(checkStageInvariants('T1', stage).join()).toMatch(/ウェーブ長 8 小節を超えています/);
  });
});
