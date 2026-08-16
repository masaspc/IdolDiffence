/**
 * M3 で入った敵の特性とアイドルの固有挙動。
 *
 * どれも「特定の答えを要求する問い」として置いたもの（04-content.md 4.3）なので、
 * **その答えが実際に効くこと**まで確かめる。
 * 例: カガミのシールドは単体では通らず、範囲では通る。
 */
import { describe, expect, it } from 'vitest';
import { createWorld, type BattleWorld } from './world';
import { getEnemy, getIdol, rosterIds } from '../data';
import { runHeadless } from '../core/loop';
import { applyStatus, isImmobilized, type Enemy } from './entities';
import { advanceEnemy, knockbackEnemy } from './systems/movement';
import { buildPaths } from './path';

const SEED = 20260816;

/** 声援を潤沢にして、配置そのものを試せる状態にする */
function richWorld(stageId = 'S1'): BattleWorld {
  const world = createWorld(stageId, SEED);
  world.addCheer(20_000);
  return world;
}

describe('敵データ', () => {
  it('設計書の 9 種がそろっている', () => {
    for (const id of [
      'e_walker',
      'e_runner',
      'e_swarm',
      'e_armor',
      'e_flyer',
      'e_healer',
      'e_shield',
      'e_splitter',
      'e_drainer',
    ]) {
      expect(getEnemy(id).name.length).toBeGreaterThan(0);
    }
  });

  it('特性は該当する敵にだけ付いている', () => {
    expect(getEnemy('e_healer').traits.healAura).toBeDefined();
    expect(getEnemy('e_drainer').traits.drainAura).toBeDefined();
    expect(getEnemy('e_shield').traits.frontShield).toBe(0.6);
    expect(getEnemy('e_splitter').traits.onDeathSpawn?.enemy).toBe('e_swarm');
    expect(getEnemy('e_walker').traits.healAura).toBeUndefined();
  });
});

describe('カガミの前面シールド', () => {
  /**
   * 単体攻撃と範囲攻撃で同じ敵を殴り、削れ方を比べる。
   * 単体（Vi1）は 60% カットされ、範囲（V1）は素通しになるはず。
   */
  function dealDamageWith(idolId: string, x: number, y: number): number {
    const world = richWorld('S7');
    const unit = world.placeUnit(idolId, x, y);
    if (typeof unit === 'string') throw new Error(unit);
    // シールド持ちを直接置いて殴らせる
    const enemy = spawnDummy(world, 'e_shield', unit.cell.x + 1, unit.cell.y);
    runHeadless(4000, (dt) => world.update(dt));
    return enemy.maxHp - enemy.hp;
  }

  it('単体攻撃は 60% カットされ、範囲攻撃は通る', () => {
    const single = dealDamageWith('Vi1', 7, 3);
    const area = dealDamageWith('V1', 7, 3);
    expect(single).toBeGreaterThan(0);
    expect(area).toBeGreaterThan(single);
  });
});

describe('ムラクモの分裂', () => {
  it('撃破すると ホタル が 3 体出る', () => {
    const world = killShot('e_splitter');
    const after = world.snapshot().enemies;
    expect(after.filter((e) => e.name === getEnemy('e_swarm').name).length).toBe(3);
    expect(after.some((e) => e.name === getEnemy('e_splitter').name)).toBe(false);
  });

  it('子はステージ補正込みの HP を持つ（素の値では出ない）', () => {
    const world = killShot('e_splitter');
    const child = internalEnemies(world).find((e) => e.defId === 'e_swarm');
    expect(child).toBeDefined();
    expect(child!.maxHp).toBeGreaterThan(getEnemy('e_swarm').hp);
  });

  /** 瀕死にした敵を 1 発で落とす。撃破まわりの副作用を見るための下ごしらえ */
  function killShot(enemyId: string): BattleWorld {
    const world = richWorld('S6');
    const unit = world.placeUnit('V1', 5, 2);
    if (typeof unit === 'string') throw new Error(unit);
    const target = spawnDummy(world, enemyId, 5.5, 3.0);
    target.hp = 1;
    runHeadless(2000, (dt) => world.update(dt));
    return world;
  }
});

describe('ツキシズクの回復オーラ', () => {
  it('射程内の傷ついた敵を回復する', () => {
    const world = richWorld('S6');
    spawnDummy(world, 'e_healer', 5, 4);
    const wounded = spawnDummy(world, 'e_walker', 5.5, 4);
    wounded.hp = wounded.maxHp * 0.5;
    const before = wounded.hp;

    // ユニットを置いていないので、増減するのは回復ぶんだけ
    runHeadless(1000, (dt) => world.update(dt));
    expect(wounded.hp).toBeGreaterThan(before);
  });

  it('最大 HP は超えない', () => {
    const world = richWorld('S6');
    spawnDummy(world, 'e_healer', 5, 4);
    const full = spawnDummy(world, 'e_walker', 5.5, 4);
    runHeadless(3000, (dt) => world.update(dt));
    expect(full.hp).toBeLessThanOrEqual(full.maxHp);
  });
});

