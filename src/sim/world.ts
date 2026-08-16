/**
 * バトルシミュレーションの状態コンテナ。
 *
 * **DOM に一切依存しない**。React はフレームごとに読み取り専用のスナップショットを
 * 受け取るだけで、逆方向の参照は持たない（docs/design/05-architecture.md 5.1）。
 * これによりヘッドレスのバランス検証とテストが成立する。
 */
import { GameClock } from '../core/clock';
import { EventBus, type BattleEvents } from '../core/events';
import { createRng, type Rng } from '../core/rng';
import { getEnemy, getIdol, getSong, getStage, type Song, type Stage } from '../data';
import { tempoMul } from '../data/schema/song';
import { clamp, vec } from '../core/vec';
import { buildPaths, type Path } from './path';
import {
  tickStatuses,
  type Enemy,
  type EntityId,
  type FloatingText,
  type Unit,
} from './entities';
import { buildSpawnSchedule, waveHpMultiplier, type ScheduledSpawn } from './systems/spawn';
import { advanceEnemy } from './systems/movement';
import { updateUnit } from './systems/combat';
import type { DamageResult } from './damage';

/** 声援の自然回復。観客ゲージへの依存は意図的に浅い（02-core-battle.md 2.3） */
const CHEER_REGEN_BASE = 5.0;
const CHEER_REGEN_PER_AUDIENCE = 0.01;
const INITIAL_CHEER = 150;
const INITIAL_AUDIENCE = 100;

/** 小節ごとの月華（ボルテージ）基礎蓄積。劣勢からの逆転経路を確保するため */
const VOLTAGE_PER_BAR = 2.0;
const VOLTAGE_MAX = 100;
/** 与ダメージ 100 につき */
const VOLTAGE_PER_100_DAMAGE = 0.4;
const VOLTAGE_PER_KILL = 1.5;

/** 売却時の返却率。編成ミスのリカバリーを許す */
const SELL_REFUND = 0.6;

const FLOATING_TEXT_LIFE_MS = 700;

export interface WaveInfo {
  index: number;
  section: string;
  startBar: number;
  bars: number;
  cardPick: boolean;
}

export interface UnitView {
  id: EntityId;
  idolId: string;
  shortName: string;
  type: string;
  cell: { x: number; y: number };
  x: number;
  y: number;
  range: number;
  cost: number;
  /** 直近の攻撃からの経過。攻撃演出に使う */
  lastAttackAgeMs: number;
  targetX: number | null;
  targetY: number | null;
  attackKind: string;
  attackRadius: number;
}

export interface EnemyView {
  id: EntityId;
  name: string;
  attr: string;
  x: number;
  y: number;
  prevX: number;
  prevY: number;
  radius: number;
  hpRatio: number;
  slowed: boolean;
}

export interface WorldSnapshot {
  stageId: string;
  stageName: string;
  songName: string;
  bpm: number;
  bar: number;
  barProgress: number;
  wave: WaveInfo | null;
  waveCount: number;
  cheer: number;
  audience: number;
  voltage: number;
  clockState: string;
  speed: number;
  finished: boolean;
  won: boolean;
  units: UnitView[];
  enemies: EnemyView[];
  floatingTexts: readonly FloatingText[];
  /** 残りスポーン数。「あと何体で終わりか」を HUD に出す */
  remainingSpawns: number;
  killed: number;
  leaked: number;
}

export type PlacementError = 'not-placeable' | 'occupied' | 'insufficient-cheer' | 'finished';

export class BattleWorld {
  readonly stage: Stage;
  readonly song: Song;
  readonly clock: GameClock;
  readonly events = new EventBus<BattleEvents>();
  readonly rng: Rng;
  readonly seed: number;

  private readonly waves: WaveInfo[];
  private readonly totalBars: number;
  private readonly paths: Path[];
  private readonly schedule: ScheduledSpawn[];
  private readonly placeableKeys: Set<string>;

