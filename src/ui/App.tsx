import { useCallback, useEffect, useRef, useState } from 'react';
import { HomeScreen } from './HomeScreen';
import { TitleScreen } from './TitleScreen';
import { PartyScreen } from './PartyScreen';
import { TalentScreen } from './TalentScreen';
import { CostumeScreen } from './CostumeScreen';
import { SettingsScreen } from './SettingsScreen';
import { AchievementScreen } from './AchievementScreen';
import { IdolScreen } from './IdolScreen';
import { BattleScreen } from './BattleScreen';
import {
  applyReward,
  calcReward,
  chapterIntroFor,
  levelUp,
  markChapterIntroSeen,
  normalizeParty,
  resolvedAtk,
  setCenter,
  toggleParty,
  unlockedIds,
  type BattleOutcome,
} from '../meta/progression';
import { respecTalents, resolveTalents, takeTalent } from '../meta/talents';
import { evolve, evolvedForBattle } from '../meta/evolution';
import {
  enhanceCostume,
  equipCostume,
  resolvePartyCostumes,
  salvageCostumes,
  unequipSlot,
} from '../meta/costumes';
import { soloPartForStage } from '../meta/rank';
import { markSecretSeen, unlockSecret } from '../meta/secrets';
import { claimRewards } from '../meta/achievements';
import { textScaleRatio, type Settings } from '../meta/settings';
import { randomSeed } from '../core/rng';
import { audioContext, installAudioUnlock } from '../audio/context';
import { HomeBgm } from '../audio/homeBgm';
import { styleOf } from '../audio/bgm';
import { getSong } from '../data';
import { volumeRatio } from '../meta/settings';
import { isOpen, lockedForBattle } from '../meta/onboarding';
import { markTutorialSeen, resetTutorial } from '../meta/tutorial';
import {
  DEFAULT_RNG_STATE,
  loadSave,
  saveSave,
  type CostumeInstance,
  type SaveData,
} from '../meta/save';
import type { CostumeSlot } from '../data/schema/costume';
import type { BattleMeta } from '../sim/world';

type Screen =
  | 'title'
  | 'home'
  | 'party'
  | 'idols'
  | 'talents'
  | 'costumes'
  | 'settings'
  | 'achievements'
  | 'battle';

