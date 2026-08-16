/**
 * コール & レスポンス（02-core-battle.md 2.9）。
 *
 * 見るべきは「押せること」より **押さない人が損をしないこと**。
 * 任意参加のはずが実質強制になっていないかを、判定ではなく結果で確かめる。
 */
import { describe, expect, it } from 'vitest';
import { createWorld, type BattleWorld } from './world';
import { runHeadless } from '../core/loop';
import { autoplay } from './autoplay';
import { getIdol, rosterIds } from '../data';
import { levelAtkMultiplier } from '../meta/progression';
import { STAGE_PLANS } from '../balance/plans';
import {
  GOOD_MS,
  isCallSection,
  judgeCall,
  callVoltage,
  PERFECT_MS,
  PERFECT_VOLTAGE,
  GOOD_VOLTAGE,
} from './systems/call';

describe('判定', () => {
  it('ぴったりは Perfect、少し外れて Good、大きく外れて Miss', () => {
    expect(judgeCall(0)).toBe('perfect');
    expect(judgeCall(PERFECT_MS)).toBe('perfect');
    expect(judgeCall(PERFECT_MS + 1)).toBe('good');
    expect(judgeCall(GOOD_MS)).toBe('good');
    expect(judgeCall(GOOD_MS + 1)).toBe('miss');
  });

  it('早くても遅くても同じに扱う', () => {
    expect(judgeCall(-120)).toBe(judgeCall(120));
    expect(judgeCall(-200)).toBe('miss');
  });

  it('Miss にペナルティは無い（罰があると「押さない」が最適解になる）', () => {
    expect(callVoltage('miss')).toBe(0);
    expect(callVoltage('good')).toBe(GOOD_VOLTAGE);
    expect(callVoltage('perfect')).toBe(PERFECT_VOLTAGE);
  });

  it('受け付けるのはサビと大サビだけ', () => {
    expect(isCallSection('chorus')).toBe(true);
    expect(isCallSection('finale')).toBe(true);
    expect(isCallSection('intro')).toBe(false);
    expect(isCallSection('verse')).toBe(false);
    expect(isCallSection(undefined)).toBe(false);
  });
});

/**
 * 上手い人の押し方。**窓が開いた瞬間ではなく、小節の頭に合わせて**押す。
 * 窓は頭の 160ms 前から開くので、開いた瞬間に押すと Good にしかならない
 */
function pressOnBeat(world: BattleWorld): void {
  const call = world.snapshot().call;
  if (call?.open === true && Math.abs(call.toTargetMs) <= PERFECT_MS) world.call();
}

/** 参照盤面で 1 ライブ通す。コールの有無だけを変えて比べる */
function playPlan(stageId: string, level: number, call: boolean, onTick?: (w: BattleWorld) => void) {
  const plan = STAGE_PLANS[stageId];
  if (!plan) throw new Error(`${stageId} の参照盤面が無い`);
  const world = createWorld(stageId, 20260816, {
    call,
    atkByIdol: Object.fromEntries(
      rosterIds.map((id) => [id, getIdol(id).base.atk * levelAtkMultiplier(level)]),
    ),
    party: plan.party,
    center: plan.center,
  });
  const result = autoplay(world, {
    plan: plan.placements,
    useSpecial: true,
    ...(onTick ? { onTick: () => onTick(world) } : {}),
  });
  return { world, snapshot: result.snapshot };
}

