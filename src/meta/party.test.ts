/**
 * 編成（出撃 5 人 + センター）と解放条件。
 *
 * ここが壊れると「出撃できない」「センターの効果が二重に乗る」といった、
 * プレイヤーから原因の見えない不具合になるので、境界を厚めに固めておく。
 */
import { describe, expect, it } from 'vitest';
import { createNewSave, CURRENT_VERSION, migrate, saveSchema, type SaveData } from './save';
import {
  chapterIntroFor,
  isUnlocked,
  normalizeParty,
  setCenter,
  toggleParty,
  unlockedIds,
} from './progression';
import { canonIds, chapters, PARTY_SIZE, rosterIds, SECRET_IDS, stageOrder } from '../data';
import { createWorld } from '../sim/world';
import { runHeadless } from '../core/loop';

function cleared(...stageIds: string[]): SaveData {
  const save = createNewSave();
  return {
    ...save,
    stageProgress: Object.fromEntries(
      stageIds.map((id) => [id, { cleared: true, bestAudience: 100, plays: 1 }]),
    ),
  };
}

describe('解放条件', () => {
  it('初期は原作の 3 人だけ', () => {
    const save = createNewSave();
    expect(unlockedIds(save)).toEqual(['V1', 'D1', 'Vi1']);
  });

  it('ステージクリアで加入する', () => {
    expect(isUnlocked(createNewSave(), 'V2')).toBe(false);
    expect(isUnlocked(cleared('S1'), 'V2')).toBe(true);
  });

  it('本編をクリアすると原作の 12 人がそろう', () => {
    const save = cleared('S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7');
    expect(unlockedIds(save)).toEqual([...canonIds]);
  });

  it('隠しキャラはステージをいくら進めても出てこない', () => {
    // ステージ解放の表に混ぜてしまうと、ホームに「○○をクリアすると解放」と
    // 出てしまい隠れていない。鍵は合言葉だけ（`meta/secrets.ts`）
    const save = cleared(...stageOrder);
    for (const id of SECRET_IDS) {
      expect(isUnlocked(save, id), `${id} がステージで解放されている`).toBe(false);
    }
  });
});

describe('編成', () => {
  it('未解放のメンバーは編成に入らない', () => {
    const save = toggleParty(createNewSave(), 'V3');
    expect(normalizeParty(save).party).not.toContain('V3');
  });

  it('定員を超えて追加できない', () => {
    let save = cleared('S1', 'S2', 'S3', 'S4', 'S5');
    for (const id of rosterIds) save = toggleParty(save, id);
    expect(normalizeParty(save).party.length).toBeLessThanOrEqual(PARTY_SIZE);
  });

  it('全員を外すことはできない（出撃不能になるため）', () => {
    let save = createNewSave();
    for (const id of ['V1', 'D1', 'Vi1']) save = toggleParty(save, id);
    expect(normalizeParty(save).party.length).toBeGreaterThan(0);
  });

  it('センターを編成から外すと、残ったメンバーへ移る', () => {
    const save = toggleParty(createNewSave(), 'V1'); // V1 が初期センター
    const { party, center } = normalizeParty(save);
    expect(party).not.toContain('V1');
    expect(center).not.toBe('V1');
    expect(party).toContain(center!);
  });

  it('編成外のメンバーはセンターにできない', () => {
    const save = setCenter(createNewSave(), 'V2');
    expect(normalizeParty(save).center).toBe('V1');
  });

  it('壊れたセーブ（重複・未解放）を読んでも整合する', () => {
    const broken: SaveData = {
      ...createNewSave(),
      party: ['V1', 'V1', 'Vi3', 'D1'],
      center: 'Vi3',
    };
    const { party, center } = normalizeParty(broken);
    expect(party).toEqual(['V1', 'D1']);
    expect(center).toBe('V1');
  });

  it('ロスターに無い ID は落とす（手書きセーブでゲームが起動しなくなるのを防ぐ）', () => {
    // 「未解放」と「存在しない」を混同すると、後段の getIdol() が例外を投げて
    // ホーム画面ごと落ちる。解放条件の表に無い ID は存在しない扱いにする
    expect(isUnlocked(createNewSave(), 'ZZ9')).toBe(false);

    const broken: SaveData = {
      ...createNewSave(),
      party: ['V1', 'ZZ9', 'D1'],
      center: 'ZZ9',
    };
    const { party, center } = normalizeParty(broken);
    expect(party).toEqual(['V1', 'D1']);
    expect(center).toBe('V1');
  });

  it('編成が丸ごと未知でも、空にせず解放済みメンバーで埋め戻す', () => {
    const broken: SaveData = { ...createNewSave(), party: ['ZZ9', 'ZZ8'], center: 'ZZ9' };
    const { party, center } = normalizeParty(broken);
    expect(party.length).toBeGreaterThan(0);
    expect(party).toContain(center!);
  });
});

