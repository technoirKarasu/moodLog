# 0012 main へのマージで、承認を挟まずに本番へ自動でデプロイする

## 状況

これまでは、手元で `infra/README.md` の「デプロイ」の手順（zip のビルド → `terraform apply` → マイグレーション → フロントの配置）を流していた。CLAUDE.md では「main マージで自動デプロイ」としている。GitHub Actions には、OIDC で引き受けるロール（`moodlog-github-actions`、AdministratorAccess。ADR 0006）が main からだけ引き受けられる形で用意してある。PR では lint・テスト・`terraform validate` が必須のチェックになっている（Issue #14、#15）。

自動にするにあたり、次を決める必要があった（Issue #76）。

- デプロイの前に、人の承認を挟むか
- Terraform の変更を、どこまで自動で apply してよいか
- マイグレーションとコードの更新の順番
- 公開リポジトリで、秘密情報をどう扱うか

## 決定

- main への push（PR のマージ）で `.github/workflows/deploy.yml` が走り、1つのジョブで次の順に流す。どこかで失敗したら止まる
  1. zip を作る（`backend/scripts/build_lambda.sh`）
  2. `terraform plan -out` で plan を保存し、`infra/scripts/check_plan.sh` が通ったら、その plan をそのまま apply する
  3. マイグレーションを流す（`backend/scripts/migrate_prod.sh`。ADR 0011）
  4. `/health` が 200 を返すことを確かめる
  5. フロントをビルドして S3 に置く（`frontend/scripts/deploy.sh`）
- 手元の手順と同じスクリプトを使う
- 承認は挟まない。PR のマージが承認にあたる
- **削除か作り直しを含む plan は、自動では apply しない。** `check_plan.sh` で止め、手元で plan を確かめてから apply する。RDS は削除保護がなく、最後のスナップショットも残さない設定なので、作り直されると記録が消えるため（削除保護は Issue #82）
- **マイグレーションは、古いコードでも動く形で書く。** マイグレーションの Lambda も同じ apply で新しいコードになるため、マイグレーションは apply のあとにしか流せない。apply からマイグレーションまでの間は、新しいコードが古いスキーマで動く。そこで、列やテーブルの追加を先にマージしてデプロイし、使わなくなった列の削除は、コードが使わなくなってから別にマージする
- zip は、同じマシンで作れば毎回同じハッシュになるようにする（更新時刻・パーミッション・並び順をそろえる）。コードが変わらないマージで、3つの Lambda が更新されないようにするため。手元（macOS）と GitHub Actions（Ubuntu）では zip の版が違い、ハッシュはそろわない。そろえるには手元でも Linux のコンテナでビルドする必要があり、手元で apply するのは削除や作り直しのときだけなので、そこまではしない。手元で apply したあとは、次の自動のデプロイで、3つの Lambda が同じコードのまま更新し直される
  - ただし、`backend/requirements.txt` で版を固定しているのは直接使うライブラリだけ。間接的に入るライブラリは、ビルドしたときの最新が入る。新しい版が出ると、コードを変えていないマージでもハッシュが変わり、PR のテストを通していない版が人の目を通らずに本番に入りうる。すべての版を固定するのは Issue #84 で行う
- 続けてマージしたときは、走っている apply を止めない（`concurrency` の `cancel-in-progress: false`）。待っている古い実行は取り消され、最新の main だけが次に流れる
- 秘密情報の扱い（Actions のログは公開される）
  - Terraform の変数のうち公開しないもの（Budgets の通知先、Google のクライアントIDとシークレット）は、Actions の secret から `TF_VAR_*` で渡す。ロールの ARN は、アカウント ID をリポジトリに書かないよう、Actions の variable に入れる
  - plan の JSON と plan ファイルには、`sensitive` の値（DB のパスワードと接続文字列など）が平文で入る。これらは Actions の secret ではないので、GitHub のログのマスクも効かない。そのため、JSON は `jq` に渡すだけでログに出さず、止めたときに出すのは該当するリソースの `address` と `actions` だけにする。plan ファイルは artifact に上げない
  - マイグレーションが失敗したときの Lambda の応答（`errorMessage` や `stackTrace`）には、SQL 文やパラメータが入りうる。`migrate_prod.sh` は例外の型（`errorType`）だけを出し、詳しくは CloudWatch Logs で見る
  - Terraform に渡す secret は `terraform plan` のステップだけに渡し、ほかのステップ（`npm ci` のインストールスクリプトなど）からは見えないようにする。`npm ci` は AWS の認証の前に流す。フロントのビルド（`next build`）は Terraform の output を読むため、認証のあとに流す
  - plan と apply の画面出力では、Terraform が `sensitive` の値を伏せる。ARN に入るアカウント ID はログに出る（AWS はアカウント ID を秘密情報として扱っていない）
- アクションの指定方法
  - `deploy.yml` は、コミットの SHA で固定する。AdministratorAccess のロールを引き受けるので、タグが付け替えられたときに、知らないコードが動かないようにする。更新は手で行う
  - `ci.yml` は、メジャーバージョンのタグのままにする。権限も secret も渡さないので、タグが付け替えられても AWS には届かない

## 捨てた選択肢

- GitHub の Environments で、デプロイの前に承認を挟む: 1人で開発していて、PR のマージがすでに承認にあたる。Environments を使うと OIDC の `sub` が `environment:...` に変わり、ロールの信頼ポリシーも変えることになる
- PR の時点で plan を流し、その plan を apply する: PR 用のロールと secret が要る（Issue #14 で見送った）
- 削除と作り直しも自動で apply する: マージだけで DB が作り直されうる
- ジョブを terraform・backend・frontend に分ける: フロントのビルドに Terraform の output が要り、ジョブの間で値を受け渡す仕組みが増える。順番に流すだけなので、1つのジョブで足りる
- Lambda のコードを `aws lambda update-function-code` で更新し、Terraform では `ignore_changes` にする: Lambda のコードが Terraform の管理から外れ、手元の plan で何が動いているか分からなくなる
- zip のハッシュが毎回変わるのを許す: フロントだけのマージでも 3つの Lambda が更新され、コールドスタートが起きる。plan にも毎回差分が出て、本当の変更が埋もれる
- CodePipeline・CodeBuild を使う: サービスが増える。GitHub Actions で足りる
- Dependabot でアクションの SHA を更新する: 仕組みが1つ増える。使うアクションは5つで、手で追える

## 結果

`.github/workflows/deploy.yml`、`infra/scripts/check_plan.sh`、`backend/scripts/migrate_prod.sh` を追加し、`backend/scripts/build_lambda.sh` で zip のハッシュをそろえた（Issue #76）。ロールの権限は AdministratorAccess のまま。Issue #83 で、このデプロイに必要な範囲に絞る。
