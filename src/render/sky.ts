/**
 * ツクヨミの空（04-content.md 4.0）。
 *
 * ## 月ではなくミラーボール
 *
 * 原作のツクヨミは、**上空に月の代わりに巨大なミラーボールが浮かぶ**。
 * 色とりどりに輝く魚群、飛行船、空を飛ぶ蒸気機関車が行き交い、
 * 海洋生物を模したホログラムが街を彩る。
 *
 * ここを普通の月にしていたのは**原作の外の空**だった。名前をいくら原作から
 * 借りても、見えている空が違えばその世界にはならない（ステージ名で一度やった
 * のと同じ失敗）。
 *
 * ## 本物の月は章が進むと昇る
 *
 * 第 1 章（ツクヨミ）の空にあるのはミラーボールだけ。第 2 章で月の都が
 * 迎えに来て、第 3 章では羽衣が織り上がる —— **章が進むほど本物の月が
 * 大きくなる**。迫る期限を言葉なしで伝える枠として使う。
 *
 * ## 時間は描画側から渡してもらう
 *
 * `Date.now()` は使えない（決定性のため eslint で禁止）し、sim 時刻に
 * 紐付けると一時停止で空まで止まる。描画ループの経過時間を受け取る。
 */
import { palette } from './palette';

/** 決定的な擬似乱数。ステージ ID から飾りの配置を決める */
function hash01(seed: string, salt: number): number {
  let h = 0x811c9dc5;
  const text = `${seed}:${salt}`;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return ((h >>> 0) % 100_000) / 100_000;
}

/**
 * ミラーボール。静的レイヤに描く（回る光だけは毎フレーム側）。
 *
 * 面の格子と、そこから漏れる光の点で「鏡の球」に見せる。
 * つるりとした円のままだと、ただの月と区別が付かない
 */
export function drawMirrorBall(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  const cx = w * 0.72;
  const cy = h * 0.17;
  const r = h * 0.11;

  // 周りへ漏れる光
  const glow = ctx.createRadialGradient(cx, cy, r * 0.6, cx, cy, r * 3.2);
  glow.addColorStop(0, 'rgba(200, 220, 255, 0.2)');
  glow.addColorStop(1, 'rgba(200, 220, 255, 0)');
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(cx, cy, r * 3.2, 0, Math.PI * 2);
  ctx.fill();

  // 球。上が明るく下が暗い
  const body = ctx.createLinearGradient(cx, cy - r, cx, cy + r);
  body.addColorStop(0, '#dfe9ff');
  body.addColorStop(1, '#7d86b8');
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();

  // 面の格子。球の内側だけに引く
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.clip();
  ctx.strokeStyle = 'rgba(30, 36, 70, 0.45)';
  ctx.lineWidth = 1;
  const rows = 7;
  for (let i = 1; i < rows; i++) {
    const y = cy - r + (2 * r * i) / rows;
    ctx.beginPath();
    ctx.moveTo(cx - r, y);
    ctx.lineTo(cx + r, y);
    ctx.stroke();
  }
  // 縦は球面に沿わせる。まっすぐだと平らな円盤に見える
  for (let i = 1; i < rows; i++) {
    const t = -1 + (2 * i) / rows;
    ctx.beginPath();
    ctx.ellipse(cx, cy, Math.abs(t) * r, r, 0, 0, Math.PI * 2);
    ctx.stroke();
    void t;
  }
  // 面のきらめき。位置は固定なので静的レイヤで足りる
  for (let i = 0; i < 10; i++) {
    const a = hash01('facet', i) * Math.PI * 2;
    const d = Math.sqrt(hash01('facet-d', i)) * r * 0.85;
    ctx.fillStyle = `rgba(255, 255, 255, ${0.25 + hash01('facet-a', i) * 0.4})`;
    ctx.fillRect(cx + Math.cos(a) * d - 2, cy + Math.sin(a) * d - 2, 4, 4);
  }
  ctx.restore();
}

/**
 * 本物の月。**第 1 章では出さない**（ツクヨミの空にあるのはミラーボール）。
 *
 * @param chapter 0 = ツクヨミ / 1 = 月の都 / 2 = 羽衣
 */
