/**
 * 称号・実績（03-progression.md ⑬）。
 *
 * **未解除のものも条件を見せる。** 隠すと「何をすればいいか分からない」だけで、
 * やり込みの入口にならない。進捗バーを添えて、
 * 「あと少しなのか、まだ遠いのか」がひと目で分かるようにする。
 */
import {
  achievementViews,
  availableTitles,
  pendingRewards,
  type AchievementView,
} from '../meta/achievements';
import type { SaveData } from '../meta/save';

interface AchievementScreenProps {
  save: SaveData;
  onClaim: () => void;
  onSetTitle: (id: string | null) => void;
  onBack: () => void;
}

function Row({ view }: { view: AchievementView }): React.JSX.Element {
  const { def, value, unlocked, ratio } = view;
  return (
    <article className={`achievement${unlocked ? ' is-unlocked' : ''}`}>
      <div className="achievement-head">
        <strong>{def.name}</strong>
        <span className="achievement-title">称号「{def.title}」</span>
      </div>
      <span className="achievement-desc">{def.desc}</span>
      <div className="achievement-bar">
        <span style={{ width: `${ratio * 100}%` }} />
      </div>
      <div className="achievement-foot">
        <span className="achievement-progress">
          {Math.min(value, def.goal).toLocaleString()} / {def.goal.toLocaleString()}
        </span>
        <span className="achievement-reward">
          {def.points > 0 && <span>才能 +{def.points}</span>}
          {def.funds > 0 && <span>¥{def.funds.toLocaleString()}</span>}
        </span>
      </div>
    </article>
  );
}

export function AchievementScreen({
  save,
  onClaim,
  onSetTitle,
  onBack,
}: AchievementScreenProps): React.JSX.Element {
  const views = achievementViews(save);
  const unlocked = views.filter((v) => v.unlocked).length;
  const pending = pendingRewards(save);
  const titles = availableTitles(save);

  return (
    <div className="home">
      <header className="home-head">
        <div>
          <h1>称号・実績</h1>
          <p className="home-sub">
            {unlocked} / {views.length} 達成
          </p>
        </div>
        <button type="button" className="party-back" onClick={onBack}>
          ホームへ戻る
        </button>
      </header>

      {pending.funds > 0 && (
        <section className="party-summary">
          <h2>
            受け取れる報酬<span className="badge">{pending.ids.length}</span>
          </h2>
          <button type="button" className="party-open" onClick={onClaim}>
            <span className="party-hint">
              ¥{pending.funds.toLocaleString()} を受け取る（才能ポイントは達成した時点で
              すでに反映されています）
            </span>
          </button>
        </section>
      )}

      <section className="party-summary">
        <h2>表示する称号</h2>
        {titles.length === 0 ? (
          <p className="party-hint">実績を達成すると選べるようになります</p>
        ) : (
          <div className="title-picker">
            <button
              type="button"
              className={`title-chip${save.title === null ? ' is-on' : ''}`}
              onClick={() => onSetTitle(null)}
            >
              なし
            </button>
            {titles.map((t) => (
              <button
                key={t.id}
                type="button"
                className={`title-chip${save.title === t.id ? ' is-on' : ''}`}
                onClick={() => onSetTitle(t.id)}
              >
                {t.title}
              </button>
            ))}
          </div>
        )}
      </section>

      <section className="roster">
        <h2>一覧</h2>
        <div className="achievement-list">
          {views.map((view) => (
            <Row key={view.id} view={view} />
          ))}
        </div>
      </section>
    </div>
  );
}
