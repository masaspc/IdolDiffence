/**
 * ホーム。育成とライブ開始の入口。
 *
 * 「次に何をすればいいか」が一目で分かることを最優先にする。
 * レベルアップ可能なキャラにはバッジを出す（06-ui-ux.md 6.1）。
 */
import { useState } from 'react';
import { useSecretCode } from './useSecretCode';
import { chapters, getIdol, getSong, getStage, requiredStage, SECRET_IDS } from '../data';
import { MAX_STAR, starRuleText } from '../sim/star';
import { MAX_SONG_LEVEL, rankOf, rankProgress, songLevelOf } from '../meta/rank';
import { bestStarOf, isUnlocked, maxSelectableStar } from '../meta/progression';
import { remainingTalentPoints } from '../meta/talents';
import {
  achievementIds,
  achievementViews,
  activeTitle,
  pendingRewards,
} from '../meta/achievements';
import { canEvolve } from '../meta/evolution';
import { unseenSecrets } from '../meta/secrets';
import {
  FEATURE_LABEL,
  FEATURE_NOTE,
  isOpen,
  nextUnlock,
  unlockedBy,
  type Feature,
} from '../meta/onboarding';
import { canLevelUp, normalizeParty, unlockedIds } from '../meta/progression';
import type { CostumeInstance, SaveData } from '../meta/save';

const TYPE_ICON: Record<string, string> = { vocal: '♪', dance: '★', visual: '♥' };

interface HomeScreenProps {
  save: SaveData;
  onOpenParty: () => void;
  onOpenTalents: () => void;
  onOpenCostumes: () => void;
  onOpenSettings: () => void;
  onOpenAchievements: () => void;
  onOpenIdols: () => void;
  onStart: (stageId: string, star: number) => void;
  /** 隠しキャラの合言葉が揃ったとき（`ui/useSecretCode.ts`） */
  onSecret: (idolId: string) => void;
  /** 隠しキャラの登場を見せたあと。詳細を開き、二度と通知しない印を付ける */
  onReveal: (idolId: string) => void;
  lastResult: {
    stageId: string;
    /** このライブで初めてクリアしたか。周回で「開きました」を出し直さないため */
    firstClear: boolean;
    won: boolean;
    audience: number;
    funds: number;
    drops: CostumeInstance[];
  } | null;
}

