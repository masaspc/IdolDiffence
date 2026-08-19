/**
 * 1 小節ぶんの譜面を組み立てる。
 *
 * ## なぜ手続き的に作るのか
 *
 * 音源ファイルを置けないから（04-content.md 4.5）。実際の楽曲は
 * 著作権に加えて録音への著作隣接権が乗るので、ファンゲームに同梱できない。
 * **原曲の旋律を打ち込みで再現するのも同じく使えない** ——
 * 音源を使わなくても、楽曲そのものの複製・翻案にあたる。
 * だから鳴らす旋律は本作のオリジナルで、**原作から借りるのは曲名だけ**
 * （BPM も構成も本作が決めた —— 原曲を聴く手段が無いので合わせようがない）。
 *
 * ## 動機を展開して曲にする
 *
 * 最初の実装は、音階の音をハッシュで選んで並べていた。決定的なので毎回同じには
 * 鳴るが、それは「同じでたらめ」で旋律ではなかった。7 曲の違いも調と打ち方だけで、
 * 実質は同じ曲だった。
 *
 * いまは曲ごとに**動機**（3〜5 音の短い型）と**和音進行**を持ち、
 * セクションごとに動機を変形して展開する（`motif.ts`）。
 *
 * | セクション | 動機の扱い |
 * |---|---|
 * | intro | 断片をオルゴールで。まだ全部は見せない |
 * | verse | そのまま |
 * | bridge | 倍速にして小節を埋める（詰める） |
 * | chorus | 頭の音を引き伸ばしてから倍速で駆け抜ける（開く） |
 * | interlude | 反行（同じ動機のまま景色が変わる） |
 * | finale | 前半は原形、後半は逆行（問いと答え） |
 *
 * さらに 4 小節で**前楽節（問い）と後楽節（答え）**を作り、
 * 後楽節は主音へ落とす。これがいちばん短い「曲の形」。
 *
 * ## 和音は四度堆積
 *
 * 5 音音階に三和音を積むと濁る。和風の定番どおり四度で重ねる（`chordDegrees`）。
 * 解決を急がない響きになり、単純な波形でも汚くならない。
 *
 * ## ここが Web Audio を知らない理由
 *
 * 「どの高さを、いつ、どれだけ鳴らすか」だけを決めて返す。音を出すのは
 * `synth.ts` と `bgm.ts` の仕事。分けておくと**ブラウザ無しで譜面をテストできる**。
 */
import type { Section } from '../data/schema/common';
import type { Song } from '../data/schema/song';
import { chordDegrees, scaleNote, type ScaleName } from './scale';
import {
  clampRegister,
  concat,
  fitToBar,
  fragment,
  invert,
  place,
  repeatTo,
  resolveToTonic,
  retrograde,
  scaleTime,
  stretchTo,
  transpose,
  type Motif,
} from './motif';

/** 音色。和楽器をシンセで近似する（04-content.md 4.5） */
export type Voice =
  /** 和太鼓。拍の芯 */
  | 'taiko'
  /** 締太鼓・拍子木。細かい刻み */
  | 'hat'
  /** 箏。爪弾く分散和音 */
  | 'koto'
  /** 尺八。息の混じった旋律 */
  | 'shakuhachi'
  /** 低音。曲の土台 */
  | 'bass'
  /** 鈴。区切りの飾り */
  | 'bell'
  /** オルゴール。静かなセクションの旋律 */
  | 'musicbox';

export interface Note {
  voice: Voice;
  /** 小節内の位置（拍。小数可） */
  beat: number;
  /** 長さ（拍） */
  beats: number;
  /** MIDI ノート番号。打楽器（taiko / hat）は音程を持たないので省く */
  midi?: number;
  /** 0..1 */
  gain: number;
}

/** 曲ごとの調と性格。`songs.json` の `music` に持つ */
export interface MusicStyle {
  root: number;
  scale: ScaleName;
  /** 打ち方の性格 */
  groove: 'straight' | 'driving' | 'sparse';
  /** その曲の動機（音階上の度数と長さ） */
  motif: Motif;
  /** 和音進行。1 小節に 1 つ、音階上の度数で持つ */
  progression: readonly number[];
}

export const DEFAULT_STYLE: MusicStyle = {
  root: 50,
  scale: 'miyakobushi',
  groove: 'straight',
  motif: { degrees: [0, 2, 1, 4], beats: [1, 1, 1, 1] },
  progression: [0, 3, 1, 4],
};

/**
 * セクションごとの厚みと、動機の扱い。
 *
 * **セクションで音が変わることが、この仕組みのいちばんの取り柄。**
 * ウェーブはもともとセクション単位で区切られているので、
 * 曲が変われば「いま何が来ているか」が耳でも分かる。
 */
