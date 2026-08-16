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
import {
  cards,
  getEnemy,
  getIdol,
  getSong,
  getStage,
  rosterIds,
  type Song,
  type Stage,
} from '../data';
import type { IdolType } from '../data/schema/common';
import type { AwakeningKey, CenterPassive } from '../data/schema/idol';
import { clamp, vec, withinRange } from '../core/vec';
import { buildPaths, type Path } from './path';
import {
  echoStacks,
  isImmobilized,
  tickStatuses,
  type Enemy,
  type EntityId,
  type FloatingText,
  type Unit,
} from './entities';
import { buildSpawnSchedule, waveHpMultiplier, type ScheduledSpawn } from './systems/spawn';
import {
  evaluateFormations,
  formationModsFor,
  type FormationHit,
  type FormationResult,
} from './systems/formation';

import { advanceEnemy, knockbackEnemy } from './systems/movement';
import { updateUnit } from './systems/combat';
import { applyCard, drawOffers, type CardOffer } from './systems/cards';
import { addPct, addTypePct, emptyPool, resolveStat, type ModifierPool } from './modifiers';
import {
  centerEconomyPool,
  resolveUnit,
  resolveUnitAura,
  upgradeCost,
  AWAKENING_LEVEL,
  MAX_POSITION_LEVEL,
  SPECIAL_ENEMY_SPEED_MUL,
} from './unitStats';
import { defenseReduction, type DamageResult } from './damage';
import { ECHO_MAX_STACKS } from './entities';
import type { TalentEffects } from '../meta/talents';

/** 声援の自然回復。観客ゲージへの依存は意図的に浅い（02-core-battle.md 2.3） */
const CHEER_REGEN_BASE = 5.0;
const CHEER_REGEN_PER_AUDIENCE = 0.01;
const INITIAL_CHEER = 150;
const INITIAL_AUDIENCE = 100;

/** 小節ごとの月華（ボルテージ）基礎蓄積。劣勢からの逆転経路を確保するため */
const VOLTAGE_PER_BAR = 2.0;
const VOLTAGE_MAX = 100;
/**
 * 戦闘による蓄積は「敵 1 体ぶんの HP を削るごと」に与える。
 *
 * 以前はダメージの**絶対値**に比例させていたが、それだと `hpMul` の大きい
 * ステージほど無制限に供給される。実測では S7（hpMul 11）で 1 ライブ 29 回も
 * 発動し、スペシャルが「ここぞの一撃」ではなく常時バフになっていた。
 * 削った割合で数えれば、ステージの硬さが変わっても発動回数は敵の**数**にだけ
 * 比例する（S1 で 4〜5 回、S7 で 8〜10 回）。
 */
const VOLTAGE_PER_ENEMY_HP = 1.0;
/** サビ中は蓄積 1.5 倍 */
const VOLTAGE_CHORUS_MUL = 1.5;

/** スペシャルライブの持続 */
const SPECIAL_DURATION_MS = 8000;

/** 売却時の返却率。編成ミスのリカバリーを許す */
const SELL_REFUND = 0.6;

/**
 * セクションごとの HP 補正（02-core-battle.md 2.4）。
 * サビと大サビは「圧の高い区間」として、数だけでなく硬さでも山を作る。
 */
function sectionHpMultiplier(section: string | undefined): number {
  if (section === 'chorus') return 1.15;
  if (section === 'finale') return 1.25;
  return 1;
}

/** 覚醒 B の Echo が与える毎秒ダメージ（1 スタックあたり） */
const ECHO_DPS = 18;

const FLOATING_TEXT_LIFE_MS = 700;

/**
 * 才能ボードの合算結果を加算プールへ移す。
 *
 * 才能は**加算**（03-progression.md E-1）。乗算にすると、系統を寄せたときだけ
 * 掛け算が伸びて他の系統が置き去りになる。
 */
function buildTalentPool(effects: TalentEffects | undefined): ModifierPool {
  const pool = emptyPool();
  if (!effects) return pool;

  addPct(pool, 'atk', effects.atkPct);
  addPct(pool, 'range', effects.rangePct);
  addPct(pool, 'attackSpeed', effects.attackSpeedPct);
  addPct(pool, 'critRate', effects.critRateAdd);
  addPct(pool, 'critDmg', effects.critDmgAdd);
  addPct(pool, 'cheerGain', effects.cheerGainPct);
  addPct(pool, 'voltageGain', effects.voltageGainPct);
  addPct(pool, 'slowPower', effects.statusPowerPct);
  addPct(pool, 'statusDuration', effects.statusDurationPct);
  addPct(pool, 'aoeRadius', effects.aoeRadiusPct);
  for (const [type, value] of Object.entries(effects.typeAtkPct)) {
    if (value !== undefined) addTypePct(pool, type as IdolType, value);
  }
  return pool;
}

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
  /** ドット絵の引き当てキー。進化していると `"V1:evolved"` になる */
  spriteId: string;
  shortName: string;
  type: string;
  cell: { x: number; y: number };
  x: number;
  y: number;
  range: number;
  atk: number;
  level: number;
  maxLevel: number;
  awakening: AwakeningKey | null;
  /** 乗っている覚醒の名前。Lv6 では 2 つ並ぶ */
  awakeningNames: string[];
  investedCost: number;
  upgradeCost: number | null;
  /** Lv3 に到達して覚醒未選択なら true */
  awaitingAwakening: boolean;
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
  /** 魅了・スタンで足が止まっている */
  bound: boolean;
  echo: number;
}

