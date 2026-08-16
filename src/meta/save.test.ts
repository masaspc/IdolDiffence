import { describe, expect, it } from 'vitest';
import {
  createNewSave,
  exportSave,
  importSave,
  loadSave,
  migrate,
  saveSave,
  CURRENT_VERSION,
  SAVE_KEY,
  STARTER_IDS,
  saveSchema,
  type SaveData,
} from './save';
import {
  applyReward,
  calcReward,
  canLevelUp,
  levelAtkMultiplier,
  levelUp,
  levelUpCost,
  MAX_LEVEL,
} from './progression';

function fakeStorage(initial?: string): Storage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  if (initial !== undefined) data.set(SAVE_KEY, initial);
  return {
    data,
    length: 0,
    clear: () => data.clear(),
    getItem: (key: string) => data.get(key) ?? null,
    key: () => null,
    removeItem: (key: string) => data.delete(key),
    setItem: (key: string, value: string) => data.set(key, value),
  } as Storage & { data: Map<string, string> };
}

describe('セーブの読み書き', () => {
  it('未保存なら新規セーブを返す', () => {
    const { data } = loadSave(fakeStorage());
    expect(data.version).toBe(CURRENT_VERSION);
    expect(data.funds).toBe(0);
    expect(data.idolLevels['V1']).toBe(1);
  });

  it('保存したものを読み戻せる', () => {
    const storage = fakeStorage();
    const save: SaveData = { ...createNewSave(), funds: 1234 };
    saveSave(storage, save);
    expect(loadSave(storage).data.funds).toBe(1234);
  });

  it('壊れた JSON は初期化して復旧する', () => {
    const result = loadSave(fakeStorage('{ これは JSON ではない'));
    expect(result.recoveredFrom).toBeDefined();
    expect(result.data.funds).toBe(0);
  });

  it('スキーマに合わないデータは初期化する', () => {
    const result = loadSave(fakeStorage(JSON.stringify({ version: 1, funds: 'たくさん' })));
    expect(result.recoveredFrom).toBe('スキーマ不一致');
  });

  it('未来のバージョンは読まない（ダウングレードでデータを壊さない）', () => {
    const future = { ...createNewSave(), version: CURRENT_VERSION + 5 };
    const result = loadSave(fakeStorage(JSON.stringify(future)));
    expect(result.recoveredFrom).toBe('新しいバージョンのセーブ');
  });

  it('エクスポートしたものをインポートできる', () => {
    const save: SaveData = { ...createNewSave(), funds: 999 };
    const imported = importSave(exportSave(save));
    expect(imported?.funds).toBe(999);
  });

  it('壊れたインポート文字列は null', () => {
    expect(importSave('!!!not-base64!!!')).toBeNull();
  });

  it('未来のバージョンのインポートは拒否する', () => {
    // 新しいビルドのデータを古いビルドへ取り込むと、
    // 知らないフィールドを落として保存し直してしまう
    const future = { ...createNewSave(), version: CURRENT_VERSION + 1 };
    expect(importSave(exportSave(future))).toBeNull();
  });
});

describe('マイグレーション', () => {
  it('現行バージョンはそのまま通る', () => {
    const save = createNewSave();
    expect(migrate({ ...save })).toEqual(save);
  });

  it('移行手段が無い古いバージョンは例外にする（黙って捨てない）', () => {
    expect(() => migrate({ version: 0 })).toThrow();
  });

  it('v1 のセーブが現行まで一気に上がる（進行は消えない）', () => {
    // M1 の頃から遊んでいる人のデータ。当時は育成とステージ進捗しか無かった
    const v1 = {
      version: 1,
      funds: 5000,
      idolLevels: { V1: 12, D1: 8, Vi1: 5 },
      stageProgress: { S1: { cleared: true, bestAudience: 100, plays: 4 } },
    };
    const parsed = saveSchema.safeParse(migrate(v1));
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
    if (!parsed.success) return;

    // 積み上げてきたものは残る
    expect(parsed.data.funds).toBe(5000);
    expect(parsed.data.idolLevels['V1']).toBe(12);
    expect(parsed.data.stageProgress['S1']?.plays).toBe(4);
    // 後から足した枠は空で始まる
    expect(parsed.data.party).toEqual([...STARTER_IDS]);
    expect(parsed.data.talents).toEqual([]);
    expect(parsed.data.evolved).toEqual([]);
    expect(parsed.data.costumes).toEqual([]);
    expect(parsed.data.equipped).toEqual({});
  });

  it('全バージョンぶんの移行が用意されている', () => {
    // 1 つでも欠けると、その版で遊んでいた人のセーブが例外になる
    for (let version = 1; version < CURRENT_VERSION; version++) {
      expect(() => migrate({ ...createNewSave(), version }), `v${version} から上がれない`)
        .not.toThrow();
    }
  });
});

describe('育成', () => {
  it('レベルで攻撃力が伸びる', () => {
    expect(levelAtkMultiplier(1)).toBe(1);
    expect(levelAtkMultiplier(30)).toBeCloseTo(2.74);
  });

  it('費用はレベルが上がるほど重くなる', () => {
    expect(levelUpCost(2)).toBeGreaterThan(levelUpCost(1));
    expect(levelUpCost(20)).toBeGreaterThan(levelUpCost(10));
  });

  it('資金が足りなければ上げられない', () => {
    const save = createNewSave();
    expect(canLevelUp(save, 'V1')).toBe(false);
    expect(levelUp(save, 'V1')).toBe(save);
  });

  it('資金があれば上がり、消費される', () => {
    const save: SaveData = { ...createNewSave(), funds: 1000 };
    const next = levelUp(save, 'V1');
    expect(next.idolLevels['V1']).toBe(2);
    expect(next.funds).toBe(1000 - levelUpCost(1));
  });

  it('上限を超えて上げられない', () => {
    const save: SaveData = {
      ...createNewSave(),
      funds: 10_000_000,
      idolLevels: { V1: MAX_LEVEL },
    };
    expect(canLevelUp(save, 'V1')).toBe(false);
  });
});

describe('報酬', () => {
  it('負けても撃破ぶんは入る（再挑戦の意欲を折らない）', () => {
    const reward = calcReward({ stageId: 'S1', won: false, audience: 0, killed: 30 });
    expect(reward.funds).toBeGreaterThan(0);
  });

  it('完走の方が多くもらえる', () => {
    const lost = calcReward({ stageId: 'S1', won: false, audience: 0, killed: 100 });
    const won = calcReward({ stageId: 'S1', won: true, audience: 100, killed: 100 });
    expect(won.funds).toBeGreaterThan(lost.funds);
  });

  it('進捗が更新される', () => {
    const save = createNewSave();
    const outcome = { stageId: 'S1', won: true, audience: 80, killed: 100 };
    const next = applyReward(save, outcome, calcReward(outcome)).save;
    expect(next.stageProgress['S1']).toEqual({ cleared: true, bestAudience: 80, plays: 1 });
  });

  it('一度クリアした記録は負けても消えない', () => {
    let save = createNewSave();
    const win = { stageId: 'S1', won: true, audience: 90, killed: 100 };
    save = applyReward(save, win, calcReward(win)).save;
    const lose = { stageId: 'S1', won: false, audience: 0, killed: 10 };
    save = applyReward(save, lose, calcReward(lose)).save;
    expect(save.stageProgress['S1']?.cleared).toBe(true);
    expect(save.stageProgress['S1']?.bestAudience).toBe(90);
    expect(save.stageProgress['S1']?.plays).toBe(2);
  });
});
