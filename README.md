# IDOL DIFFENCE

竹取物語モチーフのアニメ風アイドル・タワーディフェンス、**超・かぐや姫**。
月から来た少女 **かぐや** が地上に留まるため、迎えに来た月の使者「ツキビト」を
**歌・ダンス・ヴィジュアル**で退け、ライブを完走させる。

メインキャラクターは **かぐや（ヴィジュアル）/ やちよ（歌）/ いろは（ダンス）** の 3 人。

**現在のステータス: 設計フェーズ**（実装未着手）

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
- **原典がシステムになる**: 五つの難題 = 衣装セット効果、天の羽衣 = 最終ボスの沈黙ギミック

## 技術スタック（予定）

TypeScript (strict) / Vite / Canvas 2D / React（UI オーバーレイ）/ Zod / Vitest

## 配信

サーバー不要のクライアント完結構成のため、GitHub Pages で配信します。
`main` への push で [`.github/workflows/deploy.yml`](./.github/workflows/deploy.yml) がビルドとデプロイを行い、
`https://masaspc.github.io/IdolDiffence/` に公開されます。

実装着手（M0）までは `package.json` が無いためワークフローはスキップされます。
Pages 固有の注意点は [05. 技術アーキテクチャ 5.10](./docs/design/05-architecture.md#510-配信--デプロイgithub-pages) を参照。
