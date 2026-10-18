# コードベース解説

このドキュメントは、moodLog のコードが「何をしていて、なぜそうなっているか」を自分で説明・保守できるようになるためのガイドです。`alembic init` のようなコマンドで自動生成された部分は除き、**手で書いた/判断した部分**を中心に解説します。

最終更新: 2026-10-18（#24 マージ時点の状態）

更新の運用: 機能やインフラのまとまりが終わったら、更新用のIssueを立ててまとめて更新する。コードを変えるPRで毎回は更新しないため、最終更新より後の変更は反映されていないことがある。

---

## 1. 全体像

リポジトリは3つのディレクトリに分かれています（ADR 0001「BaaSを使わずAWSで自前構成にする」に基づく）。

```
moodLog/
├── docs/adr/     技術選定の記録（なぜその構成にしたか）
├── infra/        Terraform。AWS上のインフラをコードで定義する
├── backend/      FastAPI。APIサーバーのコード
└── frontend/     Next.js。まだREADMEのみで未実装
```

今のところ実際に動いているのは「ローカルPC上でFastAPI + Dockerの Postgres」だけです。AWS向けのTerraformコード（OIDC・RDS・SSM）は書いてありますが、まだ `terraform apply` していません。AWS上にあるのは、Terraformの管理外で用意したtfstate用のS3バケット（4.1）だけです。

### データの流れ（将来像）

```
ブラウザ → CloudFront → S3（Next.jsの静的ファイル）
ブラウザ → API Gateway → Lambda（FastAPI/Mangum） → RDS（PostgreSQL）
```

今のbackendコードは、この図の「Lambda → RDS」の部分（かつローカルのDockerに向けた仮の接続先）だけが出来ている状態です。

---

## 2. なぜこの技術構成なのか（ADR早見表）

`docs/adr/` に6本の記録があります。「結果」欄は0002と0006だけ記入済みで、残りは未記入（実際に運用してみた後の振り返りが未着手、Issue #16）。

| ADR | 決定したこと | 採用しなかった選択肢 | 理由 |
|---|---|---|---|
| 0001 | AWSで自前構成にする | Supabase, Firebase, Vercel | 「AWSの運用を自分で持つ」のが目的そのものだから（ADRではなくCLAUDE.mdの方針） |
| 0002 | DBはRDS（コスト次第でNeonも検討） | Neon | 現時点ではRDSを優先、コストが見えたら再検討 |
| 0003 | backendはLambda+Mangum | ECS Fargate | ADRに理由の記載なし |
| 0004 | 非同期処理はEventBridge→SQS→Lambda、失敗はDLQ | Lambda直接スケジュール | 失敗時にリトライ/隔離できる仕組みが欲しかった |
| 0005 | frontendはS3+CloudFront静的配信 | Vercel | AWSの運用を自分で持つ方針に反するため |
| 0006 | GitHub Actions用IAMロールに当面AdministratorAccessを付与する | 最初から最小権限のカスタムポリシー | リソースが増える初期段階で、都度ポリシーを直すコストが大きい。#14 で必要な操作が決まったら絞る |

---

## 3. backend/ の解説

### 3.1 処理の流れ

```
config.py  … DB接続先の文字列を決める
   ↓
db.py      … その文字列を使って接続窓口(engine)を作り、「生きてるか確認する関数」を提供
   ↓
main.py    … FastAPIアプリ本体。/health エンドポイントとLambda用の変換アダプタ
```

### 3.2 `app/config.py`

```python
import os

DATABASE_URL = os.environ.get(
    "DATABASE_URL",
    "postgresql+psycopg2://moodlog:moodlog@localhost:5432/moodlog",
)
```

- `os.environ.get(キー, デフォルト値)`：環境変数`DATABASE_URL`が設定されていればそれを使う。無ければローカルDocker用の接続文字列を使う。
- `postgresql+psycopg2://` の `+psycopg2` は「このURLは`psycopg2`というドライバで繋いでください」という指定。これが無いとSQLAlchemyが接続方法を正しく選べない場合がある。
- ⚠️ **注意点**：本番（AWS）で`DATABASE_URL`を設定し忘れても、エラーにはならずローカルDB用の値にフォールバックしてしまう。その結果、本番で接続できず`/health`が503を返す、という「エラーで落ちずに静かに失敗する」形で問題が現れる。設定漏れに気づきにくいポイント。
- 本番用の接続文字列は、Terraformが SSM Parameter Store の `/moodlog/database_url` に保存する（4.3）。それをLambdaの環境変数`DATABASE_URL`にどう渡すかは、まだ決まっていない（Issue #10）。

