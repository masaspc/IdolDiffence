/**
 * ゲームデータのビルド時検証。
 *
 * 実行時ではなくここで落とすことで、壊れたデータが公開されるのを防ぐ。
 * CI とデプロイワークフローの両方から呼ぶ（docs/design/05-architecture.md 5.6 / 5.11）。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { stagesSchema, checkStageInvariants } from '../src/data/schema/stage';
import { songsSchema } from '../src/data/schema/song';

const here = dirname(fileURLToPath(import.meta.url));
const jsonDir = join(here, '..', 'src', 'data', 'json');

const readJson = (file: string): unknown =>
  JSON.parse(readFileSync(join(jsonDir, file), 'utf8')) as unknown;

const errors: string[] = [];

const songs = songsSchema.safeParse(readJson('songs.json'));
if (!songs.success) {
  errors.push(`songs.json:\n${formatIssues(songs.error.issues)}`);
}

const stages = stagesSchema.safeParse(readJson('stages.json'));
if (!stages.success) {
  errors.push(`stages.json:\n${formatIssues(stages.error.issues)}`);
}

// スキーマが通ってから、参照整合性とレイアウトの不変条件を見る
if (stages.success && songs.success) {
  for (const [id, stage] of Object.entries(stages.data)) {
    if (!songs.data[stage.song]) {
      errors.push(`stages.json: ${id} が参照する楽曲 "${stage.song}" が songs.json にありません`);
    }
    errors.push(...checkStageInvariants(id, stage));
  }
}

function formatIssues(issues: { path: PropertyKey[]; message: string }[]): string {
  return issues.map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`).join('\n');
}

if (errors.length > 0) {
  console.error('データ検証に失敗しました:\n');
  for (const error of errors) console.error(error);
  process.exit(1);
}

const stageCount = stages.success ? Object.keys(stages.data).length : 0;
const songCount = songs.success ? Object.keys(songs.data).length : 0;
console.log(`データ検証 OK — ステージ ${stageCount} 件 / 楽曲 ${songCount} 件`);
