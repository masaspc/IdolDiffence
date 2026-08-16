/**
 * 静的データのロード。
 *
 * JSON は `import` でバンドルに含める。GitHub Pages はサブパス配信なので
 * `fetch('/data/...')` は 404 になる（docs/design/05-architecture.md 5.11）。
 *
 * **本番でも必ずパースする。** 以前は開発時のみ検証していたが、
 * Zod のパースは検証と同時に**既定値を実体化する**役割も持つ。
 * 素通しにすると `maxStacks` や `tempoBase` のような省略されたフィールドが
 * undefined のままになり、開発では正しく動くのに本番だけ壊れる
 * （例: カードのスタック上限が効かなくなる）。
 * データは数 KB で、起動時のパースは 1ms 程度。省く価値がない。
 */
import stagesJson from './json/stages.json';
import songsJson from './json/songs.json';
import enemiesJson from './json/enemies.json';
import idolsJson from './json/idols.json';
import cardsJson from './json/cards.json';
import talentsJson from './json/talents.json';
import costumeSeriesJson from './json/costume-series.json';
import { stagesSchema, type Stage, type Stages } from './schema/stage';
import { songsSchema, type Song, type Songs } from './schema/song';
import { enemiesSchema, type EnemyDef, type Enemies } from './schema/enemy';
import { idolsSchema, type IdolDef, type Idols } from './schema/idol';
import { cardsSchema, type CardDef, type Cards } from './schema/card';
import { talentsSchema, type TalentNode, type Talents } from './schema/talent';
import {
  costumeSeriesMapSchema,
  type CostumeSeries,
  type CostumeSeriesMap,
} from './schema/costume';

function load<T>(raw: unknown, parse: (raw: unknown) => T): T {
  return parse(raw);
}

export const stages: Stages = load(stagesJson, (raw) => stagesSchema.parse(raw));
export const songs: Songs = load(songsJson, (raw) => songsSchema.parse(raw));
export const enemies: Enemies = load(enemiesJson, (raw) => enemiesSchema.parse(raw));
export const idols: Idols = load(idolsJson, (raw) => idolsSchema.parse(raw));
export const cards: Cards = load(cardsJson, (raw) => cardsSchema.parse(raw));
export const talents: Talents = load(talentsJson, (raw) => talentsSchema.parse(raw));
export const costumeSeries: CostumeSeriesMap = load(costumeSeriesJson, (raw) =>
  costumeSeriesMapSchema.parse(raw),
);

export function getStage(id: string): Stage {
  const stage = stages[id];
  if (!stage) throw new Error(`unknown stage: ${id}`);
  return stage;
}

export function getSong(id: string): Song {
  const song = songs[id];
  if (!song) throw new Error(`unknown song: ${id}`);
  return song;
}

export function getEnemy(id: string): EnemyDef {
  const enemy = enemies[id];
  if (!enemy) throw new Error(`unknown enemy: ${id}`);
  return enemy;
}

export function getTalent(id: string): TalentNode {
  const node = talents[id];
  if (!node) throw new Error(`unknown talent: ${id}`);
  return node;
}

export function getSeries(id: string): CostumeSeries {
  const series = costumeSeries[id];
  if (!series) throw new Error(`unknown costume series: ${id}`);
  return series;
}

/** シリーズ ID の一覧。抽選と UI の並び順を兼ねる */
export const seriesIds = Object.keys(costumeSeries);

export function getIdol(id: string): IdolDef {
  const idol = idols[id];
  if (!idol) throw new Error(`unknown idol: ${id}`);
  return idol;
}

/**
 * 全アイドル。表示順もこの並びに従う。
 *
 * 原作の 12 人は 歌 4 / ダンス 4 / ヴィジュアル 4 で揃えてある。
 * 末尾の `GM` は**隠しキャラ**で、この均衡の外に置いている（`SECRET_IDS`）。
 */
export const rosterIds = [
  'V1',
  'V2',
  'V3',
  'V4',
  'D1',
  'D2',
  'D3',
  'D4',
  'Vi1',
  'Vi2',
  'Vi3',
  'Vi4',
  'GM',
] as const;

/**
 * 隠しキャラ。ステージクリアでは解放されず、セーブの `secrets` に
 * 積まれて初めてロスターに現れる（`meta/secrets.ts`）。
 *
 * **バランスの基準からは外す。** 参照盤面（`balance/plans.ts`）も CI の難度検証も
 * 原作の 12 人だけで組む。隠しキャラを前提にすると、
 * 持っていない人にとっての難度が測れなくなる
 */
export const SECRET_IDS: readonly string[] = ['GM'];

/** 原作の登場人物だけ。バランス計測と編成の基準はこちら */
export const canonIds = rosterIds.filter((id) => !SECRET_IDS.includes(id));

/** 1 ライブに出撃できる人数（03-progression.md ⑤） */
export const PARTY_SIZE = 5;

/**
 * アイドルの解放条件。値のステージをクリアすると使えるようになる。
 *
 * 設計ではプロデューサーランク（⑫）で配る予定だが、ランクは M4。
 * それまでは**ステージクリア**を解放の鍵にする。
 * 「新しい敵が出る回の前に、その敵への答えを配る」順にしてある
 * （S3 クリアで対空を持つ Vi2 / S4 クリアで DEF 無視の V3・D2 覚醒）。
 */
export const idolUnlockStage: Record<string, string | null> = {
  V1: null,
  D1: null,
  Vi1: null,
  // 犬DOGE はかぐやが携帯ゲームキットで作った相棒。最初のライブを終えた時点で連れてこられる
  D4: 'S1',
  V2: 'S1',
  D2: 'S2',
  Vi2: 'S3',
  V3: 'S4',
  D3: 'S5',
  Vi3: 'S5',
  // 諌山 真実 は彩葉の友人。「彩葉の友人」タグを 2 人にする（04-content.md）
  V4: 'S6',
  // FUSHI はヤチヨの相棒。ツクヨミの案内役なので、本編が終盤へ入るところで合流する
  Vi4: 'S7',
  // GM は隠しキャラ。ステージでは解放されない（`meta/secrets.ts`）
  GM: null,
};

/**
 * ステージの並び（表示順）。
 *
 * ボスは本編の途中と最後に挟まる。B1 は S6 の直後に出るが、
 * **S7 の前提ではない**（寄り道として置く）。
 */
export const stageOrder = [
  'S1',
  'S2',
  'S3',
  'S4',
  'S5',
  'S6',
  'B1',
  'S7',
  'S8',
  'S9',
  'S10',
  'B2',
] as const;

/**
 * 解放条件（06-ui-ux.md 6.5 の段階解放）。
 *
 * 並び順から導いていたが、ボスが分岐で入ると
 * 「B1 をクリアしないと S7 が開かない」ことになってしまう。
 * **明示の表**にして、寄り道を寄り道のままにする。
 */
export const stageUnlock: Record<string, string | null> = {
  S1: null,
  S2: 'S1',
  S3: 'S2',
  S4: 'S3',
  S5: 'S4',
  S6: 'S5',
  B1: 'S6',
  S7: 'S6',
  S8: 'S7',
  S9: 'S8',
  S10: 'S9',
  B2: 'S10',
};

export function requiredStage(stageId: string): string | null {
  return stageUnlock[stageId] ?? null;
}

/** 本編のステージだけ（ボスを除く）。バランス計測の対象 */
export const mainStageIds = stageOrder.filter((id) => !getStage(id).boss);
export const bossStageIds = stageOrder.filter((id) => getStage(id).boss);

export type { Stage, Song, EnemyDef, IdolDef, CardDef, TalentNode, CostumeSeries };
