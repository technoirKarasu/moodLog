# コードベース解説

moodLog のコードを、自分で説明・保守できるようになるためのガイド。

- 書くのは、複数のファイルや層をまたいで、はじめて分かることだけ。1つのファイルを読めば分かること、ADR やコードのコメントにあることは書かず、ファイル名か ADR の番号を示す。コードの抜粋と設定値は載せない
- 全体の構成図は [README](../README.md) の「システム構成」にある
- 更新のルール: 流れや地図が変わる PR（ファイル・Lambda・AWS のサービスの追加や削除、流れの変更）の中で、同じ PR でこのファイルを直す

---

## 1. ファイルの地図と読む順番

### 読む順番

1. [README](../README.md): 何を作っているかと、全体の構成
2. この解説の2章「リクエストの流れ」を読みながら、そこに出てくるファイルを順に開く
3. 3章「週報バッチの流れ」と4章「デプロイの流れ」
4. 判断の理由が知りたくなったら、`docs/adr/` の該当する ADR

### backend/

| パス | 役割 |
| --- | --- |
| `app/main.py` | FastAPI のアプリと、API の Lambda の入口（Mangum）。`/health`、`/me`、プリフライト |
| `app/routers/` | HTTP の入出力。リクエストとレスポンスの形（pydantic）と、依存の注入 |
| `app/services/` | 業務のルール（直近の期間の決め方、初めてのユーザーの登録、commit） |
| `app/repositories/` | SQL。ORM のオブジェクトを外に出さず、値（dataclass）を返す |
| `app/models.py` | テーブルの定義。マイグレーションの autogenerate にも使う |
| `app/db.py` | DB の接続とセッション |
| `app/auth.py` | API Gateway が検証したトークンから、ユーザーの `sub` を取り出す |
| `app/clock.py` | 現在時刻。テストで差し替えるために分けている |
| `app/config.py` | 環境変数から接続先を読む |
| `app/batch/weekly_summary.py` | 週報バッチの Lambda の入口 |
| `app/migrate.py` | マイグレーションの Lambda の入口 |
| `migrations/` | Alembic のマイグレーション |
| `scripts/build_lambda.sh` | 3つの Lambda で共通の zip を作る |
| `scripts/migrate_prod.sh` | 本番 DB にマイグレーションを流す |
| `tests/` | API 層を中心としたテスト。DB にはつながない |

### frontend/

| パス | 役割 |
| --- | --- |
| `app/page.tsx` | 唯一のページ。ログインの状態と、記録の入力・一覧を出し分ける |
| `app/layout.tsx`、`app/globals.css` | 全ページ共通の枠、DADS のテーマ、キーカラー |
| `components/` | 画面の部品（入力欄、一覧、気分のアイコン、白い面） |
| `components/dads/` | DADS 公式の React 版スニペットのコピー |
| `lib/auth.ts` | Cognito でのログイン・ログアウト・トークンの取り直し |
| `lib/api/` | backend の API を呼ぶクライアント |
| `lib/mood.ts` | 気分の値とラベル、短文の文字数の数え方 |
| `scripts/deploy.sh` | ビルドして S3 に置き、CloudFront のキャッシュを消す |

### infra/

ファイルは AWS のサービスのまとまりごとに分けている。

| ファイル | 作るもの |
| --- | --- |
| `network.tf` | VPC とプライベートサブネット |
| `db.tf` | RDS と、接続文字列の SSM パラメータ |
| `lambda.tf` | API の Lambda |
| `api_gateway.tf` | API Gateway（ルート、JWT オーソライザー、CORS） |
| `auth.tf` | Cognito（ユーザープール、マネージドログイン、Google） |
| `frontend_hosting.tf` | S3 と CloudFront |
| `batch.tf` | 週報バッチ（Scheduler、SQS、DLQ、Lambda） |
| `migrate.tf` | マイグレーションの Lambda |
| `oidc.tf` | GitHub Actions が引き受けるロールと、その権限 |
| `budgets.tf` | 月額の予算と通知 |
| `scripts/check_plan.sh` | 自動で apply しない変更を含む plan を止める |

