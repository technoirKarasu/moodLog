# frontend

Next.js (TypeScript) によるフロントエンド。静的エクスポートし、S3 + CloudFront で配信する。
UIはデジタル庁デザインシステム（DADS）に準拠する（`.claude/rules/dads.md`、ADR 0008）。

## 準備

`.env.example` を `.env.local` にコピーし、APIの公開URLを書く（`.env.local` はコミットしない）。

```sh
cp .env.example .env.local
# NEXT_PUBLIC_API_BASE_URL に `terraform -chdir=infra output -raw api_endpoint` の値を書く
```

`NEXT_PUBLIC_API_BASE_URL` はビルド時に埋め込まれる。値を変えたら、開発サーバーを再起動するかビルドし直す。

## 起動・ビルド

`frontend/` で実行する。

```sh
npm install
npm run dev        # http://localhost:3000 で開発サーバーを起動する
npm run build      # 静的ファイルを out/ に書き出す
npm run lint
npm run typecheck
```

## ディレクトリ

- `app/`: ページとレイアウト
- `lib/api/`: backend のAPIを呼ぶクライアント
- `components/dads/`: DADS公式のReact版スニペットをコピーしたもの（出典と変更点は各ファイルの先頭、ライセンスは `LICENSE`）
  - 使うコンポーネントのディレクトリごとコピーし、Storybook用の `*.stories.tsx` は除く。使わないと判断したファイルを除いた場合は、そのディレクトリの `index.ts` に理由を書く
