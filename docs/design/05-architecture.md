# 05. 技術アーキテクチャ

## 5.1 技術選定

| 領域 | 採用 | 理由 |
|---|---|---|
| 言語 | TypeScript (strict) | データ駆動が多く、型でスキーマを守りたい |
| ビルド | Vite | 起動が速く、設定が薄い |
| 描画 | **Canvas 2D**（自前レンダラ）→ 負荷次第で PixiJS へ移行可能な抽象を挟む | 同時表示 200 体程度なら Canvas 2D で足りる。依存を増やさず初動を軽くする |
| UI | React 18（Canvas の上に DOM オーバーレイ） | メニュー・育成画面は DOM の方が圧倒的に速く作れる |
| 状態管理 | Zustand（メタ層のみ） | バトル層は React の外（後述） |
| データ検証 | Zod | JSON データとセーブデータのランタイム検証 |
| 音 | Web Audio API 直叩き | BPM 同期と、`GameClock`（[5.4](#54-時間の一元管理--gameclock)）からの駆動に必要 |
| テスト | Vitest（単体・シミュレーション）、Playwright（スモーク） | — |

**重要な設計判断**: バトルシミュレーションは React の状態に一切依存させない。
`sim` は純粋な TypeScript モジュールとして DOM なしで動き、React はフレームごとに
読み取り専用のスナップショットを受け取るだけにする。これにより
(1) 描画負荷と切り離せる (2) ヘッドレスでバランス検証できる (3) テストが書きやすい。

## 5.2 モジュール構成

```
src/
├── core/                 # 汎用基盤（ゲーム固有知識を持たない）
│   ├── loop.ts           # 固定タイムステップループ + 描画補間
│   ├── rng.ts            # mulberry32 seeded PRNG
│   ├── vec.ts            # ベクトル・幾何
│   ├── events.ts         # 型付き EventBus
│   └── clock.ts          # GameClock（sim 時刻の唯一の源。BPM / beat / bar を提供）
│
├── sim/                  # バトルシミュレーション（DOM 非依存・決定的）
│   ├── world.ts          # World 状態のコンテナ
│   ├── entities.ts       # Unit / Enemy / Projectile / StatusEffect
│   ├── systems/
│   │   ├── spawn.ts      # ウェーブ進行・敵生成
│   │   ├── movement.ts   # ウェイポイント追従、飛行、魅了時の逆走
│   │   ├── targeting.ts  # 射程判定（空間ハッシュ）+ ターゲティングモード
│   │   ├── combat.ts     # 攻撃間隔、ダメージ式、クリティカル
│   │   ├── status.ts     # バフ・デバフの適用と減衰
│   │   ├── economy.ts    # 声援の収支
│   │   ├── voltage.ts    # ボルテージ蓄積・スペシャル
│   │   └── formation.ts  # 隣接ボーナスの再計算
│   ├── modifiers.ts      # 加算/乗算プールの合成（強化系統の合流点）
│   └── snapshot.ts       # 描画・UI 向けの読み取り専用ビュー生成
│
├── data/                 # 静的データ（JSON）+ Zod スキーマ
│   ├── schema/*.ts
│   └── json/{idols,enemies,stages,songs,costumes,talents,cards,balance}.json
│
├── meta/                 # 恒久進行（セーブ対象）
│   ├── save.ts           # 直列化・マイグレーション
│   ├── progression.ts    # レベル・限界突破・才能・施設
│   ├── inventory.ts      # 衣装・素材
│   └── rewards.ts        # リザルト計算とドロップ抽選
│
├── render/               # Canvas 描画
│   ├── renderer.ts       # レイヤ管理（背景 / 経路 / ユニット / 弾 / エフェクト）
│   ├── sprites.ts        # アトラス読み込み
│   └── fx/               # パーティクル、音波リング、カットイン
│
├── ui/                   # React コンポーネント
│   ├── screens/          # Title / Home / Formation / Battle / Result / Lesson ...
│   └── hud/              # 声援・ボルテージ・ウェーブ・配置パレット
│
├── audio/                # BGM 合成、SE、BPM 同期
└── balance/              # ヘッドレスシミュレータ（CI で実行）
```

## 5.3 エンティティ表現

ECS フルセットは過剰。**構造体配列 + システム関数** の軽量方式を採る。

```ts
type EntityId = number;

interface Enemy {
  id: EntityId;
  defId: string;          // "e_armor"
  attr: Attribute;        // 'silence' | 'noise' | 'glare'
  hp: number; maxHp: number;
  def: number;
  baseSpeed: number;
  pathIndex: number;      // 現在のウェイポイント区間
  pathT: number;          // 区間内の進捗 0..1
  pos: Vec2;              // 描画用にキャッシュ
  flying: boolean;
  statuses: StatusEffect[];
  resist: Partial<Record<StatusKind, number>>;
  leak: number; bounty: number;
}

interface Unit {                 // 配置されたアイドル
  id: EntityId;
  idolId: string;                // "V1"
  type: IdolType;                // 'vocal' | 'dance' | 'visual'
  cell: GridCell;
  level: 1 | 2 | 3;              // ラン内ポジションレベル
  awakening?: 'A' | 'B';
  targeting: TargetingMode;
  cooldownMs: number;
  stats: ResolvedStats;          // 全強化を合成した結果（変化時のみ再計算）
  isCenter: boolean;
}
```

- `stats` は毎フレーム計算しない。**強化・バフの変化イベント時のみ再計算**し、
  `statsDirty` フラグで管理する（200 ユニット × 60fps の再計算を避ける）。

## 5.4 時間の一元管理 — `GameClock`

**`AudioContext.currentTime` をゲーム進行時刻として各システムから直接読んではいけない。**
オーディオ時計は一時停止やカード選択モーダルで止まらないため、
sim を止めた瞬間に「曲だけ進む」状態が生まれ、ウェーブと楽曲がずれる。

```ts
class GameClock {
  simTimeMs: number      // sim の唯一の時刻。ポーズ中は進まない
  bar: number            // simTimeMs と BPM から導出
  beat: number
  // audio は追従側。GameClock が音を駆動し、逆はしない
}
```

| 状況 | 挙動 |
|---|---|
| 通常再生 | `GameClock` が固定タイムステップで進み、BGM をその時刻へ追従させる |
| 一時停止 | `simTimeMs` を止め、BGM も停止（`AudioContext.suspend()`） |
| カード選択（◆） | **楽曲を短いループ区間に入れて演奏を継続**し、`simTimeMs` は停止。 決定後、**次の小節境界から** sim を再開する |
| 速度 2x / 3x | **1 フレームに sim を N 回回す**（`simTimeMs` の刻みは 1/60 秒のまま）。BGM の再生レートには同じ係数を掛ける |

> 倍速で `dt` を倍にしてはいけない。1 ステップが 1/60 秒でなくなると、
> 攻撃回数の切り捨てや乱数の消費順が速度によって変わり、
> **同じ seed でも 1x と 3x で結果が変わってリプレイできなくなる**。
> 速度は「時計の進み方」ではなく「1 フレームあたりのステップ数」で表現する。
> 速度変更自体もリプレイのためにログへ記録する。

- カード選択で無音になるとライブ感が切れるため、単純な停止ではなくループ区間方式を採る。
- 小節境界へスナップして再開することで、再開直後のスポーンがリズムから外れない。
- オーディオ無効時（ミュート / 自動再生ブロック中）も `GameClock` は同じ挙動をする。
  **音はゲームプレイの前提ではない**（[5.11](#511-配信--デプロイgithub-pages) の自動再生制限にも関わる）。

## 5.5 強化の合流点 — `modifiers.ts`

全強化系統が最終ステータスに合流する箇所を 1 ファイルに集約する。ここが balance の要。

```ts
interface ModifierPool {
  addPct:  Record<StatKey, number>;   // 加算プール（才能・称号・ランク・ラン内カード）
  mulPct:  Record<StatKey, number[]>; // 乗算プール（衣装セット・覚醒・センター）
  flat:    Record<StatKey, number>;   // 定数加算
}

function resolveStats(base: BaseStats, pools: ModifierPool[]): ResolvedStats {
  // 1. flat を加算
  // 2. addPct を合算して (1 + Σ) を掛ける
  // 3. mulPct を順に掛ける
  // 4. CAPS でクランプ（クリティカル率 100% 等）
}
```

強化系統を追加するときは「どのプールに入れるか」を決めるだけでよく、
計算順序の判断がコード中に散らばらない。

## 5.6 データスキーマ（抜粋）

```jsonc
// data/json/idols.json
{
  "V1": {
    "name": "かぐや",
    "type": "vocal",
    "cost": 30,
    "base": { "atk": 90, "range": 3.0, "attackIntervalMs": 1600, "critRate": 0.05, "critDmg": 0.5 },
    "attack": { "kind": "aoe_ring", "skillMul": 0.9, "radius": 1.2, "pierce": true, "canHitFlying": true },
    "skill": { "id": "tooneri", "cooldownMs": 12000, "mul": 1.4, "target": "all_in_range" },
    "awakening": {
      "A": { "name": "フルコーラス", "mods": { "attackIntervalMs": "*1.5", "radius": "*1.8" } },
      "B": { "name": "ラップコール", "mods": { "attackIntervalMs": "*0.6", "radius": "*0.7" },
             "onHit": { "status": "echo", "stacks": 1 } }
    },
    "units": ["kaguya_gumi"],
    "levelCurve": { "atkPerLevel": 0.06 }
    // canHitFlying は 歌・ヴィジュアルが true、ダンスは false。
    // ダンスの覚醒 A（D2「旋風」）のみ awakening.mods で true に上書きする
  }
}
```

```jsonc
// data/json/stages.json（抜粋）
{
  "S3": {
    "name": "ライブワールド「銀波ホール」",
    "grid": { "w": 16, "h": 9 },
    "lanes": [ { "waypoints": [[0,4],[5,4],[5,7],[12,7],[15,5]] }, { "waypoints": [[0,2],[8,2],[8,5],[15,5]] } ],
    "placeable": [[2,3],[3,3],[6,2],[6,5]],
    "cellTypes": { "6,2": "runway", "3,3": "audience" },
    "song": "gekko_silence",
    "hpMul": 1.4,
    "waves": [
      { "section": "intro", "bars": 8, "spawns": [] },
      { "section": "verse", "bars": 16,
        "spawns": [ { "bar": 1, "enemy": "e_walker", "count": 6, "intervalBars": 0.5, "lane": 0 } ] }
    ]
  }
}
```

すべての JSON は Zod スキーマで検証し、**起動時ではなくビルド時**に検証する
（`npm run validate:data`）。実行時の検証は開発モードのみ。

## 5.7 セーブデータ

- 保存先: `localStorage`（キー `idoldiffence.save.v1`）、JSON を LZ 圧縮。
- 構造: `{ version, producer, idols, inventory, talents, facilities, stageProgress, prestige, settings }`
- **マイグレーション必須**: `migrations: Record<number, (old: any) => any>` を用意し、
  バージョンを 1 つずつ上げていく方式にする。強化要素が多い＝スキーマ変更が頻発するため、
  最初から入れておかないと後で必ず詰む。
- エクスポート / インポート（Base64 文字列）を提供。localStorage 消失への保険。
- チート対策は行わない（シングルプレイのため）。ただし壊れたセーブの検出と
  安全な復旧（該当セクションのみ初期化）は行う。

## 5.8 バランス検証

`src/balance/` にヘッドレスランナーを置く。

```
npm run sim -- --stage S8 --star 5 --loadout meta_p3 --trials 2000
→ クリア率 / 平均残観客 / ボトルネックウェーブ / 系統別ダメージ寄与
```

- 描画・音を全て除外し、`sim` を最大速度で回す（1 試行 ≒ 5ms 目標）。
- 強化段階を `loadout` プリセット（序盤 / 中盤 / 終盤 / カンスト）で定義。
- CI で主要 20 パターンを回し、**クリア率が想定レンジ（40〜70%）を外れたら fail**。
  バランス崩壊を PR 時点で検出できるようにする。

## 5.9 パフォーマンス方針

| 項目 | 目標 | 手段 |
|---|---|---|
| フレームレート | 60fps（敵 200 + 弾 300 同時） | 空間ハッシュによる射程判定、オブジェクトプール |
| 射程判定 | O(敵数) を避ける | セルサイズ 2 マスの空間ハッシュに敵を登録、周辺セルのみ走査 |
| GC | フレーム内アロケーション 0 に近づける | Vec2 の使い回し、配列の `length = 0` による再利用 |
| 描画 | draw call を抑える | スプライトアトラス 1 枚、レイヤごとにバッチ、静的背景はオフスクリーンにキャッシュ |
| 初回ロード | 5MB 以内 | アトラスを WebP、データは gzip、楽曲は手続き生成 |

### 実測（M6）

**「たぶん 60fps 出ている」で済ませない。** 目標を数字にするための道具を 2 本置いた。

```bash
npx tsx scripts/perf.ts                      # sim + snapshot（ヘッドレス）
npx tsx scripts/perf.ts --stress S30 10 6    # 密度を 6 倍に水増しして 500 体
npm i -D playwright-core                     # 描画の計測にだけ要る
npx tsx scripts/perf-render-run.ts S30 10 6  # 描画（Chromium で実際に描く）
```

まず分かったのは、**34 ステージのどこにも敵 200 体は立たない**ということ。
全ステージ × ★1 / ★10 を掃いた同時最大は **85 体**（S30 ★10 と B4 ★10）で、
目標の 200 体は実在しない。そこで `--stress` は
**スポーン数を 6 倍・間隔を 1/6 に水増しした盤面**を作り、そこで測っている。

| 層 | 敵 200〜299 体 p99 | 全体 p99 | 予算 16.67ms に対して |
|---|---|---|---|
| sim（`world.update`）+ `snapshot` | 0.53ms | 0.06ms | 3% |
| 描画（`renderer.draw`） | 5.0ms | 4.2ms | 30% |

**重いのは描画で、sim ではない。** 差は 2 桁ある。5.11 のリスク表が
「Canvas 2D の描画限界」を挙げていたのは当たっていて、詰めるならこちら側になる。

最初に見つかった山は**敵ごとの `createRadialGradient`**（足元に敷く属性の光）だった。
1 体なら誤差だが 200 体 × 60 回/秒になると描画時間の主役になる。
色と丸めた半径で焼いて使い回すようにして（`renderer.ts` の `enemyGlow`）、
**全体 p99 は 9.2ms → 4.2ms、200〜299 体では 11.3ms → 5.0ms** になった。

**測れていないもの**も書いておく。

- 計測はヘッドレス Chromium（ソフトウェアラスタライズ）で、実機の GPU 合成ではない。
  CPU 側の描画コストの目安にはなるが、**スマホの実測値ではない**
- `dpr` を 2 に上げても悪化しなかった（p99 2.7ms）。ソフトウェアラスタライザでは
  塗る面積が素直に効かないためで、**Retina 実機で同じとは言えない**
- **最初の 1 フレームだけ 12〜25ms** 掛かる。背景と盤面の静的レイヤを焼き、
  ドット絵を組み立てる分で、以降は貼るだけになる。画面遷移に重なるので
  今は放置しているが、体感の引っかかりとしては残っている

## 5.10 テスト方針

| 層 | 内容 |
|---|---|
| 単体 | ダメージ式、`resolveStats` の合成順序、状態異常の重複ルール、セーブマイグレーション |
| ゴールデン | 固定 seed でステージを走らせ、最終状態のハッシュを比較（意図しない挙動変化の検出） |
| プロパティ | 「声援は負にならない」「観客ゲージは 0 を下回らない」「攻撃速度は上限を超えない」 |
| E2E | タイトル→ステージ 1 クリア→報酬反映 のスモーク（Playwright） |

## 5.11 配信 / デプロイ（GitHub Pages）

本作はサーバーを必要としない（[5.1](#51-技術選定) の全要素がクライアント完結）ため、
**GitHub Pages で配信する**。公開 URL は `https://masaspc.github.io/IdolDiffence/`。

| 要素 | 実現方法 | サーバー |
|---|---|---|
| ゲーム本体 | Vite の静的ビルド（JS / CSS / HTML） | 不要 |
| ゲームデータ | JSON をバンドルに同梱 | 不要 |
| セーブ | `localStorage` | 不要 |
| BGM / SE | Web Audio API で手続き生成 | 不要 |

### Pages 固有の制約と対応（実装時に必ず踏む 4 点）

1. **サブパス配信**
   ユーザーページ直下ではなくプロジェクトページなので、配信は `/IdolDiffence/` 配下になる。
   `vite.config.ts` に `base: '/IdolDiffence/'` を設定する（本番のみ）。
   ```ts
   export default defineConfig(({ command }) => ({
     base: command === 'build' ? '/IdolDiffence/' : '/',
   }))
   ```
   未設定だとアセットを `/assets/...` に取りに行って 404 し、**真っ白な画面**になる。

2. **絶対パスの `fetch` を書かない**
   `fetch('/data/stages.json')` は同じ理由で壊れる。
   ゲームデータは **`import` でバンドルに含める**（ビルド時に Zod 検証する方針とも整合）。
   実行時取得が必要な場合のみ `import.meta.env.BASE_URL` を前置する。

3. **Web Audio の自動再生制限**
   `AudioContext` は最初のユーザー操作まで `suspended`。
   タイトル画面の「タップして開始」で `resume()` する。
   BPM クロックは `AudioContext.currentTime` 基準（[2.4](./02-core-battle.md#24-ウェーブ--楽曲構成)）なので、
   **クロックの起点をこの resume 以降に固定する**こと。ここを誤ると曲とウェーブがずれる。

4. **`localStorage` のオリジン共有**
   `masaspc.github.io` 配下の全プロジェクトが同一オリジンで、
   容量（5〜10MB）もキー空間も共有する。キーは `idoldiffence.` プレフィックスで名前空間を分ける
   （[5.7](#57-セーブデータ)）。他プロジェクトによる `localStorage.clear()` で消える可能性があるため、
   エクスポート機能をユーザーに案内する。

- **`COOP` / `COEP` ヘッダーは Pages では設定できない** → `SharedArrayBuffer` は使用不可。
  シミュレーションは単一スレッド前提なので影響なし（Worker 化する場合も
  `postMessage` ベースに留める）。
- Pages のキャッシュ制御は行えないため、Vite のハッシュ付きファイル名に依存する。
  `index.html` のみ短命キャッシュになる点は許容。

### デプロイ

`.github/workflows/deploy.yml` が `main` への push で build → Pages デプロイを行う。

- 手動実行（`workflow_dispatch`）にも対応。
- **`package.json` が存在しない間はスキップ**する（設計フェーズの現在は no-op で成功する）。
  M0 で雛形を追加した時点で自動的に動き出す。
- `npm ci` を使うため、M0 では **`package-lock.json` をコミットする**こと。
- リポジトリ設定 → Pages → Source を **「GitHub Actions」** に切り替える初回操作が必要。
- ビルド前に `npm run validate:data`（[5.6](#56-データスキーマ抜粋)）を通し、
  壊れたデータが公開されないようにする。
