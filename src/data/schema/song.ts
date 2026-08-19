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
 * 流れているのは本作が合成した別の音で、**原曲と共通なのは曲名だけ**
 * （旋律も音色も、`bpm` の値も本作が決めたもの —— 原曲を聴く手段が無いので
 * 合わせようがない）。
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
   * **原作の曲の解析結果ではない。** 原作の音源は入れられないうえ
   * （上の注記）、原曲を聴く手段も無いので、本作は曲名だけを借りて
   * 別の音を組み立てている。
   * ここはその合成side の指定 —— どの調で、どの音階で、どう打つか。
   * 曲ごとに変えているのは、7 曲が全部同じ響きにならないようにするため
   */
  music: z
    .object({
      /** 主音の MIDI ノート番号。48 = C3 */
      root: z.number().int(),
      /** 使う 5 音音階。`scale.ts` を参照 */
      scale: z.enum(['miyakobushi', 'ritsu', 'insen', 'yonanuki', 'yonanukiMinor']),
      /** 打ち方の性格 */
      groove: z.enum(['straight', 'driving', 'sparse']),
      /**
       * その曲の**動機**（3〜5 音の短い型）。音階上の度数で、和音の根音からの相対。
       *
       * ここが曲の顔になる。セクションごとに移高・反行・逆行・拡大・断片化して
       * 展開するので（`audio/motif.ts`）、**曲ごとに違う型を書けば違う曲になる**。
       * 逆にここを共通にすると、調を変えただけの同じ曲が 7 本並ぶ
       */
      motif: z.array(z.number()).min(2).max(8),
      /** 動機の各音の長さ（拍）。`motif` と同じ本数、合計は 1 小節ぶん */
      rhythm: z.array(z.number().positive()).min(2).max(8),
      /** 和音進行。1 小節に 1 つ、音階上の度数 */
      progression: z.array(z.number()).min(2).max(8),
    })
    .default({
      root: 50,
      scale: 'miyakobushi',
      groove: 'straight',
      motif: [0, 2, 1, 4],
      rhythm: [1, 1, 1, 1],
      progression: [0, 3, 1, 4],
    })
    .refine((m) => m.motif.length === m.rhythm.length, {
      message: '動機の音数と長さの数が合っていません',
    }),
});

export const songsSchema = z.record(z.string(), songSchema);

export type Song = z.infer<typeof songSchema>;
export type Songs = z.infer<typeof songsSchema>;

/** 楽曲の BPM から求まるテンポ補正係数 */
export function tempoMul(song: Song): number {
  return song.tempoBase / song.bpm;
}