### それ以外

| パス | 役割 |
| --- | --- |
| `docs/adr/` | 設計判断の記録 |
| `docs/design-principles.md` | コードの設計原則（正はここだけ） |
| `.claude/rules/dads.md` | UI のデザインのルール（正はここだけ）。`frontend/` を触るときだけ読み込まれる |
| `.claude/agents/`、`.claude/commands/` | 独立レビューのサブエージェントと、`/pr` の手順 |
| `.github/workflows/` | PR のチェック（`ci.yml`）と、main マージ時のデプロイ（`deploy.yml`） |

---

## 2. リクエストの流れ

利用者が記録を登録して一覧を見るまでに、どこで何が起きるか。

### 画面を開く

1. ブラウザが CloudFront から HTML・JS を受け取る。S3 は非公開で、CloudFront からしか読めない（`infra/frontend_hosting.tf`、ADR 0005）
2. 画面は静的なファイルで、サーバーでは何も動かない。データはすべて、ブラウザから API を呼んで取る。API の URL と Cognito の接続先は、ビルドのときに JS に埋め込まれている（`frontend/scripts/deploy.sh`）

### ログインする

3. 「ログイン」で Cognito のマネージドログインの画面へ移る。Google か、メールアドレスで入る（`frontend/lib/auth.ts`、`infra/auth.tf`、ADR 0009）
4. 認可コードを持ってトップページ（`/`）に戻り、`lib/auth.ts` がコードをトークンに替える。戻り先が `/` なのは、静的エクスポートでは `/callback` のような別のパスを CloudFront から引けないため
5. トークンはブラウザの sessionStorage に持つ（ADR 0010）。アクセストークンの期限が近づくと、リフレッシュトークンで自動で取り直す

### API を呼ぶ

6. `frontend/lib/api/entries.ts` が、アクセストークンを `Authorization` ヘッダーに付けて API Gateway を呼ぶ。画面と API はドメインが違うので、ブラウザは先にプリフライト（OPTIONS）を送る。プリフライトは認証なしのルートから Lambda に届き、FastAPI が空の応答を返す。CORS のヘッダーは API Gateway が付ける（`infra/api_gateway.tf`、`backend/app/main.py`）
7. API Gateway の JWT オーソライザーがトークンを検証する。通らなければ Lambda は呼ばれず、401 が返る。画面は 401 を受けると、トークンを取り直して1回だけ呼び直す（`frontend/app/page.tsx`）
8. すべてのパスは、認証つきの1つのルートから API の Lambda に渡る。認証なしで呼べるのは、`/health` とプリフライトのルートだけ。新しいエンドポイントを足しても、何もしなければ認証つきになる

### Lambda の中

9. Mangum が API Gateway のイベントを FastAPI のリクエストに変える。検証済みのトークンの中身もイベントに入っていて、`app/auth.py` がそこから `sub` を取り出す。Lambda はトークンを検証しない
10. router（`app/routers/entries.py`）が入力を検証し、セッション・`sub`・現在時刻を `Depends` で受け取って service を呼ぶ。テストではこの3つを差し替える
11. service（`app/services/entries.py`）が業務のルールを決める。初めて記録するユーザーはここで `users` に登録し、一覧の取得（GET）では登録しない。commit も service で行う（理由は `app/db.py` の `get_session` の docstring）
12. repository（`app/repositories/`）が SQL を流す。RDS は外から入れないプライベートサブネットにあり、Lambda も同じ VPC に置いている（ADR 0007）

### ユーザーと記録のひもづけ

