/**
 * 育成とキャラクター詳細（03-progression.md ⑦ / ⑦-2、04-content.md 4.2）。
 *
 * ## なぜホームから分けたか
 *
 * ホームの「レッスン」は名前・攻撃力・ボタンしか出しておらず、
 * **そのキャラが何をするのかがどこにも書いていなかった**。
 * 覚醒 A と B のどちらを選ぶか、センターを誰にするか、進化で何が変わるか ——
 * どれも決めるのに要る情報が画面に無く、JSON を読まないと分からない状態だった。
 *
 * 分けたうえで、左に一覧・右に詳細を置く。ホームは
 * 「次に何をすればいいか」だけを出す場所に戻す（06-ui-ux.md 6.1）。
 *
 * 文言は `ui/idolText.ts` が**数値から導く**。説明文を持たせると、
 * 数値を変えたときに文だけ古いまま残る。
 */
import { useState } from 'react';
import { getIdol, getStage } from '../data';
import { displayName, evolutionOf, evolveBlocker, isEvolved, type EvolveBlock } from '../meta/evolution';
import {
  canLevelUp,
  idolLevel,
  levelAtkMultiplier,
  levelUpCost,
  MAX_LEVEL,
  normalizeParty,
  unlockedIds,
} from '../meta/progression';
import { equippedCostume, mainValue, resolveCostumes } from '../meta/costumes';
import type { SaveData } from '../meta/save';
import {
  affinityText,
  ATTACK_KIND_LABEL,
  attackLines,
  auraLines,
  branchLines,
  centerLines,
  evolutionLines,
  evolutionRequirement,
  joinText,
  TYPE_LABEL,
  TYPE_STRONG_AGAINST,
} from './idolText';

const TYPE_ICON: Record<string, string> = { vocal: '♪', dance: '★', visual: '♥' };
const TAG_LABEL: Record<string, string> = {
  kaguya_irop: 'かぐや・いろP',
  black_onyx: 'Black onyX',
  tsukuyomi_liver: 'ツクヨミのライバー',
  ayaha_friend: '彩葉の友人',
  tsukuyomi_guide: 'ツクヨミの案内役',
  kaguya_partner: 'かぐやの相棒',
};

const SLOT_LABEL: Record<string, string> = {
  stage: 'ステージ',
  accessory: 'アクセサリ',
  mic: 'マイク',
  makeup: 'メイク',
};

function evolveHint(block: EvolveBlock, stageName: string, level: number): string {
  switch (block) {
    case 'stage':
      return `${stageName} をクリアすると解放`;
    case 'level':
      return `Lv${level} まで育てると解放`;
    case 'funds':
      return '資金が足りません';
    default:
      return '解放できません';
  }
}

interface IdolScreenProps {
  save: SaveData;
  /** 最初に開いておく人。隠しキャラの登場から飛んできたときに使う */
  focusId?: string | null;
  onLevelUp: (idolId: string) => void;
  onEvolve: (idolId: string) => void;
  onBack: () => void;
}

