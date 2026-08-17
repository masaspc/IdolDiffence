/**
 * 衣装（03-progression.md ⑨ / 06-ui-ux.md）。
 *
 * ハクスラの持ち物画面は放っておくと「一覧を延々スクロールする作業」になる。
 * ここでは **「誰に着せるか」を先に決めさせる**構成にして、
 * 一覧は常に「そのスロットに入る候補」だけへ絞る。
 * 数が増えても、1 画面で見る量が増えない。
 */
import { useState } from 'react';
import { getIdol, getSeries } from '../data';
import {
  COSTUME_SLOTS,
  SLOT_LABEL,
  MAX_ENHANCE,
  type CostumeSlot,
} from '../data/schema/costume';
import {
  SALVAGE_COUNT,
  enhanceBlocker,
  enhanceCost,
  equippedCostume,
  isEquipped,
  mainValue,
  nextRarity,
  resolveCostumes,
  salvageBlocker,
  subValue,
  wearerOf,
} from '../meta/costumes';
import { displayName } from '../meta/evolution';
import { normalizeParty, unlockedIds } from '../meta/progression';
import type { CostumeInstance, SaveData } from '../meta/save';
import type { CostumeStat } from '../data/schema/costume';

const STAT_LABEL: Record<CostumeStat, string> = {
  atkPct: '攻撃力',
  rangePct: '射程',
  attackSpeedPct: '攻撃速度',
  critRateAdd: 'クリティカル率',
  critDmgAdd: 'クリティカルダメージ',
  cheerGainPct: '声援獲得',
  voltageGainPct: '月華の蓄積',
  statusPowerPct: '状態異常の効果量',
  statusDurationPct: '状態異常の効果時間',
  aoeRadiusPct: '範囲',
  echoPowerPct: 'Echo のダメージ',
};

const pct = (value: number): string => `+${(value * 100).toFixed(1)}%`;

interface CostumeScreenProps {
  save: SaveData;
  onEquip: (idolId: string, costumeId: string) => void;
  onUnequip: (idolId: string, slot: CostumeSlot) => void;
  onEnhance: (costumeId: string) => void;
  onSalvage: (costumeIds: string[]) => void;
  onBack: () => void;
}

