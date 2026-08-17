/**
 * 1 小節ぶんの譜面を組み立てる。
 *
 * ## なぜ手続き的に作るのか
 *
 * 音源ファイルを置けないから（04-content.md 4.5）。実際の楽曲は
 * 著作権に加えて録音への著作隣接権が乗るので、ファンゲームに同梱できない。
 * かといって無音では「音楽のアニメ」を題材にした意味が無い。
 *
 * そこで**コードで曲を組み立てる**。ドット絵と同じ方針で、
 * リポジトリに権利の不明な素材を入れずに済む。
 *
 * ## ここが Web Audio を知らない理由
 *
 * 「どの高さを、いつ、どれだけ鳴らすか」だけを決めて返す。音を出すのは
 * `bgm.ts` の仕事。分けておくと、**ブラウザ無しで譜面をテストできる** ——
 * 「サビで太鼓が鳴っているか」「イントロが静かか」は音を聞かなくても分かる。
 *
 * ## 毎回同じに鳴る
 *
 * 変化は `hash01`（曲 ID と小節番号から導く）で付ける。乱数を使うと
 * 同じ小節が毎回違う旋律になり、「曲」として覚えられない。
 * 決定的なので、同じステージは何度遊んでも同じ曲が流れる。
 */
import type { Section } from '../data/schema/common';
import type { Song } from '../data/schema/song';
import { hash01, hashPick, scaleNote, type ScaleName } from './scale';

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
  | 'bell';

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
}

export const DEFAULT_STYLE: MusicStyle = { root: 50, scale: 'miyakobushi', groove: 'straight' };

/**
 * セクションごとの厚み。
 *
 * **セクションで音が変わることが、この仕組みのいちばんの取り柄。**
 * ウェーブはもともとセクション単位で区切られているので、
 * 曲が変われば「いま何が来ているか」が耳でも分かる。
 */
interface SectionShape {
  /** 太鼓を打つか */
  drums: boolean;
  /** 細かい刻みの密度（0 = 無し、1 = 8 分、2 = 16 分） */
  hats: 0 | 1 | 2;
  /** 尺八の旋律を乗せるか */
  lead: boolean;
  /** 箏の分散和音の密度 */
  koto: 0 | 1 | 2;
  /** 全体の音量 */
  gain: number;
}

const SHAPES: Record<Section, SectionShape> = {
  // 静かに始める。ここで全部鳴らすと、サビへ行っても上がらない
  intro: { drums: false, hats: 0, lead: false, koto: 1, gain: 0.55 },
  verse: { drums: true, hats: 1, lead: false, koto: 1, gain: 0.75 },
  // ブリッジは「溜め」。旋律を抜いて刻みだけ細かくする
  bridge: { drums: true, hats: 2, lead: false, koto: 0, gain: 0.8 },
  chorus: { drums: true, hats: 2, lead: true, koto: 2, gain: 1 },
  // 間奏は旋律を主役に、打ち物を下げる
  interlude: { drums: false, hats: 1, lead: true, koto: 2, gain: 0.7 },
  finale: { drums: true, hats: 2, lead: true, koto: 2, gain: 1 },
};

/**
 * 4 小節でひと回りする進行。数字は音階上の度数。
 *
 * 和音を鳴らさず**低音の動きだけ**で進行を作る。5 音音階に三和音を積むと
 * 濁りやすく、シンセの単純な波形では特に汚くなる
 */
const PROGRESSION = [0, 3, -2, 2];

/** その小節の主音（度数）。曲全体でゆっくり動く */
function barDegree(bar: number): number {
  return PROGRESSION[bar % PROGRESSION.length] ?? 0;
}

/**
 * 1 小節ぶんの譜面。
 *
 * @param songId 変化の種。曲が違えば同じ小節でも違う旋律になる
 * @param bar 曲頭からの通算小節。進行とフィルの位置を決める
 */
export function composeBar(
  songId: string,
  song: Song,
  style: MusicStyle,
  section: Section,
  bar: number,
): Note[] {
  const shape = SHAPES[section];
  const beats = song.beatsPerBar;
  const notes: Note[] = [];
  const degree = barDegree(bar);
  // 4 小節の終わりはフィル。区切りが耳で分かると、ウェーブの切れ目も掴める
  const isFill = bar % 4 === 3;
  const push = (note: Note): void => {
    notes.push({ ...note, gain: note.gain * shape.gain });
  };

  // --- 低音。曲の土台。どのセクションでも鳴らす ---
  push({
    voice: 'bass',
    beat: 0,
    beats: beats / 2,
    midi: scaleNote(style.root - 12, style.scale, degree),
    gain: 0.9,
  });
  if (style.groove !== 'sparse') {
    push({
      voice: 'bass',
      beat: beats / 2,
      beats: beats / 2,
      midi: scaleNote(style.root - 12, style.scale, degree + (isFill ? 2 : 0)),
      gain: 0.75,
    });
  }

  // --- 和太鼓 ---
  if (shape.drums) {
    for (let b = 0; b < beats; b++) {
      // 表拍は 1 と 3（`straight`）、`driving` は全部の拍を打つ
      const onBeat = style.groove === 'driving' || b % 2 === 0;
      if (onBeat) push({ voice: 'taiko', beat: b, beats: 0.5, gain: b === 0 ? 1 : 0.7 });
    }
    if (isFill) {
      // 小節終わりの連打。次の小節へ押し出す
      for (let i = 0; i < 4; i++) {
        push({ voice: 'taiko', beat: beats - 1 + i * 0.25, beats: 0.25, gain: 0.5 + i * 0.12 });
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

  // --- 箏。分散和音 ---
  if (shape.koto > 0) {
    const count = shape.koto === 2 ? beats * 2 : beats;
    for (let i = 0; i < count; i++) {
      const at = (i * beats) / count;
      // 度数は上へ登り、ときどき折り返す
      const rise = hashPick(3, songId, bar, i) - 1;
      push({
        voice: 'koto',
        beat: at,
        beats: beats / count,
        midi: scaleNote(style.root, style.scale, degree + i + rise),
        gain: 0.42,
      });
    }
  }

  // --- 尺八の旋律 ---
  if (shape.lead) {
    // 2 小節でひとつの楽句。長い音と短い音を混ぜる
    const phrase = bar % 2 === 0 ? [0, 1.5, 2.5] : [0, 1, 2, 3];
    for (let i = 0; i < phrase.length; i++) {
      const at = phrase[i] ?? 0;
      const next = phrase[i + 1] ?? beats;
      const step = hashPick(5, songId, 'lead', bar, i) - 2;
      push({
        voice: 'shakuhachi',
        beat: at,
        beats: Math.max(0.5, next - at),
        midi: scaleNote(style.root + 12, style.scale, degree + 2 + step),
        gain: 0.5,
      });
    }
  }

  // --- 鈴。サビと大サビの頭にだけ ---
  if ((section === 'chorus' || section === 'finale') && bar % 4 === 0) {
    push({
      voice: 'bell',
      beat: 0,
      beats: 2,
      midi: scaleNote(style.root + 24, style.scale, degree),
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

/** 曲の揺らぎ。同じ譜面でも曲ごとに少しテンポ感が違って聞こえる */
export function swingOf(songId: string): number {
  // 0〜0.06 拍。16 分の裏を後ろへずらす量
  return hash01(songId, 'swing') * 0.06;
}
