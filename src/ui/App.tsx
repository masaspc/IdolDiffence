import { useCallback, useEffect, useState } from 'react';
import { HomeScreen } from './HomeScreen';
import { BattleScreen } from './BattleScreen';
import {
  applyReward,
  calcReward,
  levelUp,
  resolvedAtk,
  type BattleOutcome,
} from '../meta/progression';
import { loadSave, saveSave, type SaveData } from '../meta/save';
import type { BattleMeta } from '../sim/world';
import { rosterIds } from '../data';

type Screen = 'home' | 'battle';

export function App(): React.JSX.Element {
  const [save, setSave] = useState<SaveData>(() => {
    const result = loadSave(window.localStorage);
    if (result.recoveredFrom) {
      console.warn(`セーブデータを初期化しました: ${result.recoveredFrom}`);
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
  } | null>(null);

  // 変更のたびに保存する。タブを閉じても進行が残るように
  useEffect(() => {
    saveSave(window.localStorage, save);
  }, [save]);

  const handleLevelUp = useCallback((idolId: string) => {
    setSave((current) => levelUp(current, idolId));
  }, []);

  const handleFinish = useCallback((outcome: BattleOutcome) => {
    const reward = calcReward(outcome);
    setSave((current) => applyReward(current, outcome, reward));
    setLastResult({ won: outcome.won, audience: outcome.audience, funds: reward.funds });
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

  return (
    <HomeScreen
      save={save}
      lastResult={lastResult}
      onLevelUp={handleLevelUp}
      onStart={(id) => {
        setStageId(id);
        setLastResult(null);
        // sim にメタ層を触らせないための境界。ここで解決して以後は固定
        setBattleMeta({
          atkByIdol: Object.fromEntries(rosterIds.map((rid) => [rid, resolvedAtk(save, rid)])),
        });
        setScreen('battle');
      }}
    />
  );
}
