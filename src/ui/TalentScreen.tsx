/**
 * 才能ボード（03-progression.md ⑧）。
 *
 * 3 ブランチ × 12 ノード。**全部は取れない**ので、
 * 「あと何ポイントか」と「このノードで何が変わるか」が常に見えることを優先する。
 * ツリーの見た目より、取れる／取れないの判別を優先した縦並びにしている。
 */
import { getTalent, talents } from '../data';
import type { IdolType } from '../data/schema/common';
import {
  hasKeystone,
  remainingTalentPoints,
  RESPEC_COST,
  spentTalentPoints,
  takenByBranch,
  talentBlocker,
  totalTalentPoints,
} from '../meta/talents';
import type { SaveData } from '../meta/save';

const BRANCH_LABEL: Record<IdolType, string> = {
  vocal: '歌',
  dance: 'ダンス',
  visual: 'ヴィジュアル',
};
const BRANCH_ICON: Record<IdolType, string> = { vocal: '♪', dance: '★', visual: '♥' };
const TIER_LABEL: Record<string, string> = {
  small: '小',
  mid: '中',
  keystone: 'キーストーン',
};

interface TalentScreenProps {
  save: SaveData;
  onTake: (id: string) => void;
  onRespec: () => void;
  onBack: () => void;
}

export function TalentScreen({
  save,
  onTake,
  onRespec,
  onBack,
}: TalentScreenProps): React.JSX.Element {
  const remaining = remainingTalentPoints(save);
  const counts = takenByBranch(save);

  return (
    <div className="home talent-screen">
      <header className="home-head">
        <div>
          <h1>才能ボード</h1>
          <p className="home-sub">
            残り {remaining} pt（獲得 {totalTalentPoints(save)} / 使用{' '}
            {spentTalentPoints(save)}）
          </p>
        </div>
        <button type="button" className="ghost" onClick={onBack}>
          ホームへ戻る
        </button>
      </header>

      <p className="talent-note">
        ポイントはステージの初回クリア（+2）とランク S の初回達成（+1）で増えます。
        1 ブランチを埋めるのに 17 pt かかるので、**全部は取れません**。
        キーストーンは同じブランチで 1 つだけです。
      </p>

      <div className="talent-branches">
        {(['vocal', 'dance', 'visual'] as IdolType[]).map((branch) => (
          <section key={branch} className={`talent-branch type-${branch}`}>
            <h2>
              <span className="talent-branch-icon">{BRANCH_ICON[branch]}</span>
              {BRANCH_LABEL[branch]}
              <span className="talent-branch-count">{counts[branch]} / 12</span>
            </h2>

            <ol className="talent-list">
              {Object.keys(talents)
                .filter((id) => getTalent(id).branch === branch)
                .map((id) => {
                  const node = getTalent(id);
                  const blocker = talentBlocker(save, id);
                  const taken = blocker === 'taken';
                  const locked = blocker === 'requires';
                  const exclusive = blocker === 'keystone-taken';

                  return (
                    <li
                      key={id}
                      className={[
                        'talent-node',
                        `tier-${node.tier}`,
                        taken ? 'is-taken' : '',
                        locked ? 'is-locked' : '',
                        exclusive ? 'is-excluded' : '',
                      ].join(' ')}
                    >
                      <div className="talent-node-head">
                        <strong>{node.name}</strong>
                        <span className="talent-tier">{TIER_LABEL[node.tier]}</span>
                        <span className="talent-cost">{node.cost} pt</span>
                      </div>
                      <p className="talent-desc">{node.desc}</p>
                      <button
                        type="button"
                        className={taken ? 'lesson is-on' : 'lesson'}
                        disabled={blocker !== null}
                        onClick={() => onTake(id)}
                      >
                        {taken
                          ? '取得済み'
                          : locked
                            ? '前のノードが必要'
                            : exclusive
                              ? `${BRANCH_LABEL[branch]}のキーストーンは選択済み`
                              : blocker === 'no-points'
                                ? 'ポイントが足りない'
                                : '取得する'}
                      </button>
                    </li>
                  );
                })}
            </ol>

            {hasKeystone(save, branch) && (
              <p className="talent-note">このブランチのキーストーンは決定済みです。</p>
            )}
          </section>
        ))}
      </div>

      <section className="talent-respec">
        <button
          type="button"
          className="lesson"
          disabled={save.talents.length === 0 || save.funds < RESPEC_COST}
          onClick={onRespec}
        >
          反省会（¥{RESPEC_COST.toLocaleString()}）—— 取得をすべて戻す
        </button>
      </section>
    </div>
  );
}
