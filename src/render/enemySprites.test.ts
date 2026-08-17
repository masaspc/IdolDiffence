/**
 * 敵のドット絵。
 *
 * 「絵が良いか」はテストできないので、ここが見るのは
 * **全員が必ず描かれること**と、**盤面で見分けが付くこと**。
 * どちらも落ちると敵が丸（フォールバック）へ戻り、
 * 「回復役も飛行も分裂も同じ形」という元の問題がそのまま返ってくる。
 */
import { describe, expect, it } from 'vitest';
import { buildEnemySprite, enemyDrawSize, ENEMY_SPRITE_SIZE } from './enemySprites';
import { enemies, getEnemy } from '../data';

const enemyIds = Object.keys(enemies);

function pixels(enemyId: string): Uint8ClampedArray {
  const px = buildEnemySprite(enemyId);
  if (!px) throw new Error(`${enemyId} の絵が無い`);
  return px.pixels;
}

/** 塗られているドットの数。空の絵を「描けた」と数えないため */
function filled(enemyId: string): number {
  let count = 0;
  const data = pixels(enemyId);
  for (let i = 3; i < data.length; i += 4) {
    if ((data[i] ?? 0) > 0) count++;
  }
  return count;
}

describe('敵のドット絵', () => {
  it('全員ぶんが描ける（丸へ落ちる敵がいない）', () => {
    // 体数そのものは固定しない —— 敵を足すたびにここを書き直す羽目になる。
    // 見たいのは「**足した敵に絵を付け忘れていない**」ことだけ
    expect(enemyIds.length).toBeGreaterThan(20);
    for (const id of enemyIds) {
      expect(buildEnemySprite(id), `${id} に art が無い`).not.toBeNull();
    }
  });

  it('どれも読める濃さがある', () => {
    for (const id of enemyIds) {
      // 24×24 の 1 割。これを下回ると盤面では点にしか見えない
      expect(filled(id), `${id} の絵が薄すぎる`).toBeGreaterThan(
        ENEMY_SPRITE_SIZE * ENEMY_SPRITE_SIZE * 0.1,
      );
    }
  });

  it('全員ちがう絵になる（色だけ同じ・形だけ同じでも別物）', () => {
    // 五人の貴公子は形を共有しているので、**色で分かれている**ことの検査でもある
    const seen = new Map<string, string>();
    for (const id of enemyIds) {
      const key = [...pixels(id)].join(',');
      const twin = seen.get(key);
      expect(twin, `${id} と ${twin} が同じ絵`).toBeUndefined();
      seen.set(key, id);
    }
  });

  it('枠からはみ出さない', () => {
    // はみ出すと `outline` が端で切れて、輪郭の無い側が盤面に出る
    for (const id of enemyIds) {
      const data = pixels(id);
      for (const x of [0, ENEMY_SPRITE_SIZE - 1]) {
        for (let y = 0; y < ENEMY_SPRITE_SIZE; y++) {
          expect(
            data[(y * ENEMY_SPRITE_SIZE + x) * 4 + 3] ?? 0,
            `${id} が左右の端に触れている`,
          ).toBe(0);
        }
      }
    }
  });

  it('絵の指定を持たない敵には null を返す（呼び出し側が丸へ落とせる）', () => {
    // 定義そのものを差し替えて、フォールバックの経路が生きていることを見る
    const original = getEnemy('e_walker').art;
    try {
      delete (getEnemy('e_walker') as { art?: unknown }).art;
      expect(buildEnemySprite('e_walker')).toBeNull();
    } finally {
      (getEnemy('e_walker') as { art?: unknown }).art = original;
    }
  });
});

describe('盤面へ貼る大きさ', () => {
  it('当たり判定と同じ `radius` から決まる', () => {
    // 別の基準で決めると、「見た目より広い／狭い範囲攻撃に巻き込まれる」ことになる
    expect(enemyDrawSize(0.3, 64)).toBeCloseTo(enemyDrawSize(0.15, 64) * 2, 5);
  });

  it('大きい敵ほど大きく貼られる', () => {
    const size = (id: string): number => enemyDrawSize(getEnemy(id).radius, 64);
    expect(size('e_boss_tsuki_no_o')).toBeGreaterThan(size('e_tobukuruma'));
    expect(size('e_tobukuruma')).toBeGreaterThan(size('e_walker'));
    expect(size('e_walker')).toBeGreaterThan(size('e_swarm'));
  });
});
