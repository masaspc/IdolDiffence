import { z } from 'zod';
import { attributeSchema, idolTypeSchema } from './common';

/**
 * 敵の特性（04-content.md 4.3「敵の設計意図」）。
 *
 * 各敵は「特定の強化・編成に対する問い」になっている。数値の大小だけで差をつけると
 * どれも「硬いか速いか」に収束するため、挙動そのものを変える枠をここに置く。
 */
export const enemyTraitsSchema = z.object({
  /** 周囲の敵を回復する。ツキシズク */
  healAura: z
    .object({
      radius: z.number().positive(),
      /** 最大 HP に対する毎秒の回復割合（0.03 = 3%/s） */
      percentPerSec: z.number().positive(),
    })
    .optional(),
  /** 射程内のメンバーの攻撃速度を落とす。トコヤミ */
  drainAura: z
    .object({
      radius: z.number().positive(),
      /** 攻撃速度倍率（0.75 = -25%） */
      speedMul: z.number().positive().max(1),
    })
    .optional(),
  /**
   * 正面からの単体攻撃を軽減する。カガミ。
   * **範囲攻撃には効かない**ので、「範囲で崩す」という答えが用意されている
   */
  frontShield: z.number().min(0).max(1).optional(),
  /** 撃破時に別の敵を生成する。ムラクモ */
  onDeathSpawn: z
    .object({
      enemy: z.string().min(1),
      count: z.number().int().positive(),
    })
    .optional(),
  /**
   * HP が減るごとに属性が変わる。ボス「偽アカウント」。
   *
   * 3 すくみ（02-core-battle.md 2.5）を一周させることで、
   * 「相性のいい 1 系統に寄せる」が通じない相手になる。
   * `at` は**残り HP の割合**で、高い順に並んでいなくてもよい（読み込み時に整列する）。
   */
  phases: z
    .array(
      z.object({
        /** この残 HP 割合を下回ったら切り替わる（0.66 = 残り 66%） */
        at: z.number().min(0).max(1),
        attr: attributeSchema,
      }),
    )
    .optional(),
  /**
   * 一定間隔で 1 レーンのメンバーを沈黙させる。最終ボス「強制ログアウト」。
   *
   * 沈黙中は攻撃できない。「配置を 1 レーンに固めると全部止まる」ので、
   * 分散とレーンをまたぐ射程が答えになる。
   */
  silence: z
    .object({
      /** 発動間隔（ミリ秒） */
      everyMs: z.number().positive(),
      /** 沈黙する時間（ミリ秒） */
      durationMs: z.number().positive(),
    })
    .optional(),
  /**
   * 特定の系統からの**直接攻撃**を軽減する。阿倍御主人「火鼠の裘」。
   *
   * 3 すくみ（`damage.ts`）は 1.2 / 0.9 と控えめで、
   * 「相性の悪い系統でも数を積めば通る」ようにしてある。ここはその逆で、
   * **その系統では通らない**を作るための枠。数を積んでも答えにならない。
   *
   * **Echo（継続ダメージ）は通る。** Echo は付けた瞬間に毎秒ダメージが確定し、
   * 敵に焼き付くので、系統を持たない。「焼けないなら燻す」が答えになっている ——
   * 軽減を全経路に掛けると、その系統を編成から外す以外の答えが無くなる
   */
  typeGuard: z
    .object({
      type: idolTypeSchema,
      /** 軽減率（0.8 = ダメージ 20% になる）。1 は完全無効 */
      reduction: z.number().min(0).max(1),
    })
    .optional(),
  /**
   * HP が減ると速くなる。石上麻呂（燕の子安貝を取ろうとして落ちる）。
   *
   * 「削りかけの敵を放置する」を罰する。硬い敵を全員で削るのではなく、
   * **1 体ずつ確実に落とす**順番が要る相手になる
   */
  enrage: z
    .object({
      /** この残 HP 割合を下回ると発動する */
      at: z.number().min(0).max(1),
      /** 移動速度の倍率 */
      speedMul: z.number().positive(),
    })
    .optional(),
  /**
   * 倒しても蘇る。不死の薬。
   *
   * **瞬間火力への問い。** 必殺や 1 回のバーストで溶かしても戻ってくるので、
   * 「盤面が敵を出し続ける時間ぶん削り続けられるか」を聞く。
   * 蘇った回は撃破に数えず、声援も分裂も起きない（倒せていないので）
   */
  revive: z
    .object({
      /** 蘇ったときの HP（最大 HP に対する割合） */
      hpRatio: z.number().positive().max(1),
      /** 蘇れる回数 */
      times: z.number().int().positive().default(1),
    })
    .optional(),
  /**
   * 一定量を吸収するバリア。月の都の門番（第 3 章）。
   *
   * **削りっぱなしを罰する。** 吸収量を使い切る前に手を止めると、
   * `regenAfterMs` 秒後に満タンへ戻る。少しずつ削る盤面では永久に抜けない。
   * 「一点に集めて一気に割る」が答えになる。
   *
   * HP とは別枠で、バリアがある間はダメージが HP へ通らない
   */
  barrier: z
    .object({
      /** 吸収量（最大 HP に対する割合） */
      ratio: z.number().positive(),
      /** 最後に削られてから、この時間が経つと満タンへ戻る */
      regenAfterMs: z.number().positive(),
    })
    .optional(),
  /**
   * 別の敵が近くにいるあいだ、ダメージを軽減する。羽衣を織る者と天女。
   *
   * **狙う順番への問い。** 前から順に殴ると硬い方を先に削ってしまい、
   * ずっと軽減が乗ったままになる。守っている側を先に落とす必要がある。
   *
   * 「先頭を狙う」「HP が高い方を狙う」というターゲティングの既定が
   * そのまま裏目になる、初めての相手
   */
  link: z
    .object({
      /** 守り手の敵 ID */
      guardian: z.string().min(1),
      /** この距離内に守り手がいれば成立する（マス） */
      radius: z.number().positive(),
      /** 軽減率（0.8 = ダメージ 20% になる） */
      reduction: z.number().min(0).max(1),
    })
    .optional(),
  /**
   * 状態異常の耐性（02-core-battle.md 2.8）。効果時間に `1 - resist` を掛ける。
   * `1` は完全無効。
   *
   * **ボスには必ず要る。** 乃依（Vi2）は 1.5 秒間隔で 2 秒の魅了を撒くので、
   * 耐性が無いとボスは永久に足を止められ、フェーズ変化も沈黙も出番が無くなる。
   * 「HP の大きい置物」になってしまい、ボスを置いた意味が消える
   */
  resist: z
    .object({
      stun: z.number().min(0).max(1).default(0),
      charm: z.number().min(0).max(1).default(0),
      slow: z.number().min(0).max(1).default(0),
    })
    .optional(),
  /** ボスとして扱う。HP バーの出し方と撃破演出が変わる */
  boss: z.boolean().default(false),
});

