/**
 * ホーム。育成とライブ開始の入口。
 *
 * 「次に何をすればいいか」が一目で分かることを最優先にする。
 * レベルアップ可能なキャラにはバッジを出す（06-ui-ux.md 6.1）。
 */
import { getIdol, getSong, getStage, requiredStage, stageOrder } from '../data';
import { remainingTalentPoints } from '../meta/talents';
import {
  canEvolve,
  evolutionOf,
  evolveBlocker,
  isEvolved,
  type EvolveBlock,
} from '../meta/evolution';
import {
  canLevelUp,
  idolLevel,
  levelAtkMultiplier,
  levelUpCost,
  MAX_LEVEL,
  normalizeParty,
  unlockedIds,
} from '../meta/progression';
import type { CostumeInstance, SaveData } from '../meta/save';

const TYPE_ICON: Record<string, string> = { vocal: '♪', dance: '★', visual: '♥' };
const TYPE_LABEL: Record<string, string> = { vocal: '歌', dance: 'ダンス', visual: 'ヴィジュアル' };

/**
 * 進化できない理由の文言。
 *
 * 「解放できません」だけだと、レベルを上げればいいのか資金を貯めればいいのかが
 * 分からず、ホームで手が止まる。**次に何をすればいいか**を必ず書く。
 */
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

interface HomeScreenProps {
  save: SaveData;
  onLevelUp: (idolId: string) => void;
  onEvolve: (idolId: string) => void;
  onOpenParty: () => void;
  onOpenTalents: () => void;
  onOpenCostumes: () => void;
  onStart: (stageId: string) => void;
  lastResult: {
    won: boolean;
    audience: number;
    funds: number;
    drops: CostumeInstance[];
  } | null;
}

export function HomeScreen({
  save,
  onLevelUp,
  onEvolve,
  onOpenParty,
  onOpenTalents,
  onOpenCostumes,
  onStart,
  lastResult,
}: HomeScreenProps): React.JSX.Element {
  const roster = unlockedIds(save);
  // 進化は一度きりで見落としやすいので、レッスンとは別にバッジを出す
  const upgradable = roster.filter((id) => canLevelUp(save, id) || canEvolve(save, id)).length;
  const { party, center } = normalizeParty(save);
  const talentPoints = remainingTalentPoints(save);

  return (
    <div className="home">
      <header className="home-head">
        <div>
          <h1>超かぐや姫！</h1>
          <p className="home-sub">IDOL DIFFENCE — ホーム</p>
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
          {lastResult.drops.length > 0 && (
            <span className="last-drops">
              衣装 {lastResult.drops.length} 着（
              {lastResult.drops.map((drop) => drop.rarity).join('・')}）
            </span>
          )}
        </div>
      )}

      <section className="party-summary">
        <h2>編成</h2>
        <button type="button" className="party-open" onClick={onOpenParty}>
          <span className="party-members">
            {party.map((id) => (
              <span key={id} className={`party-chip type-${getIdol(id).type}`}>
                {TYPE_ICON[getIdol(id).type]} {getIdol(id).shortName}
                {center === id ? '（センター）' : ''}
              </span>
            ))}
          </span>
          <span className="party-hint">
            {roster.length} 人中 {party.length} 人が出撃・タップして変更
          </span>
        </button>
      </section>

      <section className="party-summary">
        <h2>
          才能ボード
          {talentPoints > 0 && <span className="badge">{talentPoints}</span>}
        </h2>
        <button type="button" className="party-open" onClick={onOpenTalents}>
          <span className="party-hint">
            {talentPoints > 0
              ? `未使用の才能ポイントが ${talentPoints} pt あります`
              : '取得済みの才能を確認・振り直し'}
          </span>
        </button>
      </section>

      <section className="party-summary">
        <h2>
          衣装
          {save.costumes.length > 0 && <span className="badge">{save.costumes.length}</span>}
        </h2>
        <button type="button" className="party-open" onClick={onOpenCostumes}>
          <span className="party-hint">
            {save.costumes.length === 0
              ? 'ライブのリザルトで手に入ります（負けても 1 着）'
              : `${save.costumes.length} 着を所持・着せ替えと強化、錬成`}
          </span>
        </button>
      </section>

      <section className="roster">
        <h2>
          レッスン
          {upgradable > 0 && <span className="badge">{upgradable}</span>}
        </h2>
        <div className="roster-list">
          {roster.map((id) => {
            const idol = getIdol(id);
            const level = idolLevel(save, id);
            const maxed = level >= MAX_LEVEL;
            const cost = levelUpCost(level);
            const affordable = canLevelUp(save, id);
            const evolution = evolutionOf(id);
            const evolved = isEvolved(save, id);
            // 盤面では進化ぶんの倍率も乗る。ここで隠すと
            // 「解放したのに数字が変わらない」ように見える
            const evoMul = evolved && evolution ? evolution.atkMul : 1;
            const atk = Math.round(idol.base.atk * levelAtkMultiplier(level) * evoMul);
            const nextAtk = Math.round(idol.base.atk * levelAtkMultiplier(level + 1) * evoMul);
            const block = evolution ? evolveBlocker(save, id) : 'no-evolution';

            return (
              <article key={id} className={`roster-card type-${idol.type}${evolved ? ' is-evolved' : ''}`}>
                <div className="roster-head">
                  <span className="roster-icon">{TYPE_ICON[idol.type]}</span>
                  <div>
                    <strong>{evolved && evolution ? evolution.name : idol.name}</strong>
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

                {evolution && (
                  <div className="evolve">
                    <p className="evolve-name">
                      ✦ {evolution.name}
                      {evolved && <span className="evolve-done">解放済み</span>}
                    </p>
                    <p className="evolve-desc">{evolution.desc}</p>
                    {!evolved && (
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
                    )}
                  </div>
                )}
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
