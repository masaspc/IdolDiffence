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
import { getIdol } from '../data';
import type { AwakeningKey } from '../data/schema/idol';
import type { BattleOutcome } from '../meta/progression';
import { Hud } from './Hud';

interface BattleScreenProps {
  stageId: string;
  meta: BattleMeta;
  onFinish: (outcome: BattleOutcome) => void;
  onExit: () => void;
}

export function BattleScreen({ stageId, meta, onFinish, onExit }: BattleScreenProps): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
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
    const renderer = new Renderer(canvas, world);
    worldRef.current = world;

    const applyResize = (): void => {
      const rect = container.getBoundingClientRect();
      renderer.resize(rect.width, rect.height, window.devicePixelRatio || 1);
    };
    applyResize();

    const observer = new ResizeObserver(applyResize);
    observer.observe(container);

    let sinceUiUpdate = 0;
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
      render: (alpha) => {
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
    world.upgradeUnit(selectedUnitId);
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

  const activateSpecial = useCallback(() => {
    const world = worldRef.current;
    if (!world) return;
    if (world.activateSpecial()) sync();
  }, [sync]);

  const chooseCard = useCallback(
    (cardId: string) => {
      const world = worldRef.current;
      if (!world) return;
      world.chooseCard(cardId);
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
  // （docs/design/06-ui-ux.md 6.6）。Space はコール専用なのでここでは扱わない。
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.repeat) return;
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
  }, [togglePause, cycleSpeed, selectIdol, activateSpecial]);

  return (
    <div className="battle">
      <div className="stage" ref={containerRef}>
        <canvas ref={canvasRef} />
      </div>
      {snapshot && (
        <Hud
          snapshot={snapshot}
          fps={fps}
          pendingIdolId={pendingIdolId}
          selectedUnitId={selectedUnitId}
          onSelectIdol={selectIdol}
          onUpgradeSelected={upgradeSelected}
          onAwaken={awaken}
          onSellSelected={sellSelected}
          onTogglePause={togglePause}
          onCycleSpeed={cycleSpeed}
          onSpecial={activateSpecial}
          onChooseCard={chooseCard}
          onRestart={onExit}
          onExportLog={exportLog}
        />
      )}
    </div>
  );
}