  private scheduleCursor = 0;
  private nextEntityId = 1;

  private enemies: Enemy[] = [];
  private units: Unit[] = [];
  private floatingTexts: FloatingText[] = [];

  private cheer = INITIAL_CHEER;
  private audience = INITIAL_AUDIENCE;
  private voltage = 0;
  private finished = false;
  private won = false;
  private killed = 0;
  private leaked = 0;

  constructor(
    readonly stageId: string,
    seed: number,
  ) {
    this.stage = getStage(stageId);
    this.song = getSong(this.stage.song);
    this.clock = new GameClock(this.song.bpm, this.song.beatsPerBar);
    this.seed = seed;
    this.rng = createRng(seed);
    this.paths = buildPaths(this.stage);
    this.schedule = buildSpawnSchedule(this.stage, this.song);
    this.placeableKeys = new Set(this.stage.placeable.map(([x, y]) => `${x},${y}`));

    let startBar = 0;
    this.waves = this.stage.waves.map((wave, index) => {
      const info: WaveInfo = {
        index,
        section: wave.section,
        startBar,
        bars: wave.bars,
        cardPick: wave.cardPick,
      };
      startBar += wave.bars;
      return info;
    });
    this.totalBars = startBar;
  }

  /** 固定ステップの更新。呼び出し元は GameLoop か runHeadless のみ */
  update(dtMs: number): void {
    if (this.finished) return;

    const advanced = this.clock.advance(dtMs, (info) => {
      this.events.emit('beat', { bar: info.bar, beat: info.beat });
      if (info.beat === 0) {
        this.events.emit('bar', { bar: info.bar });
        this.addVoltage(VOLTAGE_PER_BAR);
      }
    });
    if (advanced === 0) return;

    this.updateEconomy(advanced);
    this.spawnDueEnemies();
    this.updateEnemies(advanced);
    this.updateUnits(advanced);
    this.updateFloatingTexts(advanced);
    this.checkCompletion();
  }

  private updateEconomy(dtMs: number): void {
    const regen = CHEER_REGEN_BASE + CHEER_REGEN_PER_AUDIENCE * this.audience;
    this.addCheer((regen * dtMs) / 1000);
  }

  private spawnDueEnemies(): void {
    const now = this.clock.now;
    while (this.scheduleCursor < this.schedule.length) {
      const next = this.schedule[this.scheduleCursor];
      if (!next || next.atMs > now) break;
      this.scheduleCursor++;
      this.spawnEnemy(next);
    }
  }

  private spawnEnemy(scheduled: ScheduledSpawn): void {
    const def = getEnemy(scheduled.enemyId);
    const path = this.paths[scheduled.lane] ?? this.paths[0];
    if (!path) return;

    const start = path.segments[0]?.from ?? path.goal;
    // HP にもテンポ正規化を掛ける。出現数だけを補正すると、
    // 高 BPM の曲で「数は減ったが 1 体あたりは硬いまま」になり、
    // 秒あたりの要求 DPS が曲ごとにずれる（02-core-battle.md 2.4）
    const hp =
      def.hp * tempoMul(this.song) * waveHpMultiplier(scheduled.waveIndex) * this.stage.hpMul;

    const enemy: Enemy = {
      id: this.nextEntityId++,
      defId: scheduled.enemyId,
      name: def.name,
      attr: def.attr,
      hp,
      maxHp: hp,
      def: def.def,
      baseSpeed: def.speed,
      flying: def.flying,
      radius: def.radius,
      leak: def.leak,
      bounty: def.bounty,
      lane: scheduled.lane,
      pathIndex: 0,
      pathT: 0,
      progress: 0,
      pos: vec(start.x, start.y),
      prevPos: vec(start.x, start.y),
      statuses: [],
      alive: true,
    };
    this.enemies.push(enemy);
    this.events.emit('enemySpawned', { id: enemy.id, defId: enemy.defId });
  }

