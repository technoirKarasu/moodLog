# infra

Terraform による AWS インフラのコード。state は S3 で管理する。

## 準備

`infra/terraform.tfvars` を作り、AWS Budgets の通知先を書く。このファイルは `.gitignore` で除外されているので、コミットしない。

```hcl
budget_notification_email = "通知を受け取るアドレス"
google_client_id          = "GoogleのOAuthクライアントID"
google_client_secret      = "GoogleのOAuthクライアントシークレット"
```

### tfstate のバケット（初回だけ）

state は S3 のバケット `moodlog-tfstate-96-tokyo`（ap-northeast-1）に置く（`infra/main.tf`）。state を置くバケットを同じ state で管理すると、バケットより先に state を置けないため、このバケットだけは Terraform の管理外で、AWS CLI で作る（Issue #25）。

```sh
B=moodlog-tfstate-96-tokyo
R=ap-northeast-1
# 東京などus-east-1以外では、LocationConstraint の指定が要る
aws s3api create-bucket --bucket $B --region $R \
  --create-bucket-configuration LocationConstraint=$R --object-ownership BucketOwnerEnforced
aws s3api put-public-access-block --bucket $B \
  --public-access-block-configuration BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
aws s3api put-bucket-encryption --bucket $B \
  --server-side-encryption-configuration '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"},"BucketKeyEnabled":true}]}'
# state を壊したり消したりしたときに、前の版へ戻せるようにする
aws s3api put-bucket-versioning --bucket $B --versioning-configuration Status=Enabled
```

state には DB のパスワードなどが平文で入るので、作ったあとで設定が入ったことを確かめる。

```sh
aws s3api get-bucket-location --bucket $B            # LocationConstraint: ap-northeast-1
aws s3api get-bucket-versioning --bucket $B          # Status: Enabled
aws s3api get-bucket-encryption --bucket $B          # SSEAlgorithm: AES256、BucketKeyEnabled: true
aws s3api get-public-access-block --bucket $B        # 4つとも true
aws s3api get-bucket-ownership-controls --bucket $B  # ObjectOwnership: BucketOwnerEnforced
```

前の版の state へ戻すときは、S3 の中で前の版をコピーし直す。手元に state のファイルを落とさないため（`terraform state push` は、今の版より古い state を `-force` なしでは受け付けない）。戻す前に、手元でも GitHub Actions でも plan や apply が走っていないこと（`moodlog/terraform.tfstate.tflock` がないこと）を確かめる。