describe('センターパッシブ', () => {
  it('彩葉センターで配置コストが下がる', () => {
    const plain = createWorld('S1', 1, { party: ['V1', 'D1'], center: 'V1' });
    const ayaha = createWorld('S1', 1, { party: ['V1', 'D1'], center: 'D1' });
    expect(ayaha.placementCost('V1')).toBeLessThan(plain.placementCost('V1'));
  });

  it('かぐやセンターで全体の攻撃力が上がる', () => {
    const atkWith = (center: string): number => {
      const world = createWorld('S1', 1, { party: ['V1', 'D1'], center });
      world.addCheer(1000);
      const unit = world.placeUnit('D1', 4, 6);
      if (typeof unit === 'string') throw new Error(unit);
      return world.snapshot().units[0]!.atk;
    };
    expect(atkWith('V1')).toBeGreaterThan(atkWith('D1'));
  });

  it('編成外を center に指定しても効かない', () => {
    const world = createWorld('S1', 1, { party: ['D1'], center: 'V1' });
    expect(world.snapshot().centerName).toBeNull();
  });

  it('声援獲得を上げるセンターが、実際に声援の回復を速くする', () => {
    // ユニットのローカルプールへ積むだけだと経済計算に届かない。
    // 「表示されている効果が実際には何もしていない」を防ぐための検証
    const cheerAfter = (center: string): number => {
      const world = createWorld('S1', 1, { party: ['V1', 'D1', 'Vi1'], center });
      runHeadless(5000, (dt) => world.update(dt));
      return world.snapshot().cheer;
    };
    // ヤチヨ = 声援獲得 +15% / 彩葉 = 声援に触らない
    expect(cheerAfter('Vi1')).toBeGreaterThan(cheerAfter('D1'));
  });

  it('月華の蓄積を上げるセンターが、実際にゲージを速く溜める', () => {
    const voltageAfter = (center: string): number => {
      const world = createWorld('S1', 1, { party: ['V1', 'D1', 'Vi1'], center });
      runHeadless(20_000, (dt) => world.update(dt));
      return world.snapshot().voltage;
    };
    // かぐや = 月華 +10% / 彩葉 = 月華に触らない
    expect(voltageAfter('V1')).toBeGreaterThan(voltageAfter('D1'));
  });

  it('編成外のメンバーは配置できない', () => {
    const world = createWorld('S1', 1, { party: ['D1'], center: 'D1' });
    world.addCheer(1000);
    expect(world.canPlace('V1', 4, 6)).toBe('not-in-party');
    expect(world.canPlace('D1', 4, 6)).toBeNull();
  });

  it('パレットは編成の並び順そのまま', () => {
    const world = createWorld('S1', 1, { party: ['Vi1', 'D1', 'V1'], center: 'D1' });
    expect(world.snapshot().palette.map((p) => p.idolId)).toEqual(['Vi1', 'D1', 'V1']);
    expect(world.snapshot().palette.find((p) => p.isCenter)?.idolId).toBe('D1');
  });
});

describe('セーブの移行', () => {
  it('v1 のセーブが最新まで上がり、編成と才能が補われる', () => {
    const old = {
      version: 1,
      funds: 500,
      idolLevels: { V1: 4 },
      stageProgress: { S1: { cleared: true, bestAudience: 90, plays: 2 } },
    };
    const migrated = saveSchema.parse(migrate(old));
    expect(migrated.version).toBe(CURRENT_VERSION);
    expect(migrated.funds).toBe(500);
    expect(migrated.party).toEqual(['V1', 'D1', 'Vi1']);
    expect(migrated.center).toBe('V1');
    expect(migrated.talents).toEqual([]);
  });
});

describe('章の導入（chapterIntroFor）', () => {
  it('新しい章の最初のステージへ初めて入るときだけ返す', () => {
    const save = createNewSave();
    const second = chapters[1];
    const third = chapters[2];
    expect(second).toBeDefined();
    expect(third).toBeDefined();
    const s2first = second?.stages[0] ?? '';
    expect(chapterIntroFor(save, s2first)).toEqual({
      name: second?.name,
      lead: second?.lead,
    });
    expect(chapterIntroFor(save, third?.stages[0] ?? '')).not.toBeNull();
  });

  it('第 1 章では出さない（始まりの導入はタイトルの仕事）', () => {
    const save = createNewSave();
    expect(chapterIntroFor(save, chapters[0]?.stages[0] ?? '')).toBeNull();
  });

  it('章の途中のステージでは出さない', () => {
    const save = createNewSave();
    expect(chapterIntroFor(save, chapters[1]?.stages[1] ?? '')).toBeNull();
  });

  it('一度でも挑んだら出さない（負けて再挑戦しても言い直さない）', () => {
    const save = createNewSave();
    const first = chapters[1]?.stages[0] ?? '';
    const played: SaveData = {
      ...save,
      stageProgress: { [first]: { cleared: false, bestAudience: 0, plays: 1 } },
    };
    expect(chapterIntroFor(played, first)).toBeNull();
  });
});
