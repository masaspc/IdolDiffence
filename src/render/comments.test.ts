/**
 * 配信コメント（`comments.ts`）。
 *
 * **見張るのは「空気であって邪魔ではない」こと。** 撃破は 1 ライブで数百回
 * 起きるので、間引きと上限が崩れると画面がコメントで埋まり、
 * 盤面ではなくコメントを見るゲームになる。
 */
import { describe, expect, it } from 'vitest';
import { CommentStream, resultComments, resultSuperchat, SUPERCHAT_TIERS } from './comments';

describe('間引きと上限', () => {
  it('同じ種類は最短間隔を空ける（撃破の連打で埋まらない）', () => {
    const stream = new CommentStream();
    for (let i = 0; i < 20; i++) stream.push('kill', 'full');
    expect(stream.active.length).toBe(1);
    // 時間が経てばまた出る
    stream.advance(1200);
    stream.push('kill', 'full');
    expect(stream.active.length).toBe(2);
  });

  it('同時に出る数に上限がある', () => {
    const stream = new CommentStream();
    const kinds = ['greeting', 'kill', 'special', 'boss', 'phase', 'leak', 'perfect', 'chorus', 'solo', 'win', 'lose'] as const;
    for (let round = 0; round < 8; round++) {
      for (const kind of kinds) stream.push(kind, 'full');
      stream.advance(2000);
    }
    expect(stream.active.length).toBeLessThanOrEqual(12);
  });

  it('演出「控えめ」では数を絞り、「最小」では出ない', () => {
    const reduced = new CommentStream();
    const minimal = new CommentStream();
    const kinds = ['greeting', 'kill', 'special', 'boss', 'phase', 'leak', 'perfect'] as const;
    for (const kind of kinds) {
      reduced.push(kind, 'reduced');
      minimal.push(kind, 'minimal');
    }
    expect(reduced.active.length).toBeLessThanOrEqual(5);
    expect(minimal.active.length).toBe(0);
  });
});

describe('決定性と文言', () => {
  it('同じ順で押せば同じコメントが出る（乱数を使わない）', () => {
    const run = (): string[] => {
      const stream = new CommentStream();
      for (const kind of ['greeting', 'special', 'boss'] as const) {
        stream.push(kind, 'full');
        stream.advance(500);
      }
      return stream.active.map((c) => c.text);
    };
    expect(run()).toEqual(run());
  });

  it('canon の挨拶が入っている', () => {
    // かぐやっほ～！（かぐや）とヤオヨロー！（ヤチヨ）は出典で確認済みの挨拶。
    // ここが消えると「一般の配信」になってしまう
    const stream = new CommentStream();
    for (let i = 0; i < 12; i++) {
      stream.push('greeting', 'full');
      stream.advance(500);
    }
    const texts = stream.active.map((c) => c.text).join('/');
    expect(texts.includes('かぐやっほ') || texts.includes('ヤオヨロー')).toBe(true);
  });
});

describe('スパチャ', () => {
  it('月華と完走はスパチャ、撃破やボスはただのコメント', () => {
    // スパチャは「熱が金額になる」場面だけ。ボスの登場は視聴者が金を投げる場面ではない
    const stream = new CommentStream();
    stream.push('special', 'full');
    stream.advance(500);
    stream.push('win', 'full');
    stream.advance(500);
    stream.push('kill', 'full');
    stream.advance(500);
    stream.push('boss', 'full');
    const [special, win, kill, boss] = stream.active;
    expect(special?.superchat).not.toBeNull();
    expect(win?.superchat).not.toBeNull();
    expect(kill?.superchat).toBeNull();
    expect(boss?.superchat).toBeNull();
  });

  it('金額と色帯は決定的で、段階の表から出る', () => {
    const run = (): (string | undefined)[] => {
      const stream = new CommentStream();
      for (let i = 0; i < 4; i++) {
        stream.push('special', 'full');
        stream.advance(500);
      }
      return stream.active.map((c) => c.superchat?.amount);
    };
    const amounts = run();
    expect(run()).toEqual(amounts);
    const known = new Set(SUPERCHAT_TIERS.map((t) => t.amount));
    for (const amount of amounts) {
      expect(amount).toBeDefined();
      expect(known.has(amount ?? '')).toBe(true);
    }
  });

  it('スパチャもカードぶん流し切ってから捨てる', () => {
    const stream = new CommentStream();
    stream.push('special', 'full');
    const item = stream.active[0];
    expect(item).toBeDefined();
    // 本文だけなら捨てられる位置でも、カードの余白ぶんはまだ残る
    if (item) item.progress = 800 + item.text.length * 22 + 10;
    stream.prune(800);
    expect(stream.active.length).toBe(1);
  });
});

describe('流れる', () => {
  it('時間で右から左へ進み、流れ切ったら消える', () => {
    const stream = new CommentStream();
    stream.push('kill', 'full');
    const before = stream.active[0]?.progress ?? 0;
    stream.advance(1000);
    const after = stream.active[0]?.progress ?? 0;
    expect(after).toBeGreaterThan(before);

    // 十分に流したら捨てられる
    stream.advance(120_000);
    stream.prune(800);
    expect(stream.active.length).toBe(0);
  });
});

describe('結果画面のコメント欄', () => {
  it('3 件・重複なし・決定的', () => {
    // 決着の瞬間に流すのは無理がある（描画ループが止まる）ので、
    // 結果画面に静止して並べる。同じライブなら同じ並びになる
    const a = resultComments(true, 144);
    expect(a).toHaveLength(3);
    expect(new Set(a).size).toBe(3);
    expect(resultComments(true, 144)).toEqual(a);
  });

  it('勝ち負けと周回で文言が変わる', () => {
    expect(resultComments(true, 10)).not.toEqual(resultComments(false, 10));
    expect(resultComments(true, 10)).not.toEqual(resultComments(true, 11));
  });

  it('結果画面のスパチャは決定的で、段階の表から出る', () => {
    // win のコメントはバトル中に流れない（決着で描画ループが止まる）ので、
    // 完走スパチャは結果画面に置く。同じライブなら同じ金額
    expect(resultSuperchat(144)).toEqual(resultSuperchat(144));
    const known = new Set(SUPERCHAT_TIERS.map((t) => t.amount));
    for (const seed of [0, 1, 7, 144, 999]) {
      expect(known.has(resultSuperchat(seed).amount)).toBe(true);
    }
  });
});
