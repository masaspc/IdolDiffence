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
import { hash01, midiToFreq, scaleNote } from './scale';
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

  it('曲が違えば同じ小節でも旋律が違う', () => {
    const a = bar('chorus', 7, 'reply').filter((n) => n.voice === 'shakuhachi');
    const b = bar('chorus', 7, 'remember').filter((n) => n.voice === 'shakuhachi');
    expect(a.map((n) => n.midi)).not.toEqual(b.map((n) => n.midi));
  });

  it('イントロは静かで、サビで全部鳴る', () => {
    // セクションで音が変わることが、この仕組みのいちばんの取り柄。
    // 同じ厚さで鳴らすなら、わざわざ構成に合わせる意味が無い
    const intro = voices(bar('intro'));
    const chorus = voices(bar('chorus'));
    expect(intro.has('taiko')).toBe(false);
    expect(intro.has('shakuhachi')).toBe(false);
    expect(chorus.has('taiko')).toBe(true);
    expect(chorus.has('shakuhachi')).toBe(true);
    expect(chorus.size).toBeGreaterThan(intro.size);
  });

  it('どのセクションでも低音は途切れない（曲の土台）', () => {
    for (const section of ['intro', 'verse', 'bridge', 'chorus', 'interlude', 'finale'] as const) {
      expect(voices(bar(section)).has('bass'), section).toBe(true);
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

  it('音程を持つ声部には必ず midi が付く', () => {
    for (const note of bar('finale', 4)) {
      const pitched = note.voice !== 'taiko' && note.voice !== 'hat';
      expect(note.midi !== undefined, note.voice).toBe(pitched);
    }
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

describe('曲ごとの合成設定', () => {
  it('全曲に設定がある', () => {
    for (const id of Object.keys(songs)) {
      const style = styleOf(getSong(id));
      expect(style.root, id).toBeGreaterThan(30);
      expect(style.root, id).toBeLessThan(80);
    }
  });

  it('7 曲が全部同じ響きにはならない', () => {
    // 同じ調・同じ音階で 34 ステージを回すと、どのステージも同じ曲に聞こえる
    const keys = Object.keys(songs).map((id) => {
      const style = styleOf(getSong(id));
      return `${style.root}/${style.scale}/${style.groove}`;
    });
    expect(new Set(keys).size).toBeGreaterThanOrEqual(5);
  });

  it('打ち方が譜面に効く（sparse は低音が薄い）', () => {
    const straight = composeBar('x', SONG, { ...DEFAULT_STYLE, groove: 'straight' }, 'verse', 0);
    const sparse = composeBar('x', SONG, { ...DEFAULT_STYLE, groove: 'sparse' }, 'verse', 0);
    const bassOf = (notes: Note[]): number => notes.filter((n) => n.voice === 'bass').length;
    expect(bassOf(sparse)).toBeLessThan(bassOf(straight));
  });
});
