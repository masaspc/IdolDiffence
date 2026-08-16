/**
 * 配置メンバーのドット絵。
 *
 * **画像ファイルを持たず、コードで組み立てる。** 権利のはっきりしない画像を
 * リポジトリへ入れずに済み、髪型・色・モチーフの指定だけで人数ぶんが揃う。
 *
 * ## どこまでが原作で、どこからが本作の選択か
 *
 * 形（モチーフ）は**記事で確認できたものだけ**を入れている。
 *
 * | キャラ | 反映した原作の特徴 |
 * |---|---|
 * | かぐや | ストレートロング、兎モチーフの飾り、三日月の髪飾り、インナーカラー |
 * | 月見 ヤチヨ | 乙姫モチーフ、和傘、腹部のメンダコ、花魁風に肩を開けた衣装 |
 * | 酒寄 彩葉 | 狐テーマ、赤いアイシャドー、額の装飾 |
 * | 忠犬オタ公 | 犬 |
 *
 * **髪や衣装の色までは確認できていない**ので、そこは本作が選んだもの。
 * 上表に無いキャラクターは外見の情報が取れておらず、盤面で見分けるための
 * 記号として髪型と色を割り当てている（04-content.md の未確認事項）。
 * 公式のビジュアルが確認できたら差し替える。
 *
 * 手描きの PNG に差し替えるときは `SpriteProvider` を実装して `Renderer` に渡す。
 */
import { getIdol } from '../data';
import type { SpriteArt } from '../data/schema/idol';
import { PixelCanvas, shade } from './pixel';
import { typeColor } from './palette';

/** 1 体あたりのドット数。32 では兎耳や和傘を置く余白が無かった */
export const SPRITE_SIZE = 48;
/** 盤面へ貼るときの論理サイズ。セル（64px）よりわずかに大きくして存在感を出す */
export const SPRITE_DRAW_SIZE = 72;

export interface SpriteProvider {
  /** 描けるものが無ければ null。呼び出し側は丸へフォールバックする */
  get(spriteId: string): CanvasImageSource | null;
}

/**
 * コードで組み立てるドット絵。生成は 1 回だけで、以降は使い回す。
 * `spriteId` は `"V1"`、進化後なら `"V1:evolved"`。
 */
export class GeneratedSprites implements SpriteProvider {
  private readonly cache = new Map<string, CanvasImageSource | null>();

  get(spriteId: string): CanvasImageSource | null {
    const cached = this.cache.get(spriteId);
    if (cached !== undefined) return cached;

    const px = buildSprite(spriteId);
    const sprite = px ? px.toCanvas() : null;
    this.cache.set(spriteId, sprite);
    return sprite;
  }
}

/**
 * `spriteId` からドット絵を組み立てる。**canvas へは焼かない**。
 * 焼く前で止めておくと、DOM の無いところ（見た目を確かめるスクリプト・テスト）
 * からも同じ絵を取り出せる。
 *
 * @returns 絵の指定を持たないキャラなら null
 */
export function buildSprite(spriteId: string): PixelCanvas | null {
  const [idolId, variant] = spriteId.split(':');
  if (!idolId) return null;
  const def = getIdol(idolId);
  // 進化後の絵は任意。用意していなければ元の絵をそのまま使う
  const art = variant === 'evolved' ? (def.evolution?.art ?? def.art) : def.art;
  return art ? build(art, typeColor(def.type)) : null;
}

const SKIN = '#ffdcc4';
const SKIN_SHADE = '#e0ab8e';
const OUTLINE = '#181231';
const EYE_WHITE = '#fdfdff';

/*
 * 48 ドット四方の割り付け。2.2 頭身にして、小さくても顔が読めるようにする。
 *
 *   y 0..6    髪飾り・獣耳・和傘・結い上げ
 *   y 6..26   頭（前髪は 15 まで。16 から下は顔）
 *   y 25..27  首
 *   y 27..35  胴と腕
 *   y 34..40  腰まわり
 *   y 41..48  脚と靴
 *
 * 中心は 2 ドットのあいだ（23 と 24 の境目）に置く。偶数幅の絵で
 * 「中央の 1 列」を作ると、そこだけ左右のどちらかに寄ってしまうため。
 */
const CX = 23.5;
const HEAD_CY = 16;
const HEAD_RX = 11;
const HEAD_RY = 10;
/** 前髪の下端。ここより下は顔 */
const BANGS_BOTTOM = 15;
/** 肩の高さ。首を 1 ドット見せるために頭の下端より少しだけ下げる */
const SHOULDER = 27;

