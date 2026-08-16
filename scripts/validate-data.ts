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
import { enemiesSchema } from '../src/data/schema/enemy';
import { idolsSchema } from '../src/data/schema/idol';

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

const enemies = enemiesSchema.safeParse(readJson('enemies.json'));
if (!enemies.success) {
  errors.push(`enemies.json:\n${formatIssues(enemies.error.issues)}`);
}

const idols = idolsSchema.safeParse(readJson('idols.json'));
if (!idols.success) {
  errors.push(`idols.json:\n${formatIssues(idols.error.issues)}`);
}

// スキーマが通ってから、参照整合性とレイアウトの不変条件を見る
if (stages.success && songs.success && enemies.success) {
  for (const [id, stage] of Object.entries(stages.data)) {
    if (!songs.data[stage.song]) {
      errors.push(`stages.json: ${id} が参照する楽曲 "${stage.song}" が songs.json にありません`);
    }
    for (const [waveIndex, wave] of stage.waves.entries()) {
      for (const [spawnIndex, spawn] of wave.spawns.entries()) {
        if (!enemies.data[spawn.enemy]) {
          errors.push(
            `stages.json: ${id}.waves[${waveIndex}].spawns[${spawnIndex}] が参照する敵 ` +
              `"${spawn.enemy}" が enemies.json にありません`,
          );
        }
      }
    }
    errors.push(...checkStageInvariants(id, stage));
  }
}

// aoe_ring なのに半径 0 だと、範囲攻撃のつもりが単体にしか当たらない
if (idols.success) {
  for (const [id, idol] of Object.entries(idols.data)) {
    if (idol.attack.kind === 'aoe_ring' && idol.attack.radius <= 0) {
      errors.push(`idols.json: ${id} は aoe_ring ですが radius が 0 です`);
    }
    if (idol.type === 'dance' && idol.attack.canHitFlying) {
      errors.push(
        `idols.json: ${id} はダンス系統ですが canHitFlying=true です。` +
          `ダンスの対空は覚醒 A でのみ獲得する設計です（04-content.md 対空のルール）`,
      );
    }
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

const count = (result: { success: boolean; data?: object }): number =>
  result.success && result.data ? Object.keys(result.data).length : 0;

console.log(
  `データ検証 OK — ステージ ${count(stages)} / 楽曲 ${count(songs)} / ` +
    `敵 ${count(enemies)} / アイドル ${count(idols)}`,
);
