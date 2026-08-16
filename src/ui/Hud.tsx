import { getIdol } from '../data';
import type { AwakeningKey } from '../data/schema/idol';
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
const RARITY_LABEL: Record<string, string> = { common: 'コモン', rare: 'レア', epic: 'エピック' };

interface HudProps {
  snapshot: WorldSnapshot;
  fps: number;
  pendingIdolId: string | null;
  selectedUnitId: number | null;
  onSelectIdol: (idolId: string) => void;
  onUpgradeSelected: () => void;
  onAwaken: (branch: AwakeningKey) => void;
  onSellSelected: () => void;
  onTogglePause: () => void;
  onCycleSpeed: () => void;
  onSpecial: () => void;
  onChooseCard: (cardId: string) => void;
  onRestart: () => void;
  onExportLog: () => void;
}

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
  const selected = snapshot.units.find((u) => u.id === selectedUnitId) ?? null;
  const selectedDef = selected ? getIdol(selected.idolId) : null;
  const canUpgrade =
    selected?.upgradeCost !== null &&
    selected !== null &&
    snapshot.cheer >= (selected.upgradeCost ?? Infinity);

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
          <span className="song-title">
            ♪ {snapshot.songName}
            {snapshot.centerName && (
              <em className="song-center">・センター {snapshot.centerName}</em>
            )}
          </span>
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
            <div className={`bar bar-voltage${snapshot.specialReady ? ' is-ready' : ''}`}>
              <div className="bar-fill" style={{ width: `${snapshot.voltage}%` }} />
            </div>
            <button
              type="button"
              className={`special${snapshot.specialReady ? ' is-ready' : ''}`}
              onClick={props.onSpecial}
              disabled={!snapshot.specialReady}
            >
              {snapshot.specialRemainingMs > 0
                ? `解放中 ${(snapshot.specialRemainingMs / 1000).toFixed(1)}s`
                : `解放 ${Math.floor(snapshot.voltage)}%`}
              <kbd>Q</kbd>
            </button>
          </div>
        </div>

        <div className="palette">
          {snapshot.palette.map((entry, index) => {
            const affordable = snapshot.cheer >= entry.cost;
            return (
              <button
                key={entry.idolId}
                type="button"
                className={[
                  'palette-item',
                  `type-${entry.type}`,
                  pendingIdolId === entry.idolId ? 'is-selected' : '',
                  entry.isCenter ? 'is-center' : '',
                ].join(' ')}
                onClick={() => props.onSelectIdol(entry.idolId)}
                disabled={!affordable && pendingIdolId !== entry.idolId}
              >
                <span className="palette-icon">{TYPE_ICON[entry.type]}</span>
                <span className="palette-name">{entry.shortName}</span>
                <span className="palette-cost">♥{entry.cost}</span>
                <kbd>{index + 1}</kbd>
              </button>
            );
          })}
        </div>

        <div className="controls">
          <button
            type="button"
            onClick={props.onTogglePause}
            disabled={snapshot.clockState === 'choosing'}
            title={snapshot.clockState === 'choosing' ? 'セットリスト選択中' : '一時停止'}
          >
            {snapshot.clockState === 'paused' ? '▶' : '⏸'} <kbd>P</kbd>
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

      {selected && selectedDef && (
        <div className="unit-panel">
          <div className="unit-panel-head">
            <span className={`unit-panel-icon type-${selected.type}`}>
              {TYPE_ICON[selected.type]}
            </span>
            <span>{selected.shortName}</span>
            <span className="unit-level">
              Lv{selected.level}
              <span className="unit-level-max">/{selected.maxLevel}</span>
            </span>
          </div>

          <dl>
            <div>
              <dt>攻撃力</dt>
              <dd>{selected.atk}</dd>
            </div>
            <div>
              <dt>射程</dt>
              <dd>{selected.range.toFixed(1)} マス</dd>
            </div>
            {selected.awakeningNames.length > 0 && (
              <div>
                <dt>覚醒</dt>
                <dd>{selected.awakeningNames.join(' + ')}</dd>
              </div>
            )}
          </dl>

          {selected.awaitingAwakening ? (
            <div className="awakening">
              <p className="awakening-title">覚醒分岐を選ぶ（変更不可）</p>
              {(['A', 'B'] as AwakeningKey[]).map((key) => {
                const branch = selectedDef.awakening?.[key];
                if (!branch) return null;
                return (
                  <button
                    key={key}
                    type="button"
                    className="awakening-option"
                    onClick={() => props.onAwaken(key)}
                  >
                    <strong>{branch.name}</strong>
                    <span>{branch.desc}</span>
                  </button>
                );
              })}
            </div>
          ) : selected.upgradeCost !== null ? (
            <button
              type="button"
              className="upgrade"
              onClick={props.onUpgradeSelected}
              disabled={!canUpgrade}
            >
              Lv{selected.level + 1} へ強化（♥{selected.upgradeCost}）
              {selected.level + 1 === selected.maxLevel && (
                <em className="upgrade-note">もう一方の覚醒も開く</em>
              )}
            </button>
          ) : null}

          <button type="button" className="sell" onClick={props.onSellSelected}>
            売却（♥{Math.floor(selected.investedCost * 0.6)} 返却）
          </button>
        </div>
      )}

      {snapshot.formations.length > 0 && (
        <div className="formations">
          {snapshot.formations.map((f) => (
            <span key={f.id} className="formation-chip" title={f.desc}>
              {f.name}
              {f.count > 1 ? ` ×${f.count}` : ''}
            </span>
          ))}
        </div>
      )}

      {snapshot.takenCards.length > 0 && (
        <div className="taken-cards">
          {snapshot.takenCards.map((card) => (
            <span key={card.name}>
              {card.name}
              {card.count > 1 ? ` ×${card.count}` : ''}
            </span>
          ))}
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

      {snapshot.offers && (
        <div className="overlay">
          <div className="card-choice">
            <h2>セットリストを組む</h2>
            <p className="card-choice-note">1 枚選ぶとライブが再開します</p>
            <div className="card-list">
              {snapshot.offers.map((offer) => (
                <button
                  key={offer.id}
                  type="button"
                  className={`card card-${offer.rarity}`}
                  onClick={() => props.onChooseCard(offer.id)}
                >
                  <span className="card-rarity">{RARITY_LABEL[offer.rarity] ?? offer.rarity}</span>
                  <strong className="card-name">{offer.name}</strong>
                  <span className="card-desc">{offer.desc}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

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
                ? 'リザルトの報酬でメンバーを育てて、より上の観客数を狙えます。'
                : 'ノイズを通しすぎました。強化とセットリストで火力を伸ばしましょう。'}
            </p>
            <div className="overlay-actions">
              <button type="button" className="restart" onClick={props.onRestart}>
                ホームへ戻る
              </button>
              <button type="button" className="ghost" onClick={props.onExportLog}>
                プレイログを保存
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