// 左右対称に打つ道具（PixelCanvas 側）に、この絵の中心を束ねただけの短縮形。
// 呼び出しが多いので、毎回 CX を書かずに済むようにする
const pair = (
  px: PixelCanvas,
  left: number,
  y: number,
  w: number,
  h: number,
  color: string,
): void => px.pair(CX, left, y, w, h, color);

const pairDisc = (
  px: PixelCanvas,
  left: number,
  cy: number,
  rx: number,
  ry: number,
  color: string,
): void => px.pairDisc(CX, left, cy, rx, ry, color);

const span = (px: PixelCanvas, left: number, y: number, h: number, color: string): void =>
  px.span(CX, left, y, h, color);

function build(art: SpriteArt, accentFallback: string): PixelCanvas {
  const px = new PixelCanvas(SPRITE_SIZE, SPRITE_SIZE);
  const accent = art.accent ?? accentFallback;

  drawBehind(px, art);
  drawLegs(px, art);
  drawBody(px, art, accent);
  drawHead(px);
  drawHair(px, art);
  drawFace(px, art);
  drawAccessory(px, art, accent);

  px.outline(OUTLINE);
  return px;
}

/** 体より奥に置くもの。垂らした髪 */
function drawBehind(px: PixelCanvas, art: SpriteArt): void {
  const dark = shade(art.hair, -0.22);
  const inner = art.hairInner ?? dark;

  switch (art.hairStyle) {
    case 'long':
      // ストレートロング。裾を少し広げ、内側にインナーカラーの筋を通す
      pair(px, 13, 12, 4, 22, dark);
      pair(px, 14, 28, 6, 6, dark);
      pair(px, 11, 24, 2, 10, inner);
      break;
    case 'bob':
      // 顎の高さで切り揃える。毛先を 1 段外へ跳ねさせる
      pair(px, 13, 12, 4, 14, dark);
      pair(px, 14, 24, 5, 3, dark);
      break;
    case 'twin':
      pairDisc(px, 14, 24, 4, 8, dark);
      pair(px, 15, 12, 4, 6, dark); // 結び目から房へ繋ぐ
      break;
    case 'ponytail':
      px.disc(CX + 14, 25, 3.5, 9, dark);
      px.rect(CX + 9, 13, 6, 5, dark);
      break;
    case 'updo':
      // 花魁風の結い上げ。和傘を差す場合は真上が埋まるので、横へ張り出させる
      if (art.accessory === 'umbrella') {
        pairDisc(px, 14, 13, 4, 5, dark);
      } else {
        px.disc(CX, 4, 7, 4, dark);
        pair(px, 10, 5, 3, 3, dark);
      }
      pair(px, 12, 14, 3, 10, dark); // 後れ毛
      break;
    default:
      break;
  }
}

/**
 * 和傘。原作の「常に和傘をさしている」を形で示す。
 *
 * 頭の後ろへ大きな円を置くと**光背か翼**にしか見えなかったので、
 * 肩の外へ寄せて「差している」構図にする。
 */
function drawUmbrella(px: PixelCanvas, accent: string): void {
  const rim = shade(accent, -0.4);
  const light = shade(accent, 0.3);

  px.rect(CX, 0, 1, 2, rim); // 石突き
  // 頭の真上に浅く広い笠を張る。横へずらすと三角の旗にしか見えなかった
  for (let i = 0; i < 6; i++) {
    const half = Math.round(4 + i * 2);
    px.rect(CX - half, 1 + i, half * 2 + 1, 1, i === 1 ? light : accent);
  }
  px.rect(CX - 14, 7, 29, 1, rim); // 縁
  for (const dx of [-11, -6, 0, 5, 10]) px.rect(CX + dx, 4, 1, 3, rim); // 骨
  // 柄。頭の横を通して手元まで下ろすと「差している」ことが伝わる
  px.rect(CX + 12, 7, 1, 29, rim);
  px.rect(CX + 11, 35, 3, 1, rim); // 手元
}

function drawLegs(px: PixelCanvas, art: SpriteArt): void {
  const shoe = shade(art.outfit, -0.5);
  // 脚のあいだを 2 ドット空ける。詰めると 1 本の柱に見える
  pair(px, 5, 40, 3, 6, SKIN);
  pair(px, 5, 44, 3, 1, SKIN_SHADE); // 足首の影
  pair(px, 6, 45, 5, 3, shoe);
}