export interface CardOfferView {
  id: string;
  name: string;
  rarity: string;
  desc: string;
}

export interface PaletteEntry {
  idolId: string;
  shortName: string;
  type: string;
  /** センター補正を反映した実コスト */
  cost: number;
  /** センターかどうか。HUD で印を出す */
  isCenter: boolean;
}

export interface WorldSnapshot {
  stageId: string;
  stageName: string;
  /** 出撃メンバー。HUD の配置パレットはこれをそのまま並べる */
  palette: PaletteEntry[];
  /** センターの**アイドル名**。HUD は誰がセンターかを出したいのでパッシブ名ではない */
  centerName: string | null;
  songName: string;
  bpm: number;
  bar: number;
  barProgress: number;
  wave: WaveInfo | null;
  waveCount: number;
  cheer: number;
  audience: number;
  voltage: number;
  specialReady: boolean;
  specialRemainingMs: number;
  clockState: string;
  speed: number;
  finished: boolean;
  won: boolean;
  units: UnitView[];
  enemies: EnemyView[];
  floatingTexts: readonly FloatingText[];
  remainingSpawns: number;
  killed: number;
  leaked: number;
  /** 提示中のセットリスト。null なら選択中でない */
  offers: CardOfferView[] | null;
  takenCards: { name: string; count: number }[];
  /** 成立中のフォーメーション。同じ種類はまとめて数える */
  formations: { id: string; name: string; desc: string; count: number }[];
}

export type PlacementError =
  | 'not-placeable'
  | 'occupied'
  | 'insufficient-cheer'
  | 'not-in-party'
  | 'finished';
export type UpgradeError =
  | 'not-found'
  | 'max-level'
  | 'insufficient-cheer'
  | 'finished'
  /** Lv3 の覚醒分岐を選ぶまで、その先へは上げられない */
  | 'awakening-required';

/** 計測用のイベントログ（07-roadmap.md M2 の計測） */
export interface LogEntry {
  atMs: number;
  bar: number;
  kind: string;
  detail?: Record<string, string | number | boolean>;
}

