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
  cheerChanged: { value: number; delta: number };
  voltageChanged: { value: number };
  specialStarted: Record<string, never>;
  specialEnded: Record<string, never>;
  audienceChanged: { value: number };
  battleEnded: { won: boolean; audienceLeft: number };
}