### 3.3 `app/db.py`

```python
from sqlalchemy import create_engine, text
from app.config import DATABASE_URL

engine = create_engine(DATABASE_URL, pool_pre_ping=True)

def check_connection() -> bool:
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        return True
    except Exception:
        return False
```

- `create_engine(...)`：DBへの「接続窓口」を作る。**この時点では実際には接続しない**。接続は使われたときに初めて発生する。
- `pool_pre_ping=True`：SQLAlchemyは接続を使い終わったら捨てずに再利用する（コネクションプール）。ただしDB側がタイムアウトなどで裏で接続を切ることがあるため、「使う前に本当に生きているか軽く確認する」設定。これが無いと、切れた接続を使おうとして原因不明のエラーになることがある。
- `check_connection()`：
  1. `engine.connect()` で実際に1本接続する
  2. `SELECT 1`（一番軽いSQL、テーブルを読まない）を実行してみる
  3. 成功すれば`True`、エラーが起きれば`except`で捕まえて`False`
- ⚠️ **注意点（レビューで一番見るべき箇所）**：`except Exception`で**種類を問わず全部の例外を握りつぶして`False`にしている**。ログも出していないため、本番で503が出ても「接続できないのか、認証情報が違うのか、タイムアウトなのか」をこの関数だけでは区別できない。将来、CloudWatchログに例外内容を出す改善余地がある。

### 3.4 `app/main.py`

```python
from fastapi import FastAPI, Response
from mangum import Mangum
from app.db import check_connection

app = FastAPI()

@app.get("/health")
def health(response: Response) -> dict:
    db_ok = check_connection()
    response.status_code = 200 if db_ok else 503
    return {"status": "ok" if db_ok else "error", "db": db_ok}

handler = Mangum(app)
```

- `@app.get("/health")`：「`GET /health`にアクセスが来たらこの関数を実行する」という登録（FastAPIのルーティング）。
- `response: Response`を受け取ると、戻り値（JSON）を返しつつ、ステータスコードだけ別に上書きできる。DBが生きていれば200、死んでいれば503。
- `handler = Mangum(app)`：**AWS LambdaとFastAPIの「翻訳係」**。
  - Lambdaは「決まった形のJSON（イベント）を受け取って、決まった形のJSONを返す関数」しか実行できない
  - FastAPI(`app`)は「HTTPリクエスト/レスポンス」の形でしか会話できない
  - `Mangum`がこの2つの形式を相互に変換する
  - `handler`という変数名は、AWS側でLambda関数を設定するときに`app.main.handler`という文字列で指定される想定（Terraform側はまだ未実装、Issue #10）
  - ローカルで`uvicorn`を使って起動する場合はMangumを経由しない。uvicornが直接HTTPサーバーとして`app`と会話するため、Lambda用の部分はローカル開発に影響しない

### 3.5 `tests/test_health.py`

```python
from unittest.mock import patch
from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)

def test_health_returns_200_when_db_is_reachable():
    with patch("app.main.check_connection", return_value=True):
        response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "db": True}
```

- `TestClient`：本物のHTTP通信をせずにFastAPIアプリをテストするためのラッパー。
- `patch("app.main.check_connection", ...)`：**`app.db.check_connection`ではなく`app.main.check_connection`をパッチしている**点に注意。`main.py`が`from app.db import check_connection`とした時点で、`check_connection`という名前自体が`app.main`モジュールの中にもコピーされる。Pythonのmockは「その名前が実際に定義/参照されているモジュール」単位でパッチするため、importした先（`app.main`）を書き換える必要がある。ここを`app.db.check_connection`にすると、パッチが効かず本物のDB接続が走る。DBが起動していなければテストは失敗し、ローカルのDockerのDBが起動していると**偶然通ってしまい、パッチが効いていないことに気づけない**。今後`main.py`に新しいエンドポイントを増やしてテストを書くときに必ず踏みやすい落とし穴。

### 3.6 Alembic（マイグレーション管理）