describe('トコヤミの攻撃速度デバフ', () => {
  it('射程内のメンバーの手数が落ちる', () => {
    const shots = (enemyId: string): number => {
      const world = richWorld('S1');
      const unit = world.placeUnit('D1', 4, 6);
      if (typeof unit === 'string') throw new Error(unit);
      // 妨害役を隣に、的をその先に置く
      spawnDummy(world, enemyId, 4.5, 6.5);
      const target = spawnDummy(world, 'e_walker', 5.0, 6.5);
      target.hp = 1e9;
      target.maxHp = 1e9;
      runHeadless(5000, (dt) => world.update(dt));
      return 1e9 - target.hp;
    };
    // ツユは何もしない敵。トコヤミが隣にいるときだけ手数が落ちるはず
    expect(shots('e_drainer')).toBeLessThan(shots('e_walker'));
  });
});

describe('魅了とスタン', () => {
  it('足が止まる', () => {
    const stage = createWorld('S1', SEED).stage;
    const path = buildPaths(stage)[0]!;
    const enemy = makeEnemy();
    advanceEnemy(enemy, path, 1000);
    const moved = enemy.progress;
    expect(moved).toBeGreaterThan(0);

    applyStatus(enemy, { kind: 'charm', value: 1, remainingMs: 2000 });
    expect(isImmobilized(enemy.statuses)).toBe(true);
    advanceEnemy(enemy, path, 1000);
    expect(enemy.progress).toBe(moved);
  });
});

describe('ノックバック', () => {
  it('経路上を後ろへ戻す', () => {
    const stage = createWorld('S1', SEED).stage;
    const path = buildPaths(stage)[0]!;
    const enemy = makeEnemy();
    advanceEnemy(enemy, path, 4000);
    const before = enemy.progress;
    const beforePos = { ...enemy.pos };

    knockbackEnemy(enemy, path, 1.5);
    expect(enemy.progress).toBeCloseTo(before - 1.5, 5);
    // 進捗だけでなく実際の位置も戻っていること
    expect(enemy.pos.x).not.toBeCloseTo(beforePos.x, 5);
  });

  it('スタート地点より手前へは戻さない', () => {
    const stage = createWorld('S1', SEED).stage;
    const path = buildPaths(stage)[0]!;
    const enemy = makeEnemy();
    advanceEnemy(enemy, path, 200);
    knockbackEnemy(enemy, path, 99);
    expect(enemy.progress).toBe(0);
  });
});

describe('ドット絵の指定', () => {
  it('全員に art がある（欠けると黙って丸に戻る）', () => {
    for (const id of rosterIds) {
      expect(getIdol(id).art, `${id} に art が無い`).toBeDefined();
    }
  });

  it('同じ系統の中では髪型か髪色が違う（盤面で見分けられること）', () => {
    const byType = new Map<string, string[]>();
    for (const id of rosterIds) {
      const def = getIdol(id);
      // 人型でない 2 体（犬DOGE・FUSHI）は体の作りから違う。
      // 髪型の欄は使っていないので、`form` も鍵に混ぜて見る
      const key = `${def.art!.form}/${def.art!.hairStyle}/${def.art!.hair}`;
      const list = byType.get(def.type) ?? [];
      list.push(key);
      byType.set(def.type, list);
    }
    for (const [type, keys] of byType) {
      expect(new Set(keys).size, `${type} に見分けの付かない組み合わせがある`).toBe(keys.length);
    }
  });
});

describe('モニター前のマス', () => {
  /** 配置して、解決済みの減速効果を読む */
  function slowEffect(idolId: string, x: number, y: number): { value: number; durationMs: number } {
    const world = richWorld('S7');
    const unit = world.placeUnit(idolId, x, y);
    if (typeof unit === 'string') throw new Error(unit);
    const slow = unit.attack.onHit.find((o) => o.status === 'slow');
    if (!slow) throw new Error(`${idolId} は減速を持っていない`);
    return { value: slow.value, durationMs: slow.durationMs };
  }

  it('ヴィジュアルの状態異常は「効果時間」が伸びる（効果量ではない）', () => {
    // 02-core-battle.md 2.1 の定義は「ヴィジュアル系スキルの効果時間 +25%」
    const onMonitor = slowEffect('Vi1', 7, 3); // monitor
    const elsewhere = slowEffect('Vi1', 7, 5); // runway
    expect(onMonitor.durationMs).toBeCloseTo(elsewhere.durationMs * 1.25, 5);
    expect(onMonitor.value).toBeCloseTo(elsewhere.value, 5);
  });

  it('ヴィジュアル以外は伸びない', () => {
    // 全系統に効かせると、妨害が本業でない系統をモニター前へ置くのが
    // 常に得になり、マスの性格が消える
    const onMonitor = slowEffect('D1', 7, 3);
    const elsewhere = slowEffect('D1', 1, 0); // 本舞台
    expect(onMonitor.durationMs).toBeCloseTo(elsewhere.durationMs, 5);
  });
});