export function HomeScreen({
  save,
  onOpenParty,
  onOpenTalents,
  onOpenCostumes,
  onOpenSettings,
  onOpenAchievements,
  onOpenIdols,
  onStart,
  onSecret,
  onReveal,
  lastResult,
}: HomeScreenProps): React.JSX.Element {
  const roster = unlockedIds(save);
  // 全部解放済みなら監視を止める。押しても打っても何も起きない状態で
  // キー入力を拾い続ける理由が無い
  const { onTitleTap } = useSecretCode(!SECRET_IDS.every((id) => isUnlocked(save, id)), onSecret);
  // 進化は一度きりで見落としやすいので、レッスンとは別にバッジを出す
  const upgradable = roster.filter((id) => canLevelUp(save, id) || canEvolve(save, id)).length;
  const { party, center } = normalizeParty(save);
  const talentPoints = remainingTalentPoints(save);
  const title = activeTitle(save);
  const pending = pendingRewards(save);
  const unlockedCount = achievementViews(save).filter((v) => v.unlocked).length;
  const totalAchievements = achievementIds.length;
  // 解放しただけでは気づかれない。いちばん強い駒が黙って増えるのがいちばん惜しい
  const revealed = unseenSecrets(save)[0] ?? null;
  // 段階解放（06-ui-ux.md 6.5）。開いていないものは**出さない**が、
  // 次に何が開くかは 1 行だけ見せる —— 隠すだけだと進行が止まったように見える
  const open = (feature: Feature): boolean => isOpen(save, feature);
  const next = nextUnlock(save);
  // 直前のライブで開いたもの。ホームへ戻ってから探させると気づかれない
  const justOpened = lastResult?.firstClear === true ? unlockedBy(lastResult.stageId) : [];

  return (
    <div className="home">
      <header className="home-head">
        <div>
          {/* タイトルは隠しキャラの入口も兼ねる（`ui/useSecretCode.ts`）。
              見た目は変えない ―― 押せそうに見えたら隠れていない */}
          <h1 onClick={onTitleTap}>超かぐや姫！</h1>
          <p className="home-sub">
            {title ? <span className="home-title-badge">{title}</span> : null}
            IDOL DIFFENCE — ホーム
          </p>
        </div>
        <div className="funds">
          <span className="funds-label">資金</span>
          <span className="funds-value">¥{save.funds.toLocaleString()}</span>
        </div>
        <div className="rank-badge">
          <span className="funds-label">プロデューサーランク</span>
          <span className="funds-value">{rankOf(save.totalExp)}</span>
          <span className="rank-bar">
            <span style={{ width: `${rankProgress(save.totalExp).ratio * 100}%` }} />
          </span>
        </div>
        <button type="button" className="settings-open" onClick={onOpenSettings} title="設定">
          ⚙
        </button>
      </header>

      {revealed && (
        <button type="button" className="secret-reveal" onClick={() => onReveal(revealed)}>
          <span className="secret-reveal-tag">ツクヨミに接続してきた者がいる</span>
          <strong className="secret-reveal-name">{getIdol(revealed).name} が登場しました</strong>
          <span className="secret-reveal-hint">タップして能力を見る（編成に入れられます）</span>
        </button>
      )}

      {lastResult && (
        <div className={`last-result ${lastResult.won ? 'won' : 'lost'}`}>
          前回のライブ: {lastResult.won ? '完走' : '中断'}（観客 {lastResult.audience}）
          <strong>＋¥{lastResult.funds.toLocaleString()}</strong>
          {/* 衣装は S7 まで開かない。**中身は配っている**（開いたときに
              まとめて受け取れる）が、開く前に「手に入りました」と言うと、
              見に行けない持ち物を知らせることになる */}
          {open('costumes') && lastResult.drops.length > 0 && (
            <span className="last-drops">
              衣装 {lastResult.drops.length} 着（
              {lastResult.drops.map((drop) => drop.rarity).join('・')}）
            </span>
          )}
        </div>
      )}

      {justOpened.length > 0 && (
        <div className="unlock-notice">
          <span className="unlock-notice-tag">新しく開きました</span>
          {justOpened.map((feature) => (
            <span key={feature} className="unlock-notice-row">
              <strong>{FEATURE_LABEL[feature]}</strong>
              {FEATURE_NOTE[feature]}
            </span>
          ))}
        </div>
      )}

      {open('party') && (
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
              {open('center') ? '' : '（センターは S7 クリアで選べます）'}
            </span>
          </button>
        </section>
      )}

      {open('talents') && (
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
      )}

      {open('costumes') && (
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
      )}

      {open('achievements') && (
        <section className="party-summary">
          <h2>
            称号・実績
            {pending.ids.length > 0 && <span className="badge">{pending.ids.length}</span>}
          </h2>
          <button type="button" className="party-open" onClick={onOpenAchievements}>
            <span className="party-hint">
              {unlockedCount} / {totalAchievements} 達成
              {pending.funds > 0 ? ` ・ ¥${pending.funds.toLocaleString()} を受け取れます` : ''}
            </span>
          </button>
        </section>
      )}

      {open('lesson') && (
        <section className="party-summary">
          <h2>
            育成
            {upgradable > 0 && <span className="badge">{upgradable}</span>}
          </h2>
          <button type="button" className="party-open" onClick={onOpenIdols}>
            <span className="party-hint">
              {upgradable > 0
                ? `レッスンか進化ができるメンバーが ${upgradable} 人います`
                : 'レベルを上げる・進化させる・能力の詳細を読む'}
            </span>
          </button>
        </section>
      )}

      {/* **隠すだけだと進行が止まったように見える。** 何がいつ増えるかを 1 行だけ */}
      {next && (
        <p className="next-unlock">
          {getStage(next.stageId).name}（{next.stageId}）をクリアすると{' '}
          <strong>{FEATURE_LABEL[next.feature]}</strong> が開きます
        </p>
      )}

      <section className="stage-select">
        <h2>ライブ</h2>
        {/* 34 本を 1 列に並べると「今どのあたりか」が読めない。章で区切る */}
        {chapters.map((chapter) => (
          <div key={chapter.name} className="stage-chapter">
            <h3 className="chapter-name">
              {chapter.name}
              <span className="chapter-lead">{chapter.lead}</span>
            </h3>
            <div className="stage-list">
              {chapter.stages.map((stageId) => (
                <StageCard
                  key={stageId}
                  save={save}
                  stageId={stageId}
                  showStar={open('star')}
                  showSongLevel={open('songLevel')}
                  onStart={onStart}
                />
              ))}
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}

interface StageCardProps {
  save: SaveData;
  stageId: string;
  /** ★難度を選ばせるか（S10 クリアで開く） */
  showStar: boolean;
  /** 楽曲レベルを出すか（同じく S10 クリア） */
  showSongLevel: boolean;
  onStart: (stageId: string, star: number) => void;
}

/**
 * ステージ 1 枚。★を選んでから出撃する。
 *
 * ★は**1 つずつしか開かない**（`maxSelectableStar`）。まとめて開くと
 * いきなり ★10 に挑んで「何が足りないのか分からないまま負ける」ことになる。
 */
function StageCard({
  save,
  stageId,
  showStar,
  showSongLevel,
  onStart,
}: StageCardProps): React.JSX.Element {
  const stage = getStage(stageId);
  const song = getSong(stage.song);
  const progress = save.stageProgress[stageId];
  const gate = requiredStage(stageId);
  const locked = gate !== null && !save.stageProgress[gate]?.cleared;

  const best = bestStarOf(save, stageId);
  const maxStar = maxSelectableStar(save, stageId);
  // 既定は**到達済みの最高★**。1 に戻すと、周回のたびに毎回引き上げ直すことになる。
  // 1 段上（未到達）を既定にしないのは、周回の目的がたいてい「稼ぎ」だから
  const [star, setStar] = useState(Math.max(1, best));
  const chosen = Math.min(star, maxStar);
  const rule = starRuleText(chosen);
  const songLevel = songLevelOf(save, stage.song);

  return (
    <div className={`stage-card${locked ? ' is-locked' : ''}${stage.boss ? ' is-boss' : ''}`}>
      <div className="stage-head">
        <span className="stage-no">{stageId}</span>
        <span className="stage-name">{stage.name}</span>
        {stage.boss && <span className="boss-chip">ボス</span>}
      </div>
      <span className="stage-meta">
        {locked
          ? `${getStage(gate).name} をクリアすると解放`
          : progress?.cleared
            ? `クリア済み・最高観客 ${progress.bestAudience}${showStar ? `・最高 ★${best}` : ''}`
            : '未クリア'}
      </span>
      <span className="stage-song">
        ♪ {song.name}
        {showSongLevel && `（Lv${songLevel}${songLevel >= MAX_SONG_LEVEL ? ' 上限' : ''}）`}・
        {song.bpm} BPM・{stage.lanes.length} レーン
        {progress ? ` ・ ${progress.plays} 回` : ''}
      </span>
      {/* 原作へのクレジット。**鳴っている音を作った人ではない**ので、
          そのことは設定画面に一度だけ書く（06-ui-ux.md 6.8） */}
      <span className="stage-credit">
        原作劇中歌 ／ {song.writer} ・ 歌 {song.singer}
      </span>
      {stage.modifiers.note && <span className="stage-gimmick">{stage.modifiers.note}</span>}

      {!locked && (
        <>
          {/* ★は S10 クリアまで出さない（06-ui-ux.md 6.5）。
              最初の章は難度を 1 本に絞って、盤面の組み方に集中してもらう */}
          {showStar && (
            <div className="star-picker">
              <span className="star-label">難度</span>
              <input
                type="range"
                min={1}
                max={maxStar}
                value={chosen}
                disabled={maxStar === 1}
                onChange={(event) => setStar(Number(event.target.value))}
                aria-label={`${stage.name} の難度`}
              />
              <span className="star-value">
                ★{chosen}
                <span className="star-max"> / {MAX_STAR}</span>
              </span>
            </div>
          )}
          {showStar && rule && (
            <span className="star-rule">
              ★{chosen} の追加ルール: {rule}
            </span>
          )}
          <button
            type="button"
            className="stage-go"
            onClick={() => onStart(stageId, showStar ? chosen : 1)}
          >
            {showStar ? `★${chosen} で出撃` : '出撃'}
          </button>
        </>
      )}
    </div>
  );
}
