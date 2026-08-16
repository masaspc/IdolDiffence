/**
 * 進化（03-progression.md ⑦-2）。
 *
 * 初期メンバーの 3 人（かぐや・彩葉・ヤチヨ）は配置コストが軽いぶん素の火力が低く、
 * 終盤は「置けるのに置く意味がない」状態になっていた。レベル上限まで育てても
 * 攻撃力は約 2.7 倍にしかならず、コスト 70〜80 の後発組には届かない。
 *
 * ここで**一度きりの解放**を挟む。レベル上げと違って
 * 到達ステージとレベルの両方を要求し、数値だけでなく攻撃の挙動と見た目が変わる。
 * 「育て続ければいつか強い」ではなく「ここで一段変わる」を作るのが狙い。
 *
 * 進化後も**同じアイドル ID のまま**。別 ID にすると編成・才能・ステージ進行の
 * すべてが「進化前と進化後のどちらを指すか」を判断する必要が出てくる。
 */
import { idols } from '../data';
import type { EvolutionDef } from '../data/schema/idol';
import { idolLevel, isUnlocked } from './progression';
import type { SaveData } from './save';

/**
 * 進化先を持つアイドルか。持たないキャラのほうが多い。
 *
 * `getIdol` ではなく直引きするのは、**知らない ID で例外を投げないため**。
 * セーブは手で書き換えられるし、キャラを消した後の古いセーブもここを通る。
 * ホーム画面の描画中に投げると、ゲームごと起動しなくなる（progression.ts
 * `isUnlocked` と同じ理由）。
 */
export function evolutionOf(idolId: string): EvolutionDef | null {
  return idols[idolId]?.evolution ?? null;
}

export function isEvolved(save: SaveData, idolId: string): boolean {
  return save.evolved.includes(idolId);
}

export type EvolveBlock =
  | null
  /** そもそも進化先を持たない */
  | 'no-evolution'
  | 'not-unlocked'
  | 'already'
  /** 必要なステージが未クリア */
  | 'stage'
  | 'level'
  | 'funds';

/** @returns 進化できない理由。できるなら null */
export function evolveBlocker(save: SaveData, idolId: string): EvolveBlock {
  const evolution = evolutionOf(idolId);
  if (!evolution) return 'no-evolution';
  if (!isUnlocked(save, idolId)) return 'not-unlocked';
  if (isEvolved(save, idolId)) return 'already';
  // 条件は**満たしやすい順に**見る。UI はここで返った理由をそのまま出すので、
  // 「資金が足りません」より先に「S5 をクリアしてください」を見せたい
  if (!save.stageProgress[evolution.requires.stage]?.cleared) return 'stage';
  if (idolLevel(save, idolId) < evolution.requires.level) return 'level';
  if (save.funds < evolution.cost) return 'funds';
  return null;
}

export function canEvolve(save: SaveData, idolId: string): boolean {
  return evolveBlocker(save, idolId) === null;
}

/** @returns 更新後のセーブ。条件を満たさない場合は同じ参照を返す */
export function evolve(save: SaveData, idolId: string): SaveData {
  if (!canEvolve(save, idolId)) return save;
  const evolution = evolutionOf(idolId);
  if (!evolution) return save;
  return {
    ...save,
    funds: save.funds - evolution.cost,
    evolved: [...save.evolved, idolId],
  };
}

/** 進化を反映した表示名。UI は必ずこれを通す */
export function displayName(save: SaveData, idolId: string): string {
  const idol = idols[idolId];
  if (!idol) return idolId;
  return isEvolved(save, idolId) ? (idol.evolution?.name ?? idol.name) : idol.name;
}

/**
 * sim へ渡す進化済み ID。
 *
 * セーブの `evolved` をそのまま渡すと、解放を取り消したキャラや
 * 手で書き換えたセーブの知らない ID が sim に流れ込む。ここで濾しておく。
 */
export function evolvedForBattle(save: SaveData): string[] {
  return save.evolved.filter((id) => evolutionOf(id) !== null && isUnlocked(save, id));
}