- Cognito のユーザーと DB の記録は、`users.cognito_sub` だけでつながっている。DB にはメールアドレスを持たない。画面に出すメールアドレスは、画面が ID トークンから読む（ADR 0009）
- そのため、Cognito のユーザープールを作り直すと全員の `sub` が変わり、これまでの記録が見えなくなる。削除保護を付けている理由はこれ（`infra/README.md` の「データを持つリソースを消すとき・作り直すとき」）

---

## 3. 週報バッチの流れ

1. EventBridge Scheduler が、決まった時刻に SQS へメッセージを1件送る。時刻は日本時間で指定する（`infra/batch.tf`、ADR 0004）
2. Lambda のサービスがキューを読み、メッセージを1件ずつ週報の Lambda（`app/batch/weekly_summary.py`）に渡す
3. Lambda が例外を投げずに終われば、メッセージは消える。例外を投げるとキューに戻って再試行され、決まった回数失敗すると DLQ に移る。DLQ に残ったメッセージは、中身を見てから元のキューに戻せる
4. SQS は同じメッセージを2回以上届けることがあるので、処理は冪等にする。これを handler の docstring に契約として書いている

今の週報の Lambda は、受け取ったことをログに出すだけで、DB にもつないでいない。そのため VPC の外に置いている。生成のしかたを決めたら（#32）、この章を書き直す。

---

## 4. デプロイの流れ

### PR のとき

`.github/workflows/ci.yml` が、テスト・lint・型チェック・`terraform validate` を流す。AWS の認証も secret も使わない。`terraform plan` は手元で流し、結果を PR に載せる。

### main にマージしたとき

`.github/workflows/deploy.yml` が、1つのジョブで次の順に流す（ADR 0012）。どこかで失敗したら、そこで止まる。

1. フロントの依存を入れる。依存のインストールスクリプトに AWS の認証情報を見せないよう、認証より先に行う
2. OIDC で AWS のロールを引き受ける。引き受けられるのは main のワークフローだけ（`infra/oidc.tf`）
3. Lambda の zip を作る（`backend/scripts/build_lambda.sh`）。コードが同じなら同じハッシュになり、Lambda が無駄に更新されない
4. `terraform plan` で plan を保存し、`infra/scripts/check_plan.sh` が確かめる
5. その plan を apply する。Lambda のコードもここで更新される
6. マイグレーションを流す（`backend/scripts/migrate_prod.sh` が、VPC の中のマイグレーションの Lambda を呼ぶ。ADR 0011）
7. `/health` が成功することを確かめる
8. フロントをビルドして S3 に置く（`frontend/scripts/deploy.sh`）。API の URL などは `terraform output` から読む

5と6の間は、新しいコードが古いスキーマで動く。そのため、マイグレーションは古いコードでも動く形で書く（ADR 0012）。

### 止まったとき

| 止まった場所 | 何が起きたか | 見るところ |
| --- | --- | --- |
| `check_plan.sh` | plan に、作成・削除・作り直しか、IAM・S3 のバケットポリシー・公開アクセスブロックの変更が入っている。GitHub Actions のロールは、既存のリソースの更新しかできない（ADR 0013） | `infra/README.md` の「デプロイ」。手元で plan を確かめて apply する |
| apply の途中の AccessDenied | ロールの権限にない更新が要る変更をマージした | `infra/oidc.tf` のポリシーを直す PR を出し、手元で apply してから流し直す |
| マイグレーション | ログには例外の型だけが出る。SQL 文などを公開のログに出さないため | CloudWatch Logs の `/aws/lambda/moodlog-migrate` |

新しい AWS のリソースを足すときは、同じ PR で `infra/oidc.tf` に、そのリソースを更新する権限も足す。作成も IAM の変更も `check_plan.sh` で止まるので、どちらにしても手元で apply することになる。

---

## 5. 秘密情報の流れ

