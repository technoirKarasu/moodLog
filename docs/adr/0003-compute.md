# 0003 Lambda か ECS Fargate か

## 状況

FastAPIバックエンドの実行基盤として、Lambda(Mangum)とECS Fargateのどちらにするか検討した。

## 決定

Lambda + API Gateway（Mangum経由）を採用する。

## 捨てた選択肢

ECS Fargate

## 結果

選んだ理由は費用。Lambdaは使った分だけの課金で、アクセスが少ない個人開発では安い。ECS Fargateはコンテナが常時起動するため、アクセスがなくても課金される。

`infra/lambda.tf` と `infra/api_gateway.tf` で構築した（Issue #10）。

- Lambda: Python 3.13、arm64（x86_64より料金が約2割安い）、メモリ512MB、タイムアウト10秒。#36 のVPCのプライベートサブネットに置き、RDSに接続する
- デプロイ: `backend/scripts/build_lambda.sh` でzipを作り、Terraformがそのzipを参照する
- API Gateway: HTTP API。REST APIより安く設定も少なく、REST API固有の機能（APIキーなど）は今は使わない。流量を毎秒5件、バースト10件に制限する
- DBの接続情報: SSMに保存した値を、デプロイ時にTerraformがLambdaの環境変数 `DATABASE_URL` に入れる（ADR 0007）