export function App(): React.JSX.Element {
  const [save, setSave] = useState<SaveData>(() => {
    const result = loadSave(window.localStorage);
    if (result.recoveredFrom) {
      console.warn(`セーブデータを初期化しました: ${result.recoveredFrom}`);
    }
    // ドロップの種は**まだ個人化されていなければ**引き直す。
    //
    // 対象は 3 通りある: 新規セーブ・v4 以前からの移行・壊れて作り直したもの。
    // 「壊れたときだけ」にしていたら、いちばん多い**新規プレイヤー**が既定値のまま
    // 残り、全員が同じ順で衣装を引くことになっていた。
    // 既定値と一致するのは「一度も引いていない」状態だけなので、これで見分けられる
    // （偶然一致しても、種を引き直すだけで害はない）。
    if (result.data.rngState === DEFAULT_RNG_STATE) {
      return { ...result.data, rngState: randomSeed() };
    }
    return result.data;
  });
  // タイトルから始める。「ツクヨミへ接続」の 1 タップが音の解錠を兼ねる
  const [screen, setScreen] = useState<Screen>('title');
  /** 育成画面を開いたとき最初に見せる人。隠しキャラの登場からだけ入る */
  const [idolFocus, setIdolFocus] = useState<string | null>(null);
  const [stageId, setStageId] = useState('S1');
  /**
   * 章の導入（`chapterIntroFor`）。**出撃の瞬間に確定させて持つ。**
   * 描画のたびに導出すると、見せた印を付けた次のレンダーで消えてしまう ——
   * 印は「もう出さない」の意味なので、出す判断より後に効いてはいけない
   */
  const [chapterIntro, setChapterIntro] = useState<{ name: string; lead: string } | null>(null);
  /**
   * 育成状態はバトル開始時に一度だけ解決して固定する。
   * 毎レンダーで作り直すと、リザルトで save が更新された瞬間に参照が変わり、
   * BattleScreen の effect が張り直されて**決着したワールドが破棄される**
   * （結果画面が消えて別のバトルが勝手に始まる）。
   */
  const [battleMeta, setBattleMeta] = useState<BattleMeta>({ atkByIdol: {} });
  const [lastResult, setLastResult] = useState<{
    /** どのステージの結果か。ここで何が新しく開いたかを出す（`meta/onboarding.ts`） */
    stageId: string;
    /**
     * このライブで**初めて**クリアしたか。
     *
     * ステージ ID だけで「開いた」を出すと、S1 を周回するたびに
     * 「編成が開きました」と言い続けることになる。開いたのは出来事なので、
     * 進捗が未クリア → クリアへ変わったかどうかで判定する
     */
    firstClear: boolean;
    won: boolean;
    audience: number;
    funds: number;
    drops: CostumeInstance[];
  } | null>(null);

  // 変更のたびに保存する。タブを閉じても進行が残るように
  useEffect(() => {
    saveSave(window.localStorage, save);
  }, [save]);

  /**
   * 設定を DOM へ反映する（06-ui-ux.md 6.7）。
   *
   * 文字サイズは**根の font-size**を動かすだけで通る —— HUD も画面も
   * rem で組んであるので、レイアウトを 3 通り書く必要が無い。
   * 演出強度は属性にして、CSS 側で拾わせる
   */
  useEffect(() => {
    const root = document.documentElement;
    root.style.fontSize = `${textScaleRatio(save.settings.textScale) * 100}%`;
    root.dataset.effects = save.settings.effects;
  }, [save.settings.textScale, save.settings.effects]);

  /**
   * 最初の操作で音を起こす（`audio/context.ts`）。
   *
   * バトルに入るときに作るだけでは **Safari / iOS で一切鳴らない** ——
   * あちらはユーザー操作のハンドラの**中**で起こさないと動かないが、
   * `useEffect` はクリックの外で走る。起動時に掴んでおく
   */
  useEffect(() => {
    installAudioUnlock();
  }, []);

  /**
   * ホームの BGM（`audio/homeBgm.ts`）。**バトル以外の画面で流れ続ける。**
   *
   * バトルへ入るときに止め、戻ったら作り直す。画面ごとに作り直さないのは、
   * 編成や設定を行き来するたびに曲が頭へ戻るとホームが落ち着かないから。
   * 音量 0 のときは作らない（無音のためだけに標本を焼かない）
   */
  const homeBgmRef = useRef<HomeBgm | null>(null);
  // タイトルではまだ作らない（接続のタップ＝最初の操作より前に AudioContext を
  // 作らないため）。バトル中は BattleScreen の BGM に譲る
  const homeActive = screen !== 'battle' && screen !== 'title';
  const homeVolume = volumeRatio(save.settings.bgmVolume);
  useEffect(() => {
    if (!homeActive || homeVolume === 0) {
      homeBgmRef.current?.dispose();
      homeBgmRef.current = null;
      return;
    }
    if (homeBgmRef.current) return;
    const audio = audioContext();
    if (!audio) return;
    const songId = 'ex_otogibanashi';
    homeBgmRef.current = new HomeBgm(audio, songId, getSong(songId), styleOf(getSong(songId)), homeVolume);
    return undefined;
  }, [homeActive, homeVolume]);
  // 音量スライダーは作り直さずに追従させる
  useEffect(() => {
    homeBgmRef.current?.setVolume(homeVolume);
  }, [homeVolume]);

  // リザルト処理は setSave の更新関数の**外**で行う。
  // 更新関数は純粋でなければならず、中でドロップを引くと
  // StrictMode の二重呼び出しで 2 組できてしまう
  const saveRef = useRef(save);
  saveRef.current = save;

  const handleLevelUp = useCallback((idolId: string) => {
    setSave((current) => levelUp(current, idolId));
  }, []);

  const handleEvolve = useCallback((idolId: string) => {
    setSave((current) => evolve(current, idolId));
  }, []);

  const handleFinish = useCallback((outcome: BattleOutcome) => {
    const reward = calcReward(outcome);
    const before = saveRef.current;
    const { save: next, dropped } = applyReward(before, outcome, reward);
    const firstClear =
      before.stageProgress[outcome.stageId]?.cleared !== true &&
      next.stageProgress[outcome.stageId]?.cleared === true;
    setSave(next);
    setLastResult({
      stageId: outcome.stageId,
      firstClear,
      won: outcome.won,
      audience: outcome.audience,
      funds: reward.funds,
      drops: dropped,
    });
  }, []);

  /** チュートリアルの札を見せ終わった。二度と出さない（`meta/tutorial.ts`） */
  const handleTutorialSeen = useCallback((id: string) => {
    setSave((current) => markTutorialSeen(current, id));
  }, []);

  if (screen === 'title') {
    return <TitleScreen onEnter={() => setScreen('home')} />;
  }

  if (screen === 'battle') {
    return (
      <BattleScreen
        stageId={stageId}
        meta={battleMeta}
        effects={save.settings.effects}
        attributeGlyphs={save.settings.attributeGlyphs}
        bgmVolume={save.settings.bgmVolume}
        seVolume={save.settings.seVolume}
        showFormations={isOpen(save, 'formation')}
        chapterIntro={chapterIntro}
        tutorialSeen={save.tutorialSeen}
        onTutorialSeen={handleTutorialSeen}
        onFinish={handleFinish}
        onExit={() => setScreen('home')}
      />
    );
  }

  if (screen === 'costumes') {
    return (
      <CostumeScreen
        save={save}
        onEquip={(idolId, costumeId) =>
          setSave((current) => equipCostume(current, idolId, costumeId))
        }
        onUnequip={(idolId, slot: CostumeSlot) =>
          setSave((current) => unequipSlot(current, idolId, slot))
        }
        onEnhance={(costumeId) => setSave((current) => enhanceCostume(current, costumeId))}
        onSalvage={(ids) => setSave((current) => salvageCostumes(current, ids).save)}
        onBack={() => setScreen('home')}
      />
    );
  }

  if (screen === 'talents') {
    return (
      <TalentScreen
        save={save}
        onTake={(id) => setSave((current) => takeTalent(current, id))}
        onRespec={() => setSave((current) => respecTalents(current))}
        onBack={() => setScreen('home')}
      />
    );
  }

  if (screen === 'settings') {
    return (
      <SettingsScreen
        save={save}
        onChange={(patch: Partial<Settings>) =>
          setSave((current) => ({ ...current, settings: { ...current.settings, ...patch } }))
        }
        onResetTutorial={() => setSave((current) => resetTutorial(current))}
        onBack={() => setScreen('home')}
      />
    );
  }

  if (screen === 'achievements') {
    return (
      <AchievementScreen
        save={save}
        onClaim={() => setSave((current) => claimRewards(current))}
        onSetTitle={(id) => setSave((current) => ({ ...current, title: id }))}
        onBack={() => setScreen('home')}
      />
    );
  }

  if (screen === 'idols') {
    return (
      <IdolScreen
        save={save}
        focusId={idolFocus}
        onLevelUp={handleLevelUp}
        onEvolve={handleEvolve}
        onBack={() => setScreen('home')}
      />
    );
  }

  if (screen === 'party') {
    return (
      <PartyScreen
        save={save}
        onToggle={(id) => setSave((current) => toggleParty(current, id))}
        canSetCenter={isOpen(save, 'center')}
        onSetCenter={(id) =>
          // 画面のボタンを消すだけにすると、押せる経路が残る（キーボード・古い状態）。
          // 解放の判定は**変更する側**にも置く
          setSave((current) => (isOpen(current, 'center') ? setCenter(current, id) : current))
        }
        onBack={() => setScreen('home')}
      />
    );
  }

  return (
    <HomeScreen
      save={save}
      lastResult={lastResult}
      onSecret={(idolId) => setSave((current) => unlockSecret(current, idolId))}
      onOpenParty={() => setScreen('party')}
      onOpenTalents={() => setScreen('talents')}
      onOpenCostumes={() => setScreen('costumes')}
      onOpenSettings={() => setScreen('settings')}
      onOpenAchievements={() => setScreen('achievements')}
      onOpenIdols={() => {
        setIdolFocus(null);
        setScreen('idols');
      }}
      onReveal={(idolId) => {
        // 見せたので、以後は通知しない。開く先はその人の詳細
        setSave((current) => markSecretSeen(current, idolId));
        setIdolFocus(idolId);
        setScreen('idols');
      }}
      onStart={(id, star) => {
        setStageId(id);
        setLastResult(null);
        // 章の導入は**入った時点**で確定させ、同時に見せた印を付ける。
        // 決着まで待つと、途中で閉じた人へ次も同じ「ようこそ」を出すことになる
        const intro = chapterIntroFor(save, id);
        setChapterIntro(intro);
        if (intro) setSave((current) => markChapterIntroSeen(current, id));
        // sim にメタ層を触らせないための境界。ここで解決して以後は固定
        const { party, center } = normalizeParty(save);
        setBattleMeta({
          // 段階解放。まだ開いていない要素は sim にも渡さない（`meta/onboarding.ts`）
          locked: lockedForBattle(save),
          star,
          call: save.settings.call,
          // 楽曲レベルが開くまではソロパートも渡さない。
          // ラベルを隠すだけでは**仕組みは動いたまま**で、S1 から ×1.6 が使えていた
          ...(isOpen(save, 'songLevel') ? { soloPart: soloPartForStage(save, id) } : {}),
          atkByIdol: Object.fromEntries(
            unlockedIds(save).map((rid) => [rid, resolvedAtk(save, rid)]),
          ),
          party,
          center,
          talents: resolveTalents(save),
          evolved: evolvedForBattle(save),
          costumes: resolvePartyCostumes(save, party),
        });
        setScreen('battle');
      }}
    />
  );
}
