/**
 * 敵のドット絵。
 *
 * ## なぜ丸をやめたか
 *
 * 敵は長いあいだ「属性の色で塗った丸」だった。丸は**役割の違いが見えない**。
 * 回復役も飛行も分裂も同じ形なので、盤面を見て「いま何が来ているか」が読めず、
 * 名前（ツキシズク・ムラクモ…）を覚えるとっかかりも無かった。
 * 数が 9 種のうちは色と大きさで足りていたが、23 種になると限界が来る。
 *
 * ## 二つの系統
 *
 * - **ノイズ**（ツユ・ハヤテ…）は抽象的な現象なので、抽象的な形で描く。
 *   露は雫、颶風は矢、鏡は六角、叢雲は雲 —— 名前がそのまま形になる
 * - **竹取物語の登場人物**は人型で描く。烏帽子と狩衣、十二単、天衣。
 *   人が来ていることが分かるだけで、ノイズとの区別が付く
 *
 * 画像ファイルは持たず、`enemies.json` の `art` からコードで組み立てる
 * （アイドルと同じ方針。`render/sprites.ts` の冒頭を参照）。
 *
 * ## 大きさ
 *
 * アイドルは全員が同じ 48 ドットだが、敵は**個体ごとに大きさが違う**
 * （ホタル 0.18 マス 〜 月の王 0.78 マス）。24 ドットで組んで、
 * 貼るときに半径から拡大する。ドット絵なので拡大は最近傍で潰れない。
 */
import { getEnemy } from '../data';
import type { EnemyArt } from '../data/schema/enemy';
import { PixelCanvas, shade } from './pixel';
import { attrColor } from './palette';
import type { SpriteProvider } from './sprites';

/** 1 体あたりのドット数。アイドル（48）の半分。敵は小さく貼られる */
export const ENEMY_SPRITE_SIZE = 24;

/**
 * 盤面へ貼るときの大きさ。**半径から決める**。
 *
 * 敵の当たり判定はもともと `radius` で決まっていて、丸もその大きさで
 * 描いていた。絵にしたときだけ別の基準で大きさを決めると、
 * 「見た目より広い／狭い範囲攻撃に巻き込まれる」ことになる
 */
export function enemyDrawSize(radius: number, cellSize: number): number {
  return radius * cellSize * 3.1;
}

const OUTLINE = '#120e26';
const SKIN = '#ffdcc4';
const SKIN_SHADE = '#d9a184';
const EYE = '#241a3d';

/** 24 ドットの中心。偶数なので .5 に来る */
const CX = 11.5;

export class GeneratedEnemySprites implements SpriteProvider {
  private readonly cache = new Map<string, CanvasImageSource | null>();

  get(spriteId: string): CanvasImageSource | null {
    const cached = this.cache.get(spriteId);
    if (cached !== undefined) return cached;
    const px = buildEnemySprite(spriteId);
    const sprite = px ? px.toCanvas() : null;
    this.cache.set(spriteId, sprite);
    return sprite;
  }
}

/**
 * 敵 ID からドット絵を組み立てる。**canvas へは焼かない**。
 * 焼く前で止めておくと、DOM の無いところからも同じ絵を取り出せる。
 *
 * @returns 絵の指定を持たない敵なら null（呼び出し側は丸へ戻す）
 */
export function buildEnemySprite(enemyId: string): PixelCanvas | null {
  const def = getEnemy(enemyId);
  if (!def.art) return null;
  const px = new PixelCanvas(ENEMY_SPRITE_SIZE, ENEMY_SPRITE_SIZE);
  const main = def.art.main ?? attrColor(def.attr);
  const sub = def.art.sub ?? shade(main, -0.35);
  const accent = def.art.accent ?? shade(main, 0.45);
  FORMS[def.art.form](px, { main, sub, accent }, def.art);
  px.outline(OUTLINE);
  return px;
}

interface Palette {
  main: string;
  sub: string;
  accent: string;
}

type Form = (px: PixelCanvas, c: Palette, art: EnemyArt) => void;

// --- ノイズ（抽象的な現象） ---

/** ツユ。まるい雫。いちばん基本の敵なので、いちばん素直な形にする */
const drop: Form = (px, c) => {
  px.disc(CX, 14, 7, 7, c.main);
  // 上へ尖らせる。丸のままだと「雫」に見えない
  px.trapezoid(CX, 3, 6, 1, 6, c.main);
  px.disc(CX - 2.5, 12, 2, 2.5, shade(c.main, 0.5));
};

/** ハヤテ。前傾した矢。速いことが形で分かるように、後ろへ尾を引く */
const gale: Form = (px, c) => {
  px.disc(CX + 2, 12, 5, 6, c.main);
  // 尾。3 本を後ろへ流す
  for (let i = 0; i < 3; i++) {
    px.rect(2, 8 + i * 4, 8 - i, 2, i === 1 ? c.accent : c.sub);
  }
  px.rect(CX + 4, 10, 3, 2, shade(c.main, 0.5));
};