export function drawMoon(ctx: CanvasRenderingContext2D, w: number, h: number, chapter: number): void {
  if (chapter <= 0) return;
  const r = h * (chapter === 1 ? 0.085 : 0.135);
  const cx = w * 0.19;
  const cy = h * 0.13;

  const glow = ctx.createRadialGradient(cx, cy, r * 0.5, cx, cy, r * 3);
  glow.addColorStop(0, `rgba(255, 246, 214, ${chapter === 1 ? 0.14 : 0.22})`);
  glow.addColorStop(1, 'rgba(255, 246, 214, 0)');
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(cx, cy, r * 3, 0, Math.PI * 2);
  ctx.fill();

  // **盤面を白く飛ばさない。** 月は背景なので、経路や配置マスの上に
  // 乗ったときに読めなくなるほど明るくしてはいけない
  ctx.save();
  ctx.globalAlpha = 0.8;
  ctx.fillStyle = palette.moonLow;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  // 海。のっぺりした白円だと「大きいミラーボール」に見える
  ctx.fillStyle = 'rgba(120, 130, 180, 0.4)';
  for (const [dx, dy, dr] of [
    [-0.32, -0.22, 0.26],
    [0.28, 0.08, 0.2],
    [-0.1, 0.35, 0.16],
  ] as const) {
    ctx.beginPath();
    ctx.arc(cx + dx * r, cy + dy * r, dr * r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/**
 * ミラーボールが撒く光。**拍の頭でだけ**強く出す。
 *
 * ツクヨミの空にミラーボールがある以上、そこから光が降っていないと
 * ただの飾りになる。拍に乗せることで、盤面の鼓動（`drawBeatPulse`）と
 * 空がひとつの会場として繋がる。
 *
 * @param pulse 0..1。演出強度はすでに掛かっている前提
 */
export function drawBallSparkle(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  pulse: number,
): void {
  if (pulse <= 0.01) return;
  const cx = w * 0.72;
  const cy = h * 0.17;
  const r = h * 0.11;

  ctx.save();
  ctx.globalAlpha = pulse * 0.28;
  ctx.strokeStyle = '#e8f1ff';
  ctx.lineWidth = 2;
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2 + hash01('ray', i) * 0.3;
    const from = r * 1.15;
    const to = from + r * (0.6 + hash01('ray-len', i) * 1.4) * pulse;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * from, cy + Math.sin(a) * from);
    ctx.lineTo(cx + Math.cos(a) * to, cy + Math.sin(a) * to);
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * 水に覆われた会場。**盤面の読みやすさは変えない** ——
 * 背景の色と、ゆっくり広がる波紋だけを足す。
 *
 * 原作でヤチヨのライブが描かれるときの形（ステージが一面水で覆われ、
 * 観客はまるで海の中にいるよう）。
 */
export function drawWater(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  ctx.save();
  // 青を薄く重ねる。差し替えではなく重ねるのは、常夜の暗さを残すため
  ctx.fillStyle = 'rgba(40, 90, 150, 0.22)';
  ctx.fillRect(0, 0, w, h);

  // 波紋。位置は固定なので静的レイヤで足りる
  ctx.strokeStyle = 'rgba(159, 216, 255, 0.13)';
  ctx.lineWidth = 2;
  for (let i = 0; i < 7; i++) {
    const cx = w * (0.1 + hash01('ripple-x', i) * 0.8);
    const cy = h * (0.1 + hash01('ripple-y', i) * 0.8);
    for (let ring = 1; ring <= 3; ring++) {
      ctx.beginPath();
      ctx.ellipse(cx, cy, ring * 34, ring * 12, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
  ctx.restore();
}

/** 空を流れる飾り。魚群・飛行船・蒸気機関車 */
export interface Drifter {
  kind: 'fish' | 'airship' | 'train';
  /** 画面高さに対する縦位置（0..1） */
  y: number;
  speed: number;
  scale: number;
}

/** ステージごとに決まる飾りの並び。毎回同じ空になる */
export function skyDrifters(stageId: string): Drifter[] {
  const out: Drifter[] = [];
  // 魚群は多め。原作のツクヨミでいちばん目に付く飾り
  for (let i = 0; i < 3; i++) {
    out.push({
      kind: 'fish',
      y: 0.08 + hash01(stageId, i) * 0.5,
      speed: 6 + hash01(stageId, i + 40) * 8,
      scale: 0.7 + hash01(stageId, i + 80) * 0.6,
    });
  }
  out.push({
    kind: 'airship',
    y: 0.06 + hash01(stageId, 7) * 0.12,
    speed: 4 + hash01(stageId, 8) * 3,
    scale: 0.9 + hash01(stageId, 9) * 0.4,
  });
  out.push({
    kind: 'train',
    y: 0.5 + hash01(stageId, 11) * 0.3,
    speed: 11 + hash01(stageId, 12) * 6,
    scale: 0.8 + hash01(stageId, 13) * 0.4,
  });
  return out;
}

/**
 * 空の飾りを流す。**盤面より手前には出さない** ——
 * 濃く描くと敵と見間違える。ホログラムなので薄いほうが原作にも近い
 */
export function drawDrifters(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  drifters: readonly Drifter[],
  timeMs: number,
): void {
  ctx.save();
  ctx.globalAlpha = 0.3;
  const seconds = timeMs / 1000;
  for (const [index, drifter] of drifters.entries()) {
    // 画面幅 + 余白で 1 周する。左右どちらへ流れるかは個体ごと
    const span = w * 1.5;
    const dir = index % 2 === 0 ? 1 : -1;
    const raw = (seconds * drifter.speed * 8) % span;
    const x = dir > 0 ? raw - w * 0.25 : w * 1.25 - raw;
    const y = h * drifter.y;
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(dir * drifter.scale, drifter.scale);
    if (drifter.kind === 'fish') drawFishSchool(ctx, index);
    else if (drifter.kind === 'airship') drawAirship(ctx);
    else drawTrain(ctx, seconds);
    ctx.restore();
  }
  ctx.restore();
}

/** 色とりどりに輝く魚群。1 匹ずつずらして泳がせる */
function drawFishSchool(ctx: CanvasRenderingContext2D, seed: number): void {
  const colors = ['#7ee2a8', '#9fd8ff', '#ff9ad5', '#ffd54f'];
  for (let i = 0; i < 6; i++) {
    const dx = i * 26 + hash01('fish', seed * 10 + i) * 10;
    const dy = (hash01('fishy', seed * 10 + i) - 0.5) * 34;
    ctx.fillStyle = colors[(seed + i) % colors.length] ?? '#9fd8ff';
    // 胴
    ctx.beginPath();
    ctx.ellipse(dx, dy, 9, 4.5, 0, 0, Math.PI * 2);
    ctx.fill();
    // 尾
    ctx.beginPath();
    ctx.moveTo(dx - 8, dy);
    ctx.lineTo(dx - 16, dy - 5);
    ctx.lineTo(dx - 16, dy + 5);
    ctx.closePath();
    ctx.fill();
  }
}

/** 飛行船 */
function drawAirship(ctx: CanvasRenderingContext2D): void {
  ctx.fillStyle = '#c8b8f0';
  ctx.beginPath();
  ctx.ellipse(0, 0, 46, 15, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#8f7ad0';
  ctx.fillRect(-12, 13, 24, 8);
  ctx.fillStyle = '#ffe9a3';
  for (let i = -1; i <= 1; i++) ctx.fillRect(i * 8 - 2, 15, 4, 4);
  // 尾翼
  ctx.fillStyle = '#c8b8f0';
  ctx.beginPath();
  ctx.moveTo(-44, 0);
  ctx.lineTo(-58, -12);
  ctx.lineTo(-58, 12);
  ctx.closePath();
  ctx.fill();
}

/** 空を飛ぶ蒸気機関車。煙は後ろへ流す */
function drawTrain(ctx: CanvasRenderingContext2D, seconds: number): void {
  ctx.fillStyle = '#3a2f66';
  ctx.fillRect(-30, -10, 44, 18);
  ctx.fillRect(14, -16, 16, 24);
  ctx.fillStyle = '#ffd54f';
  ctx.fillRect(24, -10, 6, 6);
  // 車輪
  ctx.fillStyle = '#8f7ad0';
  for (const wx of [-22, -6, 12]) {
    ctx.beginPath();
    ctx.arc(wx, 10, 5, 0, Math.PI * 2);
    ctx.fill();
  }
  // 煙。時間でふくらませる
  ctx.fillStyle = 'rgba(220, 226, 255, 0.55)';
  for (let i = 0; i < 5; i++) {
    const t = ((seconds * 0.6 + i * 0.2) % 1);
    ctx.beginPath();
    ctx.arc(20 - i * 16 - t * 8, -22 - i * 5 - t * 6, 4 + i * 2 + t * 3, 0, Math.PI * 2);
    ctx.fill();
  }
}
