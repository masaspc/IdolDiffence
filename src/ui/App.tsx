import { useCallback, useEffect, useRef, useState } from 'react';
import { HomeScreen } from './HomeScreen';
import { PartyScreen } from './PartyScreen';
import { TalentScreen } from './TalentScreen';
import { CostumeScreen } from './CostumeScreen';
import { SettingsScreen } from './SettingsScreen';
import { AchievementScreen } from './AchievementScreen';
import { BattleScreen } from './BattleScreen';
import {
  applyReward,
  calcReward,
  levelUp,
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
import { unlockSecret } from '../meta/secrets';
import { claimRewards } from '../meta/achievements';
import { textScaleRatio, type Settings } from '../meta/settings';
import { randomSeed } from '../core/rng';
import {
  DEFAULT_RNG_STATE,
  loadSave,
  saveSave,
  type CostumeInstance,
  type SaveData,
} from '../meta/save';
import type { CostumeSlot } from '../data/schema/costume';
import type { BattleMeta } from '../sim/world';

type Screen = 'home' | 'party' | 'talents' | 'costumes' | 'settings' | 'achievements' | 'battle';

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
  const [screen, setScreen] = useState<Screen>('home');
  const [stageId, setStageId] = useState('S1');
  /**
   * 育成状態はバトル開始時に一度だけ解決して固定する。
   * 毎レンダーで作り直すと、リザルトで save が更新された瞬間に参照が変わり、
   * BattleScreen の effect が張り直されて**決着したワールドが破棄される**
   * （結果画面が消えて別のバトルが勝手に始まる）。
   */
  const [battleMeta, setBattleMeta] = useState<BattleMeta>({ atkByIdol: {} });
  const [lastResult, setLastResult] = useState<{
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
    const { save: next, dropped } = applyReward(saveRef.current, outcome, reward);
    setSave(next);
    setLastResult({
      won: outcome.won,
      audience: outcome.audience,
      funds: reward.funds,
      drops: dropped,
    });
  }, []);

  if (screen === 'battle') {
    return (
      <BattleScreen
        stageId={stageId}
        meta={battleMeta}
        effects={save.settings.effects}
        attributeGlyphs={save.settings.attributeGlyphs}
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

  if (screen === 'party') {
    return (
      <PartyScreen
        save={save}
        onToggle={(id) => setSave((current) => toggleParty(current, id))}
        onSetCenter={(id) => setSave((current) => setCenter(current, id))}
        onBack={() => setScreen('home')}
      />
    );
  }

  return (
    <HomeScreen
      save={save}
      lastResult={lastResult}
      onLevelUp={handleLevelUp}
      onSecret={(idolId) => setSave((current) => unlockSecret(current, idolId))}
      onEvolve={handleEvolve}
      onOpenParty={() => setScreen('party')}
      onOpenTalents={() => setScreen('talents')}
      onOpenCostumes={() => setScreen('costumes')}
      onOpenSettings={() => setScreen('settings')}
      onOpenAchievements={() => setScreen('achievements')}
      onStart={(id, star) => {
        setStageId(id);
        setLastResult(null);
        // sim にメタ層を触らせないための境界。ここで解決して以後は固定
        const { party, center } = normalizeParty(save);
        setBattleMeta({
          star,
          call: save.settings.call,
          soloPart: soloPartForStage(save, id),
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
