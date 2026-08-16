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
import { stagesSchema, type Stage, type Stages } from './schema/stage';
import { songsSchema, type Song, type Songs } from './schema/song';

function load<T>(raw: unknown, parse: (raw: unknown) => T): T {
  if (import.meta.env.DEV) return parse(raw);
  return raw as T;
}

export const stages: Stages = load(stagesJson, (raw) => stagesSchema.parse(raw));
export const songs: Songs = load(songsJson, (raw) => songsSchema.parse(raw));

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

export type { Stage, Song };