function drawBody(px: PixelCanvas, art: SpriteArt, accent: string): void {
  const light = shade(art.outfit, 0.22);
  const dark = shade(art.outfit, -0.32);
  const second = art.outfit2 ?? art.outfit;

  // 首。1 ドットでも見えると、頭が胴に埋まって見えなくなる
  span(px, 2, 24, 4, SKIN);
  span(px, 2, 24, 2, SKIN_SHADE);

  px.trapezoid(CX, SHOULDER, 8, 5, 7, art.outfit);
  px.rect(CX - 5, SHOULDER, 4, 1, light); // 肩のハイライト（片側だけ。光の向きを示す）

  if (art.body === 'kimono') {
    // 着物の合わせ。斜めの線 1 本で「和」を出す
    for (let i = 0; i < 6; i++) px.rect(CX - 4 + i, 28 + i, 2, 1, second);
    span(px, 7, 34, 3, accent); // 帯
    span(px, 7, 34, 1, shade(accent, 0.3));
    px.trapezoid(CX, 37, 4, 7, 10, art.outfit);
    span(px, 11, 40, 1, dark);
  } else if (art.body === 'skirt') {
    span(px, 6, 34, 2, accent);
    px.trapezoid(CX, 36, 5, 6, 10, second);
    span(px, 11, 40, 1, dark);
  } else {
    span(px, 6, 34, 2, accent);
    px.trapezoid(CX, 36, 4, 5, 6, second);
    span(px, 1, 38, 3, dark); // 脚の割れ目
  }

  // 腕。花魁風は肩を開けるので、袖の始まりを下げて肌を見せる
  const sleeveTop = art.body === 'kimono' ? 30 : SHOULDER + 1;
  if (sleeveTop > SHOULDER + 1) pair(px, 9, SHOULDER + 1, 2, sleeveTop - SHOULDER - 1, SKIN);
  pair(px, 9, sleeveTop, 2, 35 - sleeveTop, art.outfit);
  pair(px, 9, 35, 2, 3, SKIN); // 手

  if (art.mascot) {
    // 腹部のマスコット（ヤチヨのメンダコ）。丸い胴に耳ひれを 2 枚
    px.disc(CX, 31, 3, 2.5, art.mascot);
    pair(px, 5, 29, 3, 2, art.mascot);
    pair(px, 2, 31, 1, 1, OUTLINE); // 目
  }
}

function drawHead(px: PixelCanvas): void {
  px.disc(CX, HEAD_CY, HEAD_RX, HEAD_RY, SKIN);
  span(px, 5, 24, 2, SKIN_SHADE); // 顎の影
}

/**
 * 髪。頭の上半分を塗って顔を出す。
 *
 * 前髪の下端を水平に切ると**お椀を被って見える**ので、中央で分けて
 * 左右へ払い、頬の横に一房ずつ落とす。
 */
function drawHair(px: PixelCanvas, art: SpriteArt): void {
  const hair = art.hair;
  const light = shade(hair, 0.32);
  const dark = shade(hair, -0.25);

  px.discRows(CX, HEAD_CY, HEAD_RX, HEAD_RY, hair, 0, BANGS_BOTTOM - 3);
  // 中央から左右へ払った前髪。段を付けて毛束を作る
  pair(px, 11, BANGS_BOTTOM - 2, 8, 1, hair);
  pair(px, 11, BANGS_BOTTOM - 1, 5, 1, hair);
  span(px, 2, BANGS_BOTTOM - 2, 2, hair); // 中央のひと房

  // もみあげ。頬の横を落として丸刈りに見せない
  pair(px, 11, BANGS_BOTTOM - 2, 3, 9, hair);
  pair(px, 11, BANGS_BOTTOM + 5, 1, 2, dark); // 毛先
  if (art.hairInner) pair(px, 9, BANGS_BOTTOM, 1, 7, art.hairInner);
  // つやベタ
  px.rect(CX - 8, 8, 7, 1, light);
  px.rect(CX - 9, 9, 3, 1, light);

  if (art.hairStyle === 'spiky') {
    // 頭の輪郭に沿って 1 列ずつ毛先を立てる。
    // 等間隔の房を並べると城壁の狭間に見えたので、列ごとに高さを変える
    const JAG = [1, 3, 2, 5, 3, 6, 2, 4, 6, 3, 5, 2, 4, 6, 3, 5, 2, 4, 3, 2, 4, 1];
    JAG.forEach((jag, i) => {
      const x = CX - 10.5 + i;
      const n = (x - CX) / HEAD_RX;
      if (n * n >= 1) return;
      const top = HEAD_CY - HEAD_RY * Math.sqrt(1 - n * n);
      px.rect(x, top - jag, 1, jag + 1, hair);
      px.set(x, top - jag, dark);
    });
  }
}

