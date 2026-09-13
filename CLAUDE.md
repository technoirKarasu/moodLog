# CLAUDE.md

プロダクトの説明・課題・機能一覧は README.md を参照。ここには作業指示のみ書く。

## 技術スタック

モノレポ。`frontend/` `backend/` `infra/` の3つ。

- frontend: Next.js (TypeScript)、静的エクスポート、S3 + CloudFront で配信
- backend: FastAPI (Python)、Mangum で Lambda + API Gateway、マイグレーションは Alembic
- DB: PostgreSQL（RDS。コスト次第で Neon に切り替える可能性あり）
- 非同期: EventBridge（金曜の週報生成をトリガー）→ SQS → Lambda。失敗分は DLQ
- IaC: Terraform（state は S3）
- CI/CD: GitHub Actions。OIDC で AWS 認証。PR で lint + API テスト、main マージで自動デプロイ
- テストは API 層のみ

## 方針

- Supabase・Firebase・Vercel などの BaaS/PaaS は使わない。AWS の運用を自分で持つことが目的
- 設計判断は `docs/adr/` に ADR として残す。スタックや構成を変えるときは ADR を先に書く
- 「便利だから」で新しいサービスやライブラリを足さない。追加するときは理由を ADR か PR の説明に書く

## 作業の流れ

- 作業前に対象の Issue 番号を確認する。Issue がなければ先に作る
- ブランチ名は `feat/12-short-name` の形式（Issue 番号を含める）
- PR の説明には背景と変更内容を書き、末尾に `Closes #12` を付ける
- PR のマージは人間が行う。Claude Code はマージしない
- main への直接 push は禁止
- 実装中に気づいた別の問題はその場で直さず、Issue を立てて後回しにする

## Issue の書き方

- タイトルは動詞で言い切る（例: `mainのブランチ保護にstatus checksを追加する`）。障害は現象をそのまま書く
- 本文は「背景」と「完了条件」の2本立て。完了条件は `- [ ]` のチェックボックス
- 障害の Issue は「背景」を「事象」に置き換える
- 日本語で書く。コンサル用語（劣後、一気通貫、論点、打ち手 など）は使わない

## コミュニケーション

- 日本語で応答する
- 提案は理由を1〜2行添えて簡潔に。代替案を並べすぎない
- 分からないことは推測で進めず質問する
