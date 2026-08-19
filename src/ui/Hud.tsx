import { getIdol } from '../data';
import type { AwakeningKey } from '../data/schema/idol';
import type { WorldSnapshot } from '../sim/world';
import { nextTutorial, type TutorialStep } from '../meta/tutorial';
import { resultComments } from '../render/comments';

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
  /** 月華のゲージを出すか（段階解放。`meta/onboarding.ts`） */
  showVoltage: boolean;
  /** フォーメーションの表示（同上） */
  showFormations: boolean;
  /** 見せ終わったチュートリアルの札（`meta/tutorial.ts`） */
  tutorialSeen: readonly string[];
  onTutorialSeen: (id: string) => void;
  onSelectIdol: (idolId: string) => void;
  onUpgradeSelected: () => void;
  onAwaken: (branch: AwakeningKey) => void;
  onSellSelected: () => void;
  onTogglePause: () => void;
  onCycleSpeed: () => void;
  onSpecial: () => void;
  onCall: () => void;
  onSoloPart: () => void;
  onChooseCard: (cardId: string) => void;
  onRestart: () => void;
  onExportLog: () => void;
}

/**
 * チュートリアルの札（`meta/tutorial.ts`）。
 *
 * **盤面を覆わない。** 全画面のモーダルにすると、説明しているものが
 * 説明のあいだだけ見えなくなる。指す先の近くに小さく貼り、
 * 閉じるまで残す —— 自動で消すと、読む前に消えたときに戻す手段が無い
 */
function CoachMark(props: { step: TutorialStep; onClose: () => void }): React.JSX.Element {
  return (
    <div className={`coach coach-${props.step.anchor}`} role="status">
      <strong className="coach-title">{props.step.title}</strong>
      <span className="coach-body">{props.step.body}</span>
      <button type="button" className="coach-close" onClick={props.onClose}>
        わかった
      </button>
    </div>
  );
}

/** 判定の表示名。日本語にすると 3 つの幅が揃わず、出るたびに位置が動く */
const JUDGE_LABEL: Record<string, string> = {
  perfect: 'PERFECT',
  good: 'GOOD',
  miss: 'MISS',
};

/** 判定の表示を消すまでの時間 */
const JUDGE_LIFE_MS = 600;

/**
 * コールのマーカー（02-core-battle.md 2.9）。
 *
 * **リングが縮んで消える瞬間が小節の頭**。数字のカウントダウンにすると
 * 目を落とさないと読めず、盤面から視線が外れる。
 * 押せる窓（±160ms）に入ったらリングを光らせて、
 * 「いま押していい」を色で伝える。
 */
