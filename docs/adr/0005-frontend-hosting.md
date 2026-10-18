# 0005 S3 + CloudFront（Vercelを使わない理由）

## 状況

Next.jsフロントエンドの配信先を検討した。Vercelも候補にあった。

## 決定

Next.jsを静的エクスポートし、S3 + CloudFrontで配信する。

## 捨てた選択肢

Vercel（AWSの運用を自分で持つという方針に反するため見送り）

## 結果

`infra/frontend_hosting.tf` で構築した（Issue #12）。

- S3バケットは非公開（公開アクセスブロック4項目）。CloudFrontの Origin Access Control 経由でだけ読める。バケットポリシーは、このディストリビューションからの `s3:GetObject` だけを許可する
- CloudFront: 既定のドメイン（`*.cloudfront.net`）と証明書、HTTPはHTTPSにリダイレクト、キャッシュはマネージドポリシー `CachingOptimized`、`PriceClass_200`（日本のエッジを含む）。存在しないパスは `404.html` を404で返す（OACでは存在しないオブジェクトにS3が403を返すため、403も404にする）
- アップロード: `frontend/scripts/deploy.sh` がAPIの公開URLを入れてビルドし、`aws s3 sync` でアップロードして、`/*` を無効化する。Terraformではファイルを管理しない
- APIはCORSでCloudFrontのオリジンを許可して、ブラウザから呼ぶ