- `alembic/versions/5bd71c859282_initial.py`：自動生成されたファイルで、`upgrade()`/`downgrade()`は`pass`のみ。**まだテーブルは1つも定義されていない。**
- `alembic/env.py` の手書き部分：
  ```python
  from app.config import DATABASE_URL
  config.set_main_option("sqlalchemy.url", DATABASE_URL)
  ```
  `alembic.ini`に直接DB接続文字列（パスワード含む）を書かず、`app.config`と同じ`DATABASE_URL`ロジックを使って動的に設定している。これにより、マイグレーション実行時とアプリ実行時で接続先がズレない。

### 3.7 ローカル開発環境

- `docker-compose.yml`：Postgres 16をローカルに立てる。user/pass/db名はすべて`moodlog`固定で、`config.py`のデフォルト接続文字列と一致させてある（ズレるとローカルで即503になる）。
- `requirements.txt` / `requirements-dev.txt`：全パッケージを`==`で完全ピン留め。バージョンを上げるときは手で書き換える運用（自動更新はされない）。

---

## 4. infra/ の解説（Terraform）

### 4.1 `versions.tf` / `main.tf`

```hcl
terraform {
  required_version = ">= 1.9"
  required_providers {
    aws    = { source = "hashicorp/aws", version = "~> 5.0" }
    random = { source = "hashicorp/random", version = "~> 3.6" }
  }
}
```
Terraform本体と、プロバイダ（AWSを操作するプラグイン、ランダム値を作るプラグイン）のバージョンを固定。`random`はDBのパスワード生成に使う（4.3）。

```hcl
terraform {
  backend "s3" {
    bucket       = "moodlog-tfstate-96"
    key          = "moodlog/terraform.tfstate"
    region       = "ap-southeast-2"
    encrypt      = true
    use_lockfile = true
  }
}
provider "aws" {
  region = "ap-northeast-1"
}
```
- Terraformは「今どんなAWSリソースを作ったか」を`tfstate`というファイルで管理する。これをS3に保存する設定。
- `use_lockfile = true`：複数人/CIが同時に`terraform apply`するのを防ぐロック機能。DynamoDBの別テーブルを用意せず、S3だけで実現する比較的新しい機能（Terraform 1.10以降）。
- リージョンが2つに分かれている点に注意。
  - `backend "s3"`の`region`（tfstateを置くバケットの場所）は`ap-southeast-2`（シドニー）。
  - `provider "aws"`の`region`（リソースを作る場所）は`ap-northeast-1`（東京）。
  - 2つは独立した設定なので、分かれていても動く。S3バケットは別リージョンへ移動できないため、tfstateのバケットだけシドニーに残っている（#21）。東京へ移す作業は Issue #25。

### 4.2 `oidc.tf`（GitHub ActionsがAWSを操作する仕組み）

ここが一番複雑で、かつ一番セキュリティ的に重要な部分です。GitHub ActionsのCI/CDが、AWSのアクセスキーをGitHub Secretsに保存せずにAWSを操作できるようにする仕組み（OIDC連携）です。

```hcl
resource "aws_iam_openid_connect_provider" "github_actions" {
  url            = "https://token.actions.githubusercontent.com"
  client_id_list = ["sts.amazonaws.com"]
  thumbprint_list = [ ... ]
}
```
GitHubが発行する「このワークフローは本物です」というトークン（OIDCトークン）を、AWSが信頼できる発行元として登録する。`thumbprint_list`は証明書のフォールバック値で、今はAWS側がTLS証明書をルートCAストアで直接検証するため実質使われない（コードのコメントに明記）。

```hcl
resource "aws_iam_role" "github_actions" {
  name = var.github_actions_role_name
  assume_role_policy = jsonencode({
    ...
    Condition = {
      StringEquals = {
        "token.actions.githubusercontent.com:aud" = "sts.amazonaws.com"
        "token.actions.githubusercontent.com:sub" = "repo:${var.github_org}/${var.github_repo}:ref:refs/heads/${var.github_actions_deploy_branch}"
      }
    }
  })
}
```
- GitHub Actionsが「なりすます」ためのIAMロール。
- `Condition`の`sub`（トークンに埋め込まれる情報）が **`repo:technoirKarasu/moodLog:ref:refs/heads/main`と完全一致する場合だけ**このロールになれる。
- これにより、**mainブランチへのpushで走るワークフローだけ**がAWSを操作できる。PRのワークフロー（`refs/pull/123/merge`のようなref）やフォークからのワークフローは`sub`が一致せず拒否される。「PRではlint/テストのみ、mainマージで自動デプロイ」というCLAUDE.mdの方針を、IAMの条件文だけで強制している。

