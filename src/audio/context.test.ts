/**
 * AudioContext の入り口（`context.ts`）。
 *
 * **音が出せない環境で落ちないこと**が、ここでいちばん大事な約束。
 * sim は音を知らないので、音が出ないことはゲームの進行に一切影響しない ——
 * その前提が崩れると、Web Audio を持たないブラウザで**遊べなくなる**。
 */
import { describe, expect, it } from 'vitest';
import { audioContext, audioState, installAudioUnlock, resumeAudio } from './context';

describe('音を出せない環境', () => {
  it('AudioContext が無ければ null を返す（例外を投げない）', () => {
    // Node には window も AudioContext も無い
    expect(audioContext()).toBeNull();
  });

  it('resume も状態の問い合わせも落ちない', () => {
    expect(() => resumeAudio()).not.toThrow();
    expect(audioState()).toBe('unavailable');
  });

  it('解錠の仕掛けは何度呼んでも安全', () => {
    // 起動時に 1 回呼ぶ想定だが、React の StrictMode では effect が 2 回走る
    expect(() => {
      installAudioUnlock();
      installAudioUnlock();
    }).not.toThrow();
  });
});