```sh
# 版の一覧（新しい順）。戻したい版の VersionId を選ぶ
aws s3api list-object-versions --bucket $B --prefix moodlog/terraform.tfstate \
  --query 'Versions[?Key==`moodlog/terraform.tfstate`].[VersionId,LastModified]' --output text
aws s3api copy-object --bucket $B --key moodlog/terraform.tfstate \
  --copy-source "$B/moodlog/terraform.tfstate?versionId=<戻したい版のVersionId>"
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

main にマージすると、GitHub Actions（`.github/workflows/deploy.yml`）が下の手順を自動で流す（ADR 0012）。手元で流すのは、次のときだけ。

- 自動のデプロイが `infra/scripts/check_plan.sh` で止まったとき。リソースの作成・削除・作り直しか、IAM のリソース（`aws_iam_*`）・S3 のバケットポリシー・公開アクセスブロックの変更を含む plan で止まる。GitHub Actions のロールは既存のリソースの更新しかできないため（ADR 0013）。手元で plan の中身を確かめてから apply する
- 新しいリソースを足すとき。同じ PR で、`infra/oidc.tf` のポリシー（`moodlog-github-actions-deploy`）に、そのリソースを更新する権限を足す。ポリシーの変更は IAM の変更なので、マージしたら上のとおり手元で apply する
- 自動のデプロイが、apply の途中で AccessDenied になったとき。ポリシーにない更新が要る変更をマージしたときに起きる。ポリシーを直す PR を出してマージし、手元で apply してから、止まったデプロイを `gh run rerun <実行ID>` で流し直す
- 自動のデプロイが、apply の途中で切れたとき（ジョブのタイムアウトなど）。state のロックが残っていたら `terraform -chdir=infra force-unlock <ロックID>` で外してから流す
- 初回の構築（上の「GoogleのOAuthクライアント」）

手元で流すときは、リポジトリのルートで実行する。

1. `backend/scripts/build_lambda.sh` でLambda用のzip（`backend/build/lambda.zip`）を作る。`plan` や `apply` の前に必要
2. `terraform -chdir=infra plan` で変更内容を確認し、`terraform -chdir=infra apply` で反映する
3. `backend/scripts/migrate_prod.sh` で、本番DBにマイグレーションを流す（下の「本番DBへのマイグレーション」）
4. `curl "$(terraform -chdir=infra output -raw api_endpoint)/health"` で、`200` と `{"status":"ok","db":true}` が返ることを確認する
5. `curl -i "$(terraform -chdir=infra output -raw api_endpoint)/me"` で、`401` が返ることを確認する（ログインが必要なAPI）
6. フロントエンドは `frontend/scripts/deploy.sh` でビルドしてS3にアップロードする（`frontend/README.md`）。公開URLは `terraform -chdir=infra output -raw frontend_url`

zip は、同じマシンで作れば毎回同じハッシュになる。ただし手元（macOS）と GitHub Actions（Ubuntu）では zip の版が違うため、ハッシュがそろわない。手元で apply したあとは、次の自動のデプロイで、3つのLambdaが同じコードのまま更新し直される。

また、`backend/requirements.txt` で版を固定しているのは直接使うライブラリだけで、間接的に入るライブラリ（starlette、pydantic など）は、ビルドしたときの最新が入る。新しい版が出ると、コードを変えていなくてもハッシュが変わり、PR のテストを通していない版が本番に入りうる（すべての版を固定するのは Issue #84）。

### 自動のデプロイの準備（初回だけ）

GitHub Actions に、次の値を登録する。`infra/terraform.tfvars` と同じ値を使う。

```sh
gh variable set AWS_DEPLOY_ROLE_ARN --body "$(terraform -chdir=infra output -raw github_actions_role_arn)"
gh secret set TF_VAR_BUDGET_NOTIFICATION_EMAIL   # 入力を求められたら値を貼る
gh secret set TF_VAR_GOOGLE_CLIENT_ID
gh secret set TF_VAR_GOOGLE_CLIENT_SECRET
```

## データを持つリソースを消すとき・作り直すとき

次の2つは、消したり作り直したりするとデータが失われるので、削除保護を付けている。Terraform からもコンソールや CLI からも消せない。

| リソース | 削除保護 | 消したときに残るもの | 作り直したときに起きること |
| --- | --- | --- | --- |
| RDS（`aws_db_instance.moodlog`、`infra/db.tf`。Issue #82） | `deletion_protection = true` | 最後のスナップショット（`moodlog-final`） | 空の DB になる。記録はスナップショットから戻す |
| Cognito のユーザープール（`aws_cognito_user_pool.main`、`infra/auth.tf`。Issue #86） | `deletion_protection = "ACTIVE"` | 何も残らない | 全員の `sub` が変わる。記録は `users.cognito_sub` でひもづけているので、同じアカウントでログインしても、これまでの記録が見えなくなる。メールアドレスで登録したユーザーは登録し直しになる（Google でログインするユーザーは、ログインし直せば新しいユーザーとして作られる） |

消すときも作り直すときも、手順は同じ。

- 変更はすべて PR を通して main に入れる。手元だけでコードを書き換えて apply しない。次に別の PR をマージしたときに、自動のデプロイが main のコードで apply し直すため
- `terraform destroy` は使わない。対象以外のリソースも消えるため

1. 1本目の PR: 削除保護を外す（RDS は `deletion_protection = false`、ユーザープールは `deletion_protection = "INACTIVE"`）。マージすると、自動のデプロイが設定の変更（in-place）として apply する
2. 2本目の PR: 消す変更（リソースをコードから消す）か、作り直しになる変更を入れる。ユーザープールでは、`username_attributes` など、あとから変えられない設定を変えると作り直しになる
   - 作り直しの場合は、同じ PR で削除保護を元に戻してよい。消すのは古いリソースで、その時点では削除保護が外れているため
   - マージすると、自動のデプロイは `infra/scripts/check_plan.sh` で止まる。手元で `terraform -chdir=infra plan` を確かめてから `apply` する
3. 手元で apply したあと、残りの「デプロイ」の手順（マイグレーション、`/health` の確認、フロントの配置）を流す。ユーザープールを作り直したときは、クライアントIDとトークンの Issuer が変わるので、フロントの配置（`frontend/scripts/deploy.sh`）を必ず流す。マネージドログインのドメインは `random_string` の接尾辞で決まり変わらないので、Google の OAuth クライアントのリダイレクトURIは登録し直さなくてよい
4. 残さない場合は、コードから消す（2本目の PR）まで済ませる。コードに残したまま手元で消すと、次の自動のデプロイは作成を含む plan として `check_plan.sh` で止まる。そこで手元で apply すると、空のリソースが作り直される
5. RDS では、`moodlog-final` という名前のスナップショットが残っていると、次に消すときに失敗する。いらなければ、先に消しておく（`aws rds delete-db-snapshot --db-snapshot-identifier moodlog-final`）

## 週報生成バッチの動作確認

週報生成バッチ（`infra/batch.tf`）は毎週金曜 18:00 にしか起動しないため、動作を確かめるときだけ5分ごとにする。

1. `terraform -chdir=infra apply -var 'weekly_summary_schedule=rate(5 minutes)'`
2. 数分待ち、`aws logs tail /aws/lambda/moodlog-weekly-summary` で `weekly_summary received` のログを確かめる
3. `terraform -chdir=infra apply`（`-var` なし）で金曜 18:00 に戻す。`aws scheduler get-schedule --name moodlog-weekly-summary` で戻ったことを確かめる

## 本番DBへのマイグレーション

RDSはプライベートサブネットにあり、手元から `alembic upgrade head` を実行できない。代わりに、VPC内のLambda（`moodlog-migrate`、`infra/migrate.tf`）を呼んで流す（ADR 0011）。

前提: `backend/scripts/build_lambda.sh` で作ったzipを apply 済みであること（マイグレーションのファイルはzipに入っている）。

```sh
backend/scripts/migrate_prod.sh
```

- 成功すると `{"revision": "<適用後のリビジョン>"}` を出し、終了コード0で終わる。head まで適用済みなら、何もせずに同じ値を返す
- 失敗すると、例外の型（`errorType`）だけを出し、終了コード1で終わる。エラーの内容には SQL 文などが入りうるため、公開される GitHub Actions のログには出さない。詳しくは下の `aws logs tail` で見る。`aws lambda invoke` は関数が失敗しても終了コード0を返すため、スクリプトの中でレスポンスの `FunctionError` を見て判定している
- `--cli-read-timeout 0` を付けて呼んでいる。既定の60秒で読み取りがタイムアウトすると、CLIが呼び直し、マイグレーションが2回流れうるため（Lambdaの同時実行も1つに絞っている）
- alembic のログ（`Running upgrade ...`）は `aws logs tail /aws/lambda/moodlog-migrate --since 1h` で見られる
- apply からマイグレーションを流すまでの間は、新しいコードが古いスキーマで動くため、APIがエラーを返しうる。マイグレーションは、古いコードでも動く形で書く（ADR 0012）
