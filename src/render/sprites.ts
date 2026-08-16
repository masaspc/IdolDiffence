/**
 * 配置メンバーのドット絵。
 *
 * **画像ファイルを持たず、コードで組み立てる。** 理由は 2 つある。
 * - 権利のはっきりしない画像をリポジトリへ入れずに済む
 * - 1 体ずつ手で打たなくても、髪型と色の指定だけで 9 人ぶんが揃う
 *
 * > **これは原作の外見の再現ではない。** 各キャラクターの容姿は一次情報で
 * > 確認できていないため（04-content.md の未確認事項）、ここで作っているのは
 * > **盤面で誰がどこにいるかを見分けるための記号**。髪型・色は系統と役割から
 * > 決めており、公式のビジュアルが確認できたら差し替える前提で、
 * > 描画側は「スプライトがあれば使い、無ければ丸に戻す」形にしてある。
 *
 * 手描きの PNG に差し替えるときは `SpriteProvider` を実装して
 * `Renderer` に渡せばよい（アトラスを読んで frame を返すだけ）。
 */
import { getIdol } from '../data';
import type { SpriteArt } from '../data/schema/idol';
import { PixelCanvas, shade } from './pixel';
import { typeColor } from './palette';

/** 1 体あたりのドット数。セル 64px にちょうど 2 倍で収まる */
export const SPRITE_SIZE = 32;

export interface SpriteProvider {
  /** 描けるものが無ければ null。呼び出し側は丸へフォールバックする */
  get(idolId: string): CanvasImageSource | null;
}

/** コードで組み立てるドット絵。生成は 1 回だけで、以降は使い回す */
export class GeneratedSprites implements SpriteProvider {
  private readonly cache = new Map<string, CanvasImageSource | null>();

  get(idolId: string): CanvasImageSource | null {
    const cached = this.cache.get(idolId);
    if (cached !== undefined) return cached;

    const art = getIdol(idolId).art;
    const sprite = art ? build(art, typeColor(getIdol(idolId).type)) : null;
    this.cache.set(idolId, sprite);
    return sprite;
  }
}

const SKIN = '#ffd9c0';
const SKIN_SHADE = '#e8b79b';
const OUTLINE = '#1a1430';
const EYE_WHITE = '#ffffff';

/*
 * 32 ドット四方の割り付け。2 頭身にすると頭が大きく、小さくても顔が読める。
 *
 *   y 2..5   髪の頂点・アホ毛・けもの耳
 *   y 5..19  頭（顔は 12..18 だけ空ける）
 *   y 18..24 胴と腕
 *   y 23..28 スカート／ズボン
 *   y 26..31 脚と靴
 *
 * 髪は「頭の上半分に載せる」＋「横に垂らす」の 2 つに分ける。
 * 頭全体を髪で塗ると、小さい画面では顔の無い塊になってしまう。
 */
const HEAD_CY = 12;
const HEAD_RX = 7.5;
const HEAD_RY = 7;
/** 前髪の下端。ここより下は顔を出す */
const BANGS_BOTTOM = 11;

function build(art: SpriteArt, accentFallback: string): HTMLCanvasElement {
  const px = new PixelCanvas(SPRITE_SIZE, SPRITE_SIZE);
  const cx = 15.5;
  const accent = art.accent ?? accentFallback;

  drawSideHair(px, cx, art);
  drawLegs(px, cx, art);
  drawBody(px, cx, art, accent);
  drawHead(px, cx);
  drawCrown(px, cx, art, accent);
  drawFace(px, cx, art);

  px.outline(OUTLINE);
  return px.toCanvas();
}

/** 頭より後ろに回る髪。**顔と胴の中央は空ける**ので、左右の房として置く */
function drawSideHair(px: PixelCanvas, cx: number, art: SpriteArt): void {
  const dark = shade(art.hair, -0.2);

  switch (art.hairStyle) {
    case 'long':
      for (const dx of [-8, 6]) px.rect(cx + dx, 9, 3, 14, dark);
      // 毛先を少し広げる
      for (const dx of [-9, 7]) px.rect(cx + dx, 20, 3, 3, dark);
      break;
    case 'bob':
      for (const dx of [-8, 6]) px.rect(cx + dx, 9, 3, 8, dark);
      break;
    case 'twin':
      for (const dx of [-10, 8]) px.disc(cx + dx, 16, 2.5, 5, dark);
      break;
    case 'ponytail':
      px.disc(cx + 9, 17, 2.5, 6, dark);
      px.rect(cx + 6, 10, 4, 3, dark);
      break;
    default: // short / spiky は横に垂らさない
      break;
  }
}

