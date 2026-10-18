# infra

Terraform による AWS インフラのコード。state は S3 で管理する。

## 準備

`infra/terraform.tfvars` を作り、AWS Budgets の通知先を書く。このファイルは `.gitignore` で除外されているので、コミットしない。

```hcl
budget_notification_email = "通知を受け取るアドレス"
```

## デプロイ

リポジトリのルートで実行する。

1. `backend/scripts/build_lambda.sh` でLambda用のzip（`backend/build/lambda.zip`）を作る。`plan` や `apply` の前に必要
2. `terraform -chdir=infra plan` で変更内容を確認し、`terraform -chdir=infra apply` で反映する
3. `curl "$(terraform -chdir=infra output -raw api_endpoint)/health"` で、`200` と `{"status":"ok","db":true}` が返ることを確認する
4. フロントエンドは `frontend/scripts/deploy.sh` でビルドしてS3にアップロードする（`frontend/README.md`）。公開URLは `terraform -chdir=infra output -raw frontend_url`

## 週報生成バッチの動作確認

週報生成バッチ（`infra/batch.tf`）は毎週金曜 18:00 にしか起動しないため、動作を確かめるときだけ5分ごとにする。

1. `terraform -chdir=infra apply -var 'weekly_summary_schedule=rate(5 minutes)'`
2. 数分待ち、`aws logs tail /aws/lambda/moodlog-weekly-summary` で `weekly_summary received` のログを確かめる
3. `terraform -chdir=infra apply`（`-var` なし）で金曜 18:00 に戻す。`aws scheduler get-schedule --name moodlog-weekly-summary` で戻ったことを確かめる