```hcl
resource "aws_iam_role_policy_attachment" "github_actions_admin" {
  role       = aws_iam_role.github_actions.name
  policy_arn = "arn:aws:iam::aws:policy/AdministratorAccess"
}
```
⚠️ **既知の負債**：このロールに`AdministratorAccess`（ほぼ全操作が可能な権限）を付与している。意図的な一時措置で、判断の理由はADR 0006に記録してある。CI/CD（#14）で必要な操作が決まったら最小権限に絞る。**誰かに聞かれたら「まだ最小権限化していない既知の課題」と即答できるようにしておくべき箇所。**

### 4.3 `db.tf`（RDSとSSM Parameter Store）

PostgreSQL本体（RDS）と、その接続情報の保存場所を作る（Issue #9）。上から順に、置き場所 → 通信の許可 → パスワード → DB本体 → 接続情報の保存、という流れになっている。

```hcl
data "aws_vpc" "default" {
  default = true
}

data "aws_subnets" "default" { ... }

resource "aws_db_subnet_group" "moodlog" {
  name       = "moodlog-db"
  subnet_ids = data.aws_subnets.default.ids
}
```
- `data`は「作る」のではなく「既にあるものを読む」書き方。AWSアカウントに最初からある**デフォルトVPC**とそのサブネットを読み込んでいる。
- 専用のVPCを作らない理由は、個人開発の初期段階でネットワーク構成を増やさないため（ADR 0002）。
- `aws_db_subnet_group`：RDSを置いてよいサブネットの一覧。RDSは作成時にこれを指定する必要がある。

```hcl
resource "aws_security_group" "db" {
  ingress {
    from_port   = 5432
    to_port     = 5432
    protocol    = "tcp"
    cidr_blocks = [data.aws_vpc.default.cidr_block]
  }
  ...
}
```
- セキュリティグループはRDSの手前にある「ファイアウォール」。`ingress`が入ってくる通信の許可。
- PostgreSQLのポート5432への接続を、**デフォルトVPCの中からだけ**許可している。Lambdaも同じVPCに置く想定（Issue #10）。

```hcl
resource "random_password" "db" {
  length  = 32
  special = false
}
```
- パスワードをコードに書かず、Terraformに32文字のランダムな値を作らせる。
- `special = false`：記号を使わない（英数字だけ）。パスワードはそのまま接続文字列（URL）に埋め込まれるので、`@`や`/`のような記号が入らないことで、URLの区切りと混ざらずに済む。
- ⚠️ 生成した値は**tfstateに平文で入る**。tfstateのバケットは暗号化(`encrypt = true`)しているが、tfstateを読める人はパスワードも読める。

```hcl
resource "aws_db_instance" "moodlog" {
  engine         = "postgres"
  engine_version = "16"
  instance_class = var.db_instance_class   # 既定は db.t4g.micro
  allocated_storage = 20
  ...
  publicly_accessible    = false
  multi_az               = false

  backup_retention_period = 1
  skip_final_snapshot     = true
  deletion_protection     = false
}
```
- PostgreSQLのバージョンは16。ローカルの`docker-compose.yml`と同じ。
- `publicly_accessible = false`：インターネットから直接つながらないようにする。
- `multi_az = false`：別のデータセンターに予備を置かない（Single-AZ）。ADR 0002の結果欄に、この構成での月額の見込みがある。
- ⚠️ 下の3行は、消しやすさ・安さを優先した設定。本番のデータを入れる前に見直す。
  - `backup_retention_period = 1`：自動バックアップは1日分だけ。
  - `skip_final_snapshot = true`：`terraform destroy`で消すとき、最後のバックアップを取らない。
  - `deletion_protection = false`：削除保護なし。

```hcl
resource "aws_ssm_parameter" "database_url" {
  name  = "/moodlog/database_url"
  type  = "SecureString"
  value = "postgresql+psycopg2://${...username}:${random_password.db.result}@${...endpoint}/${...db_name}"
}
```
- アプリが使う接続文字列（3.2の`DATABASE_URL`と同じ形式）を組み立てて、SSM Parameter Storeに保存する。
- `SecureString`：暗号化して保存する種類。読むにはIAMの権限が必要。
- これで「パスワードを人が見ることも、コードに書くこともない」状態になる。Lambdaがこの値をどう読むかはIssue #10で決める。

### 4.4 `variables.tf` / `outputs.tf`

