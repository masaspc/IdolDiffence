/**
 * カットイン（06-ui-ux.md 6.3）。
 *
 * ## 何のために出すのか
 *
 * **盤面から目を離させる演出には、その価値がないといけない。**
 * カットインは画面の半分を数百ミリ秒ふさぐので、「いま起きたことを見逃すと
 * 立て直しが利かない」場面にだけ出す —— 月華の解放、ソロパート、ボスの登場、
 * ボスの属性が変わった瞬間、観客が尽きかけたとき。
 * 撃破や配置のような**毎秒起きること**には出さない（音のほうで返す）。
 *
 * ## 溜めない
 *
 * ボスが 2 体同時に湧くような場面では、きっかけが一度に来る。
 * 順番待ちの列を作ると、盤面が動いているのに数秒遅れの通知が流れ続けることになる。
 * **同じ種類は上書き、違う種類は 1 つだけ控える**。
 *
 * ## 時間は描画側で数える
 *
 * sim 時刻に紐付けると、一時停止で演出が固まり、倍速で早送りされる
 * （スペシャルの演出と同じ理由）。
 */
import type { EffectLevel } from '../meta/settings';

export type CutInKind =
  /** 月華の解放 */
  | 'special'
  /** ソロパート */
  | 'solo'
  /** ボス登場 */
  | 'boss'
  /** ボスの属性が変わった */
  | 'phase'
  /** 観客が残りわずか */
  | 'danger';

export interface CutIn {
  kind: CutInKind;
  title: string;
  subtitle?: string;
  /** 左に出す顔。アイドルのスプライト ID */
  idolId?: string;
  /** 左に出す顔。敵のスプライト ID（ボス） */
  enemyId?: string;
}

/** 種類ごとの見た目と長さ。**重い出来事ほど長く**、ただし 1.6 秒を超えない */
export interface CutInStyle {
  durationMs: number;
  /** 帯の色（左 → 右） */
  from: string;
  to: string;
  /** 文字色 */
  ink: string;
}

export const CUTIN_STYLES: Record<CutInKind, CutInStyle> = {
  special: { durationMs: 1400, from: '#ff6ba8', to: '#ffd54f', ink: '#1a1430' },
  solo: { durationMs: 1100, from: '#7ee2a8', to: '#9fd8ff', ink: '#10231c' },
  // ボスは相手側の色。味方の演出と同じ色にすると、
  // 「良いことが起きた」のか「まずいことが起きた」のかが一瞬で読めない
  boss: { durationMs: 1500, from: '#6d3bd4', to: '#ff5f7e', ink: '#ffffff' },
  phase: { durationMs: 900, from: '#3a2f66', to: '#c8b8f0', ink: '#12102a' },
  danger: { durationMs: 1200, from: '#ff5f7e', to: '#ffb02e', ink: '#2b0d14' },
};

/**
 * 演出の強さに応じた長さの倍率。
 *
 * **最小でも消さない。** カットインは点滅ではなく**情報**なので、
 * 消すと「ボスが湧いたことに気づかない」が起きる。短くして刺激だけ減らす
 */
export function cutInSpeed(effects: EffectLevel): number {
  if (effects === 'full') return 1;
  if (effects === 'reduced') return 0.8;
  return 0.6;
}

/**
 * カットインの待ち行列。1 つ表示中 + 1 つ控えまで。
 *
 * 控えを 1 つに絞るのは、**遅れて出るカットインは嘘になる**から。
 * 3 秒前のフェーズ変化をいま出しても、盤面はもう次の局面にいる。
 */
export class CutInQueue {
  private current: CutIn | null = null;
  private ageMs = 0;
  private next: CutIn | null = null;

  push(cutIn: CutIn): void {
    if (!this.current) {
      this.current = cutIn;
      this.ageMs = 0;
      return;
    }
    // 同じ種類が続けて来たら、いま出ているものを差し替える（列を伸ばさない）
    if (this.current.kind === cutIn.kind) {
      this.current = cutIn;
      this.ageMs = 0;
      return;
    }
    this.next = cutIn;
  }

  /** @returns 表示中のカットインと、その進行度（0..1） */
  active(effects: EffectLevel): { cutIn: CutIn; t: number } | null {
    if (!this.current) return null;
    const duration = CUTIN_STYLES[this.current.kind].durationMs * cutInSpeed(effects);
    return { cutIn: this.current, t: Math.min(1, this.ageMs / duration) };
  }

  advance(deltaMs: number, effects: EffectLevel): void {
    if (!this.current) {
      if (this.next) {
        this.current = this.next;
        this.next = null;
        this.ageMs = 0;
      }
      return;
    }
    this.ageMs += deltaMs;
    const duration = CUTIN_STYLES[this.current.kind].durationMs * cutInSpeed(effects);
    if (this.ageMs < duration) return;
    this.current = this.next;
    this.next = null;
    this.ageMs = 0;
  }

  clear(): void {
    this.current = null;
    this.next = null;
    this.ageMs = 0;
  }

  /** テスト用。控えているぶんも含めた本数 */
  get size(): number {
    return (this.current ? 1 : 0) + (this.next ? 1 : 0);
  }
}
