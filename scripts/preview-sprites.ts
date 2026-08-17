/**
 * ドット絵を 1 枚の PNG に並べて書き出す。
 *
 *   npx tsx scripts/preview-sprites.ts out.png
 *
 * 「絵が良いか」はテストでは分からないので、**目で見るための道具**を置く。
 * ブラウザを立ち上げずに済むよう、PNG は zlib で直接組み立てる
 * （canvas も画像ライブラリも要らない）。
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { buildEnemySprite, ENEMY_SPRITE_SIZE } from '../src/render/enemySprites';
import { buildSprite, SPRITE_SIZE } from '../src/render/sprites';
import { enemies, rosterIds } from '../src/data';

const SCALE = 4;
const COLS = 8;
const PAD = 2;

interface Tile {
  size: number;
  pixels: Uint8ClampedArray;
}

const tiles: Tile[] = [];
for (const id of rosterIds) {
  const px = buildSprite(id);
  if (px) tiles.push({ size: SPRITE_SIZE, pixels: px.pixels });
}
for (const id of Object.keys(enemies)) {
  const px = buildEnemySprite(id);
  if (px) tiles.push({ size: ENEMY_SPRITE_SIZE, pixels: px.pixels });
}

const CELL = SPRITE_SIZE + PAD * 2;
const rows = Math.ceil(tiles.length / COLS);
const W = COLS * CELL * SCALE;
const H = rows * CELL * SCALE;

// 背景は盤面と同じ暗い紫。透明のまま出すと、白背景で見たとき輪郭が消える
const canvas = new Uint8Array(W * H * 4);
for (let i = 0; i < W * H; i++) {
  canvas[i * 4] = 0x1a;
  canvas[i * 4 + 1] = 0x16;
  canvas[i * 4 + 2] = 0x2a;
  canvas[i * 4 + 3] = 0xff;
}

tiles.forEach((tile, index) => {
  const col = index % COLS;
  const row = Math.floor(index / COLS);
  // タイルの中央へ置く。敵は 24 ドットなのでアイドルより小さく見える
  const offX = (col * CELL + PAD + (SPRITE_SIZE - tile.size) / 2) * SCALE;
  const offY = (row * CELL + PAD + (SPRITE_SIZE - tile.size) / 2) * SCALE;
  for (let y = 0; y < tile.size; y++) {
    for (let x = 0; x < tile.size; x++) {
      const src = (y * tile.size + x) * 4;
      const a = tile.pixels[src + 3] ?? 0;
      if (a === 0) continue;
      for (let sy = 0; sy < SCALE; sy++) {
        for (let sx = 0; sx < SCALE; sx++) {
          const dst = ((offY + y * SCALE + sy) * W + offX + x * SCALE + sx) * 4;
          canvas[dst] = tile.pixels[src] ?? 0;
          canvas[dst + 1] = tile.pixels[src + 1] ?? 0;
          canvas[dst + 2] = tile.pixels[src + 2] ?? 0;
          canvas[dst + 3] = 0xff;
        }
      }
    }
  }
});

writeFileSync(process.argv[2] ?? 'sprites.png', png(canvas, W, H));
console.log(`${tiles.length} 体を ${W}x${H} で書き出しました`);

// --- PNG の組み立て ---

function png(rgba: Uint8Array, w: number, h: number): Buffer {
  // 各行の先頭にフィルタ種別（0 = なし）を置くのが PNG の生データ形式
  const raw = Buffer.alloc(h * (w * 4 + 1));
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    Buffer.from(rgba.buffer, y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // ビット深度
  ihdr[9] = 6; // カラータイプ RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function chunk(type: string, data: Buffer): Buffer {
  const out = Buffer.alloc(data.length + 12);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buf) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
