/**
 * セーブデータ（docs/design/05-architecture.md 5.7）。
 *
 * 強化要素が多い＝スキーマ変更が頻発するため、**マイグレーションを最初から入れる**。
 * 後付けにすると、既存プレイヤーのデータを壊すか、互換コードが散らかるかの二択になる。
 *
 * localStorage は `masaspc.github.io` 配下の全プロジェクトで共有されるので、
 * キーには必ずプレフィックスを付ける（5.11）。
 */
import { z } from 'zod';

export const SAVE_KEY = 'idoldiffence.save';
export const CURRENT_VERSION = 1;

export const saveSchema = z.object({
  version: z.number().int().positive(),
  /** 育成に使う通貨 */
  funds: z.number().nonnegative(),
  /** アイドル ID -> レベル */
  idolLevels: z.record(z.string(), z.number().int().positive()),
  stageProgress: z.record(
    z.string(),
    z.object({
      cleared: z.boolean(),
      bestAudience: z.number().nonnegative(),
      plays: z.number().int().nonnegative(),
    }),
  ),
});

export type SaveData = z.infer<typeof saveSchema>;

export function createNewSave(): SaveData {
  return {
    version: CURRENT_VERSION,
    funds: 0,
    idolLevels: { V1: 1, D1: 1, Vi1: 1 },
    stageProgress: {},
  };
}

/**
 * バージョンを 1 つずつ上げていく方式。
 * `migrations[n]` は「バージョン n のデータを n+1 にする」関数。
 */
type Migration = (old: Record<string, unknown>) => Record<string, unknown>;

const migrations: Record<number, Migration> = {
  // 例）v1 -> v2 でスキルレベルを足すとき:
  // 1: (old) => ({ ...old, version: 2, skillLevels: {} }),
};

export function migrate(raw: Record<string, unknown>): Record<string, unknown> {
  let data = raw;
  let version = typeof data.version === 'number' ? data.version : 0;

  while (version < CURRENT_VERSION) {
    const step = migrations[version];
    if (!step) {
      // 移行手段が無い = 未来のバージョン or 壊れたデータ。
      // 黙って捨てず、呼び出し側が判断できるよう例外にする
      throw new Error(`セーブデータ v${version} を v${CURRENT_VERSION} へ移行できません`);
    }
    data = step(data);
    const next = typeof data.version === 'number' ? data.version : version + 1;
    if (next <= version) throw new Error(`マイグレーションがバージョンを進めませんでした: v${version}`);
    version = next;
  }
  return data;
}

export interface LoadResult {
  data: SaveData;
  /** 壊れていたので初期化した場合の理由 */
  recoveredFrom?: string;
}

/** 壊れたセーブは検出して安全に初期化する。ゲームが起動できなくなるのを避ける */
export function loadSave(storage: Pick<Storage, 'getItem'>): LoadResult {
  const text = storage.getItem(SAVE_KEY);
  if (!text) return { data: createNewSave() };

  try {
    const raw = JSON.parse(text) as Record<string, unknown>;
    const migrated = migrate(raw);
    const parsed = saveSchema.safeParse(migrated);
    if (!parsed.success) {
      return { data: createNewSave(), recoveredFrom: 'スキーマ不一致' };
    }
    // 将来のバージョンのデータは読まない（ダウングレード時にデータを壊さないため）
    if (parsed.data.version > CURRENT_VERSION) {
      return { data: createNewSave(), recoveredFrom: '新しいバージョンのセーブ' };
    }
    return { data: parsed.data };
  } catch (error) {
    return { data: createNewSave(), recoveredFrom: error instanceof Error ? error.message : '不明' };
  }
}

export function saveSave(storage: Pick<Storage, 'setItem'>, data: SaveData): void {
  storage.setItem(SAVE_KEY, JSON.stringify(data));
}

/** localStorage 消失への保険。Base64 で書き出す */
export function exportSave(data: SaveData): string {
  return btoa(encodeURIComponent(JSON.stringify(data)));
}

export function importSave(text: string): SaveData | null {
  try {
    const raw = JSON.parse(decodeURIComponent(atob(text))) as Record<string, unknown>;
    const parsed = saveSchema.safeParse(migrate(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