export interface BattleMeta {
  /** アイドル ID -> 育成後の基礎攻撃力 */
  atkByIdol?: Record<string, number>;
  /**
   * 出撃メンバー（最大 5 人）。空なら制限しない。
   * ヘッドレス計測やテストで毎回 5 人を書きたくないので、既定は「制限なし」にしている
   */
  party?: readonly string[];
  /** センター。party に含まれていないと無視する */
  center?: string | null;
  /**
   * 才能ボードの合算結果。**セーブそのものは渡さない**。
   * sim がメタ層の形を知ると、ヘッドレス計測が回しづらくなる
   */
  talents?: TalentEffects;
  /** 進化（Ray）を解放済みのアイドル ID（03-progression.md ⑦-2） */
  evolved?: readonly string[];
}

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
  private readonly meta: BattleMeta;
  /** 出撃メンバーの制限。空なら全員置ける */
  private readonly partyIds: ReadonlySet<string>;
  private readonly center: CenterPassive | undefined;
  private readonly centerName: string | null;
  private readonly centerIdolId: string | null;
  /** センターによる配置コスト倍率。彩葉センターで -8% */
  private readonly costMul: number;
  /** センターによるスペシャルライブの延長 */
  private readonly specialBonusMs: number;
  /**
   * センターのうち経済（声援・月華）に効くぶん。
   * ユニットのローカルプールへ積んでも経済計算には届かないので、別に持つ
   */
  private readonly centerPool: ModifierPool;
  private readonly palette: PaletteEntry[];
  /** 才能ボード（恒久）の加算プール。ラン中は変わらない */
  private readonly talentPool: ModifierPool;
  private readonly talents: TalentEffects | undefined;
  private readonly echoMaxStacks: number;
  private readonly echoDps: number;
  /** 進化済みのアイドル。配置時に引き当てるので Set で持つ */
  private readonly evolvedIds: ReadonlySet<string>;

  private scheduleCursor = 0;
  private nextEntityId = 1;

  private enemies: Enemy[] = [];
  private units: Unit[] = [];
  private floatingTexts: FloatingText[] = [];

  /** ラン内カードの効果が溜まるプール */
  private runPool: ModifierPool = emptyPool();
  private takenCards = new Map<string, number>();
  private offers: CardOffer[] | null = null;
  /** カード選択済みのウェーブ。同じ ◆ で二度出さないため */
  private resolvedPicks = new Set<number>();

  /** フォーメーションの成立状況。配置が変わったときだけ数え直す */
  private formation: FormationResult = { byUnit: new Map(), voltageMul: 1, hits: [] };
  /** 才能「ステップアップ」の累積。ウェーブが変わるとリセットする */
  private killSpeedBonus = 0;
  private killSpeedWave = -1;

  private specialRemainingMs = 0;
  private cheer = INITIAL_CHEER;
  private audience = INITIAL_AUDIENCE;
  private voltage = 0;
  private finished = false;
  private won = false;
  private killed = 0;
  private leaked = 0;

  readonly log: LogEntry[] = [];

  constructor(
    readonly stageId: string,
    seed: number,
    meta: BattleMeta = {},
  ) {
    this.stage = getStage(stageId);
    this.song = getSong(this.stage.song);
    this.clock = new GameClock(this.song.bpm, this.song.beatsPerBar);
    this.seed = seed;
    this.rng = createRng(seed);
    this.meta = meta;
    this.paths = buildPaths(this.stage);
    this.schedule = buildSpawnSchedule(this.stage, this.song);
    this.placeableKeys = new Set(this.stage.placeable.map(([x, y]) => `${x},${y}`));

    this.partyIds = new Set(meta.party ?? []);
    // 進化先を持たない ID が混ざっていても害はないが、
    // パレットの表示名を引くたびに定義を見に行くので絞っておく
    this.evolvedIds = new Set(
      (meta.evolved ?? []).filter((id) => getIdol(id).evolution !== undefined),
    );
    // センターは必ず出撃メンバーの中から選ぶ。編成画面で外したのに
    // パッシブだけ残る、という食い違いを sim の側で塞いでおく
    const centerId =
      meta.center && (this.partyIds.size === 0 || this.partyIds.has(meta.center))
        ? meta.center
        : null;
    this.center = centerId ? getIdol(centerId).centerPassive : undefined;
    this.centerName = this.center && centerId ? this.displayOf(centerId).name : null;
    this.centerIdolId = centerId;
    this.talents = meta.talents;
    this.talentPool = buildTalentPool(meta.talents);
    this.echoMaxStacks = ECHO_MAX_STACKS + (meta.talents?.echoMaxStacksAdd ?? 0);
    this.echoDps = ECHO_DPS * (1 + (meta.talents?.echoPowerPct ?? 0));
    this.centerPool = centerEconomyPool(this.center);
    this.costMul = this.center?.mods.costMul ?? 1;
    this.specialBonusMs = this.center?.mods.specialDurationAddMs ?? 0;

    // パレットはラン中に変わらないので 1 回だけ組む
    const paletteIds = meta.party && meta.party.length > 0 ? meta.party : rosterIds;
    this.palette = paletteIds.map((id) => {
      const def = getIdol(id);
      return {
        idolId: id,
        shortName: this.displayOf(id).shortName,
        type: def.type,
        cost: Math.round(def.cost * this.costMul),
        isCenter: id === centerId,
      };
    });

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

    this.record('battleStart', { seed, stage: stageId });
  }

  // --- ループ ---

  update(dtMs: number): void {
    if (this.finished) return;

    const advanced = this.clock.advance(dtMs, (info) => {
      this.events.emit('beat', { bar: info.bar, beat: info.beat });
      if (info.beat === 0) {
        this.events.emit('bar', { bar: info.bar });
        this.addVoltage(VOLTAGE_PER_BAR);
        this.checkCardPick(info.bar);
      }
    });
    if (advanced === 0) return;

    this.updateSpecial(advanced);
    this.updateEconomy(advanced);
    this.spawnDueEnemies();
    this.updateEnemies(advanced);
    // 漏れで観客が尽きた場合はここで打ち切る。
    // 続けて updateUnits を回すと決着後に撃破が増え、
    // battleEnd のログと最終結果が食い違う
    if (this.finished) return;
    this.updateUnits(advanced);
    this.updateFloatingTexts(advanced);
    this.checkCompletion();
  }

  private updateSpecial(dtMs: number): void {
    if (this.specialRemainingMs <= 0) return;
    this.specialRemainingMs -= dtMs;
    if (this.specialRemainingMs <= 0) {
      this.specialRemainingMs = 0;
      this.refreshUnitStats();
      this.events.emit('specialEnded', {});
      this.record('specialEnded');
    }
  }

  private updateEconomy(dtMs: number): void {
    const gain =
      resolveStat(1, 'cheerGain', [this.runPool, this.talentPool, this.centerPool]) *
      this.cheerGainFromCells();
    const regen = (CHEER_REGEN_BASE + CHEER_REGEN_PER_AUDIENCE * this.audience) * gain;
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
    // テンポ正規化は**出現数だけ**に掛ける（systems/spawn.ts）。
    // 1 秒あたりの小節数が BPM に比例するので、出現数を 132/BPM 倍すれば
    // 秒あたりの投入数が一定になり、秒基準のプレイヤー火力と釣り合う。
    // HP にも掛けると 132²/BPM に比例してしまい、逆向きのズレが残る。
    const hpMul =
      waveHpMultiplier(scheduled.waveIndex) *
      sectionHpMultiplier(this.stage.waves[scheduled.waveIndex]?.section) *
      this.stage.hpMul;
    this.createEnemy(scheduled.enemyId, scheduled.lane, hpMul, null);
  }

  /**
   * 敵を 1 体生成する。
   * `from` を渡すと、その敵の位置と進捗を引き継ぐ（ムラクモの分裂）。
   */
  private createEnemy(
    enemyId: string,
    lane: number,
    hpMul: number,
    from: Enemy | null,
  ): Enemy | null {
    const def = getEnemy(enemyId);
    const path = this.paths[lane] ?? this.paths[0];
    if (!path) return null;

    const start = from ? from.pos : (path.segments[0]?.from ?? path.goal);
    const hp = def.hp * hpMul;

    const enemy: Enemy = {
      id: this.nextEntityId++,
      defId: enemyId,
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
      traits: def.traits,
      lane,
      pathIndex: from?.pathIndex ?? 0,
      pathT: from?.pathT ?? 0,
      progress: from?.progress ?? 0,
      pos: vec(start.x, start.y),
      prevPos: vec(start.x, start.y),
      statuses: [],
      alive: true,
    };
    this.enemies.push(enemy);
    this.events.emit('enemySpawned', { id: enemy.id, defId: enemy.defId });
    return enemy;
  }

  private updateEnemies(dtMs: number): void {
    const globalSpeedMul = this.specialActive ? SPECIAL_ENEMY_SPEED_MUL : 1;
    this.applyHealAuras(dtMs);

    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const enemy = this.enemies[i];
      if (!enemy) continue;

      if (!enemy.alive) {
        this.enemies.splice(i, 1);
        continue;
      }

      const echoDamage = tickStatuses(enemy, dtMs);
      if (echoDamage > 0) {
        this.applyDamage(enemy, {
          amount: echoDamage * defenseReduction(enemy.def),
          crit: false,
          effectiveness: 'neutral',
        }, false);
        if (!enemy.alive) {
          this.enemies.splice(i, 1);
          continue;
        }
      }

      const path = this.paths[enemy.lane] ?? this.paths[0];
      if (!path) continue;

      if (advanceEnemy(enemy, path, dtMs * globalSpeedMul)) {
        enemy.alive = false;
        this.enemies.splice(i, 1);
        this.leaked++;
        this.events.emit('enemyLeaked', { id: enemy.id, leak: enemy.leak });
        this.leakAudience(enemy.leak);
      }
    }
  }

  /**
   * ツキシズクの回復オーラ。
   * 「火力を分散させると押し切られる」を作るための敵で、優先撃破の判断を要求する。
   * 回復側は多くても数体なので、ヒーラーを起点に走査する（全敵の総当たりにしない）。
   */
  private applyHealAuras(dtMs: number): void {
    for (const healer of this.enemies) {
      const aura = healer.traits.healAura;
      if (!aura || !healer.alive) continue;
      for (const target of this.enemies) {
        if (!target.alive || target.hp >= target.maxHp) continue;
        if (!withinRange(healer.pos, target.pos, aura.radius)) continue;
        target.hp = Math.min(
          target.maxHp,
          target.hp + (target.maxHp * aura.percentPerSec * dtMs) / 1000,
        );
      }
    }
  }

  /** トコヤミの攻撃速度デバフ。射程内のメンバーに掛かる */
  private drainMulFor(unit: Unit): number {
    let mul = 1;
    for (const enemy of this.enemies) {
      const aura = enemy.traits.drainAura;
      if (!aura || !enemy.alive) continue;
      if (withinRange(enemy.pos, unit.pos, aura.radius)) mul *= aura.speedMul;
    }
    return mul;
  }

  /** Vi3「たまのえだ」の DEF 低下。位置依存なので攻撃のたびに解決する */
  private defDownFor(enemy: Enemy): number {
    let max = 0;
    for (const unit of this.units) {
      const aura = unit.aura;
      if (!aura || aura.enemyDefPct <= 0) continue;
      if (withinRange(unit.pos, enemy.pos, aura.radius) && aura.enemyDefPct > max) {
        max = aura.enemyDefPct;
      }
    }
    return max;
  }

  private updateUnits(dtMs: number): void {
    const ctx = {
      rng: this.rng,
      enemies: this.enemies,
      applyDamage: (enemy: Enemy, result: DamageResult) => this.applyDamage(enemy, result),
      echoDps: this.echoDps,
      echoMaxStacks: this.echoMaxStacks,
      defDownFor: (enemy: Enemy) => this.defDownFor(enemy),
      knockback: (enemy: Enemy, dist: number) => {
        const path = this.paths[enemy.lane] ?? this.paths[0];
        if (path) knockbackEnemy(enemy, path, dist);
      },
      speedMulFor: (unit: Unit) => this.drainMulFor(unit),
    };
    for (const unit of this.units) {
      updateUnit(unit, ctx, dtMs);
    }
  }

  private applyDamage(enemy: Enemy, result: DamageResult, showText = true): void {
    if (!enemy.alive) return;
    // 過剰キル分は数えない。硬い敵を溶かした最後の一撃だけが得をするのを避ける
    const dealt = Math.min(result.amount, enemy.hp);
    enemy.hp -= result.amount;
    this.addVoltage((dealt / enemy.maxHp) * VOLTAGE_PER_ENEMY_HP);

    if (showText) {
      this.floatingTexts.push({
        x: enemy.pos.x,
        y: enemy.pos.y,
        amount: Math.round(result.amount),
        crit: result.crit,
        effectiveness: result.effectiveness,
        ageMs: 0,
        lifeMs: FLOATING_TEXT_LIFE_MS,
      });
    }

    if (enemy.hp <= 0) {
      enemy.alive = false;
      this.killed++;
      this.addCheer(enemy.bounty);
      this.events.emit('enemyKilled', { id: enemy.id, defId: enemy.defId, bounty: enemy.bounty });
      this.addKillStack();
      this.spawnOnDeath(enemy);
    }
  }

  /**
   * 才能「ステップアップ」。撃破するたび攻撃速度が上がり、ウェーブが変わると戻る。
   * ステータス解決は重いので、**刻みが変わったときだけ**掛け直す。
   */
  private addKillStack(): void {
    const stack = this.talents?.killSpeedStack;
    if (!stack) return;

    const wave = this.currentWave?.index ?? -1;
    if (wave !== this.killSpeedWave) {
      this.killSpeedWave = wave;
      if (this.killSpeedBonus !== 0) {
        this.killSpeedBonus = 0;
        this.refreshUnitStats();
      }
    }

    const next = Math.min(stack.max, this.killSpeedBonus + stack.perKill);
    if (next === this.killSpeedBonus) return;
    this.killSpeedBonus = next;
    this.refreshUnitStats();
  }

  /**
   * ムラクモの分裂。倒した位置と進捗を引き継いで子を出す。
   *
   * 子の HP には**親と同じステージ・ウェーブ補正を掛ける**。
   * 素の値で出すと、終盤のウェーブでだけ分裂が実質無害になる。
   * 親の `maxHp` と定義値の比がそのまま補正なので、それを再利用する。
   */
  private spawnOnDeath(parent: Enemy): void {
    const spawn = parent.traits.onDeathSpawn;
    if (!spawn) return;
    const hpMul = parent.maxHp / getEnemy(parent.defId).hp;
    for (let i = 0; i < spawn.count; i++) {
      this.createEnemy(spawn.enemy, parent.lane, hpMul, parent);
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

  private checkCompletion(): void {
    const spawnsDone = this.scheduleCursor >= this.schedule.length;
    const barsDone = this.clock.bar >= this.totalBars;
    if (spawnsDone && barsDone && this.enemies.length === 0) this.finish(true);
  }

  // --- セットリスト ---

  /** ◆ を通過したら選択を開始する。sim は止まり、楽曲はループ区間で鳴り続ける */
  private checkCardPick(bar: number): void {
    if (this.offers) return;
    for (const wave of this.waves) {
      if (!wave.cardPick || this.resolvedPicks.has(wave.index)) continue;
      if (bar < wave.startBar + wave.bars) continue;

      const deployedTypes = new Set<IdolType>(this.units.map((u) => u.type));
      const offers = drawOffers(this.rng, this.takenCards, deployedTypes);
      if (offers.length === 0) {
        this.resolvedPicks.add(wave.index);
        continue;
      }
      this.offers = offers;
      this.clock.beginChoice();
      this.record('cardOffered', { wave: wave.index, offers: offers.map((o) => o.id).join(',') });
      return;
    }
  }

  /** @returns 選べたら true */
  chooseCard(cardId: string): boolean {
    if (!this.offers) return false;
    const offer = this.offers.find((o) => o.id === cardId);
    if (!offer) return false;

    const instant = applyCard(this.runPool, offer.def);
    this.takenCards.set(cardId, (this.takenCards.get(cardId) ?? 0) + 1);
    if (instant.cheer) this.addCheer(instant.cheer);
    if (instant.voltage) this.addVoltage(instant.voltage);

    this.offers = null;
    for (const wave of this.waves) {
      if (wave.cardPick && !this.resolvedPicks.has(wave.index) && this.clock.bar >= wave.startBar) {
        this.resolvedPicks.add(wave.index);
        break;
      }
    }
    this.refreshUnitStats();
    this.clock.endChoice();
    this.record('cardChosen', { card: cardId });
    return true;
  }

  // --- スペシャルライブ ---

  get specialActive(): boolean {
    return this.specialRemainingMs > 0;
  }

  get specialReady(): boolean {
    return this.voltage >= VOLTAGE_MAX && !this.specialActive && !this.finished;
  }

  /**
   * 月華を解放する。全体バフ + 画面全体への初期ダメージ + 敵の減速。
   * M2 は簡易版で、カットインなどの演出は M5。
   */
  activateSpecial(): boolean {
    if (!this.specialReady) return false;

    this.voltage = 0;
    this.events.emit('voltageChanged', { value: 0 });
    this.specialRemainingMs = SPECIAL_DURATION_MS + this.specialBonusMs;
    this.refreshUnitStats();
    this.events.emit('specialStarted', {});
    this.record('specialStarted', { units: this.units.length });

    const burst = 100 + 60 * this.units.length;
    for (const enemy of [...this.enemies]) {
      this.applyDamage(enemy, {
        amount: burst * defenseReduction(enemy.def),
        crit: false,
        effectiveness: 'neutral',
      });
    }
    return true;
  }

  // --- 配置と強化 ---

  private baseAtkOf(idolId: string): number {
    return this.meta.atkByIdol?.[idolId] ?? getIdol(idolId).base.atk;
  }

  /**
   * 進化を反映した表示。
   *
   * 進化しても**アイドル ID は変えない**（別 ID にすると編成・才能・解放条件の
   * すべてが「どちらを指すか」を判断することになる）。名前と絵だけがここで割れる。
   */
  private displayOf(idolId: string): { name: string; shortName: string; spriteId: string } {
    const def = getIdol(idolId);
    const evolution = this.evolvedIds.has(idolId) ? def.evolution : undefined;
    if (!evolution) return { name: def.name, shortName: def.shortName, spriteId: idolId };
    return {
      name: evolution.name,
      shortName: evolution.shortName,
      spriteId: `${idolId}:evolved`,
    };
  }

  /** センター補正込みの配置コスト。UI と sim で同じ値を使うため公開する */
  placementCost(idolId: string): number {
    return Math.round(getIdol(idolId).cost * this.costMul);
  }

  canPlace(idolId: string, x: number, y: number): PlacementError | null {
    if (this.finished) return 'finished';
    if (this.partyIds.size > 0 && !this.partyIds.has(idolId)) return 'not-in-party';
    if (!this.placeableKeys.has(`${x},${y}`)) return 'not-placeable';
    if (this.units.some((u) => u.cell.x === x && u.cell.y === y)) return 'occupied';
    if (this.cheer < this.placementCost(idolId)) return 'insufficient-cheer';
    return null;
  }

  placeUnit(idolId: string, x: number, y: number): Unit | PlacementError {
    const error = this.canPlace(idolId, x, y);
    if (error) return error;

    const def = getIdol(idolId);
    const cost = this.placementCost(idolId);
    this.spendCheer(cost);

    const display = this.displayOf(idolId);
    const unit: Unit = {
      id: this.nextEntityId++,
      idolId,
      name: display.name,
      shortName: display.shortName,
      type: def.type,
      cell: { x, y },
      pos: vec(x + 0.5, y + 0.5),
      investedCost: cost,
      level: 1,
      awakening: null,
      awakeningSecond: null,
      evolved: this.evolvedIds.has(idolId),
      baseAtk: this.baseAtkOf(idolId),
      atk: 0,
      range: 0,
      attackIntervalMs: 0,
      critRate: 0,
      critDmg: 0,
      attack: {
        kind: def.attack.kind,
        radius: def.attack.radius,
        canHitFlying: def.attack.canHitFlying,
        skillMul: def.attack.skillMul,
        multiTarget: 1,
        defIgnore: def.attack.defIgnore,
        execute: def.attack.execute,
        knockback: def.attack.knockback,
        resetCooldownOnKill: false,
        onHit: def.attack.onHit,
      },
      aura: null,
      cooldownMs: 0,
      hitCount: 0,
      lastTargetPos: null,
      lastAttackAgeMs: Number.POSITIVE_INFINITY,
    };
    this.units.push(unit);
    // 味方オーラは配置で変わる。置いた本人だけでなく全員を解決し直す
    this.refreshUnitStats();
    this.record('place', { idol: idolId, x, y });
    return unit;
  }

  upgradeCostFor(id: EntityId): number | null {
    const unit = this.units.find((u) => u.id === id);
    if (!unit) return null;
    return upgradeCost(this.placementCost(unit.idolId), unit.level);
  }

  /**
   * ポジション強化。Lv3 で覚醒分岐の選択待ちになり、Lv6 でもう一方も手に入る
   * （03-progression.md ①②）。
   */
  upgradeUnit(id: EntityId): UpgradeError | null {
    if (this.finished) return 'finished';
    const unit = this.units.find((u) => u.id === id);
    if (!unit) return 'not-found';
    if (unit.level >= MAX_POSITION_LEVEL) return 'max-level';

    // 選ばないまま先へ進めると、Lv6 で「もう一方」が決まらない。
    // 分岐を持つキャラは、ここで必ず選ばせる
    if (
      unit.level >= AWAKENING_LEVEL &&
      !unit.awakening &&
      getIdol(unit.idolId).awakening !== undefined
    ) {
      return 'awakening-required';
    }

    const cost = upgradeCost(this.placementCost(unit.idolId), unit.level);
    if (cost === null) return 'max-level';
    if (this.cheer < cost) return 'insufficient-cheer';

    this.spendCheer(cost);
    unit.investedCost += cost;
    unit.level += 1;

    // Lv6 到達で、選ばなかった方の分岐も開く
    if (unit.level >= MAX_POSITION_LEVEL && unit.awakening && !unit.awakeningSecond) {
      unit.awakeningSecond = unit.awakening === 'A' ? 'B' : 'A';
      this.record('awakenSecond', { id, branch: unit.awakeningSecond });
    }

    // オーラを持つキャラは Lv6 の追加分岐で効果が変わる。全員を解決し直す
    this.refreshUnitStats();
    this.record('upgrade', { id, level: unit.level });
    return null;
  }

  /** 覚醒分岐の選択。ラン中の変更は不可 */
  chooseAwakening(id: EntityId, branch: AwakeningKey): boolean {
    const unit = this.units.find((u) => u.id === id);
    if (!unit || unit.level < AWAKENING_LEVEL || unit.awakening) return false;
    if (!getIdol(unit.idolId).awakening) return false;

    unit.awakening = branch;
    // 「合唱」「独唱」はオーラを変える。周囲のバフ量が動くので全員を解決し直す
    this.refreshUnitStats();
    this.record('awaken', { id, branch });
    return true;
  }

  sellUnit(id: EntityId): boolean {
    const index = this.units.findIndex((u) => u.id === id);
    if (index < 0) return false;
    const unit = this.units[index];
    if (!unit) return false;
    this.units.splice(index, 1);
    this.addCheer(Math.floor(unit.investedCost * SELL_REFUND));
    this.refreshUnitStats();
    this.record('sell', { id });
    return true;
  }

  unitAt(x: number, y: number): Unit | null {
    return this.units.find((u) => u.cell.x === x && u.cell.y === y) ?? null;
  }

  isPlaceable(x: number, y: number): boolean {
    return this.placeableKeys.has(`${x},${y}`);
  }

  private refreshUnitStats(): void {
    // オーラとフォーメーションを先に全員ぶん確定させる。後回しにすると、
    // まだ解決していない味方のぶんを取りこぼす順序依存が生まれる
    for (const unit of this.units) unit.aura = resolveUnitAura(unit);
    this.formation = evaluateFormations(
      this.units.map((u) => ({
        id: u.id,
        idolId: u.idolId,
        type: u.type,
        cell: u.cell,
        pos: u.pos,
        tags: getIdol(u.idolId).tags,
      })),
      this.centerIdolId,
    );
    for (const unit of this.units) this.resolve(unit);
  }

  /** 配置マスの種別・センター・味方オーラを添えてステータスを解決する */
  private resolve(unit: Unit): void {
    resolveUnit(unit, {
      runPool: this.runPool,
      talentPool: this.talentPool,
      center: this.center,
      cellType: this.stage.cellTypes[`${unit.cell.x},${unit.cell.y}`],
      specialActive: this.specialActive,
      allyAtkPct: this.allyAtkPctFor(unit),
      formation: formationModsFor(this.formation, unit.id),
      killSpeedBonus: this.killSpeedBonus,
    });
  }

  /**
   * 周囲の味方から受け取る ATK 加算（V2「かさね」）。
   *
   * オーラの提供側の値は「定義 + 覚醒」だけで決まり、受け手のステータスには
   * 依存しない。したがって解決の順序を気にせず 1 パスで確定できる。
   */
  private allyAtkPctFor(unit: Unit): number {
    let total = 0;
    for (const other of this.units) {
      if (other.id === unit.id) continue;
      const aura = other.aura;
      if (!aura || aura.allyAtkPct === 0) continue;
      if (withinRange(other.pos, unit.pos, aura.radius)) total += aura.allyAtkPct;
    }
    return total;
  }

  /**
   * 客席サイドに置いたメンバーぶんの声援ボーナス。
   * ユニット個別のステータスではなく経済に効くので、ここで集計する
   */
  private cheerGainFromCells(): number {
    let mul = 1;
    for (const unit of this.units) {
      if (this.stage.cellTypes[`${unit.cell.x},${unit.cell.y}`] === 'audience') mul *= 1.2;
    }
    return mul;
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
    // スペシャル中は蓄積しない（02-core-battle.md 2.3）。
    // 溜め続けると終了と同時に次が撃てて、実質「常時バフ」になる
    if (delta > 0 && this.specialActive) return;

    let scaled =
      delta *
      resolveStat(1, 'voltageGain', [this.runPool, this.talentPool, this.centerPool]) *
      this.formation.voltageMul;
    if (delta > 0 && this.currentWave?.section === 'chorus') scaled *= VOLTAGE_CHORUS_MUL;

    const next = clamp(this.voltage + scaled, 0, VOLTAGE_MAX);
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
    this.offers = null;
    this.clock.pause();
    this.events.emit('battleEnded', { won, audienceLeft: this.audience });
    this.record('battleEnd', { won, audience: this.audience, killed: this.killed, leaked: this.leaked });
  }

  private record(kind: string, detail?: Record<string, string | number | boolean>): void {
    this.log.push({
      atMs: Math.round(this.clock.now),
      bar: this.clock.bar,
      kind,
      ...(detail ? { detail } : {}),
    });
  }

  /** 再生速度の変更を記録する。記録しないとリプレイが再現できない */
  recordSpeedChange(speed: number): void {
    this.record('speed', { speed });
  }

  /** 計測用の書き出し。リザルト画面から JSON で取り出す */
  exportLog(): string {
    return JSON.stringify(
      {
        seed: this.seed,
        stage: this.stageId,
        song: this.stage.song,
        result: { won: this.won, audience: this.audience, killed: this.killed, leaked: this.leaked },
        cards: [...this.takenCards.entries()].map(([id, count]) => ({ id, count })),
        log: this.log,
      },
      null,
      2,
    );
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
      palette: this.palette,
      centerName: this.centerName,
      songName: this.song.name,
      bpm: this.song.bpm,
      bar: this.clock.bar,
      barProgress: this.clock.barProgress,
      wave: this.currentWave,
      waveCount: this.waves.length,
      cheer: Math.floor(this.cheer),
      audience: this.audience,
      voltage: this.voltage,
      specialReady: this.specialReady,
      specialRemainingMs: this.specialRemainingMs,
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
        spriteId: u.evolved ? `${u.idolId}:evolved` : u.idolId,
        shortName: u.shortName,
        type: u.type,
        cell: u.cell,
        x: u.pos.x,
        y: u.pos.y,
        range: u.range,
        atk: Math.round(u.atk),
        level: u.level,
        maxLevel: MAX_POSITION_LEVEL,
        awakening: u.awakening,
        awakeningNames: [u.awakening, u.awakeningSecond]
          .filter((key): key is AwakeningKey => key !== null)
          .map((key) => getIdol(u.idolId).awakening?.[key]?.name)
          .filter((name): name is string => name !== undefined),
        investedCost: u.investedCost,
        upgradeCost: upgradeCost(this.placementCost(u.idolId), u.level),
        awaitingAwakening:
          u.level >= AWAKENING_LEVEL && !u.awakening && !!getIdol(u.idolId).awakening,
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
        bound: isImmobilized(e.statuses),
        echo: echoStacks(e.statuses),
      })),
      floatingTexts: this.floatingTexts,
      offers: this.offers
        ? this.offers.map((o) => ({
            id: o.id,
            name: o.def.name,
            rarity: o.def.rarity,
            desc: o.def.desc,
          }))
        : null,
      takenCards: [...this.takenCards.entries()].map(([id, count]) => ({
        name: cards[id]?.name ?? id,
        count,
      })),
      formations: summariseFormations(this.formation.hits),
    };
  }
}

/** 同じ種類のボーナスは 1 行にまとめる。3 組成立していても 3 行は要らない */
function summariseFormations(
  hits: readonly FormationHit[],
): { id: string; name: string; desc: string; count: number }[] {
  const byId = new Map<string, { id: string; name: string; desc: string; count: number }>();
  for (const hit of hits) {
    const existing = byId.get(hit.id);
    if (existing) existing.count += 1;
    else byId.set(hit.id, { id: hit.id, name: hit.name, desc: hit.desc, count: 1 });
  }
  return [...byId.values()];
}

export function createWorld(stageId: string, seed: number, meta: BattleMeta = {}): BattleWorld {
  return new BattleWorld(stageId, seed, meta);
}