| 値 | 流れ | 平文で残る場所 |
| --- | --- | --- |
| DB のパスワード | Terraform が生成する（`infra/db.tf`）→ RDS に設定し、接続文字列として SSM に暗号化して保存する → apply のときに Terraform が SSM の値を読み、API とマイグレーションの Lambda の環境変数に入れる → `backend/app/config.py` が読む | tfstate（S3 のバケット。暗号化あり）、plan のファイル、Lambda のコンソールの環境変数 |
| Google のクライアントシークレット | 手元では `infra/terraform.tfvars`、GitHub Actions では secret から、Terraform の変数として渡す → Cognito の Google の設定に入る | tfstate、plan のファイル |
| Budgets の通知先 | Google のシークレットと同じ | tfstate、plan のファイル |
| ログインのトークン | Cognito → ブラウザの sessionStorage → API への `Authorization` ヘッダー | ブラウザ（ADR 0010） |

- Lambda が実行中に SSM を読まず、環境変数で受け取るのは、VPC の中から SSM に届かないため（ADR 0007）。tfstate には元から入っているので、環境変数に入れても、見える人の範囲はあまり変わらない
- plan のファイルと plan の JSON には、伏せた値も平文で入る。そのため、GitHub Actions はこれらをログにも artifact にも出さない（`infra/scripts/check_plan.sh`、ADR 0012）
- Terraform に渡す secret は、`deploy.yml` の plan のステップにだけ渡す
- 画面に埋め込む `NEXT_PUBLIC_*`（API の URL、Cognito の接続先）は、ブラウザに配る値で、秘密ではない
- ロールの ARN にはアカウント ID が入るので、リポジトリには書かず、Actions の variable に入れている

---

## 6. 複数の場所にまたがる決まり

1つを変えるときに、ほかの場所も合わせて直す必要があるもの。

### 短文の文字数

- 画面（`frontend/lib/mood.ts`）・API（`backend/app/routers/entries.py`）・DB の制約（`backend/app/models.py`）の3か所で、同じ数え方をする。前後の空白を除いてから、コードポイントで数える。絵文字で数がずれないようにするため
- 上限の値は、frontend の `lib/mood.ts` と backend の `app/models.py` の `NOTE_MAX_LENGTH` に別々に持っている。変えるときは、両方とマイグレーション（DB の制約）を変える

### 気分の値

- 値（1〜3）は、DB の制約、API の入力の型、画面の `Mood` 型、API クライアントの応答の確認（`lib/api/entries.ts`）の4か所で決まっている
- ラベルと並べる順は、画面（`lib/mood.ts`）にだけある

### 日付と時刻

- DB は時刻を UTC で持ち、API も UTC で返す
- 「1日」の区切りは日本時間で決める。backend では直近の期間を決めるとき（`app/services/entries.py`）、frontend では一覧を日ごとにまとめるとき（`components/EntryList.tsx`）、Scheduler では起動の時刻
- backend の現在時刻は `app/clock.py` から注入する。テストで時刻を固定するため

### 1つの zip と3つの Lambda

- API・マイグレーション・週報の3つの Lambda は、同じ zip を使い、入口（handler）だけを変えている（`backend/scripts/build_lambda.sh`）
- マイグレーションのディレクトリが `alembic/` ではなく `migrations/` なのは、zip の中でライブラリの alembic とぶつかるため（ADR 0011）

### 外へ出られない VPC

RDS と、RDS を使う Lambda は、外へ出る経路のないプライベートサブネットにある。NAT ゲートウェイも VPC エンドポイントもない（ADR 0007）。そのため、次の形になっている。

- DB の接続情報は、実行中に読まず、デプロイのときに環境変数で渡す（5章）
- 本番 DB へのマイグレーションは、手元からではなく、VPC の中の Lambda から流す（ADR 0011）
- トークンの検証は、Lambda ではなく API Gateway が行う。backend は Cognito の API を呼ばない（ADR 0009）
- VPC の中の Lambda から AWS のほかのサービスや外部の API を呼ぶには、VPC エンドポイントか NAT ゲートウェイを足す必要がある。どちらも費用がかかる

### 画面の見た目

