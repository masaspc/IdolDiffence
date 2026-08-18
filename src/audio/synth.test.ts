/**
 * 発音（`synth.ts`）。
 *
 * Web Audio そのものはテストできないが、**ノードをどう繋いだか**は測れる。
 * ここで見張るのは残響の配線 —— 2 回目のバトルで残響が消える、という
 * 一度やった間違いを繰り返さないため。
 */
import { describe, expect, it } from 'vitest';
import { createMasterBus, playVoice } from './synth';

/**
 * 最小の AudioContext もどき。**繋がった相手だけを記録する。**
 *
 * 本物を使うとブラウザが要るうえ、音が正しいかは耳でしか分からない。
 * 配線が正しいかだけなら、この程度で確かめられる
 */
/** AudioParam のふり。値を持つだけで、時間の指定は捨てる */
function param(value = 0): {
  value: number;
  setValueAtTime: () => void;
  linearRampToValueAtTime: () => void;
  exponentialRampToValueAtTime: () => void;
} {
  return {
    value,
    setValueAtTime: () => {},
    linearRampToValueAtTime: () => {},
    exponentialRampToValueAtTime: () => {},
  };
}

class FakeNode {
  readonly outputs: FakeNode[] = [];
  gain = param(1);
  frequency = param(0);
  Q = param(1);
  playbackRate = param(1);
  detune = param(0);
  pan = param(0);
  threshold = param(0);
  knee = param(0);
  ratio = param(1);
  attack = param(0);
  release = param(0);
  type = '';
  buffer: unknown = null;
  loop = false;
  constructor(readonly kind: string) {}
  connect(target: FakeNode): FakeNode {
    this.outputs.push(target);
    return target;
  }
  start(): void {}
  stop(): void {}
}

class FakeContext {
  /** 作ったノードを全部覚えておく。配線は下流へしか辿れないので */
  readonly made: FakeNode[] = [];
  // 波形を焼くので、短くても本物らしい値にしておく
  readonly sampleRate = 8000;
  readonly currentTime = 0;
  createGain = (): FakeNode => this.track(new FakeNode('gain'));
  createOscillator = (): FakeNode => this.track(new FakeNode('osc'));
  createBufferSource = (): FakeNode => this.track(new FakeNode('source'));
  createBiquadFilter = (): FakeNode => this.track(new FakeNode('filter'));
  createConvolver = (): FakeNode => this.track(new FakeNode('convolver'));
  createStereoPanner = (): FakeNode => this.track(new FakeNode('panner'));
  createDynamicsCompressor = (): FakeNode => this.track(new FakeNode('compressor'));
  createBuffer = (
    channels: number,
    length: number,
  ): { length: number; getChannelData: () => Float32Array } => {
    void channels;
    // 波形を書き込むので、呼ぶたびに同じ配列を返す
    const data = new Float32Array(length);
    return { length, getChannelData: () => data };
  };
  private track(node: FakeNode): FakeNode {
    this.made.push(node);
    return node;
  }
  convolvers(): FakeNode[] {
    return this.made.filter((n) => n.kind === 'convolver');
  }
}

/** `from` から辿って `to` へ着くか（残響を通る経路があるか） */
function reaches(from: FakeNode, to: FakeNode, seen = new Set<FakeNode>()): boolean {
  if (from === to) return true;
  if (seen.has(from)) return false;
  seen.add(from);
  return from.outputs.some((next) => reaches(next, to, seen));
}

function play(ctx: FakeContext, destination: FakeNode, midi = 72): void {
  // オルゴールは残響をいちばん多く送る声部
  playVoice(
    ctx as unknown as BaseAudioContext,
    destination as unknown as AudioNode,
    'musicbox',
    0,
    1,
    0.5,
    midi,
  );
}

describe('残響の配線', () => {
  it('バトルごとに master が変わっても、その master へ残響が返る', () => {
    // **2 回目のバトルで残響が消えていた。** AudioContext は使い回されるが
    // `BgmPlayer` の master は作り直され、古い master は dispose で切断される。
    // 残響を AudioContext だけで使い回すと、出口が切れた master のまま残る
    const ctx = new FakeContext();
    const first = new FakeNode('master1');
    const second = new FakeNode('master2');
    play(ctx, first);
    play(ctx, second);

    // 行き先ごとに畳み込みができ、それぞれ自分の master へ返る
    const convolvers = ctx.convolvers();
    expect(convolvers).toHaveLength(2);
    for (const master of [first, second]) {
      expect(
        convolvers.filter((c) => reaches(c, master)),
        master.kind,
      ).toHaveLength(1);
    }
    // 片方の残響がもう片方へ漏れない
    expect(reaches(first, second)).toBe(false);
    expect(reaches(second, first)).toBe(false);
  });

  it('同じオクターブの音は標本を焼き直さない（1 小節で数十回まわる）', () => {
    // 1 音ずつ波形を計算すると確実に音が途切れる。
    // オクターブごとに 1 本焼いて、あとは playbackRate でまかなう
    const ctx = new FakeContext();
    const master = new FakeNode('master');
    play(ctx, master, 72);
    const perNote = ctx.made.length;
    // 同じオクターブ内をもう 5 音。焼き直していれば作るノードが増える
    for (const midi of [73, 74, 75, 76, 77]) play(ctx, master, midi);
    expect(ctx.made.length).toBeLessThanOrEqual(perNote * 6);
  });

  it('声部ごとに定位が振られる（真ん中で 1 本に潰れない）', () => {
    const ctx = new FakeContext();
    const master = new FakeNode('master');
    play(ctx, master, 72);
    expect(ctx.made.some((n) => n.kind === 'panner')).toBe(true);
  });

  it('同じ行き先なら残響は 1 つだけ作る（音ごとに作らない）', () => {
    // 音ごとに畳み込みを作ると 1 小節で数十個のノードができる
    const ctx = new FakeContext();
    const master = new FakeNode('master');
    for (let i = 0; i < 5; i++) play(ctx, master);
    expect(ctx.convolvers()).toHaveLength(1);
  });
});

describe('まとめの段', () => {
  it('曲はコンプレッサを通ってから出る', () => {
    // 声部を足しただけだと音量がばらつき、作り込んだ音色が
    // 「素人の録音」に聞こえる
    const ctx = new FakeContext();
    const out = new FakeNode('destination');
    const input = createMasterBus(
      ctx as unknown as BaseAudioContext,
      out as unknown as AudioNode,
    ) as unknown as FakeNode;
    expect(ctx.made.some((n) => n.kind === 'compressor')).toBe(true);
    expect(reaches(input, out)).toBe(true);
  });
});
