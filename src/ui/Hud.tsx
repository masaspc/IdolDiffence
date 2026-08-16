import type { WorldSnapshot } from '../sim/world';

const SECTION_LABEL: Record<string, string> = {
  intro: 'イントロ',
  verse: 'Aメロ',
  bridge: 'Bメロ',
  chorus: 'サビ',
  interlude: '間奏',
  finale: '大サビ',
};

interface HudProps {
  snapshot: WorldSnapshot;
  fps: number;
  onTogglePause: () => void;
  onCycleSpeed: () => void;
}

export function Hud({ snapshot, fps, onTogglePause, onCycleSpeed }: HudProps): React.JSX.Element {
  const wave = snapshot.wave;
  const sectionLabel = wave ? (SECTION_LABEL[wave.section] ?? wave.section) : '完走';

  return (
    <>
      <div className="hud hud-top">
        <div className="gauge">
          <span className="gauge-label">観客</span>
          <div className="bar bar-audience">
            <div className="bar-fill" style={{ width: `${snapshot.audience}%` }} />
          </div>
          <span className="gauge-value">{snapshot.audience}</span>
        </div>
        <div className="song">
          <span className="song-title">♪ {snapshot.songName}</span>
          <span className="song-section">
            {sectionLabel}
            {wave ? ` ${wave.index + 1}/${snapshot.waveCount}` : ''}
          </span>
        </div>
      </div>

      <div className="hud hud-bottom">
        <div className="resources">
          <span className="cheer">
            <span className="cheer-icon">♥</span> {snapshot.cheer}
          </span>
          <div className="gauge gauge-voltage">
            <span className="gauge-label">月華</span>
            <div className="bar bar-voltage">
              <div className="bar-fill" style={{ width: `${snapshot.voltage}%` }} />
            </div>
            <span className="gauge-value">{Math.floor(snapshot.voltage)}%</span>
          </div>
        </div>
        <div className="controls">
          <button type="button" onClick={onTogglePause}>
            {snapshot.clockState === 'running' ? '⏸ 一時停止' : '▶ 再開'} <kbd>P</kbd>
          </button>
          <button type="button" onClick={onCycleSpeed}>
            ⏩ {snapshot.speed}x <kbd>Tab</kbd>
          </button>
        </div>
      </div>

      <div className="debug">
        <span className={fps >= 55 ? 'ok' : 'warn'}>{fps} fps</span>
        <span>
          {snapshot.bpm} BPM / {snapshot.bar} 小節
        </span>
        <span className="stage-name">{snapshot.stageName}</span>
      </div>

      {snapshot.finished && (
        <div className="overlay">
          <div className="overlay-card">
            <h2>{snapshot.won ? 'ライブ完走' : 'ライブ中断'}</h2>
            <p>観客 {snapshot.audience} / 100</p>
            <p className="note">
              M0 の空ステージです。敵とアイドルの配置は M1 で入ります。
            </p>
          </div>
        </div>
      )}
    </>
  );
}
