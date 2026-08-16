import { z } from 'zod';

export const songSchema = z.object({
  name: z.string().min(1),
  bpm: z.number().positive(),
  beatsPerBar: z.number().int().positive().default(4),
  /**
   * テンポ正規化の基準 BPM。敵 HP と出現数に `tempoBase / bpm` を掛けて、
   * BPM 差が暗黙の難易度差にならないようにする
   * （docs/design/02-core-battle.md 2.4 テンポ正規化）。
   */
  tempoBase: z.number().positive().default(132),
});

export const songsSchema = z.record(z.string(), songSchema);

export type Song = z.infer<typeof songSchema>;
export type Songs = z.infer<typeof songsSchema>;

/** 楽曲の BPM から求まるテンポ補正係数 */
export function tempoMul(song: Song): number {
  return song.tempoBase / song.bpm;
}
