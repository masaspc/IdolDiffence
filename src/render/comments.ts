/**
 * 配信コメント。**ツクヨミのライブは配信で、視聴者がいる。**
 *
 * ## なぜ要るのか
 *
 * 原作の地の言葉は配信文化（ライバー・スパチャ・切り抜き・同時接続）で、
 * かぐやたちのライブには**画面の向こうの観客**がいる。本作の「観客」は
 * ゲージの数字でしかなかった —— 撃破や月華に反応してコメントが流れると、
 * 「守っているのはライブ配信だ」が画面から分かる。
 *
 * ## 情報ではなく空気
 *
 * コメントはゲームの状態を**伝えない**（それは HUD の仕事）。だから
 * - 盤面の上端の帯だけを流れ、ユニットや敵の判読を妨げない
 * - 演出「控えめ」では数を絞り、「最小」では出さない
 * - 読めなくても困らない文言にする（数値や指示を書かない）
 *
 * ## 乱数は使わない
 *
 * `Math.random()` は禁止（ESLint）。押された回数から決定的に選ぶ。
 * コメントは sim の外なので決定性の実害は無いが、例外を作らないのは
 * SE と同じ理由 —— 「ここだけは良い」が増えていくから。
 *
 * ## 文言は原作の語彙から
 *
 * 「かぐやっほ～！」（かぐやの挨拶）と「ヤオヨロー！」（ヤチヨの挨拶）は
 * 出典で確認済みの canon（04-content.md 出典表）。残りは配信で普通に
 * 流れる言葉だけを使い、キャラクターや固有名詞を作り足さない。
 *
 * ## スパチャ
 *
 * スパチャも原作の地の言葉（M5-3）。月華と完走の盛り上がりでは、
 * コメントを**色付きの角丸カード + 金額**で描く —— 配信アプリの画面で
 * 熱が金額になって流れる、あの瞬間の再現。金額と色帯は押された回数から
 * 決定的に選ぶ（表示だけの飾りで、ゲームの資金とは無関係）。
 * ボスの登場は strong だがスパチャにしない —— 視聴者が金を投げる場面ではない。
 */
import type { EffectLevel } from '../meta/settings';

export type CommentKind =
  /** ライブ開始直後のあいさつ */
  | 'greeting'
  | 'kill'
  | 'special'
  | 'boss'
  | 'phase'
  | 'leak'
  | 'perfect'
  /** サビに入った */
  | 'chorus'
  | 'solo'
  | 'win'
  | 'lose';

/**
 * 文言。**指示や数値を書かない**（読めなくても困らないのが条件）。
 * 「かぐやっほ～！」「ヤオヨロー！」だけが canon の挨拶で、他は一般の配信語
 */
const POOL: Record<CommentKind, readonly string[]> = {
  greeting: [
    'かぐやっほ～！',
    'ヤオヨロー！',
    '初見です',
    'おじゃまします',
    '待ってた',
    'こんやちよ～',
  ],
  kill: ['ナイス！', 'うおおお', '8888', 'いいぞ～', 'つよい', '今のすごくない？'],
  special: ['月華きた！！', 'うおおおおおお', '画面が眩しい', 'スパチャ投げた', 'ここ好き'],
  boss: ['え、でかくない…？', '来たな……', 'みんな集中！', '空気変わった'],
  phase: ['色変わった！？', 'まだ何かあるの', 'ここからが本番か'],
  leak: ['あっ', '今の抜けたって', '守って～！'],
  perfect: ['コール完璧！', '一体感すご', 'ぴったりだった'],
  chorus: ['サビきた！', 'ここで跳ぶぞ！', '手拍子～！'],
  solo: ['ソロきた…', '聞き惚れる', 'ここの見せ場すき'],
  win: ['完走おつ！', '8888888888', '切り抜き確定', '神ライブだった', 'アーカイブ残して'],
  lose: ['また来るよ', '次は勝てる', 'おつかれさま…'],
};

