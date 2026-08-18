/**
 * 編成画面（03-progression.md ⑤ / 04-content.md 4.2）。
 *
 * 原作の 12 人から 5 人を選び、そのうち 1 人をセンターに置く。
 * センターは全体パッシブなので、**選んだ効果がその場で読める**ことを優先し、
 * カードに効果文をそのまま出している。
 */
import { getIdol, getStage, idolUnlockStage, PARTY_SIZE, rosterIds, SECRET_IDS } from '../data';
import { isUnlocked, normalizeParty } from '../meta/progression';
import { displayName, evolutionOf, isEvolved } from '../meta/evolution';
import type { SaveData } from '../meta/save';

const TYPE_ICON: Record<string, string> = { vocal: '♪', dance: '★', visual: '♥' };
const TYPE_LABEL: Record<string, string> = { vocal: '歌', dance: 'ダンス', visual: 'ヴィジュアル' };
const TAG_LABEL: Record<string, string> = {
  kaguya_irop: 'かぐや・いろP',
  black_onyx: 'Black onyX',
  tsukuyomi_liver: 'ツクヨミのライバー',
  ayaha_friend: '彩葉の友人',
  tsukuyomi_guide: 'ツクヨミの案内役',
  kaguya_partner: 'かぐやの相棒',
};

/** 進化を解放しているぶんの倍率。未解放なら 1 */
function evolvedMul(save: SaveData, idolId: string): { atk: number; range: number } {
  const evolution = isEvolved(save, idolId) ? evolutionOf(idolId) : null;
  return { atk: evolution?.atkMul ?? 1, range: evolution?.rangeMul ?? 1 };
}

interface PartyScreenProps {
  save: SaveData;
  onToggle: (idolId: string) => void;
  /** センターを選べるか（段階解放。`meta/onboarding.ts`） */
  canSetCenter: boolean;
  onSetCenter: (idolId: string) => void;
  onBack: () => void;
}

export function PartyScreen({
  save,
  onToggle,
  canSetCenter,
  onSetCenter,
  onBack,
}: PartyScreenProps): React.JSX.Element {
  const { party, center } = normalizeParty(save);
  const centerDef = center ? getIdol(center).centerPassive : undefined;

  return (
    <div className="home party-screen">
      <header className="home-head">
        <div>
          <h1>編成</h1>
          <p className="home-sub">
            出撃 {party.length} / {PARTY_SIZE} 人・センターは 1 人
          </p>
        </div>
        <button type="button" className="ghost" onClick={onBack}>
          ホームへ戻る
        </button>
      </header>

      <div className={`center-summary${centerDef ? '' : ' is-empty'}`}>
        {centerDef ? (
          <>
            <span className="center-badge">センター</span>
            <strong>{center ? displayName(save, center) : ''}</strong>
            <span className="center-effect">
              {centerDef.name} —— {centerDef.desc}
            </span>
          </>
        ) : (
          'センターを選んでください'
        )}
      </div>

      <section className="roster">
        <div className="roster-list">
          {rosterIds.map((id) => {
            const idol = getIdol(id);
            const unlocked = isUnlocked(save, id);
            // 隠しキャラは**解放するまで枠ごと出さない**。
            // 他のメンバーと同じ「？？？」で並べると、そこに何かある事実だけが漏れる
            if (!unlocked && SECRET_IDS.includes(id)) return null;
            const inParty = party.includes(id);
            const isCenter = center === id;
            const gate = idolUnlockStage[id];
            const full = party.length >= PARTY_SIZE;

            return (
              <article
                key={id}
                className={[
                  'roster-card',
                  `type-${idol.type}`,
                  inParty ? 'is-party' : '',
                  isCenter ? 'is-center' : '',
                  unlocked ? '' : 'is-locked',
                ].join(' ')}
              >
                <div className="roster-head">
                  <span className="roster-icon">{TYPE_ICON[idol.type]}</span>
                  <div>
                    <strong>{unlocked ? displayName(save, id) : '？？？'}</strong>
                    <span className="roster-type">
                      {TYPE_LABEL[idol.type]}
                      {idol.tags.map((tag) => ` ・ ${TAG_LABEL[tag] ?? tag}`).join('')}
                    </span>
                  </div>
                  {isCenter && <span className="roster-level">センター</span>}
                </div>

                {unlocked ? (
                  <>
                    {/* レベルは掛けない（ここは見比べるための素の値）。
                        ただし進化は名前ごと変わるので、素の値にも反映する */}
                    <dl className="roster-stats">
                      <div>
                        <dt>攻撃力</dt>
                        <dd>{Math.round(idol.base.atk * evolvedMul(save, id).atk)}</dd>
                      </div>
                      <div>
                        <dt>射程</dt>
                        <dd>{(idol.base.range * evolvedMul(save, id).range).toFixed(1)}</dd>
                      </div>
                      <div>
                        <dt>コスト</dt>
                        <dd>♥{idol.cost}</dd>
                      </div>
                    </dl>
                    {idol.aura && (
                      <p className="roster-note">
                        {idol.aura.name}: {idol.aura.desc}
                      </p>
                    )}
                    <div className="party-actions">
                      <button
                        type="button"
                        className={inParty ? 'lesson is-on' : 'lesson'}
                        onClick={() => onToggle(id)}
                        disabled={!inParty && full}
                      >
                        {inParty ? '出撃から外す' : full ? '定員' : '出撃に加える'}
                      </button>
                      {canSetCenter && (
                        <button
                          type="button"
                          className="ghost"
                          onClick={() => onSetCenter(id)}
                          disabled={!inParty || isCenter}
                        >
                          センターに
                        </button>
                      )}
                    </div>
                  </>
                ) : (
                  <p className="roster-note">
                    {gate ? `${getStage(gate).name} をクリアすると加入` : '未解放'}
                  </p>
                )}
              </article>
            );
          })}
        </div>
      </section>
    </div>
  );
}