- `variables.tf`：GitHub org/repo名、デプロイ対象ブランチ(`main`)、ロール名、RDSのインスタンスクラス(`db.t4g.micro`)。すべてデフォルト値あり。
- `outputs.tf`：`terraform apply`後に表示する値。
  - `github_actions_role_arn`：IAMロールのARN。GitHub Actionsのワークフローファイル（まだ未作成、Issue #14）で`role-to-assume:`に指定する想定。
  - `db_endpoint`：RDSの接続先（host:port）。パスワードを含む接続情報はSSMの`/moodlog/database_url`を見る。

---

## 5. 用語集

| 用語 | 意味 |
|---|---|
| ADR (Architecture Decision Record) | 「なぜこの技術・構成を選んだか」を記録する文書 |
| SQLAlchemy | PythonからDBを操作するためのライブラリ |
| コネクションプール | DB接続を使い捨てずに再利用する仕組み。毎回新規接続すると遅いため |
| Mangum | AWS LambdaのイベントとFastAPI(ASGI)の形式を相互変換するアダプタ |
| OIDC | 外部サービス（GitHub）がAWSに対して「本人確認」するための標準規格。アクセスキーの代わりに使う |
| IAM Role | AWS上の「権限のまとまり」。誰が引き受けられるかを条件で絞れる |
| tfstate | Terraformが管理するリソースの「現在の状態」を記録したファイル |
| デフォルトVPC | AWSアカウントに最初から用意されている仮想ネットワーク |
| セキュリティグループ | AWSリソースの手前に置く通信の許可リスト（ファイアウォール） |
| SSM Parameter Store | 設定値や秘密情報を保存するAWSのサービス。`SecureString`にすると暗号化して保存する |
| Alembic | SQLAlchemy用のDBマイグレーション（テーブル定義の変更履歴）管理ツール |
| Mock (unittest.mock.patch) | テスト時に関数の動作を一時的に差し替える仕組み。差し替え対象は「importした先」のモジュール |

---

## 6. 現状の進捗

| 状態 | Issue/内容 |
|---|---|
| 完了 | ADR記録（0001〜0006）、monorepo構成、Terraform実行基盤(OIDC)、FastAPI最小構成（`/health`のみ）、#9 DB・シークレット管理（コードのみ。未apply） |
| 未着手 | #6 AWSアカウント初期設定 / #10 Lambda+API Gateway / #11 Next.js最小ページ / #12 S3+CloudFront / #13 EventBridge定期ジョブ / #14 CI/CD / #15 ブランチ保護 / #16 運用確認・ADR記載 / #25 tfstateバケットの東京移行 / #28 ruff導入 |

**今はAWS上に何もデプロイされていない。** Terraformのコードはあるが`terraform apply`はまだ（AWS上にあるのはtfstate用のS3バケットだけ）。ローカルのDocker+FastAPIだけが動く状態。

---

## 7. 既知の注意点・負債リスト（レビュー時に見るべき箇所）

1. **IAMロールの権限が広すぎる**（`infra/oidc.tf`、`AdministratorAccess`）。ADR 0006で一時措置と決めている。CI/CD構築(#14)で絞る必要あり。
2. **DB接続エラーが握りつぶされる**（`backend/app/db.py`の`except Exception`）。ログを出していないため、本番で原因調査がしにくい。
3. **本番用DB接続情報をLambdaへ渡す方法が未定**（`backend/app/config.py`）。接続文字列はSSMの`/moodlog/database_url`に保存されるが、それを環境変数`DATABASE_URL`へどう渡すかはIssue #10待ち。
4. **テーブル定義が1つもない**。実際のアプリ機能（気分ログの記録など）はまだこれから。
5. **READMEに「OAuthログイン」がコア機能として明記されているが、対応するIssueがまだ無い**。DB設計にも影響するため、テーブル設計の前に検討しておきたい。
6. **RDSが消しやすい設定のまま**（`infra/db.tf`）。バックアップ1日、最終スナップショットなし、削除保護なし。本番のデータを入れる前に見直す。
7. **tfstateがシドニーにあり、DBのパスワードが平文で入る**（`infra/main.tf`、`infra/db.tf`）。東京への移行はIssue #25。

---

## 8. 次に手を動かすなら

依存関係の順番としては **#6（AWSアカウント初期設定）→ `terraform apply`でOIDC・RDS・SSMを作る → #10（Lambda+API Gateway）** が自然。#10まで終われば、今の`/health`がAWS上でRDSにつながるかを確かめられる。
