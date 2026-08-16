/**
 * バトル画面。Canvas の上に DOM の HUD を重ねる構成
 * （docs/design/06-ui-ux.md 6.2）。
 *
 * React は sim を**所有しない**。フレームごとにスナップショットを受け取るだけで、
 * 状態の実体は BattleWorld にある。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { GameLoop } from '../core/loop';
import { Renderer } from '../render/renderer';
import { createWorld, type WorldSnapshot } from '../sim/world';
import { randomSeed } from '../core/rng';
import { Hud } from './Hud';

const STAGE_ID = 'S1';

export function BattleScreen(): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<ReturnType<typeof createWorld> | null>(null);
  const loopRef = useRef<GameLoop | null>(null);

  const [snapshot, setSnapshot] = useState<WorldSnapshot | null>(null);
  const [fps, setFps] = useState(0);

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
    const loop = new GameLoop({
      update: (dtMs) => {
        world.update(dtMs);
      },
      render: (alpha) => {
        renderer.draw(alpha);
        // HUD の再レンダリングは 10Hz で足りる。60Hz で setState すると
        // React の再描画が Canvas の描画コストを上回ってしまう
        sinceUiUpdate += 1;
        if (sinceUiUpdate >= 6) {
          sinceUiUpdate = 0;
          setSnapshot(world.snapshot());
          setFps(loop.getStats().fps);
        }
      },
    });
    loopRef.current = loop;
    loop.start();
    setSnapshot(world.snapshot());

    return () => {
      loop.stop();
      observer.disconnect();
      worldRef.current = null;
      loopRef.current = null;
    };
  }, []);

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

  // キー割り当ての原則: 1 つのキーに文脈依存の複数機能を持たせない
  // （docs/design/06-ui-ux.md 6.6）。Space はコール専用なのでここでは扱わない。
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.repeat) return;
      if (event.key === 'p' || event.key === 'P') togglePause();
      if (event.key === 'Tab') {
        event.preventDefault();
        cycleSpeed();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [togglePause, cycleSpeed]);

  return (
    <div className="battle">
      <div className="stage" ref={containerRef}>
        <canvas ref={canvasRef} />
      </div>
      {snapshot && (
        <Hud snapshot={snapshot} fps={fps} onTogglePause={togglePause} onCycleSpeed={cycleSpeed} />
      )}
    </div>
  );
}
