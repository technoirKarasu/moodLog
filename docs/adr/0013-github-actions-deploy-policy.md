# 0013 GitHub Actions のロールには既存のリソースの更新だけを許し、作成と IAM の変更は手元で apply する

## 状況

GitHub Actions が OIDC で引き受けるロール（`moodlog-github-actions`）には、AdministratorAccess を付けていた（ADR 0006）。main マージ時のデプロイ（ADR 0012）で必要な操作が決まったので、その範囲に絞る（Issue #83）。

デプロイでする操作は、`terraform plan`/`apply`、マイグレーションの Lambda（`moodlog-migrate`）の呼び出し、フロントの S3 への配置、CloudFront のキャッシュの削除。

絞るにあたり、次の2つが問題になった。

- Terraform は IAM のリソース（Lambda のロールとそのポリシー、このロール自身のポリシー）も同じ state で管理している。ロールが IAM の書き込みの権限を持つと、Lambda のロールに任意の権限を足し、`UpdateFunctionCode` でそのロールとしてコードを動かせる。自分のポリシーも書き換えられる。これでは絞った意味がない
- リソースの作成を許すと、EC2（インターネットゲートウェイ、ルート、インスタンス）や RDS の作成の権限が要る。これらは名前で絞れず、範囲がアカウントとリージョンまで広がる。DB をインターネットに出すことも、課金を悪用することもできてしまう

## 決定

- ロールには、既存のリソースの「更新」だけを許す。ポリシーは `infra/oidc.tf` の2つ
  - `moodlog-github-actions-read`: 読み取り
  - `moodlog-github-actions-deploy`: 書き込み
  - マネージドポリシーは 6,144 文字までで、1つにまとめると上限に近いため、2つに分けた。書き込み用も上限に近い。超えるときは、サービスごとに3つ目のポリシーへ移す
- `infra/scripts/check_plan.sh` が止める条件を広げる。ADR 0012 の「削除か作り直し」に加えて、次を含む plan でも止める。止まった変更は、手元（管理者のユーザー）で plan を確かめてから apply する
  - リソースの作成
  - IAM のリソース（`aws_iam_*`）の更新
- 新しいリソースを足す PR では、同じ PR でポリシーにも、そのリソースを更新する権限を足す。作成も IAM の変更も止まるので、どちらにしても手元で apply することになる
- 読み取りは、サービスごとの `Describe*`・`Get*`・`List*` にし、対象は `*` にする。`terraform plan` の refresh は、管理しているリソースの属性を広く読む。操作を1つずつ並べると、プロバイダを更新したときに plan が落ちやすい。ただし、中身のデータを返す読み取りは、moodlog のものに絞る
  - S3 のオブジェクト: tfstate だけ。書き込み用のポリシーに、`PutObject` と一緒に置く
  - Lambda の関数（コードのダウンロード URL と環境変数）: moodlog の3つの関数だけ
  - SSM のパラメータの値: `/moodlog/database_url` だけ
  - Cognito の利用者の情報（`ListUsers`、`Admin*`）: 含めない
- 書き込みは、操作を並べ、対象は同じ state にあるリソースの ARN を直接参照する。参照先が作り直されると、ポリシーの更新（IAM の変更）として `check_plan.sh` で止まる
- 名前に `Delete` を含む操作は、リソースを消さず、更新の中で属性を外すものだけを許す。Revoke、`DeleteFunctionConcurrency`、`DeleteRetentionPolicy`、CORS の `DELETE`、`DeleteTags` と、デプロイの手順で消すもの（S3 のフロントの古いファイル、tfstate のロックファイル）
- アクション名は、CloudTrail のイベント名ではなく、Service Authorization Reference の IAM のアクション名で書く。たとえば、API Gateway は `apigateway:GET`/`PATCH`、Budgets は `budgets:ViewBudget`
- ポリシーにない更新が要る変更をマージすると、apply の途中で AccessDenied になって止まる。リソースは消えないので、ポリシーを直す PR を出し、手元で apply してから、デプロイを流し直す

このロールで守る範囲と、守れない範囲

- 守る: アカウント全体に権限を広げる、moodlog 以外のリソースに触れる、リソースを消す、課金を悪用するリソースを作る
- 守れない: DB の中身。VPC 内の Lambda のコードを差し替えられ、plan で DB のパスワードも読むため、DB は読み書きできる。デプロイにどうしても要る権限なので、外せない。ここは、ロールを使える経路の制限で守る
  - 信頼ポリシーで、main ブランチのワークフローからしか引き受けられない
  - リポジトリのルールセット（`Required_PR`）で、main に入るのは PR のマージだけ
  - `deploy.yml` のアクションを SHA で固定する（ADR 0012）
- 権限を絞っても、本番を書き換えられる権限であることは変わらない。`deploy.yml` のアクションを SHA で固定する理由は、今も成り立つ

## 捨てた選択肢

- 権限境界（permissions boundary）を付けることを条件に、ロールの作成やポリシーの更新を許す: IAM の変更も自動で apply できる。ただし、境界のポリシーと、境界を外させない条件が増える。IAM の変更は、新しい Lambda やキューを足すときくらいで、頻度に見合わない
- 作成の権限を持たせ、作成は止めない: 「状況」の2つ目のとおり、範囲がアカウントとリージョンまで広がる
- IAM の変更を止めず、ポリシーの Deny で自分のロールの書き換えだけを拒む: ほかのロールを経由する回り道が残る。IAM の変更は、apply の途中で落ちる
- OIDC とロールを別の Terraform のルート（別の state）に分ける: 手元で apply する場所が2つになる。`check_plan.sh` で止めれば、同じ state のままで足りる
- 読み取りも、操作を1つずつ並べる: 上のとおり、プロバイダを更新したときに plan が落ちやすい

## 結果

`infra/oidc.tf` で AdministratorAccess を外し、2つのポリシーに付け替えた。`infra/scripts/check_plan.sh` は、作成と IAM の変更でも止まる（Issue #83）。