interface SectionShape {
  drums: boolean;
  /** 細かい刻みの密度（0 = 無し、1 = 8 分、2 = 16 分） */
  hats: 0 | 1 | 2;
  /** 旋律をどの楽器で出すか。null なら旋律なし */
  lead: 'shakuhachi' | 'musicbox' | null;
  /** 旋律の高さ（度数のオフセット） */
  leadOctave: number;
  /** 箏の分散和音の密度 */
  koto: 0 | 1 | 2;
  gain: number;
}

const SHAPES: Record<Section, SectionShape> = {
  // 静かに始める。ここで全部鳴らすと、サビへ行っても上がらない。
  // 旋律は動機の断片だけをオルゴールで —— 「あとで開く」ことを予告する
  intro: {
    drums: false,
    hats: 0,
    lead: 'musicbox',
    leadOctave: 5,
    koto: 1,
    gain: 0.55,
  },
  verse: {
    drums: true,
    hats: 1,
    lead: 'shakuhachi',
    leadOctave: 0,
    koto: 1,
    gain: 0.75,
  },
  // ブリッジは「溜め」。旋律を詰めて刻みを細かくする
  bridge: {
    drums: true,
    hats: 2,
    lead: 'shakuhachi',
    leadOctave: 0,
    koto: 0,
    gain: 0.8,
  },
  chorus: {
    drums: true,
    hats: 2,
    lead: 'shakuhachi',
    leadOctave: 5,
    koto: 2,
    gain: 1,
  },
  // 間奏は旋律を主役に、打ち物を下げる
  interlude: {
    drums: false,
    hats: 1,
    lead: 'musicbox',
    leadOctave: 5,
    koto: 2,
    gain: 0.7,
  },
  finale: {
    drums: true,
    hats: 2,
    lead: 'shakuhachi',
    leadOctave: 5,
    koto: 2,
    gain: 1,
  },
};

/**
 * その小節の和音の根音（音階上の度数）。
 *
 * **主音の近くへ転回してから返す。** 進行に度数 3〜4 を書くと、その小節だけ
 * 和音も旋律もまるごと 1 オクターブ近く持ち上がり、4 小節ごとに音域が跳ねる。
 * 実際の和声で高い和音を転回して声部を近づけるのと同じことを、
 * 5 音音階（1 オクターブ = 5 度数）の上でやっている ——
 * 和音の役割は変わらず、鳴る高さだけが揃う
 */
function chordRoot(style: MusicStyle, bar: number): number {
  const list = style.progression;
  const raw = list[((bar % list.length) + list.length) % list.length] ?? 0;
  if (raw > 2) return raw - 5;
  if (raw < -2) return raw + 5;
  return raw;
}

/**
 * その小節で鳴らす動機。
 *
 * 4 小節でひと回り。前半 2 小節が**問い**、後半 2 小節が**答え**で、
 * 答えは主音へ落とす（`resolveToTonic`）。
 */
function leadMotif(style: MusicStyle, section: Section, bar: number, beatsPerBar: number): Motif {
  const shape = SHAPES[section];
  const base = style.motif;
  const inPhrase = ((bar % 4) + 4) % 4;
  const answering = inPhrase >= 2;

  let motif: Motif;
  switch (section) {
    case 'intro':
      // まだ全部は見せない。頭の 2 音だけを倍に伸ばして、余りは伸ばして埋める
      motif = scaleTime(fragment(base, 2), 2);
      break;
    case 'bridge':
      // 詰める。倍速にして小節が埋まるまで並べる
      motif = repeatTo(scaleTime(base, 0.5), beatsPerBar);
      break;
    case 'chorus':
      // 開く。**頭の音を半小節ぶん引き伸ばしてから、動機を倍速で駆け抜ける。**
      // 同じ材料のまま「張り上げてから畳みかける」形になる
      motif = concat(
        stretchTo(fragment(base, 1), beatsPerBar / 2),
        stretchTo(base, beatsPerBar / 2),
      );
      break;
    case 'interlude':
      motif = stretchTo(invert(base), beatsPerBar);
      break;
    case 'finale':
      motif = answering ? retrograde(base) : base;
      break;
    default:
      motif = base;
  }

  // 和音の上へ乗せる。度数は和音の根音からの相対で書いてある
  motif = transpose(motif, chordRoot(style, bar) + shape.leadOctave);
  // 進行・オクターブ・終止が足し合わさると音域が上がり続ける。
  // セクションの基準から 1 オクターブ半を上限にして、超えたら畳む。
  // 終止（下）にも同じ音域を渡す —— そちらで主音へ跳んで外れると、
  // 楽句まるごと 1 オクターブ動いて最後の小節だけ急に高く（低く）なる
  const range = { ceiling: shape.leadOctave + 7, floor: shape.leadOctave - 3 };
  motif = clampRegister(motif, range.ceiling);
  if (answering && inPhrase === 3) motif = resolveToTonic(motif, range);
  return fitToBar(motif, beatsPerBar);
}

