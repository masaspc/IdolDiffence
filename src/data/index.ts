/**
 * 静的データのロード。
 *
 * JSON は `import` でバンドルに含める。GitHub Pages はサブパス配信なので
 * `fetch('/data/...')` は 404 になる（docs/design/05-architecture.md 5.11）。
 *
 * 検証は **ビルド時** に `npm run validate:data` で行い、
 * 実行時は開発モードのみパースする。本番は素通しでゼロコスト。
 */
import stagesJson from './json/stages.json';
import songsJson from './json/songs.json';
import enemiesJson from './json/enemies.json';
import idolsJson from './json/idols.json';
import { stagesSchema, type Stage, type Stages } from './schema/stage';
import { songsSchema, type Song, type Songs } from './schema/song';
import { enemiesSchema, type EnemyDef, type Enemies } from './schema/enemy';
import { idolsSchema, type IdolDef, type Idols } from './schema/idol';

// Vite 外（tsx でのスクリプト実行、ヘッドレスのシミュレータ）では
// import.meta.env 自体が存在しない。その場合も検証する側に倒す。
const shouldValidate: boolean = import.meta.env?.DEV ?? true;

function load<T>(raw: unknown, parse: (raw: unknown) => T): T {
  return shouldValidate ? parse(raw) : (raw as T);
}

export const stages: Stages = load(stagesJson, (raw) => stagesSchema.parse(raw));
export const songs: Songs = load(songsJson, (raw) => songsSchema.parse(raw));
export const enemies: Enemies = load(enemiesJson, (raw) => enemiesSchema.parse(raw));
export const idols: Idols = load(idolsJson, (raw) => idolsSchema.parse(raw));

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

/** 出撃可能なアイドル。M1 はメイン 3 人のみ */
export const rosterIds = ['V1', 'D1', 'Vi1'] as const;

export type { Stage, Song, EnemyDef, IdolDef };