  private updateEnemies(dtMs: number): void {
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const enemy = this.enemies[i];
      if (!enemy) continue;

      if (!enemy.alive) {
        this.enemies.splice(i, 1);
        continue;
      }

      tickStatuses(enemy, dtMs);
      const path = this.paths[enemy.lane] ?? this.paths[0];
      if (!path) continue;

      if (advanceEnemy(enemy, path, dtMs)) {
        enemy.alive = false;
        this.enemies.splice(i, 1);
        this.leaked++;
        this.events.emit('enemyLeaked', { id: enemy.id, leak: enemy.leak });
        this.leakAudience(enemy.leak);
      }
    }
  }

  private updateUnits(dtMs: number): void {
    const ctx = {
      rng: this.rng,
      enemies: this.enemies,
      applyDamage: (enemy: Enemy, result: DamageResult) => this.applyDamage(enemy, result),
    };
    for (const unit of this.units) {
      updateUnit(unit, ctx, dtMs);
    }
  }

  private applyDamage(enemy: Enemy, result: DamageResult): void {
    if (!enemy.alive) return;
    enemy.hp -= result.amount;
    this.addVoltage((result.amount / 100) * VOLTAGE_PER_100_DAMAGE);

    this.floatingTexts.push({
      x: enemy.pos.x,
      y: enemy.pos.y,
      amount: Math.round(result.amount),
      crit: result.crit,
      effectiveness: result.effectiveness,
      ageMs: 0,
      lifeMs: FLOATING_TEXT_LIFE_MS,
    });

    if (enemy.hp <= 0) {
      enemy.alive = false;
      this.killed++;
      this.addCheer(enemy.bounty);
      this.addVoltage(VOLTAGE_PER_KILL);
      this.events.emit('enemyKilled', { id: enemy.id, defId: enemy.defId, bounty: enemy.bounty });
    }
  }

  private updateFloatingTexts(dtMs: number): void {
    for (let i = this.floatingTexts.length - 1; i >= 0; i--) {
      const text = this.floatingTexts[i];
      if (!text) continue;
      text.ageMs += dtMs;
      if (text.ageMs >= text.lifeMs) this.floatingTexts.splice(i, 1);
    }
  }

  /** 全ウェーブを流し切り、残った敵も片付いたら完走 */
  private checkCompletion(): void {
    const spawnsDone = this.scheduleCursor >= this.schedule.length;
    const barsDone = this.clock.bar >= this.totalBars;
    if (spawnsDone && barsDone && this.enemies.length === 0) this.finish(true);
  }

  // --- 操作 ---

  canPlace(idolId: string, x: number, y: number): PlacementError | null {
    if (this.finished) return 'finished';
    if (!this.placeableKeys.has(`${x},${y}`)) return 'not-placeable';
    if (this.units.some((u) => u.cell.x === x && u.cell.y === y)) return 'occupied';
    if (this.cheer < getIdol(idolId).cost) return 'insufficient-cheer';
    return null;
  }

  placeUnit(idolId: string, x: number, y: number): Unit | PlacementError {
    const error = this.canPlace(idolId, x, y);
    if (error) return error;

    const def = getIdol(idolId);
    this.spendCheer(def.cost);

    const unit: Unit = {
      id: this.nextEntityId++,
      idolId,
      name: def.name,
      shortName: def.shortName,
      type: def.type,
      cell: { x, y },
      pos: vec(x + 0.5, y + 0.5),
      cost: def.cost,
      atk: def.base.atk,
      range: def.base.range,
      attackIntervalMs: def.base.attackIntervalMs,
      critRate: def.base.critRate,
      critDmg: def.base.critDmg,
      attack: def.attack,
      cooldownMs: 0,
      lastTargetPos: null,
      lastAttackAgeMs: Number.POSITIVE_INFINITY,
    };
    this.units.push(unit);
    return unit;
  }

  /** 投入コストの 60% を返却する */
  sellUnit(id: EntityId): boolean {
    const index = this.units.findIndex((u) => u.id === id);
    if (index < 0) return false;
    const unit = this.units[index];
    if (!unit) return false;
    this.units.splice(index, 1);
    this.addCheer(Math.floor(unit.cost * SELL_REFUND));
    return true;
  }

  unitAt(x: number, y: number): Unit | null {
    return this.units.find((u) => u.cell.x === x && u.cell.y === y) ?? null;
  }

  isPlaceable(x: number, y: number): boolean {
    return this.placeableKeys.has(`${x},${y}`);
  }

  // --- リソース ---

  addCheer(delta: number): void {
    const next = Math.max(0, this.cheer + delta);
    const applied = next - this.cheer;
    this.cheer = next;
    if (applied !== 0) this.events.emit('cheerChanged', { value: this.cheer, delta: applied });
  }

  spendCheer(cost: number): boolean {
    if (this.cheer < cost) return false;
    this.addCheer(-cost);
    return true;
  }

  addVoltage(delta: number): void {
    const next = clamp(this.voltage + delta, 0, VOLTAGE_MAX);
    if (next === this.voltage) return;
    this.voltage = next;
    this.events.emit('voltageChanged', { value: this.voltage });
  }

  leakAudience(amount: number): void {
    this.audience = Math.max(0, this.audience - amount);
    this.events.emit('audienceChanged', { value: this.audience });
    if (this.audience <= 0) this.finish(false);
  }

  private finish(won: boolean): void {
    if (this.finished) return;
    this.finished = true;
    this.won = won;
    this.clock.pause();
    this.events.emit('battleEnded', { won, audienceLeft: this.audience });
  }

  get currentWave(): WaveInfo | null {
    const bar = this.clock.bar;
    for (const wave of this.waves) {
      if (bar < wave.startBar + wave.bars) return wave;
    }
    return null;
  }

  get totalSpawnCount(): number {
    return this.schedule.length;
  }

  snapshot(): WorldSnapshot {
    return {
      stageId: this.stageId,
      stageName: this.stage.name,
      songName: this.song.name,
      bpm: this.song.bpm,
      bar: this.clock.bar,
      barProgress: this.clock.barProgress,
      wave: this.currentWave,
      waveCount: this.waves.length,
      cheer: Math.floor(this.cheer),
      audience: this.audience,
      voltage: this.voltage,
      clockState: this.clock.currentState,
      speed: this.clock.playbackSpeed,
      finished: this.finished,
      won: this.won,
      killed: this.killed,
      leaked: this.leaked,
      remainingSpawns: this.schedule.length - this.scheduleCursor,
      units: this.units.map((u) => ({
        id: u.id,
        idolId: u.idolId,
        shortName: u.shortName,
        type: u.type,
        cell: u.cell,
        x: u.pos.x,
        y: u.pos.y,
        range: u.range,
        cost: u.cost,
        lastAttackAgeMs: u.lastAttackAgeMs,
        targetX: u.lastTargetPos?.x ?? null,
        targetY: u.lastTargetPos?.y ?? null,
        attackKind: u.attack.kind,
        attackRadius: u.attack.radius,
      })),
      enemies: this.enemies.map((e) => ({
        id: e.id,
        name: e.name,
        attr: e.attr,
        x: e.pos.x,
        y: e.pos.y,
        prevX: e.prevPos.x,
        prevY: e.prevPos.y,
        radius: e.radius,
        hpRatio: Math.max(0, e.hp / e.maxHp),
        slowed: e.statuses.some((s) => s.kind === 'slow'),
      })),
      floatingTexts: this.floatingTexts,
    };
  }
}

export function createWorld(stageId: string, seed: number): BattleWorld {
  return new BattleWorld(stageId, seed);
}
