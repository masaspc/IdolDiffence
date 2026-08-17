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
import { DEFAULT_SETTINGS, settingsSchema } from './settings';

export const SAVE_KEY = 'idoldiffence.save';
export const CURRENT_VERSION = 10;

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
  /**
   * ステージ ID -> 到達した最高の★（02-core-battle.md 2.10）。
   *
   * `stageProgress` に混ぜず別に持つ。「クリアしたか」と
   * 「どこまで難しくして勝てたか」は別の問いで、前者は解放、後者は周回の指標になる
   */
  bestStar: z.record(z.string(), z.number().int().positive()),
  /**
   * プロデューサーランクの累計経験値（03-progression.md ⑫）。
   *
   * **ランクそのものは持たない。** 曲線を調整したときに、
   * 保存済みのランクだけが古い曲線のまま残るのを避ける（衣装の実効値と同じ理由）
   */
  totalExp: z.number().nonnegative(),
  /** 楽曲 ID -> 累計習熟度（⑩）。レベルはここから導く */
  songExp: z.record(z.string(), z.number().nonnegative()),
  /**
   * 解放済みの隠し要素（いまは隠しキャラの ID だけ）。
   *
   * 解放済みキャラの一覧ではなく**隠し要素の鍵**を持つ。通常のメンバーは
   * ステージ進捗から毎回導いており（`isUnlocked`）、解放結果を保存すると
   * 条件を変えたときに古いセーブだけ食い違う
   */
  secrets: z.array(z.string()),
  /**
   * 「登場しました」と知らせ済みの隠しキャラ。
   *
   * 解放そのものは導けるが（`isSecretUnlocked`）、**知らせたかどうかは出来事**で、
   * 進捗からは復元できない。持たないとホームを開くたびに同じ通知が出続ける
   */
  seenSecrets: z.array(z.string()),
  /** 設定（06-ui-ux.md 6.7 アクセシビリティ） */
  settings: settingsSchema,
  /**
   * ライブの記録（03-progression.md ⑬）。
   *
   * **進捗から導けないものだけ**を積む。「1 ライブで最多何体」のような値は
   * その場で数えないと後から復元できない。導けるもの（クリア数・★・ランク）は
   * 持たず、実績の判定時に毎回導く
   */
  stats: z.object({
    wins: z.number().int().nonnegative(),
    kills: z.number().int().nonnegative(),
    bestKills: z.number().int().nonnegative(),
    noLeakWins: z.number().int().nonnegative(),
    perfectCalls: z.number().int().nonnegative(),
    bestCallCombo: z.number().int().nonnegative(),
    soloUses: z.number().int().nonnegative(),
    fundsEarned: z.number().nonnegative(),
  }),
  /**
   * 資金報酬を受け取り済みの実績。
   *
   * 才能ポイントは解除状態から毎回導けるが、資金は**残高が増減する**ので
   * 「導いた総額 − 使った額」では復元できない。ここだけ受領済みを持つ
   */
  claimedAchievements: z.array(z.string()),
  /** 表示している称号（実績 ID）。未設定なら null */
  title: z.string().nullable(),
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
    bestStar: {},
    totalExp: 0,
    songExp: {},
    secrets: [],
    seenSecrets: [],
    settings: { ...DEFAULT_SETTINGS },
    stats: emptyStats(),
    claimedAchievements: [],
    title: null,
  };
}

/** 記録の初期値。移行でも新規でも同じものを使う */
export function emptyStats(): SaveData['stats'] {
  return {
    wins: 0,
    kills: 0,
    bestKills: 0,
    noLeakWins: 0,
    perfectCalls: 0,
    bestCallCombo: 0,
    soloUses: 0,
    fundsEarned: 0,
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
  // v5 -> v6: ★難度・プロデューサーランク・楽曲レベルを追加した（M4）。
  // 遡ってランクを配ることはしない（周回で伸ばす軸なので、
  // 過去のプレイぶんを推定して配ると初日から上限近くになってしまう）。
  // ★はクリア済みステージを ★1 到達として引き継ぐ
  5: (old) => ({
    ...old,
    version: 6,
    bestStar: Object.fromEntries(
      Object.entries((old.stageProgress ?? {}) as Record<string, { cleared?: boolean }>)
        .filter(([, p]) => p?.cleared)
        .map(([id]) => [id, 1]),
    ),
    totalExp: 0,
    songExp: {},
  }),
  // v6 -> v7: 原作の登場人物 3 人（真実・犬DOGE・FUSHI）と隠しキャラを追加した。
  // 3 人はステージ進捗から解放されるので遡って配られる。
  // 隠しキャラは合言葉が鍵なので、既存プレイヤーも改めて打つところから
  6: (old) => ({ ...old, version: 7, secrets: [] }),
  // v7 -> v8: 設定（アクセシビリティ）と実績を追加した（M5-1）。
  // 記録はゼロから始める。過去のプレイぶんを推定して配ると、
  // 「1 ライブで 500 体」のような実績が根拠なく解除されてしまう。
  // ステージ進捗から導ける実績（クリア数・★・ランク）は遡って解除される
  7: (old) => ({
    ...old,
    version: 8,
    settings: { ...DEFAULT_SETTINGS },
    stats: emptyStats(),
    claimedAchievements: [],
    title: null,
  }),
  // v8 -> v9: 隠しキャラが腕前でも解放されるようになった（S5 を ★5 で勝つ）。
  // 条件は `bestStar` から毎回導くので、**既存プレイヤーにも遡って適用される** ——
  // すでに S5 を ★5 で勝っている人は、次にホームを開いた時点で登場する。
  //
  // 通知済みの一覧は、合言葉で開けていたぶんを「済み」として引き継ぐ。
  // 自分で打って呼び出した人に、いまさら「登場しました」と出すのはおかしい
  8: (old) => ({
    ...old,
    version: 9,
    seenSecrets: [...((old.secrets ?? []) as string[])],
  }),
  // v9 -> v10: 楽曲を原作の劇中歌の実タイトルへ差し替えた（M5-3）。
  // **習熟度は移す。** 曲名を変えただけで、プレイヤーが積んだものは同じ。
  // 捨てるとソロパートの解禁が巻き戻り、「何もしていないのに弱くなった」になる。
  // 126BPM の枠を畳んだので、そのぶんは移り先へ足し込む
  9: (old) => ({
    ...old,
    version: 10,
    songExp: renameSongExp((old.songExp ?? {}) as Record<string, number>),
  }),
};

/** 旧 ID -> 新 ID。畳んだ枠は同じ移り先へ合流する */
const SONG_RENAMES: Record<string, string> = {
  kaguya_rising: 'reply',
  neon_horai: 'ray_cpk',
  gekko_silence: 'hoshifuru_umi',
  hinezumi_overdrive: 'shunkan',
  hagoromo_encore: 'watashi_wa',
  gonan_five: 'remember',
  tsuki_capital: 'ex_otogibanashi',
  tennin_waltz: 'ex_otogibanashi',
};

function renameSongExp(old: Record<string, number>): Record<string, number> {
  const next: Record<string, number> = {};
  for (const [id, exp] of Object.entries(old)) {
    const key = SONG_RENAMES[id] ?? id;
    next[key] = (next[key] ?? 0) + exp;
  }
  return next;
}

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