/** 同じ種類を続けて出さない最短間隔（ms）。撃破は 1 ライブで数百回起きる */
const MIN_GAP_MS: Record<CommentKind, number> = {
  greeting: 400,
  kill: 1100,
  special: 300,
  boss: 300,
  phase: 300,
  leak: 700,
  perfect: 300,
  chorus: 300,
  solo: 300,
  win: 200,
  lose: 200,
};

export interface ActiveComment {
  text: string;
  /** 流れる帯の中の縦位置（0..1） */
  lane: number;
  /** 右端からの進み（px）。draw 側で幅から引く */
  progress: number;
  /** px/秒 */
  speed: number;
  /** 強調（月華・勝利など）。少し大きく明るく描く */
  strong: boolean;
  /** スパチャとして描く（角丸カード + 金額）。金額は表示だけの飾り */
  superchat: { amount: string; tier: number } | null;
}

/**
 * スパチャの金額段階。**低い順**。色は配信アプリの通例（青→緑→黄→橙→赤）に
 * 寄せるが、実在サービスの正確な色・金額区分の複製はしない。
 * 文字色は段階ごとに持つ —— 明るい帯（緑・黄・橙）に白文字を載せると
 * コントラストが 2〜3:1 まで落ちて金額が読めない
 */
export const SUPERCHAT_TIERS: readonly { amount: string; color: string; text: string }[] = [
  { amount: '¥200', color: '#2f6ac2', text: '#ffffff' },
  { amount: '¥500', color: '#2f9e6e', text: '#101026' },
  { amount: '¥1,000', color: '#d8a13d', text: '#101026' },
  { amount: '¥5,000', color: '#d8663d', text: '#101026' },
  { amount: '¥10,000', color: '#c93a5b', text: '#ffffff' },
];

/** 画面に同時に出す上限。埋め尽くすと盤面ではなくコメントを見てしまう */
function capFor(effects: EffectLevel): number {
  if (effects === 'minimal') return 0;
  if (effects === 'reduced') return 5;
  return 12;
}

/**
 * 結果画面の先頭に出すスパチャ。完走の熱はここで金額になる ——
 * `win` のコメントはバトル中には流れない（決着で描画ループが止まる）ので、
 * ストリームの側ではなく結果画面に置く。
 */
export function resultSuperchat(seed: number): { amount: string; color: string; text: string } {
  const index = ((seed * 2246822519) >>> 0) % SUPERCHAT_TIERS.length;
  return SUPERCHAT_TIERS[index] ?? { amount: '¥200', color: '#2f6ac2', text: '#ffffff' };
}

/**
 * 結果画面に出す視聴者コメント。
 *
 * 完走・中断の瞬間に流すのは**構造的に無理**がある —— 決着のフレームで
 * 描画ループは止まる（結果画面を 60Hz で再描画し続けないため）ので、
 * 流し始めたコメントは誰にも見えない。動かして見せる代わりに、
 * **配信終了後のコメント欄**として結果画面へ静止して並べる。
 *
 * @param seed そのライブの数字（撃破数など）。周回ごとに並びが変わる
 */
export function resultComments(won: boolean, seed: number): string[] {
  const pool = won ? POOL.win : POOL.lose;
  const out: string[] = [];
  let cursor = (seed * 2654435761) >>> 0;
  while (out.length < 3 && out.length < pool.length) {
    cursor = (Math.imul(cursor, 1664525) + 1013904223) >>> 0;
    const text = pool[cursor % pool.length];
    if (text !== undefined && !out.includes(text)) out.push(text);
  }
  return out;
}

export class CommentStream {
  private readonly items: ActiveComment[] = [];
  private counter = 0;
  private readonly lastAt = new Map<CommentKind, number>();
  private nowMs = 0;

  /** 決定的な選択。押された回数から散らす */
  private pick(list: readonly string[]): string {
    const index = ((this.counter * 2654435761) >>> 0) % list.length;
    return list[index] ?? list[0] ?? '';
  }

