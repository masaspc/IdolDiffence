/**
 * バトル中の演出配線 —— world のイベントを Renderer の演出へつなぐ。
 *
 * **ここを 1 か所にしておく理由。** 以前はこの配線が `BattleScreen.tsx` の
 * 中だけにあり、描画を測る計測用ページ（`scripts/perf-render.ts`）は
 * 素の `renderer.draw` しか呼んでいなかった。カットインも閃光もコメントも
 * 出ないまま「1 フレーム何 ms か」を測っていたことになり、
 * **本番より軽い絵の数字を本番の数字として出していた**（Codex の指摘）。
 *
 * 音は持ち込まない。`onSe` で外へ渡すだけにして、ヘッドレス計測では
 * 何もしない関数を渡す。
 */
import type { BattleWorld } from '../sim/world';
import type { Renderer } from '../render/renderer';
import { getEnemy } from '../data';
import type { SeName } from '../audio/se';
import { ATTR_LABEL } from './idolText';

export interface BattleEffectsOptions {
  /** カットインに出すステージ名（「LIVE 配信開始」の副題） */
  stageName: string;
  /** 章の導入（`meta/progression.ts` chapterIntroFor）。新章の初回だけ非 null */
  chapterIntro?: { name: string; lead: string } | null;
  /** 効果音。計測では何もしない関数を渡す */
  onSe?: (name: SeName) => void;
}

/**
 * 演出を world につなぐ。戻り値を呼ぶと全部外れる。
 *
 * 開幕のカットイン（章の導入 → 配信開始）もここで積む。
 * カットインの列は 1 枚控えまでなので、2 枚がちょうど収まる
 */
export function attachBattleEffects(
  world: BattleWorld,
  renderer: Renderer,
  options: BattleEffectsOptions,
): () => void {
  const se = options.onSe ?? ((): void => {});

  // 章の導入 → 配信開始、の順で 2 枚。章の導入は新章の最初のステージの初回だけ
  if (options.chapterIntro) {
    renderer.pushCutIn({
      kind: 'chapter',
      title: options.chapterIntro.name,
      subtitle: options.chapterIntro.lead,
    });
  }
  // 配信開始の合図。バトルの頭に 1 回だけ ——
  // ホームで「● 配信を始める」を押した先がここだと画面が言う
  renderer.pushCutIn({ kind: 'live', title: 'LIVE 配信開始', subtitle: options.stageName });

  // 観客の危機は 1 回だけ出す。境目を行き来するたびに出すと、
  // いちばん忙しい場面でカットインが連発することになる
  let warnedDanger = false;

  const off = [
    // 演出は sim ではなく描画側で数える。sim 時刻に紐付けると、
    // 一時停止で止まり、倍速で早送りされてしまう
    world.events.on('specialStarted', () => {
      const latest = world.snapshot();
      renderer.startSpecialEffect();
      renderer.pushCutIn({
        kind: 'special',
        title: 'スペシャルライブ！',
        ...(latest.centerName ? { subtitle: `センター ${latest.centerName}` } : {}),
        ...(latest.centerIdolId ? { idolId: latest.centerIdolId } : {}),
      });
      renderer.pushComment('special');
      se('special');
    }),
    world.events.on('enemyKilled', () => {
      se('kill');
      renderer.pushComment('kill');
    }),
    world.events.on('enemyLeaked', () => {
      se('leak');
      renderer.pushComment('leak');
    }),
    // ライブ開始直後は挨拶が流れる。サビの頭でも一声。
    // コメントは情報ではなく空気なので、間引きは renderer 側
    world.events.on('bar', (e) => {
      if (e.bar < 8 && e.bar % 2 === 0) renderer.pushComment('greeting');
    }),
    world.events.on('sectionChanged', (e) => {
      if (e.section === 'chorus' || e.section === 'finale') {
        renderer.pushComment('chorus');
        // サビ突入で画面外周に光のリング（06-ui-ux 6.4）
        renderer.startChorusRing();
      }
    }),
    world.events.on('called', (e) => {
      // 自動ぶん（コールを切っている人へ配る Good）では返さない。
      // 押していないのに手応えだけ返るのはおかしい
      if (e.auto || e.judge !== 'perfect') return;
      renderer.pushComment('perfect');
      se('callPerfect');
    }),
    world.events.on('bossPhase', (e) => {
      se('phase');
      renderer.pushComment('phase');
      // 何が変わったのかを名指しする。「フェーズ 2」では
      // 編成のどこを変えればいいのか分からない
      renderer.pushCutIn({
        kind: 'phase',
        title: '属性が変わった',
        subtitle: `${ATTR_LABEL[e.attr] ?? e.attr} になった`,
      });
    }),
    world.events.on('enemySpawned', (e) => {
      if (!getEnemy(e.defId).traits.boss) return;
      se('boss');
      renderer.pushComment('boss');
      renderer.pushCutIn({
        kind: 'boss',
        title: getEnemy(e.defId).name,
        subtitle: '通すと同接が大きく減ります',
        enemyId: e.defId,
      });
    }),
    // ソロパートは 1 人を選んで撃つ操作なので、誰に入ったのかを顔で返す
    world.events.on('soloStarted', (e) => {
      renderer.pushComment('solo');
      const unit = world.snapshot().units.find((u) => u.id === e.id);
      if (!unit) return;
      renderer.pushCutIn({
        kind: 'solo',
        title: 'ソロパート',
        subtitle: unit.shortName,
        idolId: unit.spriteId,
      });
    }),
    world.events.on('audienceChanged', (e) => {
      if (warnedDanger || e.value > 25 || e.value <= 0) return;
      warnedDanger = true;
      renderer.pushCutIn({ kind: 'danger', title: '視聴者が離れはじめた', subtitle: '同接 25 以下' });
    }),
    // 決着の瞬間に流すコメントは無い —— 決着のフレームで描画ループが
    // 止まるので、流し始めても誰にも見えない。完走の拍手は結果画面が
    // 静止したコメント欄として出す（`comments.ts` resultComments）
    world.events.on('battleEnded', (e) => se(e.won ? 'win' : 'lose')),
  ];

  return (): void => {
    for (const fn of off) fn();
  };
}
