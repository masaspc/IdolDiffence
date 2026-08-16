# IDOL DIFFENCE

アニメ映画『**超かぐや姫！**』の非公式ファン制作タワーディフェンス。

仮想空間 **ツクヨミ** のライブ会場に湧く「ノイズ」を、**歌・ダンス・ヴィジュアル**で退け、
ライブを完走させる。操作するのは **かぐや（歌）/ 酒寄 彩葉（ダンス）/ 月見 ヤチヨ（ヴィジュアル）** の 3 人。

> **非公式・非営利のファン制作です。**
> 『超かぐや姫！』のキャラクターおよび世界観の権利は、原作の権利者に帰属します。
> 公式サイト: https://www.cho-kaguyahime.com
>
> 敵・ステージ・楽曲・強化システム・数値など、原作に存在しない要素はすべて本作独自の追加です。
> 切り分けは [04. コンテンツ設計](./docs/design/04-content.md#原作と本作独自要素の切り分け) に明記しています。
>
> **公開前に確認が必要な事項**（権利者の正式名称と © 表記、二次創作ガイドラインの有無など）は
> [未確認事項](./docs/design/04-content.md#未確認事項公開前に要確認) にチェックリストとして残しています。
> 現状は制作環境から公式サイトへ直接アクセスできず、一次情報での裏取りが未了です。

**現在のステータス: M2（強化して勝つループ）完了** — ステージ 3 本を通しで遊べます。
配置・ポジション強化・覚醒分岐・セットリスト・月華の解放・育成が動作します。

## 開発

```bash
npm install
npm run dev            # 開発サーバー
npm test               # 単体テスト
npm run lint           # 決定性ルールを含む Lint
npm run typecheck      # 型チェック
npm run validate:data  # ゲームデータの検証
npm run build          # 本番ビルド
```

### 実装済み（M0〜M2）

| モジュール | 内容 |
|---|---|
| `src/core/loop.ts` | 固定タイムステップ 1/60 秒 + 描画補間。実時間に触れてよい唯一の場所 |
| `src/core/clock.ts` | `GameClock` — sim 時刻の唯一の源。BPM / 拍 / 小節、ポーズとカード選択時のスナップ |
| `src/core/rng.ts` | seed 付き PRNG（mulberry32）。`Math.random()` は Lint で禁止 |
| `src/core/events.ts` | 型付き EventBus |
| `src/core/vec.ts` | ベクトル演算（アロケーションを避ける out 引数方式） |
| `src/sim/world.ts` | バトル状態。DOM 非依存で、React はスナップショットを読むだけ |
| `src/render/renderer.ts` | Canvas 2D。静的レイヤをオフスクリーンにキャッシュ |
| `src/data/` | JSON + Zod スキーマ。ビルド時に検証 |

## ドキュメント

設計書は [`docs/design/`](./docs/design/README.md) にあります。

- [01. コンセプト](./docs/design/01-concept.md) — 世界観・コアループ
- [02. バトル設計](./docs/design/02-core-battle.md) — ダメージ式・リソース・属性相性
- [03. 強化要素](./docs/design/03-progression.md) — ラン内 6 系統 + 恒久 9 系統
- [04. コンテンツ設計](./docs/design/04-content.md) — アイドル・敵・ステージ・楽曲
- [05. 技術アーキテクチャ](./docs/design/05-architecture.md) — TypeScript + Canvas、決定的シミュレーション
- [06. UI / UX](./docs/design/06-ui-ux.md) — 画面・操作・アクセシビリティ
- [07. ロードマップ](./docs/design/07-roadmap.md) — M0〜M6

## 特徴

- **3 系統の攻撃**: 歌（範囲・持続）/ ダンス（単体・機動）/ ヴィジュアル（妨害・支援）の 3 すくみ
- **楽曲がウェーブ**: イントロ → A メロ → B メロ → サビ。BPM に同期して敵が湧き、サビで演出が加速
- **月華ゲージ**: 溜め切ると全員のスペシャルライブが炸裂
- **強化が満載**: 1 プレイ内で完結する強化と、積み上がる恒久強化の二層構造
- **ツクヨミが舞台**: 和風建築にネオンを重ねた仮想空間のライブワールドを守り抜く

## 技術スタック

TypeScript (strict) / Vite / Canvas 2D / React（UI オーバーレイ）/ Zod / Vitest

## 配信

サーバー不要のクライアント完結構成のため、GitHub Pages で配信します。
`main` への push で [`.github/workflows/deploy.yml`](./.github/workflows/deploy.yml) がビルドとデプロイを行い、
`https://masaspc.github.io/IdolDiffence/` に公開されます。

実装着手（M0）までは `package.json` が無いためワークフローはスキップされます。
Pages 固有の注意点は [05. 技術アーキテクチャ 5.10](./docs/design/05-architecture.md#510-配信--デプロイgithub-pages) を参照。
