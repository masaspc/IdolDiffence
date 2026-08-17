import { z } from 'zod';

/**
 * 楽曲。
 *
 * ## 名前は原作の劇中歌そのもの
 *
 * 原作（Netflix 映画『超かぐや姫！』）は**ボカロ P が書き下ろした劇中歌**で
 * 成り立っている作品で、かぐやと彩葉はツクヨミでその曲を配信している。
 * 本作独自の曲名を置くと、原作でいちばん重要な部分だけが別物になってしまう。
 *
 * ## ただし音は本作が合成したもの
 *
 * **原作の音源は入っていない。** 楽曲そのものには著作権が、録音には
 * 著作隣接権があり、ファン制作物に同梱できない（04-content.md 4.5）。
 * 流れているのは BPM と構成だけを合わせて本作が合成した別の音。
 * `writer` / `singer` は**原作へのクレジット**であって、
 * 鳴っている音を作った人ではない —— 画面にもその旨を出す。
 */
export const songSchema = z.object({
  name: z.string().min(1),
  /** 原作での作曲者。クレジット表示に使う */
  writer: z.string().min(1),
  /** 原作で歌っているキャラクター */
  singer: z.string().min(1),
  bpm: z.number().positive(),
  beatsPerBar: z.number().int().positive().default(4),
  /**
   * テンポ正規化の基準 BPM。敵 HP と出現数に `tempoBase / bpm` を掛けて、
   * BPM 差が暗黙の難易度差にならないようにする
   * （docs/design/02-core-battle.md 2.4 テンポ正規化）。
   */
  tempoBase: z.number().positive().default(132),
  /**
   * 合成の設定（`src/audio/`）。
   *
   * **原作の曲の解析結果ではない。** 原作の音源は入れられないので
   * （上の注記）、本作は BPM と構成だけを合わせて別の音を組み立てている。
   * ここはその合成side の指定 —— どの調で、どの音階で、どう打つか。
   * 曲ごとに変えているのは、7 曲が全部同じ響きにならないようにするため
   */
  music: z
    .object({
      /** 主音の MIDI ノート番号。48 = C3 */
      root: z.number().int(),
      /** 使う 5 音音階。`scale.ts` を参照 */
      scale: z.enum(['miyakobushi', 'ritsu', 'insen']),
      /** 打ち方の性格 */
      groove: z.enum(['straight', 'driving', 'sparse']),
    })
    .default({ root: 50, scale: 'miyakobushi', groove: 'straight' }),
});

export const songsSchema = z.record(z.string(), songSchema);

export type Song = z.infer<typeof songSchema>;
export type Songs = z.infer<typeof songsSchema>;

/** 楽曲の BPM から求まるテンポ補正係数 */
export function tempoMul(song: Song): number {
  return song.tempoBase / song.bpm;
}