/**
 * 1 小節ぶんの譜面。
 *
 * @param songId 使わないが、曲ごとの取り違えを防ぐために受け取る
 * @param bar 曲頭からの通算小節。進行・楽句・フィルの位置を決める
 */
export function composeBar(
  songId: string,
  song: Song,
  style: MusicStyle,
  section: Section,
  bar: number,
): Note[] {
  void songId;
  const shape = SHAPES[section];
  const beats = song.beatsPerBar;
  const notes: Note[] = [];
  const root = chordRoot(style, bar);
  const chord = chordDegrees(root);
  // 4 小節の終わりはフィル。区切りが耳で分かると、ウェーブの切れ目も掴める
  const isFill = ((bar % 4) + 4) % 4 === 3;
  const push = (note: Note): void => {
    notes.push({ ...note, gain: note.gain * shape.gain });
  };
  const pitch = (degree: number, octaveShift = 0): number =>
    scaleNote(style.root + octaveShift * 12, style.scale, degree);

  // --- 低音。和音の根音。どのセクションでも鳴らす ---
  push({
    voice: 'bass',
    beat: 0,
    beats: beats / 2,
    midi: pitch(root, -1),
    gain: 0.9,
  });
  if (style.groove !== 'sparse') {
    // 後半は次の和音へ渡す音。根音を 2 回叩くより、進行が聞こえる
    const next = chordRoot(style, bar + 1);
    const passing = isFill ? next - 1 : root + 2;
    push({
      voice: 'bass',
      beat: beats / 2,
      beats: beats / 2,
      midi: pitch(passing, -1),
      gain: 0.72,
    });
  }

  // --- 和太鼓 ---
  if (shape.drums) {
    for (let b = 0; b < beats; b++) {
      const onBeat = style.groove === 'driving' || b % 2 === 0;
      if (onBeat) push({ voice: 'taiko', beat: b, beats: 0.5, gain: b === 0 ? 1 : 0.7 });
    }
    if (isFill) {
      for (let i = 0; i < 4; i++) {
        push({
          voice: 'taiko',
          beat: beats - 1 + i * 0.25,
          beats: 0.25,
          gain: 0.5 + i * 0.12,
        });
      }
    }
  }

  // --- 刻み ---
  if (shape.hats > 0) {
    const step = shape.hats === 2 ? 0.25 : 0.5;
    for (let t = 0; t < beats; t += step) {
      // 裏を強めに。表だけ強いと機械的に聞こえる
      const accent = Math.abs(t % 1) > 0.001 ? 0.5 : 0.28;
      push({ voice: 'hat', beat: t, beats: step, gain: accent });
    }
  }

  // --- 箏。四度堆積の分散和音 ---
  // **決まった型で上下させる。** 乱数で音を選ぶと和音が濁るうえ、
  // 「同じ曲を弾いている」感じが消える
  if (shape.koto > 0) {
    const pattern = shape.koto === 2 ? [0, 1, 2, 1, 2, 1, 0, 1] : [0, 1, 2, 1];
    const step = beats / pattern.length;
    for (let i = 0; i < pattern.length; i++) {
      const degree = chord[pattern[i] ?? 0] ?? root;
      push({
        voice: 'koto',
        beat: i * step,
        beats: step,
        midi: pitch(degree),
        gain: 0.42,
      });
    }
  }

  // --- 旋律 ---
  if (shape.lead) {
    const motif = leadMotif(style, section, bar, beats);
    for (const note of place(motif)) {
      push({
        voice: shape.lead,
        beat: note.beat,
        beats: note.beats,
        midi: pitch(note.degree),
        // 楽句の頭を強く。全部同じ強さだと打ち込みに聞こえる
        gain: (note.beat === 0 ? 0.62 : 0.5) * (shape.lead === 'musicbox' ? 1.1 : 1),
      });
    }
  }

  // --- 鈴。サビと大サビの頭にだけ ---
  if ((section === 'chorus' || section === 'finale') && ((bar % 4) + 4) % 4 === 0) {
    push({
      voice: 'bell',
      beat: 0,
      beats: 2,
      midi: pitch(root, 2),
      gain: 0.35,
    });
  }

  return notes;
}

/**
 * 小節番号 → セクションの対応表を作る。
 *
 * ステージのウェーブがそのまま曲の構成なので、**曲の構成を別に持たない**。
 * 別に持つと、ウェーブを 1 本足したときに曲だけ古い構成のまま残る
 */
export function sectionMap(waves: readonly { section: Section; bars: number }[]): Section[] {
  const map: Section[] = [];
  for (const wave of waves) {
    for (let i = 0; i < wave.bars; i++) map.push(wave.section);
  }
  return map;
}
