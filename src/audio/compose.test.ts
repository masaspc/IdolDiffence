/**
 * 譜面（`compose.ts`）と音階（`scale.ts`）。
 *
 * **音を聞かずに確かめられることだけを見る。** Web Audio はテストできないが、
 * 「どの高さを、いつ、どれだけ鳴らすか」は数字なので確かめられる ——
 * サビで太鼓が鳴っているか、イントロが静かか、毎回同じ曲になるか。
 *
 * ここが崩れると「鳴ってはいるが曲になっていない」状態に静かに落ちる。
 */
import { describe, expect, it } from 'vitest';
import { composeBar, sectionMap, DEFAULT_STYLE, type Note } from './compose';
import { chordDegrees, hash01, midiToFreq, scaleNote } from './scale';
import { getSong, getStage, songs, stageOrder } from '../data';
import { styleOf } from './bgm';
import type { Song } from '../data/schema/song';

const SONG: Song = getSong('reply');

function bar(section: Parameters<typeof composeBar>[3], index = 0, songId = 'reply'): Note[] {
  return composeBar(songId, SONG, DEFAULT_STYLE, section, index);
}

function voices(notes: Note[]): Set<string> {
  return new Set(notes.map((n) => n.voice));
}

describe('音階', () => {
  it('5 音でオクターブをまたいで連続する', () => {
    // 旋律を書くときに「オクターブをまたぐ」を気にしなくて済むのが狙い
    expect(scaleNote(60, 'miyakobushi', 0)).toBe(60);
    expect(scaleNote(60, 'miyakobushi', 5)).toBe(72); // 1 オクターブ上の主音
    expect(scaleNote(60, 'miyakobushi', 10)).toBe(84);
  });

  it('負の度数は下のオクターブへ降りる', () => {
    // JS の % は負で負を返す。素朴に書くと低音の進行だけが壊れる
    expect(scaleNote(60, 'miyakobushi', -1)).toBe(56); // 下のオクターブの最高音
    expect(scaleNote(60, 'miyakobushi', -5)).toBe(48);
  });

  it('音階ごとに違う響きになる', () => {
    // 都節は半音を含み、律は含まない。ここが同じだと音階を分けた意味が無い
    const miyako = [0, 1, 2, 3, 4].map((d) => scaleNote(60, 'miyakobushi', d));
    const ritsu = [0, 1, 2, 3, 4].map((d) => scaleNote(60, 'ritsu', d));
    expect(miyako).toEqual([60, 61, 65, 67, 68]);
    expect(ritsu).toEqual([60, 62, 65, 67, 69]);
  });

  it('A4 は 440Hz', () => {
    expect(midiToFreq(69)).toBeCloseTo(440, 6);
    expect(midiToFreq(81)).toBeCloseTo(880, 6);
  });

  it('同じ引数からは必ず同じ値が出る（曲として覚えられる）', () => {
    // 乱数を使うと同じ小節が毎回違う旋律になり、「曲」にならない
    expect(hash01('reply', 4, 'lead')).toBe(hash01('reply', 4, 'lead'));
    expect(hash01('reply', 4, 'lead')).not.toBe(hash01('reply', 5, 'lead'));
    expect(hash01('reply', 4)).not.toBe(hash01('remember', 4));
  });

  it('0 以上 1 未満に収まる', () => {
    for (let i = 0; i < 200; i++) {
      const value = hash01('song', i);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });
});

describe('譜面', () => {
  it('同じ小節は何度組んでも同じ譜面になる', () => {
    expect(bar('chorus', 7)).toEqual(bar('chorus', 7));
  });

  it('イントロは静かで、サビで全部鳴る', () => {
    // セクションで音が変わることが、この仕組みのいちばんの取り柄。
    // 同じ厚さで鳴らすなら、わざわざ構成に合わせる意味が無い
    const intro = voices(bar('intro'));
    const chorus = voices(bar('chorus'));
    expect(intro.has('taiko')).toBe(false);
    expect(chorus.has('taiko')).toBe(true);
    expect(chorus.size).toBeGreaterThan(intro.size);
  });

  it('静かなセクションの旋律はオルゴール', () => {
    // 原作の音源は使えないので、せめて音色で「聴かせる」場所を作る
    expect(voices(bar('intro')).has('musicbox')).toBe(true);
    expect(voices(bar('interlude')).has('musicbox')).toBe(true);
    expect(voices(bar('chorus')).has('shakuhachi')).toBe(true);
  });

  it('どのセクションでも低音は途切れない（曲の土台）', () => {
    for (const section of ['intro', 'verse', 'bridge', 'chorus', 'interlude', 'finale'] as const) {
      expect(voices(bar(section)).has('bass'), section).toBe(true);
    }
  });

  it('どのセクションにも旋律がある', () => {
    for (const section of ['intro', 'verse', 'bridge', 'chorus', 'interlude', 'finale'] as const) {
      const lead = bar(section).filter((n) => n.voice === 'shakuhachi' || n.voice === 'musicbox');
      expect(lead.length, section).toBeGreaterThan(0);
    }
  });

  it('サビはイントロより音量が大きい', () => {
    const loudness = (notes: Note[]): number => notes.reduce((sum, n) => sum + n.gain, 0);
    expect(loudness(bar('chorus'))).toBeGreaterThan(loudness(bar('intro')));
  });

  it('4 小節ごとに太鼓のフィルが入る（区切りが耳で分かる）', () => {
    const plain = bar('verse', 2).filter((n) => n.voice === 'taiko');
    const fill = bar('verse', 3).filter((n) => n.voice === 'taiko');
    expect(fill.length).toBeGreaterThan(plain.length);
  });

  it('音は小節からはみ出さない', () => {
    // はみ出すと次の小節の頭と重なり、拍の頭がぼやける
    for (let i = 0; i < 16; i++) {
      for (const note of bar('finale', i)) {
        expect(note.beat, `bar ${i}`).toBeGreaterThanOrEqual(0);
        expect(note.beat, `bar ${i}`).toBeLessThan(SONG.beatsPerBar);
        expect(note.gain).toBeGreaterThan(0);
      }
    }
  });

  it('旋律も小節に収まる（変形で伸びても切る）', () => {
    for (const section of ['intro', 'verse', 'bridge', 'chorus', 'interlude', 'finale'] as const) {
      for (let i = 0; i < 8; i++) {
        const lead = bar(section, i).filter(
          (n) => n.voice === 'shakuhachi' || n.voice === 'musicbox',
        );
        const end = lead.reduce((max, n) => Math.max(max, n.beat + n.beats), 0);
        expect(end, `${section} bar ${i}`).toBeLessThanOrEqual(SONG.beatsPerBar + 1e-9);
      }
    }
  });

  it('音程を持つ声部には必ず midi が付く', () => {
    for (const note of bar('finale', 4)) {
      const pitched = note.voice !== 'taiko' && note.voice !== 'hat';
      expect(note.midi !== undefined, note.voice).toBe(pitched);
    }
  });
});

describe('動機の展開', () => {
  const lead = (section: Parameters<typeof composeBar>[3], index: number): number[] =>
    bar(section, index)
      .filter((n) => n.voice === 'shakuhachi' || n.voice === 'musicbox')
      .map((n) => n.midi ?? 0);

  it('同じ動機が繰り返し出てくる（覚えられる）', () => {
    // 4 小節でひと回りする和音進行に乗るので、同じ位置の小節は同じ旋律になる。
    // ここが崩れると、鳴ってはいるが覚えられない音の列に戻る
    expect(lead('verse', 0)).toEqual(lead('verse', 4));
    expect(lead('verse', 1)).toEqual(lead('verse', 5));
  });

  it('小節ごとに和音が動くので、同じ動機でも高さが変わる', () => {
    expect(lead('verse', 0)).not.toEqual(lead('verse', 1));
  });

  it('セクションが変われば同じ小節でも扱いが変わる', () => {
    // サビはオクターブ上、間奏は反行。同じ動機のまま景色が変わる
    expect(lead('chorus', 0)).not.toEqual(lead('verse', 0));
    expect(lead('interlude', 0)).not.toEqual(lead('verse', 0));
  });

  it('サビは音域が上がる', () => {
    const top = (notes: number[]): number => Math.max(...notes);
    expect(top(lead('chorus', 0))).toBeGreaterThan(top(lead('verse', 0)));
  });

  it('ブリッジは音数が増える（詰めて溜める）', () => {
    expect(lead('bridge', 0).length).toBeGreaterThan(lead('verse', 0).length);
  });

  it('大サビは前半と後半で問いと答えになる', () => {
    // 後半は逆行。同じ材料のまま「返事」に聞こえる
    expect(lead('finale', 0)).not.toEqual(lead('finale', 2));
  });
});

describe('構成', () => {
  it('ウェーブの並びがそのまま曲の構成になる', () => {
    // 曲の構成を別に持つと、ウェーブを 1 本足したときに曲だけ古いままになる
    const map = sectionMap([
      { section: 'intro', bars: 2 },
      { section: 'chorus', bars: 3 },
    ]);
    expect(map).toEqual(['intro', 'intro', 'chorus', 'chorus', 'chorus']);
  });

  it('全ステージのウェーブから構成を作れる', () => {
    for (const stageId of stageOrder) {
      const stage = getStage(stageId);
      const map = sectionMap(stage.waves);
      expect(map.length, stageId).toBe(stage.waves.reduce((sum, w) => sum + w.bars, 0));
    }
  });
});

describe('曲ごとの顔', () => {
  it('全曲に動機と進行がある', () => {
    for (const id of Object.keys(songs)) {
      const style = styleOf(getSong(id));
      expect(style.motif.degrees.length, id).toBeGreaterThanOrEqual(2);
      expect(style.motif.degrees.length, id).toBe(style.motif.beats.length);
      expect(style.progression.length, id).toBeGreaterThanOrEqual(2);
      expect(style.root, id).toBeGreaterThan(30);
      expect(style.root, id).toBeLessThan(80);
    }
  });

  it('動機は 1 小節に収まる', () => {
    for (const id of Object.keys(songs)) {
      const song = getSong(id);
      const total = styleOf(song).motif.beats.reduce((sum, b) => sum + b, 0);
      expect(total, id).toBeCloseTo(song.beatsPerBar, 6);
    }
  });

  it('7 曲が全部違う曲になる', () => {
    // **ここが今回いちばん直したかったところ。** 前は調と打ち方しか違わず、
    // 7 曲が実質同じ曲だった。動機が違えば別の曲になる
    const motifs = Object.keys(songs).map((id) => styleOf(getSong(id)).motif.degrees.join(','));
    expect(new Set(motifs).size).toBe(motifs.length);

    const progressions = Object.keys(songs).map((id) => styleOf(getSong(id)).progression.join(','));
    expect(new Set(progressions).size).toBe(progressions.length);
  });

  it('実際に鳴らす音も曲ごとに違う', () => {
    const firstBar = (id: string): string => {
      const song = getSong(id);
      return composeBar(id, song, styleOf(song), 'chorus', 0)
        .filter((n) => n.voice === 'shakuhachi')
        .map((n) => n.midi)
        .join(',');
    };
    const heads = Object.keys(songs).map(firstBar);
    expect(new Set(heads).size).toBe(heads.length);
  });

  it('全曲・全セクションで旋律が歌える音域に収まる', () => {
    // 進行・オクターブ・終止が足し合わさると音域が上がり続ける。
    // 放っておくとサビの終わりだけ 2 オクターブ上へ飛んで、耳に刺さる音になる
    for (const id of Object.keys(songs)) {
      const song = getSong(id);
      const style = styleOf(song);
      for (const section of [
        'intro',
        'verse',
        'bridge',
        'chorus',
        'interlude',
        'finale',
      ] as const) {
        for (let i = 0; i < 8; i++) {
          for (const note of composeBar(id, song, style, section, i)) {
            if (note.voice !== 'shakuhachi' && note.voice !== 'musicbox') continue;
            // C2〜C6。これを外すと歌えない高さになる
            expect(note.midi, `${id} ${section} bar${i}`).toBeGreaterThanOrEqual(36);
            expect(note.midi, `${id} ${section} bar${i}`).toBeLessThanOrEqual(84);
          }
        }
      }
    }
  });

  it('音の長さが譜面に書ける値になる（端数を出さない）', () => {
    // 変形の倍率を直に書いていたころは 0.575 拍や 0.1 拍が出ていた。
    // 0.1 拍の切れ端は旋律ではなく取りこぼしに聞こえる
    for (const id of Object.keys(songs)) {
      const song = getSong(id);
      const style = styleOf(song);
      for (const section of [
        'intro',
        'verse',
        'bridge',
        'chorus',
        'interlude',
        'finale',
      ] as const) {
        for (let i = 0; i < 8; i++) {
          for (const note of composeBar(id, song, style, section, i)) {
            if (note.voice !== 'shakuhachi' && note.voice !== 'musicbox') continue;
            expect(note.beats, `${id} ${section} bar${i}`).toBeGreaterThanOrEqual(0.25);
            // 16 分（0.25 拍）の倍数に乗っているか
            const steps = note.beats / 0.25;
            expect(
              Math.abs(steps - Math.round(steps)),
              `${id} ${section} ${note.beats}`,
            ).toBeLessThan(1e-6);
          }
        }
      }
    }
  });

  it('サビは動機を引き伸ばしてから畳みかける（音数が増える）', () => {
    // 同じ材料のまま「張り上げてから駆け抜ける」形。
    // オクターブを上げるだけだと、サビが「同じ旋律の高いほう」で終わる
    const lead = (section: Parameters<typeof composeBar>[3]): Note[] =>
      bar(section, 0).filter((n) => n.voice === 'shakuhachi' || n.voice === 'musicbox');
    expect(lead('chorus').length).toBeGreaterThan(lead('verse').length);
    // 頭の音がいちばん長い
    const head = lead('chorus')[0];
    expect(head?.beats).toBeGreaterThanOrEqual(SONG.beatsPerBar / 2);
  });

  it('高い和音は転回して近くへ寄せる（小節ごとに音域が跳ねない）', () => {
    // 進行に度数 4 を書くと、その小節だけ旋律まるごと持ち上がっていた
    const top = (index: number): number =>
      Math.max(
        ...bar('verse', index)
          .filter((n) => n.voice === 'shakuhachi')
          .map((n) => n.midi ?? 0),
      );
    const tops = [0, 1, 2, 3].map(top);
    expect(Math.max(...tops) - Math.min(...tops)).toBeLessThanOrEqual(12);
  });

  it('打ち方が譜面に効く（sparse は低音が薄い）', () => {
    const straight = composeBar('x', SONG, { ...DEFAULT_STYLE, groove: 'straight' }, 'verse', 0);
    const sparse = composeBar('x', SONG, { ...DEFAULT_STYLE, groove: 'sparse' }, 'verse', 0);
    const bassOf = (notes: Note[]): number => notes.filter((n) => n.voice === 'bass').length;
    expect(bassOf(sparse)).toBeLessThan(bassOf(straight));
  });

  it('和音は四度堆積（三和音を積んで濁らせない）', () => {
    // 5 音音階に 3 度堆積を乗せると濁る。1 つ飛ばしで重ねるのが和風の定番
    expect(chordDegrees(0)).toEqual([0, 2, 4]);
    expect(chordDegrees(3)).toEqual([3, 5, 7]);
  });
});
