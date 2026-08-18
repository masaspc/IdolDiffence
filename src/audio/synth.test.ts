/**
 * 発音（`synth.ts`）。
 *
 * Web Audio そのものはテストできないが、**ノードをどう繋いだか**は測れる。
 * ここで見張るのは残響の配線 —— 2 回目のバトルで残響が消える、という
 * 一度やった間違いを繰り返さないため。
 */
import { describe, expect, it } from 'vitest';
import { playVoice } from './synth';

/**
 * 最小の AudioContext もどき。**繋がった相手だけを記録する。**
 *
 * 本物を使うとブラウザが要るうえ、音が正しいかは耳でしか分からない。
 * 配線が正しいかだけなら、この程度で確かめられる
 */
class FakeNode {
  readonly outputs: FakeNode[] = [];
  gain = { value: 1, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} };
  frequency = { value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {}, linearRampToValueAtTime() {} };
  Q = { value: 1 };
  detune = { value: 0, setValueAtTime() {}, linearRampToValueAtTime() {} };
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
  readonly sampleRate = 8000;
  readonly currentTime = 0;
  createGain = (): FakeNode => this.track(new FakeNode('gain'));
  createOscillator = (): FakeNode => this.track(new FakeNode('osc'));
  createBufferSource = (): FakeNode => this.track(new FakeNode('source'));
  createBiquadFilter = (): FakeNode => this.track(new FakeNode('filter'));
  createConvolver = (): FakeNode => this.track(new FakeNode('convolver'));
  createWaveShaper = (): FakeNode => this.track(new FakeNode('shaper'));
  createBuffer = (channels: number, length: number): { getChannelData: () => Float32Array } => {
    void channels;
    return { getChannelData: () => new Float32Array(length) };
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

function play(ctx: FakeContext, destination: FakeNode): void {
  // オルゴールは残響をいちばん多く送る声部
  playVoice(ctx as unknown as BaseAudioContext, destination as unknown as AudioNode, 'musicbox', 0, 1, 0.5, 72);
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
      expect(convolvers.filter((c) => reaches(c, master)), master.kind).toHaveLength(1);
    }
    // 片方の残響がもう片方へ漏れない
    expect(reaches(first, second)).toBe(false);
    expect(reaches(second, first)).toBe(false);
  });

  it('同じ行き先なら残響は 1 つだけ作る（音ごとに作らない）', () => {
    // 音ごとに畳み込みを作ると 1 小節で数十個のノードができる
    const ctx = new FakeContext();
    const master = new FakeNode('master');
    for (let i = 0; i < 5; i++) play(ctx, master);
    expect(ctx.convolvers()).toHaveLength(1);
  });
});
