/**
 * 段階解放（06-ui-ux.md 6.5）。
 *
 * ## なぜ要るのか
 *
 * ホームには編成・才能ボード・衣装・称号・育成・ライブが並び、バトルには
 * 配置・強化・セットリスト・月華・コール・倍速・ソロパートがある。
 * **1 本目のライブでこれを全部見せると、何から触ればいいか分からない。**
 * 強化系統が多いのはこのゲームの中核なので、減らすのではなく**順に開く**。
 *
 * ## セーブには持たない
 *
 * 解放状態はステージ進捗から**毎回導く**。実績（`meta/achievements.ts`）と
 * 才能ポイントと同じ方針で、保存すると解放条件を変えたときに
 * 古いセーブだけが食い違う。
 *
 * ## 順番は設計ではなく実測で決めた
 *
 * 設計書の表は「セットリストは S2 クリア、月華は S3 クリア」だったが、
 * ヘッドレスで測ると **S3 は月華が無いと勝てない**（Lv5・フル配置で
 * 月華ありは 5 seed 中 3 勝、無しは 1 勝）。表のとおりに塞ぐと、
 * ちょうど難しくなる回で最も強い手札を取り上げることになる。
 *
 * 逆に S1 と S2 は**両方塞いでも 5/5 で勝てる**（フル配置なら観客 100）。
 * そこで 1 本ずつ前倒しして、
 *
 * - S1 —— 配置と強化だけ
 * - S2 —— セットリストが増える
 * - S3 —— 月華が増える（ここから難しくなる）
 *
 * とした。**1 ステージにつき新しい仕組みは 1 つ**という設計の意図はそのままで、
 * 難度の実測とも合う。
 */
import { stageOrder } from '../data';
import type { SaveData } from './save';
import type { LockedFeature } from '../sim/world';

/** 段階解放で開く要素 */
export type Feature =
  /** セットリスト（◆ の選択）。sim を止める */
  | 'setlist'
  /** 月華解放（ボルテージ） */
  | 'special'
  /** 育成画面（レベルアップ・進化） */
  | 'lesson'
  /** 編成（出撃メンバーの入れ替え） */
  | 'party'
  /** フォーメーション（配置の並びで付くボーナスの表示） */
  | 'formation'
  /** 才能ボード */
  | 'talents'
  /** 衣装 */
  | 'costumes'
  /** センター指定 */
  | 'center'
  /** ★難度の選択 */
  | 'star'
  /** 楽曲レベル（ソロパート） */
  | 'songLevel'
  /** 称号・実績 */
  | 'achievements';

/**
 * 「このステージをクリアしたら開く」の対応。
 *
 * ここに載っていない要素（配置・ポジション強化・設定）は**最初から開いている**。
 * 設定だけは何があっても塞がない —— アクセシビリティの設定を
 * 進行の後ろに置くと、それが必要な人が最初のライブを越えられない
 */
const GATES: Record<Feature, string> = {
  // S1 を終えると仲間が 2 人増える（犬DOGE・忠犬オタ公）。
  // 選ぶ相手がいて初めて編成に意味が出る
  party: 'S1',
  setlist: 'S1',
  // S3 は月華とセットリストの両方が要る。その 1 本前で開ける
  special: 'S2',
  lesson: 'S2',
  formation: 'S5',
  talents: 'S5',
  costumes: 'S7',
  center: 'S7',
  // 章の切れ目。ここから先は周回の軸が増える
  star: 'S10',
  songLevel: 'S10',
  achievements: 'S10',
};

/** ステージの並び順。存在しない ID が混じったら末尾へ回す（進行を壊さない） */
function stageIndex(stageId: string): number {
  const index = (stageOrder as readonly string[]).indexOf(stageId);
  return index < 0 ? Number.MAX_SAFE_INTEGER : index;
}

/** 開く順。ホームで「次に何が開くか」を出すのに使う */
const ORDER: readonly Feature[] = (Object.keys(GATES) as Feature[]).sort(
  (a, b) => stageIndex(GATES[a]) - stageIndex(GATES[b]),
);

export const FEATURE_LABEL: Record<Feature, string> = {
  setlist: 'セットリスト',
  special: '月華解放',
  lesson: '育成',
  party: '編成',
  formation: 'フォーメーション',
  talents: '才能ボード',
  costumes: '衣装',
  center: 'センター',
  star: '★難度',
  songLevel: '楽曲レベル',
  achievements: '称号・実績',
};

/** 開いたときにひと言だけ添える。何ができるようになったかが分からないと開いた意味が無い */
export const FEATURE_NOTE: Record<Feature, string> = {
  setlist: 'ライブの途中で 3 枚から 1 枚を選び、その場かぎりの強化を積みます',
  special: 'ボルテージが満タンになると月華を解放できます',
  lesson: '資金でレベルを上げ、条件を満たすと進化させられます',
  party: '出撃する 5 人を選べます',
  formation: '配置の並びに応じてボーナスが付きます',
  talents: 'ステージクリアで貯まるポイントを、恒久の強化に振れます',
  costumes: '4 スロットに着せ替え、強化と錬成ができます',
  center: 'センターに置いた人の相性が編成全体に効きます',
  star: '難度を上げると報酬が増えます',
  songLevel: '同じ曲を歌うほど習熟し、ソロパートが解禁されます',
  achievements: '達成すると資金と才能ポイント、そして称号が手に入ります',
};

function cleared(save: SaveData, stageId: string): boolean {
  return save.stageProgress[stageId]?.cleared === true;
}

export function isOpen(save: SaveData, feature: Feature): boolean {
  return cleared(save, GATES[feature]);
}

/** いま開いている要素すべて */
export function openFeatures(save: SaveData): Feature[] {
  return ORDER.filter((feature) => isOpen(save, feature));
}

export interface NextUnlock {
  feature: Feature;
  /** これをクリアすると開く */
  stageId: string;
}

/**
 * 次に開くもの。
 *
 * **隠すだけだと、進行が止まったように見える。** 「何がいつ増えるか」を
 * 1 行だけ出しておくと、いま見えていないものがあるのは分かる
 */
export function nextUnlock(save: SaveData): NextUnlock | null {
  for (const feature of ORDER) {
    if (!isOpen(save, feature)) return { feature, stageId: GATES[feature] };
  }
  return null;
}

/**
 * そのステージをクリアしたことで新しく開いたもの。
 *
 * リザルトの直後に見せる。ホームへ戻ってから探させると気づかれない
 */
export function unlockedBy(stageId: string): Feature[] {
  return ORDER.filter((feature) => GATES[feature] === stageId);
}

/**
 * sim へ渡す「まだ開いていない要素」（`BattleMeta.locked`）。
 *
 * sim が知るのはここまで —— 進捗もセーブの形も渡さない
 */
export function lockedForBattle(save: SaveData): LockedFeature[] {
  const locked: LockedFeature[] = [];
  if (!isOpen(save, 'setlist')) locked.push('setlist');
  if (!isOpen(save, 'special')) locked.push('special');
  return locked;
}