  push(kind: CommentKind, effects: EffectLevel): void {
    if (effects === 'minimal') return;
    const last = this.lastAt.get(kind);
    if (last !== undefined && this.nowMs - last < MIN_GAP_MS[kind]) return;
    if (this.items.length >= capFor(effects)) return;
    this.lastAt.set(kind, this.nowMs);

    this.counter += 1;
    const jitter = ((this.counter * 40503) >>> 0) % 1000;
    // 月華と完走だけスパチャにする。ボスの登場は視聴者が金を投げる場面ではない
    const tier =
      kind === 'special' || kind === 'win'
        ? ((this.counter * 2246822519) >>> 0) % SUPERCHAT_TIERS.length
        : -1;
    const chosen = tier >= 0 ? SUPERCHAT_TIERS[tier] : undefined;
    this.items.push({
      text: this.pick(POOL[kind]),
      lane: (jitter % 5) / 5 + 0.06,
      progress: 0,
      // 速さも少し散らす。全部同じ速さだと帯ごと動いて見える
      speed: 68 + (jitter % 7) * 7,
      strong: kind === 'special' || kind === 'win' || kind === 'boss',
      superchat: chosen ? { amount: chosen.amount, tier } : null,
    });
  }

  /** 実時間で進める。ポーズでもコメントは流れ切ってよい（空の飾りと同じ扱い） */
  advance(deltaMs: number): void {
    this.nowMs += deltaMs;
    for (const item of this.items) {
      item.progress += (item.speed * deltaMs) / 1000;
    }
  }

  /** 画面幅を渡して、流れ切ったものを捨てる。draw と分けてテストできるように */
  prune(width: number): void {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const item = this.items[i];
      // スパチャは金額とカードの余白ぶん長い。捨てるのが早いと右端で消える
      const extra = item?.superchat ? (item.superchat.amount.length + 3) * 22 : 0;
      if (item && item.progress > width + item.text.length * 22 + extra) this.items.splice(i, 1);
    }
  }

  get active(): readonly ActiveComment[] {
    return this.items;
  }

  /**
   * 上端の帯へ右→左に流す。
   *
   * @param top HUD の下端（この下から帯が始まる）
   * @param bandHeight 帯の高さ。盤面の判読を妨げないよう上端だけ
   */
  draw(
    ctx: CanvasRenderingContext2D,
    width: number,
    top: number,
    bandHeight: number,
  ): void {
    ctx.save();
    ctx.textBaseline = 'top';
    for (const item of this.items) {
      const x = width - item.progress;
      const y = top + item.lane * bandHeight;
      ctx.font = item.strong
        ? 'bold 15px "Hiragino Sans", "Noto Sans JP", sans-serif'
        : '13px "Hiragino Sans", "Noto Sans JP", sans-serif';

      if (item.superchat) {
        // スパチャは色付きの角丸カード。金額 + 本文を 1 枚に載せる
        const label = `${item.superchat.amount}  ${item.text}`;
        const w = ctx.measureText(label).width + 20;
        const tier = SUPERCHAT_TIERS[item.superchat.tier];
        ctx.globalAlpha = 0.92;
        ctx.fillStyle = tier?.color ?? '#2f6ac2';
        ctx.beginPath();
        ctx.roundRect(x - 10, y - 5, w, 26, 8);
        ctx.fill();
        ctx.fillStyle = tier?.text ?? '#ffffff';
        ctx.fillText(label, x, y);
        continue;
      }

      // 半透明の白 + 細い縁。配信のコメントらしく、背景より前・情報より後ろ
      ctx.globalAlpha = item.strong ? 0.9 : 0.72;
      ctx.strokeStyle = 'rgba(10, 8, 26, 0.8)';
      ctx.lineWidth = 3;
      ctx.strokeText(item.text, x, y);
      ctx.fillStyle = item.strong ? '#ffd54f' : '#eae6ff';
      ctx.fillText(item.text, x, y);
    }
    ctx.restore();
  }
}
