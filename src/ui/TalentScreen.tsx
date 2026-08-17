/**
 * 才能ボード（03-progression.md ⑧）。
 *
 * 3 ブランチ × 18 ノード。**全部は取れない**ので、
 * 「あと何ポイントか」と「このノードで何が変わるか」が常に見えることを優先する。
 * ツリーの見た目より、取れる／取れないの判別を優先した縦並びにしている。
 * ただし**道の分かれ目だけは見せる** —— 18 ノードを 1 列に並べると、
 * どこで排他が起きるのかがデータを読まないと分からない。
 */
import { getTalent } from '../data';
import type { IdolType } from '../data/schema/common';
import {
  branchLayout,
  hasCapstone,
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
  capstone: '最終',
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
        ポイントはステージの初回クリア（+2）とランク S の初回達成（+1）、
        プロデューサーランク（+2/Lv）で増えます。
        <strong>キーストーンは同じブランチで 1 つだけ</strong>、
        <strong>最終才能はボード全体で 1 つだけ</strong>です。
        遊び込めばポイントは余りますが、この 2 つの排他だけは最後まで残ります。
      </p>

      <div className="talent-branches">
        {(['vocal', 'dance', 'visual'] as IdolType[]).map((branch) => (
          <section key={branch} className={`talent-branch type-${branch}`}>
            <h2>
              <span className="talent-branch-icon">{BRANCH_ICON[branch]}</span>
              {BRANCH_LABEL[branch]}
              <span className="talent-branch-count">{counts[branch]} / 18</span>
            </h2>

            {/*
              18 ノードを 1 列に並べると、**どこで道が分かれるのかが読めない**。
              分岐は `requires` にしか書いていないので、`branchLayout` で復元して
              「共通の根 → 2 つの道」の形のまま見せる
            */}
            {(() => {
              const layout = branchLayout(branch);
              const groups: { title: string; note?: string; ids: string[] }[] = [
                { title: '共通', note: 'どちらの道へ進んでも通ります', ids: layout.shared },
                ...layout.paths.map((path) => ({
                  title: `${getTalent(path.keystoneId).name} の道`,
                  ids: path.ids,
                })),
              ];
              return groups.map((group) => (
                <div key={group.title} className="talent-group">
                  <h3 className="talent-group-name">
                    {group.title}
                    <span className="talent-group-cost">
                      {group.ids.reduce((sum, id) => sum + getTalent(id).cost, 0)} pt
                    </span>
                  </h3>
                  {group.note && <p className="talent-note">{group.note}</p>}
                  <ol className="talent-list">
                    {group.ids.map((id) => {
                      const node = getTalent(id);
                      const blocker = talentBlocker(save, id);
                      const taken = blocker === 'taken';
                      const locked = blocker === 'requires';
                      const exclusive =
                        blocker === 'keystone-taken' || blocker === 'capstone-taken';

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
                                : blocker === 'capstone-taken'
                                  ? '最終才能は選択済み（ボード全体で 1 つ）'
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
                </div>
              ));
            })()}

            {hasKeystone(save, branch) && (
              <p className="talent-note">このブランチのキーストーンは決定済みです。</p>
            )}
          </section>
        ))}
      </div>

      {hasCapstone(save) && (
        <p className="talent-note">
          最終才能は決定済みです。選び直すには反省会でボードを戻してください。
        </p>
      )}

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