function drawLegs(px: PixelCanvas, cx: number, art: SpriteArt): void {
  const shoe = shade(art.outfit, -0.4);
  for (const dx of [-3, 1]) {
    px.rect(cx + dx, 25, 3, 4, SKIN);
    px.rect(cx + dx, 29, 3, 2, shoe);
  }
}

function drawBody(px: PixelCanvas, cx: number, art: SpriteArt, accent: string): void {
  const light = shade(art.outfit, 0.2);

  px.trapezoid(cx, 18, 6, 4, 4, art.outfit);
  px.rect(cx - 4, 18, 3, 1, light); // 肩のハイライト。光源は左上

  if (art.body === 'skirt') {
    px.trapezoid(cx, 23, 4, 4, 7, art.outfit);
    px.rect(cx - 7, 26, 15, 1, shade(art.outfit, -0.3));
  } else {
    px.trapezoid(cx, 23, 3, 4, 4, art.outfit);
    px.rect(cx, 24, 1, 2, shade(art.outfit, -0.35)); // 脚の割れ目
  }

  // 差し色の帯。系統の色をここへ置くと、遠目でも役割が分かる
  px.rect(cx - 4, 22, 9, 1, accent);

  for (const dx of [-6, 5]) {
    px.rect(cx + dx, 19, 2, 4, art.outfit);
    px.rect(cx + dx, 23, 2, 2, SKIN); // 手
  }
}

function drawHead(px: PixelCanvas, cx: number): void {
  px.disc(cx, HEAD_CY, HEAD_RX, HEAD_RY, SKIN);
  px.rect(cx - 4, 18, 9, 1, SKIN_SHADE); // 顎の影
}

/** 前髪と、頭の上に出る飾り */
function drawCrown(px: PixelCanvas, cx: number, art: SpriteArt, accent: string): void {
  const hair = art.hair;
  const light = shade(hair, 0.28);

  // 頭の上半分だけを髪にする。輪郭は頭と同じなので、被り物ではなく髪に見える
  px.discRows(cx, HEAD_CY, HEAD_RX, HEAD_RY, hair, 0, BANGS_BOTTOM);
  // もみあげ。頬の横を 1 段だけ落として、丸刈りに見えないようにする
  for (const dx of [-7, 5]) px.rect(cx + dx, BANGS_BOTTOM + 1, 2, 2, hair);
  // つやベタ
  px.rect(cx - 5, 6, 4, 1, light);

  if (art.hairStyle === 'spiky') {
    for (const dx of [-6, -2, 2, 6]) px.rect(cx + dx, 3, 2, 3, hair);
  }
  if (art.hairStyle === 'twin') {
    for (const dx of [-9, 7]) px.rect(cx + dx, 11, 3, 2, accent);
  }
  if (art.hairStyle === 'ponytail') {
    px.rect(cx + 5, 9, 3, 2, accent);
  }
  if (art.ears) {
    // けもの耳。頭の輪郭より外へ出すと、小さくても種類が分かる
    for (const dx of [-7, 5]) {
      px.rect(cx + dx, 1, 3, 5, hair);
      px.rect(cx + dx + 1, 3, 1, 2, accent);
    }
  }
  if (art.ahoge) {
    px.rect(cx, 2, 1, 3, hair);
    px.rect(cx + 1, 1, 1, 2, hair);
  }
}

function drawFace(px: PixelCanvas, cx: number, art: SpriteArt): void {
  const eye = art.eye ?? '#3b2a4d';
  for (const dx of [-5, 2]) {
    px.rect(cx + dx, 13, 3, 3, EYE_WHITE);
    px.rect(cx + dx + 1, 13, 2, 2, eye);
    px.set(cx + dx + 1, 13, shade(eye, 0.55)); // ハイライト
  }
  px.rect(cx - 1, 17, 2, 1, SKIN_SHADE); // 口
  for (const dx of [-6, 5]) px.set(cx + dx, 16, '#ff9db8'); // 頬
}
