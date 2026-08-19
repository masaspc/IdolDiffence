/**
 * チュートリアル（06-ui-ux.md 6.5）。
 *
 * ## 説明ではなく、その場で 1 行だけ
 *
 * 遊ぶ前にルールをまとめて読ませる形は取らない。読み飛ばされるし、
 * 読んだところで**まだ画面に無いもの**の話なので身に付かない。
 * 代わりに「その操作が初めて要る瞬間」に 1 枚だけ出す ——
 * 配置できるようになったら配置の話を、◆ が出たらセットリストの話を。
 *
 * ## 段階解放と対になっている
 *
 * 何が出せるかは `meta/onboarding.ts` が決める。開いていない要素の説明は
 * そもそも出番が来ない（◆ が出なければセットリストの札も出ない）ので、
 * **ここに「まだ早い」判定を書かなくていい**。
 *
 * ## 見せたかどうかはセーブに持つ
 *
 * 解放状態と違って、**これは出来事**で進捗からは復元できない。
 * 持たないと同じ札が毎ライブ出続ける（隠しキャラの `seenSecrets` と同じ理由）。
 */
import type { SaveData } from './save';

export type TutorialId =
  /** 配置 */
  | 'place'
  /** ポジション強化 */
  | 'upgrade'
  /** 観客が減った */
  | 'leak'
  /** セットリスト（◆） */
  | 'setlist'
  /** 月華解放 */
  | 'special'
  /** 覚醒分岐 */
  | 'awakening';

/** 札を出す場所。UI 側がこの名前で位置を決める */
export type TutorialAnchor = 'palette' | 'unit' | 'audience' | 'cards' | 'voltage';

export interface TutorialStep {
  id: TutorialId;
  title: string;
  body: string;
  anchor: TutorialAnchor;
}

/**
 * バトルの様子。**snapshot をそのまま渡さない** ——
 * ここが sim の形に依存すると、sim を変えるたびにチュートリアルが壊れる
 */
export interface BattleCue {
  /** 配置済みのユニット数 */
  placed: number;
  /** 通してしまった数 */
  leaked: number;
  /** ◆ の選択が出ている */
  choosing: boolean;
  /** 月華を撃てる */
  specialReady: boolean;
  /** 覚醒分岐の選択待ちがいる */
  awaiting: boolean;
}

/**
 * 出す順。**上から順に、条件を満たした最初の 1 枚だけ**を出す。
 *
 * 並べて出すと画面が札で埋まる。とくに最初のライブは
 * 「配置 → 強化 → 漏れ」が数秒のうちに続けて起きる
 */
const STEPS: readonly (TutorialStep & { when: (cue: BattleCue) => boolean })[] = [
  {
    id: 'setlist',
    // 題は選択画面の見出しと変える。同じ文字が 2 つ並ぶと、
    // 説明なのか画面の一部なのか分からない
    title: 'いまライブは止まっています',
    body: '3 枚から 1 枚を選ぶと再開します。効果はこのライブのあいだだけ続きます。',
    anchor: 'cards',
    // 選択中はほかの操作ができないので、割り込んででもここを先に出す
    when: (cue) => cue.choosing,
  },
  {
    id: 'awakening',
    title: '覚醒分岐',
    body: 'ポジション Lv3 で performance が分かれます。あとから変えられないので、いま迷うところです。',
    anchor: 'unit',
    when: (cue) => cue.awaiting,
  },
  {
    id: 'place',
    title: 'まずは配置',
    body: '下のメンバーを選び、光っているマスをタップします。声援（♥）が足りるぶんだけ置けます。',
    anchor: 'palette',
    when: (cue) => cue.placed === 0,
  },
  {
    id: 'upgrade',
    title: '置いた人を強化する',
    body: '盤面の人をタップすると詳細が開きます。声援を足せばポジションが上がり、攻撃力と射程が伸びます。',
    anchor: 'unit',
    when: (cue) => cue.placed > 0,
  },
  {
    id: 'special',
    title: '月華解放',
    body: 'ボルテージが満タンになりました。解放すると全員が強化され、画面の敵全体にダメージが入ります。',
    anchor: 'voltage',
    when: (cue) => cue.specialReady,
  },
  {
    id: 'leak',
    title: '通すと同接が減る',
    body: '敵がステージの端まで届くと同接（見てくれている観客の数）が減ります。0 になるとライブは中断です。',
    anchor: 'audience',
    when: (cue) => cue.leaked > 0,
  },
];

/** ID から札を引く。文言だけ要るときに使う */
export function tutorialStep(id: TutorialId): TutorialStep | null {
  const found = STEPS.find((step) => step.id === id);
  if (!found) return null;
  return { id: found.id, title: found.title, body: found.body, anchor: found.anchor };
}

/**
 * いま出すべき札。無ければ null。
 *
 * @param seen 見せ終わった札（`save.tutorialSeen`）
 */
export function nextTutorial(seen: readonly string[], cue: BattleCue): TutorialStep | null {
  for (const step of STEPS) {
    if (seen.includes(step.id)) continue;
    if (!step.when(cue)) continue;
    return { id: step.id, title: step.title, body: step.body, anchor: step.anchor };
  }
  return null;
}

/** 全部の札の ID。移行で「既存プレイヤーには出さない」を作るのに使う */
export const TUTORIAL_IDS: readonly TutorialId[] = STEPS.map((step) => step.id);

export function markTutorialSeen(save: SaveData, id: string): SaveData {
  if (save.tutorialSeen.includes(id)) return save;
  return { ...save, tutorialSeen: [...save.tutorialSeen, id] };
}

/** 設定から「もう一度見る」。遊び方を忘れたときの逃げ道が無いと戻れない */
export function resetTutorial(save: SaveData): SaveData {
  return { ...save, tutorialSeen: [] };
}
