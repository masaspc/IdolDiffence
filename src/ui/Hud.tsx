import { getIdol, rosterIds } from '../data';
import type { WorldSnapshot } from '../sim/world';

const SECTION_LABEL: Record<string, string> = {
  intro: 'イントロ',
  verse: 'Aメロ',
  bridge: 'Bメロ',
  chorus: 'サビ',
  interlude: '間奏',
  finale: '大サビ',
};

const TYPE_ICON: Record<string, string> = { vocal: '♪', dance: '★', visual: '♥' };

interface HudProps {
  snapshot: WorldSnapshot;
  fps: number;
  pendingIdolId: string | null;
  selectedUnitId: number | null;
  onSelectIdol: (idolId: string) => void;
  onSellSelected: () => void;
  onTogglePause: () => void;
  onCycleSpeed: () => void;
  onRestart: () => void;
}

/** 観客の残量でランクを決める。M1 は報酬なしなので表示のみ */
function rankOf(audience: number): string {
  if (audience >= 100) return 'S';
  if (audience >= 80) return 'A';
  if (audience >= 50) return 'B';
  return 'C';
}

export function Hud(props: HudProps): React.JSX.Element {
  const { snapshot, fps, pendingIdolId, selectedUnitId } = props;
  const wave = snapshot.wave;
  const sectionLabel = wave ? (SECTION_LABEL[wave.section] ?? wave.section) : '大詰め';
  const selectedUnit = snapshot.units.find((u) => u.id === selectedUnitId) ?? null;

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
            {wave ? ` ${wave.index + 1}/${snapshot.waveCount}` : ''} ／ 残り {snapshot.remainingSpawns} 体
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

        <div className="palette">
          {rosterIds.map((id, index) => {
            const idol = getIdol(id);
            const affordable = snapshot.cheer >= idol.cost;
            return (
              <button
                key={id}
                type="button"
                className={[
                  'palette-item',
                  `type-${idol.type}`,
                  pendingIdolId === id ? 'is-selected' : '',
                  affordable ? '' : 'is-disabled',
                ].join(' ')}
                onClick={() => props.onSelectIdol(id)}
                disabled={!affordable && pendingIdolId !== id}
              >
                <span className="palette-icon">{TYPE_ICON[idol.type]}</span>
                <span className="palette-name">{idol.shortName}</span>
                <span className="palette-cost">♥{idol.cost}</span>
                <kbd>{index + 1}</kbd>
              </button>
            );
          })}
        </div>

        <div className="controls">
          <button type="button" onClick={props.onTogglePause}>
            {snapshot.clockState === 'running' ? '⏸' : '▶'} <kbd>P</kbd>
          </button>
          <button type="button" onClick={props.onCycleSpeed}>
            ⏩ {snapshot.speed}x <kbd>Tab</kbd>
          </button>
        </div>
      </div>

      {pendingIdolId && (
        <div className="hint">
          {getIdol(pendingIdolId).name} を配置するマスをクリック（<kbd>Esc</kbd> で取消）
        </div>
      )}

      {selectedUnit && (
        <div className="unit-panel">
          <div className="unit-panel-head">
            <span className={`unit-panel-icon type-${selectedUnit.type}`}>
              {TYPE_ICON[selectedUnit.type]}
            </span>
            <span>{selectedUnit.shortName}</span>
          </div>
          <dl>
            <div>
              <dt>射程</dt>
              <dd>{selectedUnit.range.toFixed(1)} マス</dd>
            </div>
            <div>
              <dt>配置コスト</dt>
              <dd>♥{selectedUnit.cost}</dd>
            </div>
          </dl>
          <button type="button" className="sell" onClick={props.onSellSelected}>
            売却（♥{Math.floor(selectedUnit.cost * 0.6)} 返却）
          </button>
        </div>
      )}

      <div className="debug">
        <span className={fps >= 55 ? 'ok' : 'warn'}>{fps} fps</span>
        <span>
          {snapshot.bpm} BPM / {snapshot.bar} 小節
        </span>
        <span>
          撃破 {snapshot.killed} / 漏れ {snapshot.leaked}
        </span>
      </div>

      {snapshot.finished && (
        <div className="overlay">
          <div className="overlay-card">
            <h2>{snapshot.won ? 'ライブ完走！' : 'ライブ中断…'}</h2>
            {snapshot.won && <p className="rank">ランク {rankOf(snapshot.audience)}</p>}
            <p>
              観客 {snapshot.audience} / 100 ・ 撃破 {snapshot.killed} ・ 漏れ {snapshot.leaked}
            </p>
            <p className="note">
              {snapshot.won
                ? 'M1 の範囲はここまで。セットリストと強化は M2 で入ります。'
                : 'ツキビトを通しすぎました。経路沿いにメンバーを置いて迎撃しましょう。'}
            </p>
            <button type="button" className="restart" onClick={props.onRestart}>
              もう一度
            </button>
          </div>
        </div>
      )}
    </>
  );
}
