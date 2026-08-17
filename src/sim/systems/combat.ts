/**
 * 攻撃処理。攻撃間隔の消化 → ターゲット選択 → ダメージ適用。
 *
 * world への依存を避けるため、ダメージの適用は呼び出し側のコールバックに委ねる。
 * こうしておくとテストで単体のユニットだけを回せる。
 */
import { withinRange } from '../../core/vec';
import type { Rng } from '../../core/rng';
import { computeDamage, type DamageResult } from '../damage';
import {
  applyStatus,
  isCharmed,
  linkFactor,
  typeGuardFactor,
  vulnerability,
  type Enemy,
  type Unit,
} from '../entities';
import { findTarget } from './targeting';

export interface CombatContext {
  rng: Rng;
  enemies: readonly Enemy[];
  /**
   * ダメージを実際に反映する。撃破判定も呼び出し側の責務。
   * `from` は貢献度の集計に使う（誰が出したダメージか）
   */
  applyDamage: (enemy: Enemy, result: DamageResult, from?: Unit) => void;
  /** Echo の最大スタック。才能「無限旋律」で伸びる */
  echoMaxStacks?: number;
  /**
   * 味方オーラによる DEF 低下（0.35 = -35%）。
   * Vi3「たまのえだ」は位置依存なので、world 側で解決してもらう
   */
  defDownFor?: (enemy: Enemy) => number;
  /** ノックバックを経路へ反映する。world 側がレーンごとの経路を持っている */
  knockback?: (enemy: Enemy, distance: number) => void;
  /** 敵の特性（トコヤミの攻撃速度デバフ）による倍率 */
  speedMulFor?: (unit: Unit) => number;
}

export function updateUnit(unit: Unit, ctx: CombatContext, dtMs: number): void {
  unit.lastAttackAgeMs += dtMs;

  // 沈黙（最終ボスの切断処理）。**クールダウンも進めない**。
  // 進めてしまうと、明けた瞬間に溜まったぶんが一斉に撃たれて、
  // 「1 レーンが 4 秒止まる」という圧が帳消しになる
  if (unit.silencedMs > 0) {
    unit.silencedMs -= dtMs;
    unit.lastTargetPos = null;
    return;
  }

  unit.cooldownMs -= dtMs * (ctx.speedMulFor?.(unit) ?? 1);
  if (unit.cooldownMs > 0) return;

  const target = findTarget(unit, ctx.enemies);
  if (!target) {
    // 撃てないあいだクールダウンが際限なく貯まると、
    // 敵が射程に入った瞬間に連射が起きる。0 で止める
    unit.cooldownMs = 0;
    unit.lastTargetPos = null;
    return;
  }

  unit.cooldownMs = unit.attackIntervalMs;
  unit.lastAttackAgeMs = 0;
  unit.lastTargetPos = { x: target.pos.x, y: target.pos.y };
  unit.hitCount += 1;

  const knockbackNow =
    unit.attack.knockback !== undefined &&
    unit.hitCount % unit.attack.knockback.everyHits === 0;

  let killedAny = false;

  for (const victim of collectVictims(unit, target, ctx.enemies)) {
    const result = computeDamage(
      {
        atk: unit.atk,
        skillMul: unit.attack.skillMul * executeMultiplier(unit, victim),
        type: unit.type,
        critRate: unit.critRate,
        critDmg: unit.critDmg,
        alwaysEffective: unit.attack.alwaysEffective,
      },
      {
        attr: victim.attr,
        def: effectiveDef(victim, unit, ctx),
        fragile: vulnerability(victim.statuses),
      },
      ctx.rng,
    );

    // カガミの前面シールドは**範囲攻撃では崩れる**。
    // 「単体火力を積めば何でも抜ける」を成立させないための弱点（04-content.md）。
    // 衣装セット「仏の御石の鉢」4 着は、単体のままシールドを削る第 2 の答え
    const shield = victim.traits.frontShield;
    if (shield !== undefined && unit.attack.kind === 'single') {
      result.amount *= 1 - shield * (1 - unit.attack.shieldPierce);
    }

    // 火鼠の裘は焼けない。**その系統では通らない**を作る枠で、
    // 3 すくみの 0.9 と違って数を積んでも答えにならない。
    // Echo は系統を持たないので通る（「焼けないなら燻す」が答え）
    result.amount *= typeGuardFactor(victim, unit.type);

    // 守り手が近くにいるあいだは通らない。**狙う順番**への問い ——
    // 「先頭を狙う」「HP が高い方を狙う」という既定がそのまま裏目になる
    result.amount *= linkFactor(victim, ctx.enemies);

    ctx.applyDamage(victim, result, unit);
    if (!victim.alive) killedAny = true;

    if (victim.alive) {
      for (const onHit of unit.attack.onHit) {
        // 幻惑（魅了中の敵に脆弱）のように、他の状態異常を前提にする効果がある。
        // 対象が魅了されていなければ脆弱は乗らない
        if (onHit.status === 'vulnerable' && unit.attack.onHit.some((o) => o.status === 'charm')) {
          if (!isCharmed(victim.statuses)) continue;
        }
        applyStatus(
          victim,
          {
            kind: onHit.status,
            value: onHit.value,
            remainingMs: onHit.durationMs,
            // Echo の威力は付けた本人のもの（衣装・才能が人ごとに違う）。
            // 貢献度で誰のダメージか数えるので、出どころも一緒に持たせる
            ...(onHit.status === 'echo'
              ? { stacks: onHit.value, dps: unit.echoDps, sourceId: unit.idolId }
              : {}),
          },
          ctx.echoMaxStacks,
        );
      }
      if (knockbackNow && unit.attack.knockback) {
        ctx.knockback?.(victim, unit.attack.knockback.distance);
      }
    }
  }

  // D3 覚醒「追撃」。撃破したら次の一撃をすぐ撃てる
  if (killedAny && unit.attack.resetCooldownOnKill) unit.cooldownMs = 0;
}