/**
 * ホタル。小さい体に大きな羽。数で来るので、1 体が軽く見える形にする。
 *
 * 羽と体を**明暗で分ける**。同系色で重ねると、小さく貼ったときに
 * ただの塊になって「羽がある」ことが読めなかった
 */
const moth: Form = (px, c) => {
  const wing = shade(c.main, 0.45);
  px.pairDisc(CX, 5, 11, 5, 6, wing);
  px.pairDisc(CX, 6, 10, 2, 3, c.main); // 羽の模様
  px.disc(CX, 13, 2, 6, c.sub); // 細い胴
  px.disc(CX, 8, 2.5, 2.5, c.sub); // 頭
  px.pair(CX, 3, 3, 1, 4, c.accent); // 触角
  px.pair(CX, 1, 8, 1, 1, c.accent); // 光る目
};

/** イワクラ。角のある岩。硬さは「四角い」ことで伝える */
const rock: Form = (px, c) => {
  px.trapezoid(CX, 6, 15, 4, 9, c.main);
  px.trapezoid(CX, 6, 5, 4, 6, shade(c.main, 0.3));
  // 割れ目。のっぺりした塊にならないように
  px.rect(CX - 1, 11, 2, 8, c.sub);
  px.pair(CX, 8, 13, 2, 5, c.sub);
};

/** アマツバメ。広げた翼。飛んでいることが最優先で分かる形 */
const bird: Form = (px, c) => {
  px.pair(CX, 10, 9, 5, 2, c.main);
  px.pair(CX, 8, 11, 4, 2, c.sub);
  px.disc(CX, 12, 3.5, 5, c.main);
  px.disc(CX, 7, 2.5, 2.5, c.main);
  px.rect(CX - 0.5, 6, 2, 2, c.accent); // 嘴
  px.trapezoid(CX, 17, 4, 3, 1, c.sub); // 尾
};

/** ツキシズク。雫に月の輪。回復役なので、光っていることを見せる */
const moondrop: Form = (px, c) => {
  px.disc(CX, 14, 6, 6, c.main);
  px.trapezoid(CX, 4, 6, 1, 5, c.main);
  // 三日月。回復の出どころ
  px.disc(CX, 13, 4, 4, c.accent);
  px.disc(CX + 2, 12, 3.5, 3.5, c.main);
};

/** カガミ。六角の鏡。正面から殴ると弾かれることが読めるように、面を強く見せる */
const mirror: Form = (px, c) => {
  px.trapezoid(CX, 4, 7, 3, 8, c.sub);
  px.trapezoid(CX, 11, 8, 8, 2, c.sub);
  px.trapezoid(CX, 6, 6, 3, 6, c.main);
  px.trapezoid(CX, 12, 6, 6, 2, c.main);
  // 反射の光。斜めの筋を 2 本
  for (let i = 0; i < 5; i++) px.set(CX - 3 + i, 12 - i, c.accent);
  for (let i = 0; i < 3; i++) px.set(CX + 1 + i, 13 - i, c.accent);
};

/** ムラクモ。重なった雲。撃破で分かれることを、こぶの数で予感させる */
const cloud: Form = (px, c) => {
  px.disc(CX, 13, 9, 5, c.main);
  px.disc(CX - 4, 10, 4, 4, c.main);
  px.disc(CX + 3, 9, 5, 4.5, c.main);
  px.disc(CX - 5, 15, 3, 2.5, c.sub);
  px.disc(CX + 5, 15, 3, 2.5, c.sub);
  px.disc(CX + 2, 8, 2, 2, shade(c.main, 0.45));
};

/** トコヤミ。裾を引く闇。周りを弱らせるので、下へ滲ませる */
const shadeForm: Form = (px, c) => {
  px.disc(CX, 10, 7, 7, c.main);
  px.trapezoid(CX, 15, 8, 6, 8, c.sub);
  // 目だけが浮かぶ
  px.pair(CX, 4, 9, 2, 3, c.accent);
};

// --- 竹取物語の登場人物（人型） ---

/** 顔と首。人型に共通の土台 */
function face(px: PixelCanvas, cy: number, rx = 4, ry = 4.5): void {
  px.disc(CX, cy, rx, ry, SKIN);
  px.disc(CX, cy + ry - 1, rx - 1, 1.5, SKIN_SHADE);
  px.pair(CX, 2, cy, 1, 2, EYE);
}

/**
 * 貴公子。烏帽子と狩衣。
 *
 * 五人を色だけで塗り分ける。形まで変えると、五つの難題が
 * 「別々の敵」になってしまい、同じ役どころだと読めない
 */
const noble: Form = (px, c) => {
  // 烏帽子。まっすぐ上へ伸ばす。これがあるだけで平安の人だと分かる
  px.rect(CX - 2, 1, 5, 5, c.sub);
  px.rect(CX - 3, 5, 7, 2, c.sub);
  face(px, 10);
  // 狩衣。肩を張らせて袖を広く
  px.trapezoid(CX, 14, 9, 4, 9, c.main);
  px.pair(CX, 8, 15, 3, 6, c.accent); // 袖
  px.rect(CX - 1, 14, 3, 9, c.accent); // 前身頃の合わせ
};

