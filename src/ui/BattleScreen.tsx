/**
 * バトル画面。Canvas の上に DOM の HUD を重ねる構成
 * （docs/design/06-ui-ux.md 6.2）。
 *
 * React は sim を**所有しない**。フレームごとにスナップショットを受け取るだけで、
 * 状態の実体は BattleWorld にある。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { GameLoop } from '../core/loop';
import { Renderer, type HoverState } from '../render/renderer';
import { createWorld, type BattleMeta, type BattleWorld, type WorldSnapshot } from '../sim/world';
import { randomSeed } from '../core/rng';
import { getEnemy, getIdol, getSong, getStage } from '../data';
import type { AwakeningKey } from '../data/schema/idol';
import type { BattleOutcome } from '../meta/progression';
import { volumeRatio, type EffectLevel } from '../meta/settings';
import { BgmPlayer, styleOf } from '../audio/bgm';
import { audioContext, resumeAudio } from '../audio/context';
import { playSe, setSeVolume } from '../audio/se';
import { ATTR_LABEL } from './idolText';
import { Hud } from './Hud';

/**
 * Space を渡してはいけない相手か。
 * ボタン・リンク・入力欄では Space は「そのコントロールの操作」
 */
function isInteractive(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.closest('button, a, input, select, textarea, [role="button"]') !== null;
}

interface BattleScreenProps {
  stageId: string;
  meta: BattleMeta;
  /** 演出の強さ（06-ui-ux.md 6.7） */
  effects: EffectLevel;
  /** 敵に属性の記号を重ねる（同 6.7 色覚） */
  attributeGlyphs: boolean;
  /** BGM / 効果音の音量（0〜10 の段階） */
  bgmVolume: number;
  seVolume: number;
  /** フォーメーションの表示（段階解放。`meta/onboarding.ts`） */
  showFormations: boolean;
  /** 見せ終わったチュートリアルの札（`meta/tutorial.ts`） */
  tutorialSeen: readonly string[];
  onTutorialSeen: (id: string) => void;
  onFinish: (outcome: BattleOutcome) => void;
  onExit: () => void;
}

