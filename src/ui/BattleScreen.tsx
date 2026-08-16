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
import { createWorld, type BattleWorld, type WorldSnapshot } from '../sim/world';
import { randomSeed } from '../core/rng';
import { getIdol, rosterIds } from '../data';
import { Hud } from './Hud';

const STAGE_ID = 'S1';

export function BattleScreen(): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<BattleWorld | null>(null);
  const loopRef = useRef<GameLoop | null>(null);
  /** 描画のたびに読むので ref。setState だと 60Hz の再レンダリングになる */
  const hoverRef = useRef<HoverState>({
    cell: null,
    pendingIdolId: null,
    pendingRange: 0,
    pendingValid: false,
    selectedUnitId: null,
  });

  const [snapshot, setSnapshot] = useState<WorldSnapshot | null>(null);
  const [fps, setFps] = useState(0);
  const [pendingIdolId, setPendingIdolId] = useState<string | null>(null);
  const [selectedUnitId, setSelectedUnitId] = useState<number | null>(null);
  const [runId, setRunId] = useState(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    // seed はここで 1 回だけ引く。以降の乱数はすべて world.rng 経由
    const world = createWorld(STAGE_ID, randomSeed());
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
    let latest = world.snapshot();
    const loop = new GameLoop({
      update: (dtMs) => {
        world.update(dtMs);
      },
      render: (alpha) => {
        latest = world.snapshot();
        renderer.draw(latest, hoverRef.current, alpha);
        // HUD の再レンダリングは 10Hz で足りる。60Hz で setState すると
        // React の再描画が Canvas の描画コストを上回ってしまう
        sinceUiUpdate += 1;
        if (sinceUiUpdate >= 6 || latest.finished) {
          sinceUiUpdate = 0;
          setSnapshot(latest);
          setFps(loop.getStats().fps);
        }
      },
    });
    loopRef.current = loop;
    loop.start();
    setSnapshot(world.snapshot());

    const updateHoverFromPointer = (event: PointerEvent | MouseEvent): void => {
      hoverRef.current.cell = renderer.cellFromClient(event.clientX, event.clientY);
      refreshPendingValidity();
    };

    const refreshPendingValidity = (): void => {
      const hover = hoverRef.current;
      const cell = hover.cell;
      hover.pendingValid =
        hover.pendingIdolId !== null &&
        cell !== null &&
        world.canPlace(hover.pendingIdolId, cell.x, cell.y) === null;
    };

    canvas.addEventListener('pointermove', updateHoverFromPointer);
    const clearHover = (): void => {
      hoverRef.current.cell = null;
    };
    canvas.addEventListener('pointerleave', clearHover);

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
    canvas.addEventListener('click', onClick);

    return () => {
      loop.stop();
      observer.disconnect();
      canvas.removeEventListener('pointermove', updateHoverFromPointer);
      canvas.removeEventListener('pointerleave', clearHover);
      canvas.removeEventListener('click', onClick);
      worldRef.current = null;
      loopRef.current = null;
    };
  }, [runId]);

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

  const togglePause = useCallback(() => {
    const world = worldRef.current;
    if (!world) return;
    if (world.clock.isRunning) world.clock.pause();
    else world.clock.resume();
    setSnapshot(world.snapshot());
  }, []);

  const cycleSpeed = useCallback(() => {
    const world = worldRef.current;
    if (!world) return;
    const next = world.clock.playbackSpeed >= 3 ? 1 : world.clock.playbackSpeed + 1;
    world.clock.setSpeed(next);
    setSnapshot(world.snapshot());
  }, []);

  const selectIdol = useCallback((idolId: string) => {
    setSelectedUnitId(null);
    setPendingIdolId((current) => (current === idolId ? null : idolId));
  }, []);

  const sellSelected = useCallback(() => {
    const world = worldRef.current;
    if (!world || selectedUnitId === null) return;
    world.sellUnit(selectedUnitId);
    setSelectedUnitId(null);
    setSnapshot(world.snapshot());
  }, [selectedUnitId]);

  const restart = useCallback(() => {
    setPendingIdolId(null);
    setSelectedUnitId(null);
    setRunId((n) => n + 1);
  }, []);

  // キー割り当ての原則: 1 つのキーに文脈依存の複数機能を持たせない
  // （docs/design/06-ui-ux.md 6.6）。Space はコール専用なのでここでは扱わない。
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.repeat) return;
      if (event.key === 'p' || event.key === 'P') togglePause();
      if (event.key === 'Escape') {
        setPendingIdolId(null);
        setSelectedUnitId(null);
      }
      if (event.key === 'Tab') {
        event.preventDefault();
        cycleSpeed();
      }
      const index = Number(event.key);
      if (Number.isInteger(index) && index >= 1 && index <= rosterIds.length) {
        const id = rosterIds[index - 1];
        if (id) selectIdol(id);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [togglePause, cycleSpeed, selectIdol]);

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
          onSellSelected={sellSelected}
          onTogglePause={togglePause}
          onCycleSpeed={cycleSpeed}
          onRestart={restart}
        />
      )}
    </div>
  );
}