describe('アイドルの固有挙動', () => {
  it('V3 は防御無視を持ち、貫通線で攻撃する', () => {
    const def = getIdol('V3');
    expect(def.attack.kind).toBe('pierce_line');
    expect(def.attack.defIgnore).toBeCloseTo(0.4);
  });

  it('D2 の覚醒 A だけがダンスに対空を与える', () => {
    const def = getIdol('D2');
    expect(def.attack.canHitFlying).toBe(false);
    expect(def.awakening?.A.mods.grantFlying).toBe(true);
    expect(def.awakening?.B.mods.grantFlying).toBeUndefined();
  });

  it('V2 のオーラが近くの味方の攻撃力を上げる', () => {
    const world = richWorld('S3');
    const alone = world.placeUnit('D1', 2, 3);
    if (typeof alone === 'string') throw new Error(alone);
    const before = world.snapshot().units.find((u) => u.id === alone.id)!.atk;

    const buffer = world.placeUnit('V2', 2, 5);
    if (typeof buffer === 'string') throw new Error(buffer);
    const after = world.snapshot().units.find((u) => u.id === alone.id)!.atk;

    expect(after).toBeGreaterThan(before);
  });

  it('V2 の覚醒 B「独唱」はオーラを捨てて自身を強化する', () => {
    const world = richWorld('S3');
    const buffer = world.placeUnit('V2', 2, 5);
    const ally = world.placeUnit('D1', 2, 3);
    if (typeof buffer === 'string' || typeof ally === 'string') throw new Error('placement failed');
    world.upgradeUnit(buffer.id);
    world.upgradeUnit(buffer.id);

    const allyBuffed = world.snapshot().units.find((u) => u.id === ally.id)!.atk;
    const selfBefore = world.snapshot().units.find((u) => u.id === buffer.id)!.atk;

    expect(world.chooseAwakening(buffer.id, 'B')).toBe(true);

    const allyAfter = world.snapshot().units.find((u) => u.id === ally.id)!.atk;
    const selfAfter = world.snapshot().units.find((u) => u.id === buffer.id)!.atk;

    expect(allyAfter).toBeLessThan(allyBuffed); // 味方のバフは消える
    expect(selfAfter).toBeGreaterThan(selfBefore); // 自分は伸びる
  });

  it('D3 は瀕死の敵に倍率が乗る', () => {
    const damageAt = (hpRatio: number): number => {
      const world = richWorld('S1');
      const unit = world.placeUnit('D3', 4, 6);
      if (typeof unit === 'string') throw new Error(unit);
      const target = spawnDummy(world, 'e_walker', 4.6, 6.5);
      target.maxHp = 1e9;
      target.hp = 1e9 * hpRatio;
      const before = target.hp;
      runHeadless(1600, (dt) => world.update(dt));
      return before - target.hp;
    };
    expect(damageAt(0.2)).toBeGreaterThan(damageAt(0.9));
  });
});

// --- ヘルパー ---

/**
 * sim の内部配列へ敵を直接ねじ込む。
 *
 * スポーン表を待つと、検証したい状況（特定の敵が特定の位置にいる）を
 * 作るのに数十秒ぶんの更新が要る。特性そのものを見たいテストでは邪魔なので、
 * ここだけ内部にアクセスする。
 */
function spawnDummy(world: BattleWorld, enemyId: string, x: number, y: number): Enemy {
  const def = getEnemy(enemyId);
  const hp = def.hp * world.stage.hpMul;
  const enemy: Enemy = {
    id: 100000 + internalEnemies(world).length,
    defId: enemyId,
    name: def.name,
    attr: def.attr,
    hp,
    maxHp: hp,
    def: def.def,
    baseSpeed: 0, // 動かれると位置関係が崩れるので止めておく
    flying: def.flying,
    radius: def.radius,
    leak: def.leak,
    bounty: def.bounty,
    traits: def.traits,
    lane: 0,
    pathIndex: 0,
    pathT: 0,
    progress: 1,
    pos: { x, y },
    prevPos: { x, y },
    statuses: [],
    alive: true,
  };
  internalEnemies(world).push(enemy);
  return enemy;
}

function internalEnemies(world: BattleWorld): Enemy[] {
  return (world as unknown as { enemies: Enemy[] }).enemies;
}

function makeEnemy(): Enemy {
  const def = getEnemy('e_walker');
  return {
    id: 1,
    defId: 'e_walker',
    name: def.name,
    attr: def.attr,
    hp: def.hp,
    maxHp: def.hp,
    def: def.def,
    baseSpeed: def.speed,
    flying: false,
    radius: def.radius,
    leak: def.leak,
    bounty: def.bounty,
    traits: def.traits,
    lane: 0,
    pathIndex: 0,
    pathT: 0,
    progress: 0,
    pos: { x: 0, y: 4 },
    prevPos: { x: 0, y: 4 },
    statuses: [],
    alive: true,
  };
}
