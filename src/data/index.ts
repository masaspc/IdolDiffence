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
import { stagesSchema, type Stage, type Stages } from './schema/stage';
import { songsSchema, type Song, type Songs } from './schema/song';
import { enemiesSchema, type EnemyDef, type Enemies } from './schema/enemy';
import { idolsSchema, type IdolDef, type Idols } from './schema/idol';
import { cardsSchema, type CardDef, type Cards } from './schema/card';

function load<T>(raw: unknown, parse: (raw: unknown) => T): T {
  return parse(raw);
}

export const stages: Stages = load(stagesJson, (raw) => stagesSchema.parse(raw));
export const songs: Songs = load(songsJson, (raw) => songsSchema.parse(raw));
export const enemies: Enemies = load(enemiesJson, (raw) => enemiesSchema.parse(raw));
export const idols: Idols = load(idolsJson, (raw) => idolsSchema.parse(raw));
export const cards: Cards = load(cardsJson, (raw) => cardsSchema.parse(raw));

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

export function getIdol(id: string): IdolDef {
  const idol = idols[id];
  if (!idol) throw new Error(`unknown idol: ${id}`);
  return idol;
}

/** 出撃可能なアイドル。M2 はメイン 3 人のみ */
export const rosterIds = ['V1', 'D1', 'Vi1'] as const;

/**
 * ステージの並びと解放条件。
 * 前のステージをクリアすると次が開く（06-ui-ux.md 6.5 の段階解放）。
 */
export const stageOrder = ['S1', 'S2', 'S3'] as const;

export function requiredStage(stageId: string): string | null {
  const index = stageOrder.indexOf(stageId as (typeof stageOrder)[number]);
  return index > 0 ? (stageOrder[index - 1] ?? null) : null;
}

export type { Stage, Song, EnemyDef, IdolDef, CardDef };
