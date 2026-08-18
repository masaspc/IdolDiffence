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
}

/** 画面に同時に出す上限。埋め尽くすと盤面ではなくコメントを見てしまう */
function capFor(effects: EffectLevel): number {
  if (effects === 'minimal') return 0;
  if (effects === 'reduced') return 5;
  return 12;
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
    this.items.push({
      text: this.pick(POOL[kind]),
      lane: (jitter % 5) / 5 + 0.06,
      progress: 0,
      // 速さも少し散らす。全部同じ速さだと帯ごと動いて見える
      speed: 68 + (jitter % 7) * 7,
      strong: kind === 'special' || kind === 'win' || kind === 'boss',
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
      if (item && item.progress > width + item.text.length * 22) this.items.splice(i, 1);
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