describe('盤面', () => {
  it('切っていると窓もマーカーも出ない', () => {
    const { world } = playPlan('S5', 20, false);
    expect(world.snapshot().call).toBeNull();
    expect(world.call()).toBeNull();
  });

  it('切っていても Good 相当が自動で入る（押せない人が損をしない）', () => {
    // 06-ui-ux.md 6.7。自動ぶんは `auto` 付きで通知される
    let auto = 0;
    const plan = STAGE_PLANS['S5'];
    if (!plan) throw new Error('S5 の参照盤面が無い');
    const world = createWorld('S5', 20260816, {
      call: false,
      atkByIdol: Object.fromEntries(
        rosterIds.map((id) => [id, getIdol(id).base.atk * levelAtkMultiplier(20)]),
      ),
      party: plan.party,
      center: plan.center,
    });
    world.events.on('called', (e) => {
      if (e.auto) auto++;
      expect(e.judge).toBe('good');
    });
    autoplay(world, { plan: plan.placements, useSpecial: true });
    expect(auto).toBeGreaterThan(5);
    expect(world.callStats.good).toBe(auto);
    expect(world.callStats.perfect).toBe(0);
  });

  it('小節の頭に合わせれば Perfect になる', () => {
    const { world } = playPlan('S5', 20, true, pressOnBeat);
    expect(world.callStats.perfect).toBeGreaterThan(5);
    // 頭に合わせているので Miss も Good も出ない = 連続が途切れない
    expect(world.callStats.miss).toBe(0);
    expect(world.callStats.bestCombo).toBe(world.callStats.perfect);
  });

  it('窓が開いた瞬間に押すと Good（早すぎる）', () => {
    const { world } = playPlan('S5', 20, true, (w) => {
      if (w.snapshot().call?.open === true) w.call();
    });
    expect(world.callStats.good).toBeGreaterThan(5);
  });

  it('同じ小節で連打しても 1 回しか数えない', () => {
    const world = createWorld('S5', 1, { call: true, party: ['V1'], center: null });
    // サビまで進める。◆ は sim を止めるので選んでやる必要がある
    let opened = false;
    runHeadless(180_000, (dt) => {
      if (opened) return;
      world.update(dt);
      const snapshot = world.snapshot();
      const offer = snapshot.offers?.[0];
      if (offer) world.chooseCard(offer.id);
      if (snapshot.call?.open === true) opened = true;
    });
    expect(opened).toBe(true);
    expect(world.call()).not.toBeNull();
    expect(world.call()).toBeNull();
    expect(world.callStats.perfect + world.callStats.good + world.callStats.miss).toBe(1);
  });

  it('小節の頭より**前**でも押せる（窓が片側にならない）', () => {
    // 小節境界のフックで開けると、早押し（-160〜0ms）が丸ごと弾かれて
    // ±160ms のはずの窓が「頭からの 160ms」になる
    const world = createWorld('S5', 1, { call: true, party: ['V1'], center: null });
    let openedEarly = false;
    let toTarget = 0;
    runHeadless(180_000, (dt) => {
      if (openedEarly) return;
      world.update(dt);
      const snapshot = world.snapshot();
      const offer = snapshot.offers?.[0];
      if (offer) world.chooseCard(offer.id);
      // 「開いている」かつ「まだ小節の頭に着いていない」= 早押しできる状態
      if (snapshot.call?.open === true && snapshot.call.toTargetMs > 0) {
        openedEarly = true;
        toTarget = snapshot.call.toTargetMs;
      }
    });
    expect(openedEarly, '小節の頭より前に窓が開かない').toBe(true);
    expect(toTarget).toBeLessThanOrEqual(GOOD_MS);
    // その時点で押せば判定が返る
    expect(world.call()).not.toBeNull();
  });

  it('受付の外では押しても何も起きない', () => {
    const world = createWorld('S5', 1, { call: true, party: ['V1'], center: null });
    // イントロのあいだは窓が開かない
    runHeadless(2000, (dt) => world.update(dt));
    expect(world.snapshot().call?.open).toBe(false);
    expect(world.call()).toBeNull();
    expect(world.callStats.miss).toBe(0);
  });
});

describe('得の大きさ', () => {
  const SEEDS = [20260816, 7, 1234, 555];
  /** 1 ステージ 4 シード × 2 通り。既定の 5 秒では足りない */
  const TIMEOUT = 120_000;
  const BOARDS = [
    ['S5', 22],
    ['S7', 22],
    ['S9', 20],
    ['S10', 22],
  ] as const;

  /** 複数シードの平均。1 回の勝敗は段差で決まるので 1 本では測れない */
  function average(stageId: string, level: number, call: boolean) {
    const runs = SEEDS.map((seed) => {
      const plan = STAGE_PLANS[stageId];
      if (!plan) throw new Error(`${stageId} の参照盤面が無い`);
      const world = createWorld(stageId, seed, {
        call,
        atkByIdol: Object.fromEntries(
          rosterIds.map((id) => [id, getIdol(id).base.atk * levelAtkMultiplier(level)]),
        ),
        party: plan.party,
        center: plan.center,
      });
      return autoplay(world, {
        plan: plan.placements,
        useSpecial: true,
        ...(call ? { onTick: pressOnBeat } : {}),
      }).snapshot;
    });
    return runs.reduce((a, r) => a + r.audience, 0) / runs.length;
  }

  /** 盤面ごとの「押した得」（観客の差） */
  function gains(): number[] {
    return BOARDS.map(([stageId, level]) => average(stageId, level, true) - average(stageId, level, false));
  }

  it(
    '押すと得をする —— ただし**盤面ごとではなく合計で**',
    () => {
      // 1 盤面だけを見ると符号が反転することがある。効くのは主に
      // 「月華が早く貯まって解放が 1 回増える」ぶんで、その 1 回が
      // 大波と噛み合うかどうかは盤面と運で決まるため。
      // 実測でも S10 だけは押したほうが観客が下がる回がある
      const total = gains().reduce((a, g) => a + g, 0);
      expect(total, `合計で損をしている: ${gains().map((g) => g.toFixed(1)).join(' / ')}`)
        .toBeGreaterThan(0);
    },
    TIMEOUT,
  );

  it(
    '得は観客 20 点ぶんまで（押さなくてもクリアできる）',
    () => {
      // ここが崩れると「リズムゲームが上手い人だけが勝つ TD」になり、
      // 盤面を読む面白さが押し出される。
      // **撃破数や与ダメージでは測れない** —— どちらも敵の総数・総 HP に
      // 張り付くので、強くなっても数字が動かない
      for (const gain of gains()) {
        expect(gain, 'コールが強すぎる').toBeLessThan(20);
      }
    },
    TIMEOUT,
  );
});