export function BattleScreen({
  stageId,
  meta,
  effects,
  attributeGlyphs,
  bgmVolume,
  seVolume,
  showFormations,
  tutorialSeen,
  onTutorialSeen,
  onFinish,
  onExit,
}: BattleScreenProps): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<BattleWorld | null>(null);
  /** 描画のたびに読むので ref。setState だと 60Hz の再レンダリングになる */
  const hoverRef = useRef<HoverState>({
    cell: null,
    pendingIdolId: null,
    pendingRange: 0,
    pendingValid: false,
    selectedUnitId: null,
  });
  const onFinishRef = useRef(onFinish);
  onFinishRef.current = onFinish;
  // 演出強度は world を作る effect の依存に入れない。入れると設定を変えた瞬間に
  // world ごと作り直され、進行中のライブが消える。
  // 代わりに renderer へ後から流し込む
  const effectsRef = useRef(effects);
  effectsRef.current = effects;
  const glyphsRef = useRef(attributeGlyphs);
  glyphsRef.current = attributeGlyphs;
  const rendererRef = useRef<Renderer | null>(null);
  const bgmRef = useRef<BgmPlayer | null>(null);
  // 音量も world の effect の依存には入れない。入れるとスライダーを動かすたびに
  // ライブが作り直される。ref 経由で現在値を読ませる
  const bgmVolumeRef = useRef(bgmVolume);
  bgmVolumeRef.current = bgmVolume;

  useEffect(() => {
    rendererRef.current?.setEffects(effects);
    rendererRef.current?.setAttributeGlyphs(attributeGlyphs);
  }, [effects, attributeGlyphs]);

  useEffect(() => {
    bgmRef.current?.setVolume(volumeRatio(bgmVolume));
  }, [bgmVolume]);

  useEffect(() => {
    setSeVolume(volumeRatio(seVolume));
  }, [seVolume]);

  const [snapshot, setSnapshot] = useState<WorldSnapshot | null>(null);
  const [fps, setFps] = useState(0);
  const [pendingIdolId, setPendingIdolId] = useState<string | null>(null);
  const [selectedUnitId, setSelectedUnitId] = useState<number | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    // seed はここで 1 回だけ引く。以降の乱数はすべて world.rng 経由
    const world = createWorld(stageId, randomSeed(), meta);
    const renderer = new Renderer(
      canvas,
      world,
      undefined,
      undefined,
      effectsRef.current,
      glyphsRef.current,
    );
    worldRef.current = world;
    rendererRef.current = renderer;

    // 演出は sim ではなく描画側で数える。sim 時刻に紐付けると、
    // 一時停止で止まり、倍速で早送りされてしまう
    const offSpecial = world.events.on('specialStarted', () => {
      const latest = world.snapshot();
      renderer.startSpecialEffect();
      renderer.pushCutIn({
        kind: 'special',
        title: 'スペシャルライブ！',
        ...(latest.centerName ? { subtitle: `センター ${latest.centerName}` } : {}),
        ...(latest.centerIdolId ? { idolId: latest.centerIdolId } : {}),
      });
      playSe('special');
    });

    // --- 音 ---
    // 出撃ボタン（クリック）から来ているので、ここで作れば自動再生の制限に当たらない
    resumeAudio();
    const audio = audioContext();
    const stage = getStage(stageId);
    const song = getSong(stage.song);
    const bgm = audio
      ? new BgmPlayer(audio, {
          song,
          songId: stage.song,
          style: styleOf(song),
          waves: stage.waves,
        })
      : null;
    bgmRef.current = bgm;
    bgm?.setVolume(volumeRatio(bgmVolumeRef.current));

    // 観客の危機は 1 回だけ出す。境目を行き来するたびに出すと、
    // いちばん忙しい場面でカットインが連発することになる
    let warnedDanger = false;

    // sim からは鳴らさない。ヘッドレス計測とテストに音の都合を持ち込まないため
    const offSe = [
      world.events.on('enemyKilled', () => {
        playSe('kill');
        renderer.pushComment('kill');
      }),
      world.events.on('enemyLeaked', () => {
        playSe('leak');
        renderer.pushComment('leak');
      }),
      // ライブ開始直後は挨拶が流れる（かぐやっほ～！／ヤオヨロー！は原作の挨拶）。
      // サビの頭でも一声。コメントは情報ではなく空気なので、間引きは renderer 側
      world.events.on('bar', (e) => {
        if (e.bar < 8 && e.bar % 2 === 0) renderer.pushComment('greeting');
      }),
      world.events.on('sectionChanged', (e) => {
        if (e.section === 'chorus' || e.section === 'finale') renderer.pushComment('chorus');
      }),
      world.events.on('specialStarted', () => renderer.pushComment('special')),
      world.events.on('called', (e) => {
        if (!e.auto && e.judge === 'perfect') renderer.pushComment('perfect');
      }),
      world.events.on('bossPhase', (e) => {
        playSe('phase');
        renderer.pushComment('phase');
        // 何が変わったのかを名指しする。「フェーズ 2」では
        // 編成のどこを変えればいいのか分からない
        renderer.pushCutIn({
          kind: 'phase',
          title: '属性が変わった',
          subtitle: `${ATTR_LABEL[e.attr] ?? e.attr} になった`,
        });
      }),
      world.events.on('enemySpawned', (e) => {
        if (!getEnemy(e.defId).traits.boss) return;
        playSe('boss');
        renderer.pushComment('boss');
        renderer.pushCutIn({
          kind: 'boss',
          title: getEnemy(e.defId).name,
          subtitle: '通すと観客が大きく減ります',
          enemyId: e.defId,
        });
      }),
      // ソロパートは 1 人を選んで撃つ操作なので、誰に入ったのかを顔で返す
      world.events.on('soloStarted', (e) => {
        renderer.pushComment('solo');
        const unit = world.snapshot().units.find((u) => u.id === e.id);
        if (!unit) return;
        renderer.pushCutIn({
          kind: 'solo',
          title: 'ソロパート',
          subtitle: unit.shortName,
          idolId: unit.spriteId,
        });
      }),
      world.events.on('audienceChanged', (e) => {
        if (warnedDanger || e.value > 25 || e.value <= 0) return;
        warnedDanger = true;
        renderer.pushCutIn({ kind: 'danger', title: '客席が空きはじめた', subtitle: '観客 25 以下' });
      }),
      world.events.on('called', (e) => {
        // 自動ぶん（コールを切っている人へ配る Good）では鳴らさない。
        // 押していないのに手応えの音だけ返るのはおかしい
        if (!e.auto && e.judge === 'perfect') playSe('callPerfect');
      }),
      world.events.on('battleEnded', (e) => {
        playSe(e.won ? 'win' : 'lose');
        // 完走の拍手は 1 声では寂しい。間隔は renderer 側が守る
        renderer.pushComment(e.won ? 'win' : 'lose');
        renderer.pushComment(e.won ? 'win' : 'lose');
      }),
    ];

    // HUD が覆う高さを測って渡す。canvas は全面のままにして背景を端まで見せ、
    // 盤面だけを HUD の内側へ収める（renderer.setSafeArea）。
    // 狭い画面では HUD が折り返して高さが変わるので、毎回測り直す
    const applyResize = (): void => {
      const rect = container.getBoundingClientRect();
      const root = rootRef.current;
      const top = root?.querySelector('.hud-top')?.getBoundingClientRect().height ?? 0;
      const bottom = root?.querySelector('.hud-bottom')?.getBoundingClientRect().height ?? 0;
      renderer.setSafeArea(top, bottom);
      renderer.resize(rect.width, rect.height, window.devicePixelRatio || 1);
    };
    applyResize();

    const observer = new ResizeObserver(applyResize);
    observer.observe(container);
    if (rootRef.current) observer.observe(rootRef.current);

    let sinceUiUpdate = 0;
    let sinceLayoutCheck = 0;
    let publishedFinish = false;
    let wasChoosing = false;

    const loop = new GameLoop({
      update: (dtMs) => {
        // 倍速は「1 フレームに sim を何回回すか」で表現する。
        // dt を倍にすると 1 ステップが 1/60 秒でなくなり、
        // 攻撃回数や乱数の消費順が速度で変わってリプレイできなくなる
        const steps = world.clock.playbackSpeed;
        for (let i = 0; i < steps; i++) world.update(dtMs);
      },
      render: (alpha, frameMs) => {
        renderer.advanceEffects(frameMs);
        // 音は sim 時刻に追従する（05-architecture.md 5.4）。
        // 一時停止でも倍速でも、曲とウェーブがずれない
        bgm?.sync(world.clock.now, world.clock.currentState, world.clock.playbackSpeed);
        // HUD の高さは中身（覚醒の選択肢、取得カードの一覧）で変わるが、
        // .battle 自体の大きさは変わらないので ResizeObserver では拾えない。
        // 毎秒 2 回測り直す。同じ寸法なら renderer 側で弾かれる
        if (++sinceLayoutCheck >= 30) {
          sinceLayoutCheck = 0;
          applyResize();
        }

        const latest = world.snapshot();
        renderer.draw(latest, hoverRef.current, alpha);

        // 決着したら 1 回だけ publish してループを止める。
        // finished を毎フレーム publish すると、静止した結果画面のまま
        // 60Hz で React が再描画され続ける
        if (latest.finished) {
          if (!publishedFinish) {
            publishedFinish = true;
            setSnapshot(latest);
            setFps(loop.getStats().fps);
            loop.stop();
            onFinishRef.current({
              stageId: latest.stageId,
              won: latest.won,
              audience: latest.audience,
              killed: latest.killed,
              star: latest.star,
              leaked: latest.leaked,
              // 自動ぶん（コールを切っている人へ配る Good）は実績に数えない。
              // 押していない人の「Perfect 50 連」が成立してしまう
              perfectCalls: world.callStats.perfect,
              bestCallCombo: world.callStats.bestCombo,
              soloUses: world.soloUseCount,
            });
          }
          return;
        }

        // カード選択に入った瞬間は即座に反映する（10Hz 待ちだと反応が鈍く見える）
        const choosing = latest.offers !== null;
        if (choosing !== wasChoosing) {
          wasChoosing = choosing;
          setSnapshot(latest);
          return;
        }

        // HUD の再レンダリングは 10Hz で足りる。60Hz で setState すると
        // React の再描画が Canvas の描画コストを上回ってしまう
        sinceUiUpdate += 1;
        if (sinceUiUpdate >= 6) {
          sinceUiUpdate = 0;
          setSnapshot(latest);
          setFps(loop.getStats().fps);
        }
      },
    });
    loop.start();
    setSnapshot(world.snapshot());

    const refreshPendingValidity = (): void => {
      const hover = hoverRef.current;
      const cell = hover.cell;
      hover.pendingValid =
        hover.pendingIdolId !== null &&
        cell !== null &&
        world.canPlace(hover.pendingIdolId, cell.x, cell.y) === null;
    };

    const updateHoverFromPointer = (event: PointerEvent): void => {
      hoverRef.current.cell = renderer.cellFromClient(event.clientX, event.clientY);
      refreshPendingValidity();
    };
    const clearHover = (): void => {
      hoverRef.current.cell = null;
    };

    const onClick = (event: MouseEvent): void => {
      const cell = renderer.cellFromClient(event.clientX, event.clientY);
      if (!cell) return;

      const existing = world.unitAt(cell.x, cell.y);
      if (existing) {
        setSelectedUnitId((current) => (current === existing.id ? null : existing.id));
        setPendingIdolId(null);
        return;
      }

      const idolId = hoverRef.current.pendingIdolId;
      if (idolId) {
        const result = world.placeUnit(idolId, cell.x, cell.y);
        if (typeof result !== 'string') {
          // 置いたら選択を解除する。残したままだと同じマスに
          // 「配置不可」のプレビューが出続けて紛らわしい
          playSe('place');
          setPendingIdolId(null);
          setSnapshot(world.snapshot());
        }
        return;
      }
      setSelectedUnitId(null);
    };

    canvas.addEventListener('pointermove', updateHoverFromPointer);
    canvas.addEventListener('pointerleave', clearHover);
    canvas.addEventListener('click', onClick);

    return () => {
      loop.stop();
      offSpecial();
      for (const off of offSe) off();
      bgm?.dispose();
      bgmRef.current = null;
      observer.disconnect();
      canvas.removeEventListener('pointermove', updateHoverFromPointer);
      canvas.removeEventListener('pointerleave', clearHover);
      canvas.removeEventListener('click', onClick);
      worldRef.current = null;
    };
  }, [stageId, meta]);

  // 選択状態は React が持ち、描画用に ref へ流し込む
  useEffect(() => {
    hoverRef.current.pendingIdolId = pendingIdolId;
    hoverRef.current.pendingRange = pendingIdolId ? getIdol(pendingIdolId).base.range : 0;
    const world = worldRef.current;
    const cell = hoverRef.current.cell;
    hoverRef.current.pendingValid =
      pendingIdolId !== null &&
      cell !== null &&
      world?.canPlace(pendingIdolId, cell.x, cell.y) === null;
  }, [pendingIdolId]);

  useEffect(() => {
    hoverRef.current.selectedUnitId = selectedUnitId;
  }, [selectedUnitId]);

  const sync = useCallback(() => {
    const world = worldRef.current;
    if (world) setSnapshot(world.snapshot());
  }, []);

  const togglePause = useCallback(() => {
    const world = worldRef.current;
    if (!world) return;
    if (world.clock.isRunning) world.clock.pause();
    else world.clock.resume();
    sync();
  }, [sync]);

  const cycleSpeed = useCallback(() => {
    const world = worldRef.current;
    if (!world) return;
    const next = world.clock.playbackSpeed >= 3 ? 1 : world.clock.playbackSpeed + 1;
    world.clock.setSpeed(next);
    world.recordSpeedChange(next);
    sync();
  }, [sync]);

  const selectIdol = useCallback((idolId: string) => {
    setSelectedUnitId(null);
    setPendingIdolId((current) => (current === idolId ? null : idolId));
  }, []);

  const upgradeSelected = useCallback(() => {
    const world = worldRef.current;
    if (!world || selectedUnitId === null) return;
    // `upgradeUnit` は**失敗の理由**を返す（成功は null）
    if (world.upgradeUnit(selectedUnitId) === null) playSe('upgrade');
    sync();
  }, [selectedUnitId, sync]);

  const awaken = useCallback(
    (branch: AwakeningKey) => {
      const world = worldRef.current;
      if (!world || selectedUnitId === null) return;
      world.chooseAwakening(selectedUnitId, branch);
      sync();
    },
    [selectedUnitId, sync],
  );

  const sellSelected = useCallback(() => {
    const world = worldRef.current;
    if (!world || selectedUnitId === null) return;
    world.sellUnit(selectedUnitId);
    setSelectedUnitId(null);
    sync();
  }, [selectedUnitId, sync]);

  /**
   * コール（02-core-battle.md 2.9）。
   *
   * **判定は sim の時計で行う。** 押した瞬間の実時刻ではなく
   * `world.call()` の中で `clock.now` と小節頭を突き合わせるので、
   * 倍速でも一時停止を挟んでも判定の物差しが変わらない
   */
  const doCall = useCallback(() => {
    const world = worldRef.current;
    if (!world) return;
    if (world.call() !== null) sync();
  }, [sync]);

  const activateSpecial = useCallback(() => {
    const world = worldRef.current;
    if (!world) return;
    if (world.activateSpecial()) sync();
  }, [sync]);

  /** ソロパートは**選んでいる 1 人**に当てる。選んでいなければ何もしない */
  const activateSoloPart = useCallback(() => {
    const world = worldRef.current;
    if (!world || selectedUnitId === null) return;
    if (world.activateSoloPart(selectedUnitId)) sync();
  }, [sync, selectedUnitId]);

  const chooseCard = useCallback(
    (cardId: string) => {
      const world = worldRef.current;
      if (!world) return;
      world.chooseCard(cardId);
      playSe('card');
      sync();
    },
    [sync],
  );

  /** 計測用。リザルトからプレイログを JSON で取り出す（07-roadmap.md M2） */
  const exportLog = useCallback(() => {
    const world = worldRef.current;
    if (!world) return;
    const blob = new Blob([world.exportLog()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `idoldiffence-${world.stageId}-${world.seed}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }, []);

  // キー割り当ての原則: 1 つのキーに文脈依存の複数機能を持たせない
  // （docs/design/06-ui-ux.md 6.6）。Space はコール専用。
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.repeat) return;
      if (event.key === ' ') {
        // ボタンにフォーカスがある状態の Space は**そのボタンを押す**操作。
        // ここで奪うと、キーボードだけで遊ぶ人が一時停止もカード選択も
        // 押せなくなる（06-ui-ux.md 6.7 フルキーボード操作）
        if (isInteractive(event.target)) return;
        // 盤面にフォーカスがあるときだけコールへ回す。
        // preventDefault は画面のスクロールを止めるため
        event.preventDefault();
        doCall();
        return;
      }
      if (event.key === 'p' || event.key === 'P') togglePause();
      if (event.key === 'q' || event.key === 'Q') activateSpecial();
      if (event.key === 'Escape') {
        setPendingIdolId(null);
        setSelectedUnitId(null);
      }
      if (event.key === 'Tab') {
        event.preventDefault();
        cycleSpeed();
      }
      const index = Number(event.key);
      const palette = worldRef.current?.snapshot().palette ?? [];
      if (Number.isInteger(index) && index >= 1 && index <= palette.length) {
        const id = palette[index - 1]?.idolId;
        if (id) selectIdol(id);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [togglePause, cycleSpeed, selectIdol, activateSpecial, doCall]);

  return (
    <div className="battle" ref={rootRef}>
      <div className="stage" ref={containerRef}>
        <canvas ref={canvasRef} />
      </div>
      {snapshot && (
        <Hud
          snapshot={snapshot}
          fps={fps}
          pendingIdolId={pendingIdolId}
          selectedUnitId={selectedUnitId}
          showVoltage={meta.locked?.includes('special') !== true}
          showFormations={showFormations}
          tutorialSeen={tutorialSeen}
          onTutorialSeen={onTutorialSeen}
          onSelectIdol={selectIdol}
          onUpgradeSelected={upgradeSelected}
          onAwaken={awaken}
          onSellSelected={sellSelected}
          onTogglePause={togglePause}
          onCycleSpeed={cycleSpeed}
          onSpecial={activateSpecial}
          onCall={doCall}
          onSoloPart={activateSoloPart}
          onChooseCard={chooseCard}
          onRestart={onExit}
          onExportLog={exportLog}
        />
      )}
    </div>
  );
}