- 見た目は DADS に従う。ルールは `.claude/rules/dads.md` にあり、部品は `components/dads/` の公式スニペットを使う
- エラーや必須を表す赤い文字は、背景の色の上ではコントラストが足りない。赤い文字が出うるものは、白い面（`components/Panel.tsx`）の中に置く（`app/globals.css` のコメント）

### テスト

- backend のテストは DB につながない。依存は FastAPI の `dependency_overrides` か monkeypatch で差し替える。repository の SQL は、自動テストでは確かめていない

---

## 7. 用語集

| 用語 | 意味 |
| --- | --- |
| ADR (Architecture Decision Record) | 「なぜこの技術・構成を選んだか」を記録する文書 |
| 静的エクスポート | Next.js を、サーバーなしの HTML・JS・CSS として書き出すこと |
| OAC (Origin Access Control) | CloudFront が署名付きで S3 を読む仕組み。S3 を非公開のまま配信できる |
| キャッシュの無効化（invalidation） | CloudFront のエッジに残っている古いファイルを消す操作 |
| Cognito のユーザープール | ユーザーの登録・ログイン・トークンの発行を行う、Cognito の中の単位 |
| マネージドログイン | Cognito が用意するログイン画面 |
| 認可コードフロー + PKCE | ログイン後に受け取ったコードをトークンに替える方式。PKCE は、コードを横取りされても使えないようにする仕組み |
| アクセストークン / ID トークン / リフレッシュトークン | API を呼ぶための証明 / ユーザーの情報（メールアドレスなど） / 期限が切れたトークンを取り直すための証明 |
| `sub` | Cognito がユーザーごとに付ける一意の ID |
| JWT オーソライザー | API Gateway が、トークン（JWT）を検証してから Lambda に渡す仕組み |
| CORS | ブラウザが、別ドメインへのリクエストを相手の許可がない限りブロックする仕組み |
| プリフライト | CORS で、本番のリクエストの前にブラウザが送る確認（OPTIONS） |
| HTTP API | API Gateway の安価な種類（v2） |
| スロットリング | 一定時間あたりのリクエスト数の上限。超えると 429 を返す |
| Mangum | Lambda のイベントと FastAPI（ASGI）の形式を相互に変換するアダプタ |
| Lambda handler | Lambda が呼び出す入口の関数 |
| wheel | Python のビルド済みパッケージ。OS と CPU ごとに別のファイルがある |
| arm64 / Graviton | AWS の ARM 系の CPU。x86_64 より安い |
| VPC / サブネット | AWS 上の自分専用のネットワークと、その中の区画 |
| プライベートサブネット | インターネットへの出入り口がないサブネット |
| NAT ゲートウェイ / VPC エンドポイント | プライベートサブネットから外（インターネット / AWS のサービス）へ出るための経路 |
| セキュリティグループ | AWS のリソースの手前に置く、通信の許可の一覧 |
| SSM Parameter Store | 設定値や秘密情報を保存する AWS のサービス |
| EventBridge Scheduler | 時刻を指定して AWS のサービスを呼ぶサービス。タイムゾーンを指定できる |
| SQS / DLQ | メッセージを溜めるキュー / 何度も失敗したメッセージの退避先のキュー |
| 冪等（べきとう） | 同じ処理を2回やっても、結果が1回と同じになる性質 |
| Alembic | SQLAlchemy 用のマイグレーション管理ツール |
| tfstate | Terraform が管理するリソースの、今の状態を記録したファイル |
| OIDC | 外部のサービス（GitHub）が AWS に本人確認をするための規格。アクセスキーの代わりに使う |
| IAM ロール | AWS 上の権限のまとまり。誰が引き受けられるかを条件で絞れる |
| 混乱した代理（confused deputy） | AWS のサービスが、他人の指示で自分のアカウントのリソースを操作させられてしまう問題 |
| DADS | デジタル庁デザインシステム。色・文字・部品・アクセシビリティの基準 |
