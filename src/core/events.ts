/**
 * 型付き EventBus。
 *
 * sim 内の疎結合な通知に使う（撃破 → ボルテージ加算、小節境界 → スポーン等）。
 * 購読者の呼び出し順は登録順で決定的。
 */
export type Listener<T> = (payload: T) => void;

export class EventBus<Events> {
  private listeners = new Map<keyof Events, Set<Listener<never>>>();

  on<K extends keyof Events>(event: K, listener: Listener<Events[K]>): () => void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(listener as Listener<never>);
    return () => this.off(event, listener);
  }

  once<K extends keyof Events>(event: K, listener: Listener<Events[K]>): () => void {
    const off = this.on(event, (payload) => {
      off();
      listener(payload);
    });
    return off;
  }

  off<K extends keyof Events>(event: K, listener: Listener<Events[K]>): void {
    this.listeners.get(event)?.delete(listener as Listener<never>);
  }

  emit<K extends keyof Events>(event: K, payload: Events[K]): void {
    const set = this.listeners.get(event);
    if (!set) return;
    // 配信中の on/off で反復が壊れないようスナップショットを取る
    for (const listener of [...set]) {
      (listener as Listener<Events[K]>)(payload);
    }
  }

  clear(): void {
    this.listeners.clear();
  }

  listenerCount<K extends keyof Events>(event: K): number {
    return this.listeners.get(event)?.size ?? 0;
  }
}

/** バトル中に流れるイベント。systems はこれを介して会話する */
export interface BattleEvents {
  beat: { bar: number; beat: number };
  bar: { bar: number };
  sectionChanged: { index: number; section: string };
  enemySpawned: { id: number; defId: string };
  enemyKilled: { id: number; defId: string; bounty: number };
  enemyLeaked: { id: number; leak: number };
  /** 倒したはずが蘇った（不死の薬）。撃破としては数えていない */
  enemyRevived: { id: number; defId: string };
  cheerChanged: { value: number; delta: number };
  voltageChanged: { value: number };
  specialStarted: Record<string, never>;
  specialEnded: Record<string, never>;
  audienceChanged: { value: number };
  /** ボスの属性が変わった（偽アカウント） */
  bossPhase: { id: number; attr: string };
  /** レーンのメンバーが沈黙した（強制ログアウト） */
  silenced: { lane: number; count: number };
  /**
   * コール & レスポンスの判定（02-core-battle.md 2.9）。
   * `auto` はコールを切っている人へ自動で配ったぶん（06-ui-ux.md 6.7）
   */
  called: { judge: 'perfect' | 'good' | 'miss'; bar: number; auto: boolean };
  /** ソロパート（楽曲レベル）の発動と終了 */
  soloStarted: { id: number };
  soloEnded: Record<string, never>;
  battleEnded: { won: boolean; audienceLeft: number };
}