/** 説明のまとまり。見出しと箇条書き。中身が無ければ丸ごと出さない */
function Block({ title, lines }: { title: string; lines: string[] }): React.JSX.Element | null {
  if (lines.length === 0) return null;
  return (
    <div className="detail-block">
      <h3>{title}</h3>
      <ul>
        {lines.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
    </div>
  );
}

export function IdolScreen({
  save,
  focusId = null,
  onLevelUp,
  onEvolve,
  onBack,
}: IdolScreenProps): React.JSX.Element {
  const roster = unlockedIds(save);
  const [selected, setSelected] = useState(focusId ?? roster[0] ?? 'V1');
  const id = roster.includes(selected) ? selected : (roster[0] ?? 'V1');

  const def = getIdol(id);
  const level = idolLevel(save, id);
  const maxed = level >= MAX_LEVEL;
  const evolution = evolutionOf(id);
  const evolved = isEvolved(save, id);
  const block = evolution ? evolveBlocker(save, id) : 'no-evolution';
  const { party, center } = normalizeParty(save);

  // 盤面に乗る実際の値。素の値だけ見せると「育てたのに変わらない」ように見える
  const evoAtk = evolved && evolution ? evolution.atkMul : 1;
  const evoRange = evolved && evolution ? evolution.rangeMul : 1;
  const atk = Math.round(def.base.atk * levelAtkMultiplier(level) * evoAtk);
  const nextAtk = Math.round(def.base.atk * levelAtkMultiplier(level + 1) * evoAtk);
  const range = (def.base.range * evoRange).toFixed(1);

  const costumes = resolveCostumes(save, id);
  const worn = (['stage', 'accessory', 'mic', 'makeup'] as const)
    .map((slot) => ({ slot, costume: equippedCostume(save, id, slot) }))
    .filter((entry) => entry.costume !== null);

  return (
    <div className="home idol-screen">
      <header className="home-head">
        <div>
          <h1>育成</h1>
          <p className="home-sub">
            {roster.length} 人・レッスンと進化、できることの詳細
          </p>
        </div>
        <div className="funds">
          <span className="funds-label">資金</span>
          <span className="funds-value">¥{save.funds.toLocaleString()}</span>
        </div>
        <button type="button" className="party-back" onClick={onBack}>
          ホームへ戻る
        </button>
      </header>

      <div className="idol-layout">
        <nav className="idol-picker" aria-label="メンバー">
          {roster.map((memberId) => {
            const member = getIdol(memberId);
            const canLevel = canLevelUp(save, memberId);
            const evo = evolutionOf(memberId);
            const canEvo = evo !== null && evolveBlocker(save, memberId) === null;
            return (
              <button
                key={memberId}
                type="button"
                className={[
                  'idol-tab',
                  `type-${member.type}`,
                  memberId === id ? 'is-on' : '',
                ].join(' ')}
                onClick={() => setSelected(memberId)}
              >
                <span className="idol-tab-icon">{TYPE_ICON[member.type]}</span>
                <span className="idol-tab-name">{displayName(save, memberId)}</span>
                <span className="idol-tab-level">Lv{idolLevel(save, memberId)}</span>
                {(canLevel || canEvo) && <span className="badge">!</span>}
              </button>
            );
          })}
        </nav>

        <article className={`idol-detail type-${def.type}`}>
          <div className="idol-detail-head">
            <span className="idol-detail-icon">{TYPE_ICON[def.type]}</span>
            <div>
              <h2>{displayName(save, id)}</h2>
              <p className="idol-detail-sub">
                {TYPE_LABEL[def.type]}
                {def.tags.map((tag) => ` ・ ${TAG_LABEL[tag] ?? tag}`).join('')}
                {party.includes(id) && <span className="idol-flag">出撃中</span>}
                {center === id && <span className="idol-flag is-center">センター</span>}
              </p>
            </div>
            <span className="roster-level">Lv{level}</span>
          </div>

          <dl className="idol-stats">
            <div>
              <dt>攻撃力</dt>
              <dd>
                {atk}
                {!maxed && <span className="delta"> → {nextAtk}</span>}
              </dd>
            </div>
            <div>
              <dt>射程</dt>
              <dd>{range} マス</dd>
            </div>
            <div>
              <dt>攻撃間隔</dt>
              <dd>{(def.base.attackIntervalMs / 1000).toFixed(2)} 秒</dd>
            </div>
            <div>
              <dt>配置コスト</dt>
              <dd>♥{def.cost}</dd>
            </div>
            <div>
              <dt>クリティカル</dt>
              <dd>
                {Math.round(def.base.critRate * 100)}% / ダメージ +
                {Math.round((0.5 + def.base.critDmg) * 100)}%
              </dd>
            </div>
            <div>
              <dt>攻撃の種類</dt>
              <dd>{ATTACK_KIND_LABEL[def.attack.kind]}</dd>
            </div>
          </dl>

          {def.lore && <p className="idol-lore">{def.lore}</p>}

          <p className="idol-note">
            {TYPE_LABEL[def.type]}は<strong>{TYPE_STRONG_AGAINST[def.type]}</strong>の敵に有利
            （ダメージ +20%）。配置コストは<strong>声援</strong>で払い、
            置いたあとレベルを 6 段階まで上げられます。
          </p>

          <Block title="攻撃" lines={attackLines(def, evolved ? evolution : null)} />
          <Block title={`オーラ${def.aura ? `「${def.aura.name}」` : ''}`} lines={auraLines(def)} />
          {def.affinity.length > 0 && (
            <div className="detail-block">
              <h3>相性（原作の関係）</h3>
              <ul>
                {def.affinity.map((rule) => (
                  <li key={rule.name}>
                    <strong>{rule.name}</strong>: {affinityText(rule)}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {def.centerPassive && (
            <div className="detail-block">
              <h3>センター「{def.centerPassive.name}」</h3>
              <p className="detail-lead">
                編成で 1 人だけ選べます。ライブのあいだ盤面全体に効き続けます。
              </p>
              <ul>
                {centerLines(def).map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </div>
          )}
          {def.awakening && (
            <div className="detail-block">
              <h3>覚醒（配置 Lv3 でどちらか 1 つ・Lv6 でもう片方も）</h3>
              <div className="awaken-pair">
                {(['A', 'B'] as const).map((key) => {
                  const branch = def.awakening?.[key];
                  if (!branch) return null;
                  return (
                    <div key={key} className="awaken-card">
                      <strong>
                        {key}: {branch.name}
                      </strong>
                      <p>{branch.desc}</p>
                      <ul>
                        {branchLines(branch).map((line) => (
                          <li key={line}>{line}</li>
                        ))}
                      </ul>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {worn.length > 0 && (
            <div className="detail-block">
              <h3>着ている衣装</h3>
              <ul>
                {worn.map(({ slot, costume }) => (
                  <li key={slot}>
                    {SLOT_LABEL[slot]}: {costume?.rarity} +{costume?.enhance}（
                    {costume ? Math.round(mainValue(costume) * 100) / 100 : 0} 相当）
                  </li>
                ))}
              </ul>
              <p className="detail-lead">
                合計の攻撃力 +{Math.round((costumes.stats.atkPct ?? 0) * 100)}%
              </p>
            </div>
          )}

          <div className="detail-block">
            <h3>レッスン</h3>
            <p className="detail-lead">
              資金でレベルを上げます。Lv{MAX_LEVEL} が上限で、攻撃力は 1 レベルごとに
              素の 6% ぶん増えます。
              （{joinText(save, id)}）
            </p>
            <button
              type="button"
              className="lesson"
              disabled={maxed || !canLevelUp(save, id)}
              onClick={() => onLevelUp(id)}
            >
              {maxed ? 'レベル上限' : `レッスン（¥${levelUpCost(level).toLocaleString()}）`}
            </button>
          </div>

          {evolution && (
            <div className={`detail-block evolve${evolved ? ' is-done' : ''}`}>
              <h3>
                ✦ 進化「{evolution.name}」{evolved && <span className="evolve-done">解放済み</span>}
              </h3>
              <p className="evolve-desc">{evolution.desc}</p>
              <ul>
                {evolutionLines(evolution).map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
              {!evolved && (
                <>
                  <p className="detail-lead">条件: {evolutionRequirement(evolution)}</p>
                  <button
                    type="button"
                    className="lesson evolve-button"
                    disabled={block !== null}
                    onClick={() => onEvolve(id)}
                  >
                    {block === null
                      ? `進化（¥${evolution.cost.toLocaleString()}）`
                      : evolveHint(
                          block,
                          getStage(evolution.requires.stage).name,
                          evolution.requires.level,
                        )}
                  </button>
                </>
              )}
            </div>
          )}
        </article>
      </div>
    </div>
  );
}