/** D3「ひねずみ」。瀕死の敵に倍率を掛ける */
function executeMultiplier(unit: Unit, victim: Enemy): number {
  const execute = unit.attack.execute;
  if (!execute) return 1;
  return victim.hp / victim.maxHp <= execute.threshold ? execute.mul : 1;
}

/** 防御無視（覚醒・固有）と味方オーラの DEF 低下を反映した実効 DEF */
function effectiveDef(victim: Enemy, unit: Unit, ctx: CombatContext): number {
  const ignore = Math.min(1, unit.attack.defIgnore + (ctx.defDownFor?.(victim) ?? 0));
  return victim.def * (1 - ignore);
}

/** 範囲攻撃なら対象周辺、貫通なら直線上、覚醒「乱舞」なら先頭から N 体 */
function collectVictims(unit: Unit, target: Enemy, enemies: readonly Enemy[]): Enemy[] {
  const canHit = (enemy: Enemy): boolean =>
    enemy.alive && (!enemy.flying || unit.attack.canHitFlying);

  if (unit.attack.kind === 'aoe_ring') {
    return enemies.filter((e) => canHit(e) && withinRange(target.pos, e.pos, unit.attack.radius));
  }

  if (unit.attack.kind === 'pierce_line') {
    return enemies.filter((e) => canHit(e) && onLine(unit, target, e));
  }

  if (unit.attack.multiTarget > 1) {
    return enemies
      .filter((e) => canHit(e) && withinRange(unit.pos, e.pos, unit.range))
      .sort((a, b) => b.progress - a.progress)
      .slice(0, unit.attack.multiTarget);
  }

  return [target];
}

/**
 * 自分から対象へ伸びる線分の近傍にいるか（V3「ながれ」）。
 * 線分の延長方向は射程まで伸ばす。対象の手前と奥の両方を巻き込みたいため。
 */
function onLine(unit: Unit, target: Enemy, enemy: Enemy): boolean {
  const dx = target.pos.x - unit.pos.x;
  const dy = target.pos.y - unit.pos.y;
  const length = Math.hypot(dx, dy);
  if (length === 0) return withinRange(unit.pos, enemy.pos, unit.attack.radius);

  const ux = dx / length;
  const uy = dy / length;
  const ex = enemy.pos.x - unit.pos.x;
  const ey = enemy.pos.y - unit.pos.y;

  // 線上の位置（射程内、かつ後方でない）
  const along = ex * ux + ey * uy;
  if (along < 0 || along > unit.range) return false;

  // 線からの距離が線の太さ以内
  const perpendicular = Math.abs(ex * uy - ey * ux);
  return perpendicular <= unit.attack.radius;
}
