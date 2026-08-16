/**
 * ヘッドレスでバトルを回すための駆動。
 *
 * セットリストの ◆ では sim が停止するので、**誰かが選ばないと進まない**。
 * テストとバランス計測の両方で必要になるため、ここに一本化する。
 */
import { runHeadless } from '../core/loop';
import type { BattleWorld, CardOfferView, WorldSnapshot } from './world';

export interface Placement {
  idolId: string;
  x: number;
  y: number;
  /** 配置後に上げるポジションレベル（省略時は 1 のまま） */
  upgradeTo?: 2 | 3;
  /** Lv3 に到達したときの覚醒分岐 */
  awakening?: 'A' | 'B';
}

export interface AutoplayOptions {
  /** 声援が貯まり次第、先頭から順に配置していく */
  plan?: readonly Placement[];
  /** 提示された 3 枚からどれを選ぶか。既定は先頭 */
  pickCard?: (offers: readonly CardOfferView[]) => string | null;
  /** 月華が満タンになったら即発動するか */
  useSpecial?: boolean;
  /** 打ち切り時間 */
  maxMs?: number;
}

export interface AutoplayResult {
  snapshot: WorldSnapshot;
  /** 実際に配置できた数 */
  placed: number;
  elapsedMs: number;
  specialsUsed: number;
  cardsPicked: number;
}

export function autoplay(world: BattleWorld, options: AutoplayOptions = {}): AutoplayResult {
  const plan = options.plan ?? [];
  const pickCard = options.pickCard ?? ((offers) => offers[0]?.id ?? null);
  const maxMs = options.maxMs ?? 10 * 60 * 1000;

  let cursor = 0;
  let elapsedMs = 0;
  let specialsUsed = 0;
  let cardsPicked = 0;
  /** 配置済みユニットの id。強化・覚醒の対象を追う */
  const placedIds: number[] = [];

  runHeadless(
    maxMs,
    (dt) => {
      world.update(dt);
      elapsedMs += dt;

      // ◆ は sim を止める。選ばないと永遠に進まない
      const offers = world.snapshot().offers;
      if (offers) {
        const choice = pickCard(offers);
        if (choice) {
          world.chooseCard(choice);
          cardsPicked++;
        }
        return;
      }

      if (options.useSpecial && world.specialReady) {
        world.activateSpecial();
        specialsUsed++;
      }

      const next = plan[cursor];
      if (next && world.canPlace(next.idolId, next.x, next.y) === null) {
        const unit = world.placeUnit(next.idolId, next.x, next.y);
        if (typeof unit !== 'string') {
          placedIds.push(unit.id);
          cursor++;
        }
        return;
      }

      // 配置が一巡したら、余った声援で強化していく
      applyUpgrades(world, plan, placedIds);
    },
    () => world.snapshot().finished,
  );

  return { snapshot: world.snapshot(), placed: cursor, elapsedMs, specialsUsed, cardsPicked };
}

function applyUpgrades(
  world: BattleWorld,
  plan: readonly Placement[],
  placedIds: readonly number[],
): void {
  for (let i = 0; i < placedIds.length; i++) {
    const id = placedIds[i];
    const target = plan[i];
    if (id === undefined || !target?.upgradeTo) continue;

    const view = world.snapshot().units.find((u) => u.id === id);
    if (!view) continue;

    if (view.awaitingAwakening && target.awakening) {
      world.chooseAwakening(id, target.awakening);
      return;
    }
    if (view.level < target.upgradeTo && world.upgradeUnit(id) === null) return;
  }
}