function drawFace(px: PixelCanvas, art: SpriteArt): void {
  const eye = art.eye ?? '#3b2a4d';

  // 白目を左右に残し、虹彩を細くする。全面を塗るとゴーグルに見える
  pair(px, 8, 17, 4, 1, OUTLINE); // まつげ
  pair(px, 8, 18, 4, 4, EYE_WHITE);
  pair(px, 7, 18, 2, 3, eye); // 虹彩
  pair(px, 7, 18, 1, 1, shade(eye, 0.65)); // ハイライト
  pair(px, 6, 20, 1, 1, shade(eye, -0.45)); // 瞳孔の影
  pair(px, 8, 22, 4, 1, shade(SKIN, -0.12)); // 下まぶた

  if (art.eyeShadow) {
    // 赤いアイシャドー（彩葉）。
    // まぶたの**上に横一文字**で置くと赤い眉に見えてしまうので、
    // 目尻へ寄せて跳ね上げる。化粧として読める形はこちら
    pair(px, 8, 17, 1, 4, art.eyeShadow);
    pair(px, 9, 16, 1, 2, art.eyeShadow);
  }

  // 眉。1 ドットでも入れると表情が出る
  pair(px, 8, 14, 3, 1, shade(art.hair, -0.3));

  span(px, 1, 24, 1, '#c4736b'); // 口
  pair(px, 10, 21, 3, 2, '#ff9db8'); // 頬
}

/** 頭の上に出るモチーフ。原作で確認できた形をここへ集める */
function drawAccessory(px: PixelCanvas, art: SpriteArt, accent: string): void {
  const hair = art.hair;
  const dark = shade(hair, -0.3);

  switch (art.accessory) {
    case 'umbrella':
      // 差している傘は体より手前。奥に置くと頭に隠れて旗のように見える
      drawUmbrella(px, accent);
      break;
    case 'rabbit':
      // 兎の耳。細長く上へ。内側に差し色を通す
      pair(px, 8, 0, 3, 9, hair);
      pair(px, 7, 2, 1, 5, accent);
      pair(px, 8, 0, 1, 3, dark);
      break;
    case 'fox':
      // 狐の耳。**下を広く**して三角を作る。上を広くすると触角に見える。
      // 段ごとに幅を変えるので pair() ではなく 1 行ずつ組む
      for (let i = 0; i < 7; i++) pair(px, 11 - (6 - i), 1 + i, i + 1, 1, hair);
      for (let i = 0; i < 4; i++) pair(px, 10 - (3 - i), 3 + i, i + 1, 1, accent);
      break;
    case 'dog':
      // 垂れ耳。頭の横から生えて、**外へ開きながら**頬の下まで垂れる。
      // まっすぐ立てると頭から離れた 2 本の棒にしか見えなかった
      for (let i = 0; i < 12; i++) {
        const left = 12 + Math.min(4, Math.round(i * 0.45));
        pair(px, left, 9 + i, 4, 1, hair);
        if (i > 1 && i < 10) pair(px, left - 1, 9 + i, 2, 1, dark);
      }
      break;
    default:
      break;
  }

  if (art.crescent) {
    // 三日月の髪飾り。円から円を引いて欠けさせる。
    // 獣耳と重ならないよう、こめかみの高さへ寄せる。
    // 頭から離すと宙に浮いた記号にしか見えないので、髪の上に載せる。
    // 欠けは**髪の色で塗り直す**。透明に抜くと頭に穴が開いて見える
    const mx = CX - 7;
    px.disc(mx, 11, 3.5, 4, accent);
    px.disc(mx + 2, 11, 3, 3.6, hair);
  }

  if (art.foreheadMark) {
    // 額の装飾（彩葉）
    span(px, 1, 12, 2, accent);
    pair(px, 2, 13, 1, 1, accent);
  }
}