export function CostumeScreen({
  save,
  onEquip,
  onUnequip,
  onEnhance,
  onSalvage,
  onBack,
}: CostumeScreenProps): React.JSX.Element {
  const roster = unlockedIds(save);
  const { party } = normalizeParty(save);
  // 出撃メンバーを先頭に。着せたいのはたいてい出す人
  const ordered = [...party, ...roster.filter((id) => !party.includes(id))];

  const [idolId, setIdolId] = useState(ordered[0] ?? 'V1');
  const [slot, setSlot] = useState<CostumeSlot>('stage');
  /** 錬成に選んだ衣装。3 着そろうと実行できる */
  const [salvaging, setSalvaging] = useState<string[]>([]);

  const effects = resolveCostumes(save, idolId);
  const candidates = save.costumes.filter((c) => c.slot === slot);
  const equipped = equippedCostume(save, idolId, slot);
  const salvageBlock = salvageBlocker(save, salvaging);
  // 「何になるか」を選んでいる途中から見せる。押してからでは遅い
  const salvageResult =
    salvaging.length > 0
      ? (() => {
          const first = save.costumes.find((c) => c.id === salvaging[0]);
          if (!first) return null;
          const mixed = salvaging.some(
            (id) => save.costumes.find((c) => c.id === id)?.rarity !== first.rarity,
          );
          return mixed ? null : nextRarity(first.rarity);
        })()
      : null;

  const toggleSalvage = (id: string): void => {
    setSalvaging((current) =>
      current.includes(id)
        ? current.filter((x) => x !== id)
        : current.length >= SALVAGE_COUNT
          ? current
          : [...current, id],
    );
  };

  return (
    <div className="home costume-screen">
      <header className="home-head">
        <div>
          <h1>衣装</h1>
          <p className="home-sub">
            所持 {save.costumes.length} 着・4 スロット・同シリーズ 2 着 / 4 着でセット効果
          </p>
        </div>
        <div className="funds">
          <span className="funds-label">資金</span>
          <span className="funds-value">¥{save.funds.toLocaleString()}</span>
        </div>
        <button type="button" className="ghost" onClick={onBack}>
          ホームへ戻る
        </button>
      </header>

      <section className="party-summary">
        <h2>着せる相手</h2>
        <div className="costume-idols">
          {ordered.map((id) => (
            <button
              key={id}
              type="button"
              className={`party-chip type-${getIdol(id).type}${id === idolId ? ' is-on' : ''}`}
              onClick={() => setIdolId(id)}
            >
              {displayName(save, id)}
              {party.includes(id) ? '' : '（控え）'}
            </button>
          ))}
        </div>
      </section>

      <section className="party-summary">
        <h2>着用中</h2>
        <div className="costume-slots">
          {COSTUME_SLOTS.map((key) => {
            const worn = equippedCostume(save, idolId, key);
            return (
              <button
                key={key}
                type="button"
                className={`costume-slot${key === slot ? ' is-on' : ''}${worn ? '' : ' is-empty'}`}
                onClick={() => setSlot(key)}
              >
                <span className="costume-slot-name">{SLOT_LABEL[key]}</span>
                {worn ? (
                  <>
                    <span className={`costume-rarity r-${worn.rarity}`}>{worn.rarity}</span>
                    <span className="costume-series">{getSeries(worn.seriesId).name}</span>
                    <span className="costume-main">
                      {STAT_LABEL[worn.mainStat]} {pct(mainValue(worn))}
                    </span>
                    <span className="costume-enhance">+{worn.enhance}</span>
                  </>
                ) : (
                  <span className="costume-series">空き</span>
                )}
              </button>
            );
          })}
        </div>

        {effects.sets.length > 0 && (
          <ul className="costume-sets">
            {effects.sets.map((set) => (
              <li key={set.seriesId}>
                <strong>{getSeries(set.seriesId).name}</strong> {set.count} 着（
                {set.tier === 4 ? '2 着 + 4 着' : '2 着'}効果）
              </li>
            ))}
          </ul>
        )}
        <p className="costume-total">
          合計:{' '}
          {Object.entries(effects.stats)
            .filter(([, value]) => value !== undefined && value !== 0)
            .map(([stat, value]) => `${STAT_LABEL[stat as CostumeStat]} ${pct(value ?? 0)}`)
            .join(' / ') || '効果なし'}
          {effects.defIgnoreAdd > 0 && ` / DEF 無視 ${pct(effects.defIgnoreAdd)}`}
          {effects.shieldPierce > 0 && ` / シールド貫通 ${pct(effects.shieldPierce)}`}
          {effects.specialDmgPct > 0 && ` / スペシャル中 ${pct(effects.specialDmgPct)}`}
          {effects.echoMaxStacksAdd > 0 && ` / Echo 上限 +${effects.echoMaxStacksAdd}`}
          {effects.startCheer > 0 && ` / 開始時声援 +${effects.startCheer}`}
        </p>
      </section>

      <section className="roster">
        <h2>
          {SLOT_LABEL[slot]}の候補
          <span className="badge">{candidates.length}</span>
        </h2>
        {equipped && (
          <button
            type="button"
            className="lesson"
            onClick={() => onUnequip(idolId, slot)}
            style={{ maxWidth: '20rem', marginBottom: '0.8rem' }}
          >
            このスロットを外す
          </button>
        )}
        {candidates.length === 0 ? (
          <p className="costume-empty">
            まだ持っていません。ライブのリザルトで手に入ります（負けても 1 着）。
          </p>
        ) : (
          <div className="roster-list">
            {candidates.map((costume) => (
              <CostumeCard
                key={costume.id}
                save={save}
                costume={costume}
                isWorn={equipped?.id === costume.id}
                isPicked={salvaging.includes(costume.id)}
                onEquip={() => onEquip(idolId, costume.id)}
                onEnhance={() => onEnhance(costume.id)}
                onToggleSalvage={() => toggleSalvage(costume.id)}
              />
            ))}
          </div>
        )}
      </section>

      <section className="party-summary">
        <h2>錬成</h2>
        <p className="costume-empty">
          同じレアリティの衣装 {SALVAGE_COUNT} 着を、<strong>1 段上のレアリティ</strong>の
          1 着に作り替えます（シリーズとステータスは引き直し）。
          R → SR → SSR → UR。UR は上が無いので UR のまま引き直します。
        </p>
        <p className="costume-total">
          選択中 {salvaging.length} / {SALVAGE_COUNT}
          {salvageResult && (
            <span className="salvage-result">
              {' → '}
              <strong>{salvageResult}</strong> が 1 着
            </span>
          )}
          {salvaging.length > 0 && (
            <button
              type="button"
              className="ghost"
              style={{ marginLeft: '0.6rem' }}
              onClick={() => setSalvaging([])}
            >
              選び直す
            </button>
          )}
        </p>
        <button
          type="button"
          className="lesson"
          style={{ maxWidth: '20rem' }}
          disabled={salvageBlock !== null}
          onClick={() => {
            onSalvage(salvaging);
            setSalvaging([]);
          }}
        >
          {salvageBlock === null
            ? '錬成する'
            : salvageBlock === 'mixed-rarity'
              ? 'レアリティを揃えてください'
              : salvageBlock === 'equipped'
                ? '着用中のものは選べません'
                : `あと ${SALVAGE_COUNT - salvaging.length} 着`}
        </button>
      </section>
    </div>
  );
}

