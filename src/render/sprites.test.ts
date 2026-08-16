/**
 * 配置メンバーのドット絵。
 *
 * 「絵が良いか」はテストできないので、ここが見るのは
 * **誰かが必ず描かれること**と**進化前後で別の絵になること**だけ。
 * どちらも落ちると盤面が丸（フォールバック）に戻り、原因が分かりにくい。
 */
import { describe, expect, it } from 'vitest';
import { buildSprite, SPRITE_SIZE } from './sprites';
import { getIdol, rosterIds } from '../data';

/** 塗られているドットの数。空の絵を「描けた」と数えないため */
function filled(spriteId: string): number {
  const px = buildSprite(spriteId);
  if (!px) return 0;
  let count = 0;
  for (let i = 3; i < px.pixels.length; i += 4) {
    if ((px.pixels[i] ?? 0) > 0) count++;
  }
  return count;
}

function bytes(spriteId: string): string {
  return [...(buildSprite(spriteId)?.pixels ?? [])].join(',');
}

describe('ドット絵', () => {
  it('全員ぶんが描ける', () => {
    for (const id of rosterIds) {
      // 48×48 の 1 割は埋まっていないと、人型として読めない
      expect(filled(id), `${id} の絵が薄すぎる`).toBeGreaterThan(SPRITE_SIZE * SPRITE_SIZE * 0.1);
    }
  });

  it('進化後は別の絵になる', () => {
    for (const id of rosterIds) {
      if (!getIdol(id).evolution) continue;
      expect(bytes(`${id}:evolved`), `${id} の進化後が元と同じ絵`).not.toBe(bytes(id));
    }
  });

  it('進化後の絵を用意していなければ元の絵で描く（落ちない）', () => {
    // V2 は進化を持たない。それでも `:evolved` を投げられて壊れないこと
    expect(bytes('V2:evolved')).toBe(bytes('V2'));
  });

  it('絵の指定を持たない ID には null を返す（呼び出し側が丸へ落とせる）', () => {
    expect(buildSprite('')).toBeNull();
  });

  it('顔は枠からはみ出さない', () => {
    // はみ出すと `outline` が端で切れて、盤面で輪郭の無い側が出る
    for (const id of rosterIds) {
      const px = buildSprite(id);
      if (!px) continue;
      for (const x of [0, SPRITE_SIZE - 1]) {
        for (let y = 0; y < SPRITE_SIZE; y++) {
          expect(px.pixels[(y * SPRITE_SIZE + x) * 4 + 3] ?? 0, `${id} が左右の端に触れている`).toBe(
            0,
          );
        }
      }
    }
  });
});
