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
import { costumeRaritySchema, costumeSlotSchema, costumeStatSchema } from '../data/schema/costume';
import { seedFromString } from '../core/rng';

export const SAVE_KEY = 'idoldiffence.save';
export const CURRENT_VERSION = 5;

/**
 * 生成された衣装 1 着（03-progression.md ⑨）。
 *
 * 定義（シリーズとセット効果）は JSON にあるが、実体は乱数で無数に増えるので
 * セーブが持つ。**実効値は持たない**（`mainValue` / `subValue` が強化段階から導く）。
 * 実効値を焼き込むと、係数を調整したときに既存の所持品だけ旧値のまま残る。
 */
export const costumeInstanceSchema = z.object({
  id: z.string().min(1),
  seriesId: z.string().min(1),
  slot: costumeSlotSchema,
  rarity: costumeRaritySchema,
  mainStat: costumeStatSchema,
  /** 副次ステータスと「何段伸びたか」 */
  subs: z.array(z.object({ stat: costumeStatSchema, rolls: z.number().int().positive() })),
  enhance: z.number().int().min(0),
});

export type CostumeInstance = z.infer<typeof costumeInstanceSchema>;

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
  /** 出撃メンバー（最大 5 人）。並び順が HUD のパレット順になる */
  party: z.array(z.string()),
  /** センター。party に含まれない ID は無視される */
  center: z.string().nullable(),
  /** 取得済みの才能ノード ID。ポイント数は実績から導けるので持たない */
  talents: z.array(z.string()),
  /** 進化を解放済みのアイドル ID（03-progression.md ⑦-2） */
  evolved: z.array(z.string()),
  /** 所持している衣装（03-progression.md ⑨） */
  costumes: z.array(costumeInstanceSchema),
  /** アイドル ID -> スロット -> 衣装 ID。1 着は 1 人しか着られない */
  equipped: z.record(z.string(), z.record(costumeSlotSchema, z.string())),
  /** 衣装 ID の連番。既存の ID とぶつからないようにするためだけの数 */
  costumeSeq: z.number().int().nonnegative(),
  /**
   * メタ層の乱数の状態（ドロップと錬成）。
   *
   * `Math.random()` を使わず**セーブに状態を持つ**ことで、ドロップ分布を
   * ヘッドレスで測れるようにし、リロードして引き直すのも塞ぐ
   */
  rngState: z.number().int().nonnegative(),
});

export type SaveData = z.infer<typeof saveSchema>;

/** 初期メンバー。原作の 3 人（04-content.md 4.1） */
export const STARTER_IDS = ['V1', 'D1', 'Vi1'] as const;

/**
 * ドロップ乱数の既定の種。
 *
 * 固定値なので、**引数を省いたセーブは誰が作っても同じ順で引く**。
 * テストとヘッドレス計測はこれで回す。実際のプレイでは `App` が
 * `randomSeed()` を渡すので、プレイヤーごとに変わる。
 */
export const DEFAULT_RNG_STATE = seedFromString('idoldiffence:drops');

export function createNewSave(rngState: number = DEFAULT_RNG_STATE): SaveData {
  return {
    version: CURRENT_VERSION,
    funds: 0,
    idolLevels: { V1: 1, D1: 1, Vi1: 1 },
    stageProgress: {},
    party: [...STARTER_IDS],
    center: 'V1',
    talents: [],
    evolved: [],
    costumes: [],
    equipped: {},
    costumeSeq: 0,
    rngState,
  };
}

/**
 * バージョンを 1 つずつ上げていく方式。
 * `migrations[n]` は「バージョン n のデータを n+1 にする」関数。
 */
type Migration = (old: Record<string, unknown>) => Record<string, unknown>;

const migrations: Record<number, Migration> = {
  // v1 -> v2: 編成（出撃 5 人 + センター）を追加した（M3）。
  // 既存プレイヤーは初期 3 人で遊んでいたので、それをそのまま編成として引き継ぐ
  1: (old) => ({ ...old, version: 2, party: [...STARTER_IDS], center: 'V1' }),
  // v2 -> v3: 才能ボードを追加した（M3-2）。既存プレイヤーは未取得から始める。
  // ポイントは実績（クリア済みステージ）から導くので、遡って配られる
  2: (old) => ({ ...old, version: 3, talents: [] }),
  // v3 -> v4: 初期メンバーの進化を追加した（M3-2）。
  // 解放は資金を払う操作なので、遡って配ることはしない
  3: (old) => ({ ...old, version: 4, evolved: [] }),
  // v4 -> v5: 衣装を追加した（M3-2b）。所持ゼロから始める。
  // 乱数の種は既定値を入れる。既存プレイヤーぶんを遡って配らないのは、
  // ドロップが「プレイした回数」に対する報酬だから
  4: (old) => ({
    ...old,
    version: 5,
    costumes: [],
    equipped: {},
    costumeSeq: 0,
    rngState: DEFAULT_RNG_STATE,
  }),
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
    if (!parsed.success) return null;
    // 新しいビルドで書き出したデータを古いビルドへ取り込むと、
    // 知らないフィールドを落として保存し直してしまう。loadSave と同じく拒否する
    if (parsed.data.version > CURRENT_VERSION) return null;
    return parsed.data;
  } catch {
    return null;
  }
}