function CallMarker(props: {
  call: NonNullable<WorldSnapshot['call']>;
  onCall: () => void;
}): React.JSX.Element {
  const { call } = props;
  // 近づくほど 0 へ寄せる。手前 1000ms から出す ——
  // それより早いと常時なにか動いていて目が疲れる
  const LEAD_MS = 1000;
  const ratio = Math.max(0, Math.min(1, call.toTargetMs / LEAD_MS));
  const judge = call.lastAgeMs < JUDGE_LIFE_MS ? call.lastJudge : null;

  return (
    <button
      type="button"
      className={`call${call.open ? ' is-open' : ''}`}
      onClick={props.onCall}
      aria-label="コール"
    >
      <span className="call-ring" style={{ transform: `scale(${1 + ratio * 0.9})` }} />
      <span className="call-core">
        {judge ? (
          <span className={`call-judge is-${judge}`}>{JUDGE_LABEL[judge]}</span>
        ) : (
          <span className="call-key">Space</span>
        )}
      </span>
      {call.combo >= 2 && <span className="call-combo">{call.combo} 連</span>}
    </button>
  );
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
  // 進化後は表示名が変わる。パレットの名前をそのまま使って案内と食い違わせない
  const pendingName = pendingIdolId
    ? (snapshot.palette.find((e) => e.idolId === pendingIdolId)?.shortName ??
      getIdol(pendingIdolId).name)
    : '';
  const selected = snapshot.units.find((u) => u.id === selectedUnitId) ?? null;
  // いま出すべき札は 1 枚だけ。並べて出すと画面が札で埋まる
  const coach = nextTutorial(props.tutorialSeen, {
    placed: snapshot.units.length,
    leaked: snapshot.leaked,
    choosing: snapshot.offers !== null,
    specialReady: snapshot.specialReady,
    awaiting: snapshot.units.some((u) => u.awaitingAwakening),
  });
  const selectedDef = selected ? getIdol(selected.idolId) : null;
  const canUpgrade =
    selected?.upgradeCost !== null &&
    selected !== null &&
    snapshot.cheer >= (selected.upgradeCost ?? Infinity);

  return (
    <>
      <div className="hud hud-top">
        {(snapshot.star > 1 || snapshot.starRule || snapshot.stageNote) && (
          <div className="stage-rules">
            {snapshot.star > 1 && <span className="star-chip">★{snapshot.star}</span>}
            {snapshot.starRule && <span className="rule-chip">{snapshot.starRule}</span>}
            {snapshot.stageNote && <span className="rule-chip">{snapshot.stageNote}</span>}
          </div>
        )}
        <div className="gauge">
          {/* ゲージの数はツクヨミの同時接続数（設計文書では観客ゲージ）。
              ライブは配信なので、画面の語彙は「同接」で揃える */}
          <span className="gauge-label">同接</span>
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
          {/* 月華はまだ開いていないことがある（段階解放）。
              満タンのゲージを出したまま押せなくすると、
              「壊れている」のか「まだ早い」のかが分からない */}
          {props.showVoltage && (
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
          )}
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

        {snapshot.call && <CallMarker call={snapshot.call} onCall={props.onCall} />}

        {pendingIdolId && (
          <div className="hint">
            {pendingName} を配置するマスをクリック（<kbd>Esc</kbd> で取消）
          </div>
        )}
      </div>

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

          {/* ソロパート（楽曲レベル）。**選んでいる 1 人**に当てるので、
              全体バフの月華とは別のボタンにしてユニットパネルへ置く */}
          {snapshot.soloReady !== null && (
            <button
              type="button"
              className={`solo${snapshot.soloUnitId === selected.id ? ' is-on' : ''}`}
              onClick={props.onSoloPart}
              disabled={!snapshot.soloReady}
            >
              {snapshot.soloUnitId === selected.id
                ? 'ソロパート中'
                : snapshot.soloReady
                  ? 'ソロパート'
                  : `ソロパート（あと ${Math.ceil(snapshot.soloCooldownMs / 1000)}s）`}
            </button>
          )}

          <button type="button" className="sell" onClick={props.onSellSelected}>
            売却（♥{Math.floor(selected.investedCost * 0.6)} 返却）
          </button>
        </div>
      )}

      {props.showFormations && snapshot.formations.length > 0 && (
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

      {/* チュートリアルの札は**いちばん外側に置く**。
          下部バーの中に置いていたら、セットリストの選択（全画面のオーバーレイ）に
          覆われて「わかった」が押せなかった —— よりによって、
          そのオーバーレイを説明する札が押せない状態になっていた */}
      {coach && <CoachMark step={coach} onClose={() => props.onTutorialSeen(coach.id)} />}

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
              同接 {snapshot.audience} / 100 ・ 撃破 {snapshot.killed} ・ 漏れ {snapshot.leaked}
            </p>
            {snapshot.contribution.length > 0 && (
              <div className="contribution">
                <h3>貢献度</h3>
                {(() => {
                  const top = snapshot.contribution[0]?.damage ?? 1;
                  const total = snapshot.contribution.reduce((sum, c) => sum + c.damage, 0) || 1;
                  return snapshot.contribution.map((entry) => (
                    <div key={entry.idolId} className="contribution-row">
                      <span className="contribution-name">{entry.shortName}</span>
                      <span className="contribution-bar">
                        <span style={{ width: `${(entry.damage / top) * 100}%` }} />
                      </span>
                      <span className="contribution-value">
                        {Math.round((entry.damage / total) * 100)}%
                      </span>
                    </div>
                  ));
                })()}
              </div>
            )}
            {/* 配信終了後のコメント欄。決着の瞬間に流すのは無理がある ——
                描画ループが止まるので、静止して並べる（`render/comments.ts`） */}
            <p className="result-comments">
              {resultComments(snapshot.won, snapshot.killed).map((text) => (
                <span key={text}>{text}</span>
              ))}
            </p>
            <p className="note">
              {snapshot.won
                ? 'リザルトの報酬でメンバーを育てて、より多くの同接を狙えます。'
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
