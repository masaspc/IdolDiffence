import { useCallback, useEffect, useRef, useState } from 'react';
import { HomeScreen } from './HomeScreen';
import { PartyScreen } from './PartyScreen';
import { TalentScreen } from './TalentScreen';
import { CostumeScreen } from './CostumeScreen';
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
import { randomSeed } from '../core/rng';
import { loadSave, saveSave, type CostumeInstance, type SaveData } from '../meta/save';
import type { CostumeSlot } from '../data/schema/costume';
import type { BattleMeta } from '../sim/world';

type Screen = 'home' | 'party' | 'talents' | 'costumes' | 'battle';

export function App(): React.JSX.Element {
  const [save, setSave] = useState<SaveData>(() => {
    const result = loadSave(window.localStorage);
    if (result.recoveredFrom) {
      console.warn(`セーブデータを初期化しました: ${result.recoveredFrom}`);
      // 作り直すときはドロップの種を引き直す。既定値のままだと
      // 誰が始めても同じ順で衣装が出る
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
      onEvolve={handleEvolve}
      onOpenParty={() => setScreen('party')}
      onOpenTalents={() => setScreen('talents')}
      onOpenCostumes={() => setScreen('costumes')}
      onStart={(id) => {
        setStageId(id);
        setLastResult(null);
        // sim にメタ層を触らせないための境界。ここで解決して以後は固定
        const { party, center } = normalizeParty(save);
        setBattleMeta({
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