interface CostumeCardProps {
  save: SaveData;
  costume: CostumeInstance;
  isWorn: boolean;
  isPicked: boolean;
  onEquip: () => void;
  onEnhance: () => void;
  onToggleSalvage: () => void;
}

function CostumeCard({
  save,
  costume,
  isWorn,
  isPicked,
  onEquip,
  onEnhance,
  onToggleSalvage,
}: CostumeCardProps): React.JSX.Element {
  const series = getSeries(costume.seriesId);
  const cost = enhanceCost(costume);
  const block = enhanceBlocker(save, costume.id);
  const wearer = wearerOf(save, costume.id);

  return (
    <article
      className={`roster-card costume-card r-${costume.rarity}${isPicked ? ' is-picked' : ''}`}
    >
      <div className="roster-head">
        <span className={`costume-rarity r-${costume.rarity}`}>{costume.rarity}</span>
        <div>
          <strong>{series.name}</strong>
          <span className="roster-type">{SLOT_LABEL[costume.slot]}</span>
        </div>
        <span className="roster-level">+{costume.enhance}</span>
      </div>

      <dl className="roster-stats">
        <div>
          <dt>{STAT_LABEL[costume.mainStat]}</dt>
          <dd>{pct(mainValue(costume))}</dd>
        </div>
        {costume.subs.map((sub) => (
          <div key={sub.stat} className="costume-sub">
            <dt>{STAT_LABEL[sub.stat]}</dt>
            <dd>{pct(subValue(sub.stat, sub.rolls))}</dd>
          </div>
        ))}
      </dl>

      <p className="costume-flavor">{series.flavor}</p>

      {wearer && !isWorn && (
        <p className="costume-worn-by">{displayName(save, wearer)} が着用中</p>
      )}

      <div className="party-actions">
        <button type="button" className={isWorn ? 'lesson is-on' : 'lesson'} onClick={onEquip}>
          {isWorn ? '着用中' : '着せる'}
        </button>
        <button type="button" className="lesson" disabled={block !== null} onClick={onEnhance}>
          {costume.enhance >= MAX_ENHANCE
            ? '強化上限'
            : `強化 +${costume.enhance + 1}（¥${(cost ?? 0).toLocaleString()}）`}
        </button>
        <button
          type="button"
          className={isPicked ? 'lesson is-on' : 'lesson'}
          disabled={isEquipped(save, costume.id)}
          onClick={onToggleSalvage}
        >
          {isPicked ? '錬成から外す' : '錬成に使う'}
        </button>
      </div>
    </article>
  );
}
