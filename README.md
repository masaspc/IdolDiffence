# IDOL DIFFENCE

アニメ風の女性アイドルたちが「歌」「ダンス」「ヴィジュアル」で戦うタワーディフェンス。
ステージに押し寄せる「サイレンス」を、パフォーマンスで退けてライブを完走させる。

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
- **ボルテージ**: 溜め切ると全員のスペシャルライブが炸裂
- **強化が満載**: 1 プレイ内で完結する強化と、積み上がる恒久強化の二層構造

## 技術スタック（予定）

TypeScript (strict) / Vite / Canvas 2D / React（UI オーバーレイ）/ Zod / Vitest
