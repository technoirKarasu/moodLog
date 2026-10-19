# infra

Terraform による AWS インフラのコード。state は S3 で管理する。

## 準備

`infra/terraform.tfvars` を作り、AWS Budgets の通知先を書く。このファイルは `.gitignore` で除外されているので、コミットしない。

```hcl
budget_notification_email = "通知を受け取るアドレス"
google_client_id          = "GoogleのOAuthクライアントID"
google_client_secret      = "GoogleのOAuthクライアントシークレット"
```

### GoogleのOAuthクライアント（初回だけ）

Googleでのログイン（`infra/auth.tf`）には、Google Cloud Console で作る OAuth クライアントが要る。
GoogleのリダイレクトURIには Cognito のドメインが要り、Cognito の設定には Google のクライアントIDが要るため、初回だけ2回に分けて apply する。

1. Cognito のドメインまで作る。この時点では Google の値はまだないため、仮の値を渡す
   ```sh
   terraform -chdir=infra apply -target=aws_cognito_user_pool_domain.main -var google_client_id=dummy -var google_client_secret=dummy
   ```
2. Google Cloud Console の「APIとサービス」→「認証情報」で、OAuth クライアントID（種類: ウェブアプリケーション）を作る。承認済みのリダイレクトURIには、`$(terraform -chdir=infra output -raw cognito_domain_url)/oauth2/idpresponse` を登録する
3. 作ったクライアントIDとシークレットを `infra/terraform.tfvars` に書き、下の「デプロイ」の手順で全体を apply する

クライアントシークレットは tfstate（S3、暗号化あり）に平文で入る。

## デプロイ

リポジトリのルートで実行する。

1. `backend/scripts/build_lambda.sh` でLambda用のzip（`backend/build/lambda.zip`）を作る。`plan` や `apply` の前に必要
2. `terraform -chdir=infra plan` で変更内容を確認し、`terraform -chdir=infra apply` で反映する
3. マイグレーションがあれば、本番DBに流す（下の「本番DBへのマイグレーション」）
4. `curl "$(terraform -chdir=infra output -raw api_endpoint)/health"` で、`200` と `{"status":"ok","db":true}` が返ることを確認する
5. `curl -i "$(terraform -chdir=infra output -raw api_endpoint)/me"` で、`401` が返ることを確認する（ログインが必要なAPI）
6. フロントエンドは `frontend/scripts/deploy.sh` でビルドしてS3にアップロードする（`frontend/README.md`）。公開URLは `terraform -chdir=infra output -raw frontend_url`

## 週報生成バッチの動作確認

週報生成バッチ（`infra/batch.tf`）は毎週金曜 18:00 にしか起動しないため、動作を確かめるときだけ5分ごとにする。

1. `terraform -chdir=infra apply -var 'weekly_summary_schedule=rate(5 minutes)'`
2. 数分待ち、`aws logs tail /aws/lambda/moodlog-weekly-summary` で `weekly_summary received` のログを確かめる
3. `terraform -chdir=infra apply`（`-var` なし）で金曜 18:00 に戻す。`aws scheduler get-schedule --name moodlog-weekly-summary` で戻ったことを確かめる

## 本番DBへのマイグレーション

RDSはプライベートサブネットにあり、手元から `alembic upgrade head` を実行できない。代わりに、VPC内のLambda（`moodlog-migrate`、`infra/migrate.tf`）を呼んで流す（ADR 0011）。

前提: `backend/scripts/build_lambda.sh` で作ったzipを apply 済みであること（マイグレーションのファイルはzipに入っている）。

```sh
aws lambda invoke --function-name moodlog-migrate --cli-read-timeout 0 /tmp/migrate.json
cat /tmp/migrate.json
```

- 成功すると、`/tmp/migrate.json` が `{"revision": "<適用後のリビジョン>"}` になる。head まで適用済みなら、何もせずに同じ値を返す
- 失敗すると、コマンドの出力に `"FunctionError": "Unhandled"` が付き、`/tmp/migrate.json` に `errorMessage` が入る。**`aws lambda invoke` は失敗しても終了コード0を返す**ので、終了コードでは判定しない
- `--cli-read-timeout 0` を付ける。既定の60秒で読み取りがタイムアウトすると、CLIが呼び直し、マイグレーションが2回流れうるため（Lambdaの同時実行も1つに絞っている）
- alembic のログ（`Running upgrade ...`）は `aws logs tail /aws/lambda/moodlog-migrate --since 1h` で見られる
- apply からマイグレーションを流すまでの間は、新しいコードが古いスキーマで動くため、APIがエラーを返しうる