/** 中臣 房子。十二単。裾を大きく広げ、正面から通さない厚みを見せる */
const lady: Form = (px, c) => {
  // 垂髪。背中へ長く落とす
  px.disc(CX, 8, 5, 5, c.sub);
  px.rect(CX - 5, 8, 11, 12, c.sub);
  face(px, 9);
  // 唐衣と裳。層を重ねて厚く
  px.trapezoid(CX, 13, 5, 4, 7, c.main);
  px.trapezoid(CX, 17, 6, 7, 9, c.accent);
  px.rect(CX - 1, 13, 3, 8, shade(c.main, -0.25));
};

/** 天人。羽衣。飛ぶので足を描かず、衣を左右へ流す */
const tennin: Form = (px, c) => {
  // 羽衣。体より奥に、大きく波打たせる
  px.pair(CX, 10, 7, 6, 3, c.accent);
  px.pair(CX, 9, 12, 5, 3, c.accent);
  px.disc(CX, 7, 4.5, 4.5, c.sub); // 結い上げた髪
  face(px, 9, 3.5, 4);
  px.trapezoid(CX, 13, 8, 3, 6, c.main);
  // 光輪。天の人であることの記号
  px.disc(CX, 4, 5, 2, shade(c.accent, 0.5));
  px.disc(CX, 4, 3, 1, c.main);
};

/**
 * 月人の兵。兜と鎧。数で来る側なので、輪郭を四角く締める。
 *
 * 兜に**三日月の前立て**を挿す。月の都から来たことが一目で分かるし、
 * 竹取物語の五人（烏帽子）とも見分けが付く
 */
const soldier: Form = (px, c) => {
  px.pair(CX, 4, 1, 2, 3, c.accent); // 三日月の前立て
  px.trapezoid(CX, 3, 5, 3, 6, c.sub); // 兜
  px.pair(CX, 6, 7, 2, 2, c.sub); // 吹返し
  face(px, 11, 3.5, 3.5);
  px.trapezoid(CX, 15, 7, 5, 7, c.main); // 胴
  px.span(CX, 5, 17, 1, c.sub); // 札の段
  px.span(CX, 6, 20, 1, c.sub);
  px.rect(CX + 5, 6, 2, 15, c.accent); // 矛の柄
  px.rect(CX + 4, 5, 4, 2, c.accent); // 穂先
};

/** 飛ぶ車。羅蓋（きぬがさ）を差した車。重く遅いので、横に広く低く取る */
const cart: Form = (px, c) => {
  // 羅蓋。上に大きく張り出す傘
  px.trapezoid(CX, 2, 5, 2, 9, c.accent);
  px.rect(CX - 0.5, 6, 2, 5, c.sub);
  // 屋形
  px.rect(CX - 7, 10, 15, 8, c.main);
  px.rect(CX - 7, 12, 15, 1, c.sub);
  // 車輪。2 つ見せて「車」だと分かるように
  px.pairDisc(CX, 6, 19, 3, 3, c.sub);
  px.pairDisc(CX, 6, 19, 1, 1, c.accent);
};

/** 不死の薬。壺。倒しても戻ってくるので、封じられた形にする */
const jar: Form = (px, c) => {
  px.disc(CX, 15, 7, 6, c.main);
  px.trapezoid(CX, 5, 5, 3, 5, c.main); // 首
  px.span(CX, 4, 3, 2, c.sub); // 蓋
  // 立ちのぼる気。薬であることの記号
  px.pair(CX, 3, 1, 1, 3, c.accent);
  px.disc(CX - 2.5, 14, 2, 2.5, shade(c.main, 0.45));
};

/** 月の王。冠と長衣。いちばん大きく描く。三日月を戴かせる */
const king: Form = (px, c) => {
  // 三日月の冠。塗った円を、ずらした円で**透明に戻して**欠けさせる
  // （alpha 0 で打てば消せる。輪郭付けも消えたドットは拾わない）
  px.disc(CX, 4, 5, 3, c.accent);
  px.disc(CX + 2.5, 3, 4, 2.5, c.accent, 0);
  px.span(CX, 5, 6, 2, c.accent);
  px.disc(CX, 8, 5.5, 5, c.sub); // 髪
  face(px, 10, 4, 4.5);
  // 長衣。裾を床まで
  px.trapezoid(CX, 14, 10, 5, 9, c.main);
  px.pair(CX, 10, 15, 3, 8, c.sub); // 袖
  px.rect(CX - 1, 14, 3, 10, c.accent);
};

const FORMS: Record<EnemyArt['form'], Form> = {
  drop,
  moondrop,
  gale,
  moth,
  rock,
  bird,
  mirror,
  cloud,
  shade: shadeForm,
  noble,
  lady,
  tennin,
  soldier,
  cart,
  jar,
  king,
};
