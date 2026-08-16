/**
 * ホーム（事務所）。育成とライブ開始の入口。
 *
 * 「次に何をすればいいか」が一目で分かることを最優先にする。
 * レベルアップ可能なキャラにはバッジを出す（06-ui-ux.md 6.1）。
 */
import { getIdol, getSong, getStage, requiredStage, rosterIds, stageOrder } from '../data';
import {
  canLevelUp,
  idolLevel,
  levelAtkMultiplier,
  levelUpCost,
  MAX_LEVEL,
} from '../meta/progression';
import type { SaveData } from '../meta/save';

const TYPE_ICON: Record<string, string> = { vocal: '♪', dance: '★', visual: '♥' };
const TYPE_LABEL: Record<string, string> = { vocal: '歌', dance: 'ダンス', visual: 'ヴィジュアル' };

interface HomeScreenProps {
  save: SaveData;
  onLevelUp: (idolId: string) => void;
  onStart: (stageId: string) => void;
  lastResult: { won: boolean; audience: number; funds: number } | null;
}

export function HomeScreen({ save, onLevelUp, onStart, lastResult }: HomeScreenProps): React.JSX.Element {
  const upgradable = rosterIds.filter((id) => canLevelUp(save, id)).length;

  return (
    <div className="home">
      <header className="home-head">
        <div>
          <h1>超・かぐや姫</h1>
          <p className="home-sub">IDOL DIFFENCE — 事務所</p>
        </div>
        <div className="funds">
          <span className="funds-label">資金</span>
          <span className="funds-value">¥{save.funds.toLocaleString()}</span>
        </div>
      </header>

      {lastResult && (
        <div className={`last-result ${lastResult.won ? 'won' : 'lost'}`}>
          前回のライブ: {lastResult.won ? '完走' : '中断'}（観客 {lastResult.audience}）
          <strong>＋¥{lastResult.funds.toLocaleString()}</strong>
        </div>
      )}

      <section className="roster">
        <h2>
          レッスン
          {upgradable > 0 && <span className="badge">{upgradable}</span>}
        </h2>
        <div className="roster-list">
          {rosterIds.map((id) => {
            const idol = getIdol(id);
            const level = idolLevel(save, id);
            const maxed = level >= MAX_LEVEL;
            const cost = levelUpCost(level);
            const affordable = canLevelUp(save, id);
            const atk = Math.round(idol.base.atk * levelAtkMultiplier(level));
            const nextAtk = Math.round(idol.base.atk * levelAtkMultiplier(level + 1));

            return (
              <article key={id} className={`roster-card type-${idol.type}`}>
                <div className="roster-head">
                  <span className="roster-icon">{TYPE_ICON[idol.type]}</span>
                  <div>
                    <strong>{idol.name}</strong>
                    <span className="roster-type">{TYPE_LABEL[idol.type]}</span>
                  </div>
                  <span className="roster-level">Lv{level}</span>
                </div>

                <dl className="roster-stats">
                  <div>
                    <dt>攻撃力</dt>
                    <dd>
                      {atk}
                      {!maxed && <span className="delta"> → {nextAtk}</span>}
                    </dd>
                  </div>
                  <div>
                    <dt>配置コスト</dt>
                    <dd>♥{idol.cost}</dd>
                  </div>
                </dl>

                <button
                  type="button"
                  className="lesson"
                  disabled={maxed || !affordable}
                  onClick={() => onLevelUp(id)}
                >
                  {maxed ? 'レベル上限' : `レッスン（¥${cost.toLocaleString()}）`}
                </button>
              </article>
            );
          })}
        </div>
      </section>

      <section className="stage-select">
        <h2>ライブ</h2>
        <div className="stage-list">
          {stageOrder.map((stageId) => {
            const stage = getStage(stageId);
            const song = getSong(stage.song);
            const progress = save.stageProgress[stageId];
            const gate = requiredStage(stageId);
            const locked = gate !== null && !save.stageProgress[gate]?.cleared;

            return (
              <button
                key={stageId}
                type="button"
                className={`stage-card${locked ? ' is-locked' : ''}`}
                onClick={() => onStart(stageId)}
                disabled={locked}
              >
                <span className="stage-no">{stageId}</span>
                <span className="stage-name">{stage.name}</span>
                <span className="stage-meta">
                  {locked
                    ? `${getStage(gate).name} をクリアすると解放`
                    : progress?.cleared
                      ? `クリア済み・最高観客 ${progress.bestAudience}`
                      : '未クリア'}
                </span>
                <span className="stage-song">
                  ♪ {song.name}・{song.bpm} BPM・{stage.lanes.length} レーン
                  {progress ? ` ・ ${progress.plays} 回` : ''}
                </span>
              </button>
            );
          })}
        </div>
      </section>
    </div>
  );
}
