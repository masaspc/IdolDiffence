/**
 * 隠しキャラの合言葉の入力（`meta/secrets.ts`）。
 *
 * ホーム画面でキーボードから打つ。**入力欄は置かない** ―― 欄があれば
 * 「何か打つものがある」と分かってしまい、隠れていることにならない。
 *
 * スマホには物理キーが無いので、タイトルの連打も同じ扱いにしてある。
 * 隠し要素が「PC を持っている人だけのもの」になるのは避けたい。
 */
import { useCallback, useEffect, useRef } from 'react';
import { matchSecret, MAX_CODE_LENGTH, SECRET_CODES, TAP_COUNT } from '../meta/secrets';

/** 連打とみなす間隔。これを超えたら数え直す */
const TAP_WINDOW_MS = 1200;

/**
 * 連打で配る隠しキャラ。連打は「どれか 1 つ」しか指せないので、
 * 合言葉の表の先頭を使う。隠しキャラが増えたら選ばせる形へ変える
 */
const TAP_TARGET = Object.keys(SECRET_CODES)[0] ?? null;

export interface SecretCodeHandlers {
  /** タイトルに付ける。連打で解放する経路 */
  onTitleTap: (event: { timeStamp: number }) => void;
}

/**
 * @param enabled 解放済みなら false を渡して監視を止める
 * @param onUnlock 合言葉が揃ったときに呼ばれる
 */
export function useSecretCode(
  enabled: boolean,
  onUnlock: (idolId: string) => void,
): SecretCodeHandlers {
  const buffer = useRef('');
  const taps = useRef({ count: 0, last: Number.NEGATIVE_INFINITY });
  // 監視の張り直しで入力が消えないよう、コールバックは ref 越しに読む
  const unlockRef = useRef(onUnlock);
  unlockRef.current = onUnlock;

  useEffect(() => {
    if (!enabled) return;

    const onKey = (event: KeyboardEvent): void => {
      // 修飾キー付きはブラウザの操作。合言葉として数えない
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key.length !== 1 || !/[a-z]/i.test(event.key)) return;

      buffer.current = (buffer.current + event.key).slice(-MAX_CODE_LENGTH);
      const hit = matchSecret(buffer.current);
      if (hit) {
        buffer.current = '';
        unlockRef.current(hit);
      }
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enabled]);

  const onTitleTap = useCallback(
    (event: { timeStamp: number }): void => {
      // 時計は**イベントが持っている値**を使う。`Date.now()` は
      // 決定性のためにこの層では禁じてある（eslint no-restricted-properties）
      if (!enabled || TAP_TARGET === null) return;
      const state = taps.current;
      state.count = event.timeStamp - state.last > TAP_WINDOW_MS ? 1 : state.count + 1;
      state.last = event.timeStamp;
      if (state.count < TAP_COUNT) return;

      state.count = 0;
      unlockRef.current(TAP_TARGET);
    },
    [enabled],
  );

  return { onTitleTap };
}