/**
 * 敵の見た目（`render/enemySprites.ts`）。
 *
 * 元は全員が「属性の色の丸」だった。丸は**役割の違いが見えない** ——
 * 回復役も飛行も分裂も同じ形なので、盤面を見て「何が来ているか」が読めず、
 * 名前を覚えるとっかかりも無かった。
 *
 * 画像は持たず、`form` と色の指定からコードで組み立てる（アイドルと同じ方針）。
 * 指定が無ければ丸へ戻るので、絵を欠いても盤面は成立する
 */
export const enemyArtSchema = z.object({
  /** 組み立て方。ノイズは抽象的な形、竹取物語の登場人物は人型 */
  form: z.enum([
    'drop',
    'moondrop',
    'gale',
    'moth',
    'rock',
    'bird',
    'mirror',
    'cloud',
    'shade',
    'noble',
    'lady',
    'tennin',
    'soldier',
    'cart',
    'jar',
    'king',
  ]),
  /** 主色。省略すると属性の色を使う */
  main: z.string().optional(),
  /** 副色（衣・内側） */
  sub: z.string().optional(),
  /** 差し色（冠・持ち物） */
  accent: z.string().optional(),
});

export type EnemyArt = z.infer<typeof enemyArtSchema>;

export const enemySchema = z.object({
  name: z.string().min(1),
  attr: attributeSchema,
  hp: z.number().positive(),
  def: z.number().nonnegative(),
  /** 移動速度（マス／秒） */
  speed: z.number().positive(),
  /** センターステージ到達時に減る観客ゲージ */
  leak: z.number().positive(),
  /** 撃破時に得られる声援 */
  bounty: z.number().nonnegative(),
  /** 飛行。経路を無視して直線でゴールへ向かう */
  flying: z.boolean().default(false),
  /** 描画半径（マス単位）。ドット絵の大きさもここから決まる */
  radius: z.number().positive().default(0.3),
  art: enemyArtSchema.optional(),
  traits: enemyTraitsSchema.default({}),
});

export const enemiesSchema = z.record(z.string(), enemySchema);

export type EnemyTraits = z.infer<typeof enemyTraitsSchema>;
export type EnemyDef = z.infer<typeof enemySchema>;
export type Enemies = z.infer<typeof enemiesSchema>;
