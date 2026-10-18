# コードベース解説

このドキュメントは、moodLog のコードが「何をしていて、なぜそうなっているか」を自分で説明・保守できるようになるためのガイドです。`alembic init` や `create-next-app` のようなコマンドで自動生成された部分は除き、**手で書いた/判断した部分**を中心に解説します。

最終更新: 2026-10-19（#55 マージ時点の状態）

更新の運用: 機能やインフラのまとまりが終わったら、更新用のIssueを立ててまとめて更新する。コードを変えるPRで毎回は更新しないため、最終更新より後の変更は反映されていないことがある。

---

## 1. 全体像

リポジトリは次のように分かれています（ADR 0001「BaaSを使わずAWSで自前構成にする」に基づく）。

```
moodLog/
├── backend/      FastAPI。APIサーバーと週報バッチのコード
├── frontend/     Next.js。静的エクスポートしてS3+CloudFrontで配信する
├── infra/        Terraform。AWS上のインフラをコードで定義する
├── docs/
│   ├── adr/                 技術選定の記録（なぜその構成にしたか）
│   ├── design-principles.md コードの設計原則（正はここだけ）
│   ├── codebase-guide.md    このファイル
│   └── dads/                DADS公式Markdown（.gitignore済み。ローカル参照用）
├── .claude/      Claude Code用のルール・コマンド・サブエージェント（7章）
└── .github/      PRテンプレート（ワークフローはまだない、Issue #14）
```

**walking skeleton（全層が最低限つながった状態）はAWS上で動いています。** ブラウザで公開URL（CloudFront）を開くと、Next.jsのページがAPI Gateway経由でLambdaの `/health` を呼び、LambdaがRDSに `SELECT 1` を投げた結果を表示します。週報バッチも毎週金曜18時に起動しています（中身はログ1行だけ）。

### データの流れ

```
【画面】
ブラウザ ─→ CloudFront ─→ S3（Next.jsの静的ファイル。OAC経由でのみ読める）

【API】
ブラウザ ─(CORS)→ API Gateway(HTTP API) ─→ Lambda moodlog-api（FastAPI/Mangum） ─→ RDS（PostgreSQL）
                                              └ VPCのプライベートサブネット内 ┘

【週報バッチ】
EventBridge Scheduler（金曜18:00 JST） ─→ SQS ─→ Lambda moodlog-weekly-summary
                                          └(3回失敗)→ DLQ
```

ポイントは、**画面のファイルとAPIは別々のURLにある**ことです。ブラウザはCloudFrontからHTML/JSを受け取り、そのJSがAPI GatewayのURLを直接呼びます。オリジン（ドメイン）が違うので、API側でCORSの許可が必要になります（4.5）。

---

## 2. なぜこの技術構成なのか（ADR早見表）

`docs/adr/` に8本の記録があります。「結果」欄は0001以外は記入済み（0001の振り返りはIssue #16）。

| ADR | 決定したこと | 採用しなかった選択肢 | 理由 |
|---|---|---|---|
| 0001 | AWSで自前構成にする | Supabase, Firebase, Vercel | 「AWSの運用を自分で持つ」のが目的そのものだから（ADRではなくCLAUDE.mdの方針） |
| 0002 | DBはRDS（コスト次第でNeonも検討） | Neon | 月額の見込み（約2,000〜2,500円）を出したうえで、RDSの継続を判断済み |
| 0003 | backendはLambda+API Gateway（Mangum） | ECS Fargate | 費用。Lambdaは使った分だけの課金。Fargateはアクセスがなくても常時課金 |
| 0004 | 非同期処理はEventBridge Scheduler→SQS→Lambda、失敗はDLQ | Lambdaの直接スケジュール | 当初の理由（DLQがない）は不正確だったと結果欄で訂正済み。今の理由は「ユーザーごとのメッセージに分けて同時実行数を抑え、失敗分だけやり直せる」「失敗メッセージがDLQに残り中身を見て再投入できる」 |
| 0005 | frontendはS3+CloudFront静的配信 | Vercel | AWSの運用を自分で持つ方針に反するため |
| 0006 | GitHub Actions用IAMロールに当面AdministratorAccessを付与する | 最初から最小権限のカスタムポリシー | リソースが増える初期段階で、都度ポリシーを直すコストが大きい。#14 で必要な操作が決まったら絞る |
| 0007 | VPCをTerraformで作る（プライベートサブネット2つだけ） | デフォルトVPCの作り直し、外部モジュール、NATゲートウェイ | 東京にデフォルトVPCがなく `plan` が失敗した（#36）。管理外の前提を減らす。NATは月約45ドル、VPCエンドポイントは月約20ドルかかるので作らない |
| 0008 | UIはデジタル庁デザインシステム（DADS）に準拠し、Tailwind CSS v4を使う | 独自デザイン、CSS変数だけで自作、Tailwind v3 | アクセシビリティの基準（JIS X 8341-3 / WCAG 2.2）に乗れる。公式のテーマプラグインとReactスニペットがTailwind前提 |

0007の「NATもVPCエンドポイントも作らない」は、後の構成に大きく効いています。**VPC内のLambdaはインターネットにもAWSのAPI（SSMなど）にも出られない**ので、DBの接続情報は実行中に読まず、デプロイ時に環境変数で渡しています（4.4）。

---

## 3. backend/ の解説

### 3.1 構成と処理の流れ

```
app/
├── config.py              … DB接続先の文字列を決める
├── db.py                  … 接続窓口(engine)と「生きてるか確認する関数」
├── main.py                … FastAPIアプリ本体。/health と、API用Lambdaの入口(handler)
└── batch/
    └── weekly_summary.py  … 週報バッチ用Lambdaの入口(handler)
```

```
config.py → db.py → main.py ──(Mangum)── Lambda moodlog-api
                    batch/weekly_summary.py ── Lambda moodlog-weekly-summary
```

**Lambdaは2つあるが、zipは1つ**です。`build_lambda.sh` が `app/` ごと1つのzipにし、Terraformで「どの関数を入口にするか（`handler`）」だけを変えています（3.8、4.4、4.7）。

### 3.2 `app/config.py`

```python
import os

DATABASE_URL = os.environ.get(
    "DATABASE_URL",
    "postgresql+psycopg2://moodlog:moodlog@localhost:5432/moodlog",
)
```

- `os.environ.get(キー, デフォルト値)`：環境変数`DATABASE_URL`が設定されていればそれを使う。無ければローカルDocker用の接続文字列を使う。
- `postgresql+psycopg2://` の `+psycopg2` は「このURLは`psycopg2`というドライバで繋いでください」という指定。
- 本番では、TerraformがSSMの `/moodlog/database_url` の値を、Lambdaの環境変数 `DATABASE_URL` に入れる（4.4）。
- ⚠️ **注意点**：本番で`DATABASE_URL`が空になっても、エラーにはならずローカルDB用の値にフォールバックする。その結果、本番で`localhost`に繋ごうとして`/health`が503を返す、という「静かに失敗する」形で問題が現れる。

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
- `pool_pre_ping=True`：SQLAlchemyは接続を使い終わっても捨てずに再利用する（コネクションプール）。DB側が裏で接続を切ることがあるため、「使う前に本当に生きているか軽く確認する」設定。
  - Lambdaでは、同じ実行環境が数分〜数十分使い回される間、モジュールのトップレベルで作った `engine`（とプール内の接続）も残る。そのため、Lambdaでもプールとpre_pingは意味がある。
- `check_connection()`：`SELECT 1`（テーブルを読まない一番軽いSQL）を実行し、成功なら`True`、例外なら`False`。
- ⚠️ **注意点1**：`except Exception`で**種類を問わず全部の例外を握りつぶして`False`にしている**。ログも出していないため、本番で503が出ても「繋がらないのか、認証が違うのか、タイムアウトなのか」をCloudWatch Logsから区別できない。
- ⚠️ **注意点2**：接続のタイムアウト（`connect_timeout`）を指定していない。ネットワークやセキュリティグループを誤ると、接続が返らないままLambdaのタイムアウト（10秒）が先に来る。その場合アプリの503ではなくAPI Gatewayのエラー（500/503の`{"message": ...}`）になり、原因の切り分けがしにくい（Issue #43）。

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
  - Lambdaは「イベント（JSON）を受け取ってJSONを返す関数」しか実行できない。FastAPIは「HTTPリクエスト/レスポンス」（ASGI）でしか会話できない。Mangumがこの2つを相互に変換する。
  - `infra/lambda.tf` で `handler = "app.main.handler"` と指定している。「`app/main.py` モジュールの `handler` という変数を呼べ」という意味。
  - API Gatewayは `$default` ルートで**全パスをこのLambdaに渡す**ので、URLの振り分けはFastAPIがやる（4.5）。エンドポイントを増やしてもTerraformは変えなくてよい。
  - ローカルで`uvicorn`を使って起動する場合はMangumを経由しない。uvicornが直接`app`と会話する。
- ⚠️ 設計原則（`docs/design-principles.md`）では「DBは`Depends`で注入する」「router / service / repositoryの層に分ける」と決めているが、`/health`は原則を書く前に作ったため`check_connection()`を直接呼んでいる。次のエンドポイントがこの書き方を真似ないよう、`Depends`に直すIssueがある（#31）。

### 3.5 `app/batch/weekly_summary.py`

```python
logger = logging.getLogger(__name__)
# LambdaのPythonランタイムは、既定ではルートロガーがWARNINGのため、
# INFOを出すにはここで設定する
logger.setLevel(logging.INFO)


def handler(event: dict[str, Any], context: Any) -> None:
    for record in event["Records"]:
        logger.info(
            "weekly_summary received message_id=%s body=%s",
            record["messageId"],
            record["body"],
        )
```

- 週報バッチの入口。今は**中身がなく、受け取ったメッセージごとにログを1行出すだけ**（Issue #13で「空で」作った）。週報をどう生成するか（LLMを使うか等）はまだ決まっていない（Issue #32）。
- SQSがLambdaを呼ぶとき、`event` は `{"Records": [メッセージ, ...]}` の形で来る。各メッセージの `messageId` はSQSが付けるID、`body` は送り手（EventBridge Scheduler）が入れた中身（`{"job":"weekly_summary"}`）。
- Lambdaの戻り値は使っていない（`None`）。**例外を投げずに終われば「処理成功」とみなされ、SQSからメッセージが消える。** 例外を投げると、メッセージはキューに戻って再試行され、3回失敗するとDLQへ移る（4.7）。
- `logger.setLevel(logging.INFO)`：これが無いと`logger.info`がCloudWatch Logsに出ない。LambdaのPythonランタイムの既定がWARNINGのため。
- **冪等性**（docstringに明記）：SQSは同じメッセージを2回以上届けることがある（at-least-once）。そのため「同じメッセージが2回来ても結果が同じ」ことを契約にしている。今はログが2行出るだけで副作用がない。週報の生成を足すときも、「同じ週の週報を2回作らない」ようにする必要がある。

### 3.6 テスト（`tests/`）

**`test_health.py`**

```python
client = TestClient(app)

def test_health_returns_200_when_db_is_reachable():
    with patch("app.main.check_connection", return_value=True):
        response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "db": True}
```

- `TestClient`：本物のHTTP通信をせずにFastAPIアプリをテストするためのラッパー。
- `patch("app.main.check_connection", ...)`：**`app.db.check_connection`ではなく`app.main.check_connection`をパッチしている**点に注意。`main.py`が`from app.db import check_connection`とした時点で、`check_connection`という名前が`app.main`モジュールの中にも作られる。mockは「名前が参照される場所」を書き換える必要があるため、import先の`app.main`をパッチする。
  - ここを`app.db.check_connection`にするとパッチが効かず本物のDB接続が走る。ローカルのDBが起動していると200のテストは**偶然通ってしまい、間違いに気づけない**。この落とし穴をなくすのが #31（`Depends` + `app.dependency_overrides` に変える）。
- テストは200と503の2本。

**`test_weekly_summary.py`**

```python
def test_handler_logs_one_line_per_record(caplog):
    with caplog.at_level(logging.INFO, logger="app.batch.weekly_summary"):
        handler(_sqs_event("message-1", "message-2"), None)

    records = [r for r in caplog.records if r.name == "app.batch.weekly_summary"]
    assert len(records) == 2
```

- `_sqs_event(...)`：SQSがLambdaに渡すイベントの形（`Records`の配列）を、テスト用に組み立てる関数。
- `caplog`：pytestが用意しているフィクスチャ（テスト関数の引数に書くと自動で渡される道具）。テスト中に出たログを集めてくれる。
- メッセージ2件を渡して、ログが2行・INFOレベル・それぞれのmessageIdを含むことを確かめている。`context`（Lambdaの実行情報）は使っていないので`None`を渡す。

### 3.7 Alembic（マイグレーション管理）

- `alembic/versions/5bd71c859282_initial.py`：自動生成されたファイルで、`upgrade()`/`downgrade()`は`pass`のみ。**まだテーブルは1つも定義されていない。**
- `alembic/env.py` の手書き部分は2行だけ：
  ```python
  from app.config import DATABASE_URL
  config.set_main_option("sqlalchemy.url", DATABASE_URL)
  ```
  `alembic.ini`に接続文字列（パスワード含む）を書かず、アプリと同じ`DATABASE_URL`を使う。マイグレーションとアプリで接続先がズレない。
- ⚠️ RDSはプライベートサブネットにあり、手元のPCからは直接つながらない。本番DBにマイグレーションをどう流すか（Lambdaから実行する、CIから流す、など）はまだ決まっていない。テーブルを作る段階で決める必要がある。

### 3.8 `scripts/build_lambda.sh`（Lambda用zipを作る）

```bash
python3 -m pip install \
  --requirement "${backend_dir}/requirements.txt" \
  --target "${package_dir}" \
  --platform manylinux2014_aarch64 \
  --platform manylinux_2_28_aarch64 \
  --python-version 3.13 \
  --implementation cp \
  --only-binary=:all:

cp -R "${backend_dir}/app" "${package_dir}/app"
(cd "${package_dir}" && zip -q -r "${build_dir}/lambda.zip" .)
```

- Lambdaには「依存ライブラリ＋自分のコード」を1つのzipにして渡す。出来るのは `backend/build/lambda.zip`（`.gitignore`済み）で、Terraformがこれを参照する。**`terraform plan`/`apply`の前に必ず実行する**（zipが無いと`plan`が失敗する）。
- **一番のポイントは`--platform`の指定**。手元のMac（macOS）で普通に`pip install`すると、macOS向けのライブラリが入る。`psycopg2-binary`のようにC言語の部分を含むライブラリは、OSとCPUが違うと動かない。Lambdaの実行環境は Linux / arm64（Graviton）なので、そのためのwheel（ビルド済みパッケージ）を明示して取ってくる。
  - `--only-binary=:all:`：ソースからのビルドを禁止し、ビルド済みのwheelだけを使う（Macでビルドしてしまうのを防ぐ）。
  - `--platform`を2つ書いている理由：`psycopg2-binary 2.9.13` は`manylinux2014`のarm64向けwheelを出しておらず、`manylinux_2_28`しかない。Lambdaの`python3.13`ランタイム（Amazon Linux 2023、glibc 2.34）は`2_28`も動かせるので、両方を許可している。
- `requirements.txt`だけを入れ、`requirements-dev.txt`（pytest、ruffなど）は入れない。zipを小さく保つため。

### 3.9 ローカル開発環境と静的解析

- `docker-compose.yml`：Postgres 16をローカルに立てる。user/pass/db名はすべて`moodlog`で、`config.py`のデフォルト接続文字列と一致させてある。RDSも同じPostgreSQL 16。
- `requirements.txt` / `requirements-dev.txt`：全パッケージを`==`で完全ピン留め。バージョンを上げるときは手で書き換える。Pythonは Lambdaに合わせて 3.13（`backend/README.md`）。
- `ruff.toml`（#28で追加）：Pythonのlinter。
  - `select = ["E", "F", "I", "B", "UP"]`：使うルールを明示している。既定のルールはruffのバージョンで変わるため、上げたときに突然エラーが増えないようにする。
    - E: PEP 8の書き方 / F: 未使用のimportや未定義の変数 / I: importの並び順 / B: bugbear（バグになりやすい書き方） / UP: 古い書き方を新しいPythonの書き方に
  - `extend-exclude = ["alembic/versions"]`：自動生成されるマイグレーションファイルは対象外。
  - `known-third-party = ["alembic"]`：`backend/alembic/`というディレクトリがあるため、そのままだとruffが「`import alembic`は自作コード」と判断し、importの並び順が狂う。外部ライブラリだと教えている。
- 機械判定のコマンド（テスト・lint）はCLAUDE.mdの表にある。リポジトリのルートで実行する。

---

## 4. infra/ の解説（Terraform）

ファイルは役割ごとに分かれています。

| ファイル | 作るもの | Issue |
|---|---|---|
| `versions.tf` / `main.tf` | Terraform・プロバイダのバージョン、tfstateの保存先、リージョン | #7 |
| `oidc.tf` | GitHub Actions用のOIDCプロバイダとIAMロール | #7 |
| `network.tf` | VPCとプライベートサブネット2つ | #36 |
| `db.tf` | RDS、DB用セキュリティグループ、SSMの接続文字列 | #9 |
| `lambda.tf` | API用Lambda、そのIAMロール・セキュリティグループ・ロググループ | #10 |
| `api_gateway.tf` | API Gateway（HTTP API） | #10 |
| `frontend_hosting.tf` | フロントエンド用S3とCloudFront | #12 |
| `batch.tf` | 週報バッチ（Scheduler、SQS、DLQ、Lambda） | #13 |
| `budgets.tf` | 月額予算とメール通知 | #6 |
| `variables.tf` / `outputs.tf` | 入力値と、apply後に表示する値 | - |

**すべて`terraform apply`済み**です（`terraform -chdir=infra state list`で確認できる）。

### 4.1 `versions.tf` / `main.tf`

```hcl
terraform {
  required_version = ">= 1.10"
  required_providers {
    aws    = { source = "hashicorp/aws", version = "~> 5.0" }
    random = { source = "hashicorp/random", version = "~> 3.6" }
  }
}
```
Terraform本体と、プロバイダ（AWSを操作するプラグイン、ランダム値を作るプラグイン）のバージョンを固定。`random`はDBのパスワード生成に使う（4.3）。`1.10`以上なのは、下の`use_lockfile`が1.10からの機能だから（#35）。

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
- Terraformは「今どんなAWSリソースを作ったか」を`tfstate`というファイルで管理する。これをS3に保存する設定。tfstate用のバケット自体はTerraformの管理外で、手で作った。
- `use_lockfile = true`：2か所から同時に`apply`するのを防ぐロック。DynamoDBを使わず、S3だけで実現する。
- リージョンが2つに分かれている点に注意。
  - `backend "s3"`の`region`（tfstateを置くバケットの場所）は`ap-southeast-2`（シドニー）。
  - `provider "aws"`の`region`（リソースを作る場所）は`ap-northeast-1`（東京）。
  - 2つは独立した設定なので、分かれていても動く。S3バケットは別リージョンへ移動できないため、tfstateのバケットだけシドニーに残っている（#21）。東京へ移す作業は Issue #25。

### 4.2 `oidc.tf`（GitHub ActionsがAWSを操作する仕組み）

GitHub ActionsのCI/CDが、AWSのアクセスキーをGitHub Secretsに保存せずにAWSを操作できるようにする仕組み（OIDC連携）です。**セキュリティ的に一番重要な部分です。** ただし、ワークフロー（`.github/workflows/`）はまだ無いので、このロールはまだ誰にも使われていません（#14）。

```hcl
resource "aws_iam_openid_connect_provider" "github_actions" {
  url            = "https://token.actions.githubusercontent.com"
  client_id_list = ["sts.amazonaws.com"]
  thumbprint_list = [ ... ]
}
```
GitHubが発行する「このワークフローは本物です」というトークン（OIDCトークン）を、AWSが信頼できる発行元として登録する。`thumbprint_list`は証明書のフォールバック値で、今はAWS側がルートCAで直接検証するため実質使われない（コードのコメントに明記）。

```hcl
resource "aws_iam_role" "github_actions" {
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
- `sub`（トークンに埋め込まれる情報）が **`repo:technoirKarasu/moodLog:ref:refs/heads/main`と完全一致する場合だけ**このロールになれる。
- **mainブランチで走るワークフローだけ**がAWSを操作できる。PRのワークフロー（`refs/pull/123/merge`）やフォークからは`sub`が一致せず拒否される。「PRではlint/テストのみ、mainマージで自動デプロイ」というCLAUDE.mdの方針を、IAMの条件だけで強制している。

```hcl
resource "aws_iam_role_policy_attachment" "github_actions_admin" {
  policy_arn = "arn:aws:iam::aws:policy/AdministratorAccess"
}
```
⚠️ **既知の負債**：このロールに`AdministratorAccess`（ほぼ全操作が可能な権限）を付けている。意図的な一時措置で、理由はADR 0006。CI/CD（#14）で必要な操作が決まったら最小権限に絞る。

### 4.3 `network.tf` と `db.tf`（VPCとRDS）

**`network.tf`**：RDSとAPI用Lambdaを置くネットワーク。

```hcl
resource "aws_vpc" "main" {
  cidr_block           = "10.0.0.0/16"
  enable_dns_support   = true
  enable_dns_hostnames = true
}

resource "aws_subnet" "private_a" { cidr_block = "10.0.1.0/24", availability_zone = "ap-northeast-1a" }
resource "aws_subnet" "private_c" { cidr_block = "10.0.2.0/24", availability_zone = "ap-northeast-1c" }
```
- VPC（AWS上の自分専用のネットワーク）を1つと、サブネット（その中の区画）を2つ作る。
- サブネットが2つあるのは、RDSのサブネットグループに「2つ以上のAZ（データセンター）のサブネット」が必須だから。RDS自体はSingle-AZで1台だけ。
- `enable_dns_*`：VPC内から、RDSのエンドポイント名（`moodlog.xxxx.ap-northeast-1.rds.amazonaws.com`）をIPアドレスに変換できるようにする。
- **インターネットゲートウェイもNATゲートウェイも作らない**。サブネットは2つとも、外に出る経路がない「プライベートサブネット」。外からも入れないし、中からも出られない（ADR 0007）。
- 当初はAWSが最初から用意する「デフォルトVPC」を使っていたが、東京リージョンにそれが無く`plan`が失敗したため、自分で作る形に変えた（#36）。

**`db.tf`**：上から順に、置き場所 → 通信の許可 → パスワード → DB本体 → 接続情報の保存。

```hcl
resource "aws_db_subnet_group" "moodlog" {
  subnet_ids = [aws_subnet.private_a.id, aws_subnet.private_c.id]
}
```
RDSを置いてよいサブネットの一覧。

```hcl
resource "aws_security_group" "db" {
  description = "Allowed access to RDS (PostgreSQL)"
  ingress {
    description = "PostgreSQL from within the VPC"
    from_port   = 5432
    to_port     = 5432
    protocol    = "tcp"
    cidr_blocks = [aws_vpc.main.cidr_block]
  }
  ...
}
```
- セキュリティグループはRDSの手前にある「ファイアウォール」。`ingress`が入ってくる通信の許可。
- PostgreSQLのポート5432への接続を、**VPCの中（`10.0.0.0/16`）全体から**許可している。
- `description`が英語なのは、AWSがセキュリティグループの説明に英数字と一部の記号しか受け付けないため（#38）。
- ⚠️ 今はAPI用Lambdaのセキュリティグループ（4.4）があるので、受け入れ元をそれだけに絞れる（Issue #44）。

```hcl
resource "random_password" "db" {
  length  = 32
  special = false
}
```
- パスワードをコードに書かず、Terraformに32文字のランダムな値を作らせる。
- `special = false`：記号を使わない。パスワードは接続文字列（URL）にそのまま埋め込むので、`@`や`/`がURLの区切りと混ざらないようにする。
- ⚠️ 生成した値は**tfstateに平文で入る**。tfstateのバケットは暗号化しているが、tfstateを読める人はパスワードも読める。

```hcl
resource "aws_db_instance" "moodlog" {
  engine         = "postgres"
  engine_version = "16"
  instance_class = var.db_instance_class   # 既定は db.t4g.micro
  allocated_storage = 20
  storage_type      = "gp3"
  publicly_accessible    = false
  multi_az               = false

  backup_retention_period = 1
  skip_final_snapshot     = true
  deletion_protection     = false
}
```
- `publicly_accessible = false`：インターネットから直接つながらないようにする。そもそもプライベートサブネットなので、外への経路もない。
- `multi_az = false`：別のAZに予備を置かない。ADR 0002に、この構成での月額の見込みがある。
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
- アプリが使う接続文字列（3.2の`DATABASE_URL`と同じ形式）を組み立てて、SSM Parameter Storeに暗号化して保存する。
- この値はLambdaが実行中に読むのではなく、**Terraformがデプロイ時に読んでLambdaの環境変数に入れる**（4.4）。

### 4.4 `lambda.tf`（API用Lambda）

```hcl
resource "aws_lambda_function" "api" {
  function_name = "moodlog-api"
  runtime       = "python3.13"
  architectures = ["arm64"]
  handler       = "app.main.handler"
  memory_size   = 512
  timeout       = 10

  filename         = local.lambda_zip_path      # backend/build/lambda.zip
  source_code_hash = filebase64sha256(local.lambda_zip_path)

  vpc_config {
    subnet_ids         = [aws_subnet.private_a.id, aws_subnet.private_c.id]
    security_group_ids = [aws_security_group.lambda.id]
  }

  environment {
    variables = {
      DATABASE_URL = aws_ssm_parameter.database_url.value
    }
  }
}
```
- `arm64`：x86_64より料金が約2割安い。そのため`build_lambda.sh`でarm64向けのwheelを入れている（3.8）。
- `handler = "app.main.handler"`：zipの中の`app/main.py`の`handler`（Mangum）を入口にする。
- `source_code_hash`：zipの中身のハッシュ。これが変わるとTerraformが「コードが変わった」と判断してLambdaを更新する。
  - ⚠️ zipにはファイルのタイムスタンプが入るため、コードを変えていなくてもビルドし直すたびにハッシュが変わり、毎回更新が出る。手元からのデプロイでは実害が小さいので許容し、CI/CD（#14）で見直す（コードのコメントに明記）。
- `vpc_config`：LambdaをRDSと同じVPCのプライベートサブネットに置く。こうしないとRDSに届かない。
- **`environment`がこの構成の一番のポイント**。
  - VPC内のLambdaは外に出られない（4.3）ので、実行中にSSMのAPIを呼べない。呼べるようにするにはVPCエンドポイント（月約20ドル）かNATゲートウェイ（月約45ドル）が要る。
  - そこで、**Terraformが`apply`のときにSSMの値を読んで、Lambdaの環境変数に直接入れる**。Lambdaは`os.environ`を読むだけで済む（3.2）。追加費用はゼロ。
  - 代わりに、接続文字列（パスワード込み）がLambdaのコンソールの「環境変数」に見える。tfstateには元々入っているので、見える人の範囲はあまり変わらない、と判断した（ADR 0007）。

```hcl
resource "aws_security_group" "lambda" {
  egress {
    description = "PostgreSQL within the VPC"
    from_port   = 5432
    to_port     = 5432
    protocol    = "tcp"
    cidr_blocks = [aws_vpc.main.cidr_block]
  }
}
```
Lambdaから**外へ出る通信は、VPC内の5432番（PostgreSQL）だけ**を許可する。DB用（4.3）とは逆向き（`egress`）の設定。

```hcl
resource "aws_iam_role_policy_attachment" "lambda_vpc_access" {
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaVPCAccessExecutionRole"
}

resource "aws_cloudwatch_log_group" "lambda" {
  name              = "/aws/lambda/moodlog-api"
  retention_in_days = 14
}
```
- IAMロール：Lambda自身が使う権限。VPC内にネットワークの口（ENI）を作る権限と、CloudWatch Logsに書く権限を持つマネージドポリシー。
- ロググループ：Lambdaのログの置き場所。自動作成に任せると保持期間が「無期限」になり、ログ代がかかり続けるので、先に作って14日にする。
- `depends_on`（関数の側にある）：「これを先に作ってからLambdaを作れ」という順番の指定。ロググループを先に作らないと、Lambdaが先に動いてロググループを自動作成し、Terraformの作成がぶつかって失敗する。IAMポリシーのアタッチも先に行う。VPC内にLambdaを作るとき、ENIを作る権限が先に要るため。

### 4.5 `api_gateway.tf`（公開URLの入口）

```hcl
resource "aws_apigatewayv2_api" "api" {
  protocol_type = "HTTP"
  cors_configuration {
    allow_origins = [
      "https://${aws_cloudfront_distribution.frontend.domain_name}",
      "http://localhost:3000",
    ]
    allow_methods = ["GET"]
  }
}

resource "aws_apigatewayv2_route" "default" {
  route_key = "$default"
  target    = "integrations/${aws_apigatewayv2_integration.lambda.id}"
}

resource "aws_apigatewayv2_stage" "default" {
  name        = "$default"
  auto_deploy = true
  default_route_settings {
    throttling_rate_limit  = 5
    throttling_burst_limit = 10
  }
}

resource "aws_lambda_permission" "api_gateway" {
  principal  = "apigateway.amazonaws.com"
  source_arn = "${aws_apigatewayv2_api.api.execution_arn}/*/*"
}
```
- **HTTP API**（v2）を使う。REST API（v1）より安く設定も少ない。REST API固有の機能（APIキーなど）は今は使わない（ADR 0003）。
- `$default`ルート：パスやメソッドを問わず、全部を1つのLambdaに渡す。URLの振り分けはFastAPIがやる（3.4）。
- `integration`の`payload_format_version = "2.0"`：API GatewayがLambdaに渡すイベントの形式。Mangumはこの形式を理解できる。
- **CORS**：ブラウザは、画面を配ったドメイン（CloudFront）と違うドメイン（API Gateway）へのリクエストを、相手が許可しない限りブロックする。ここで「CloudFrontのドメインからのGETは許可」と宣言している。
  - ブラウザが事前に送る確認（OPTIONSリクエスト）にはAPI Gatewayが自分で答えるので、Lambdaは呼ばれない。
  - `http://localhost:3000`はローカル開発用（`npm run dev`の画面から本番APIを呼ぶ）。ログインも個人データもない今は残している。ログインを入れるときに見直す（#33）。
- **スロットリング**：毎秒5件、瞬間的には10件まで。認証なしで公開しており、リクエストのたびにDBに接続するので、料金とRDSの同時接続数を守る。超えると429が返る。
- `aws_lambda_permission`：「API GatewayがこのLambdaを呼んでよい」という許可。これが無いとAPI Gatewayが呼べず500になる。IAMロールとは別の、Lambda側に付ける許可（リソースベースポリシー）。

### 4.6 `frontend_hosting.tf`（S3とCloudFront）

```hcl
resource "aws_s3_bucket" "frontend" {
  bucket = "moodlog-frontend-${data.aws_caller_identity.current.account_id}"
}
resource "aws_s3_bucket_public_access_block" "frontend" { ... 4項目すべて true ... }
```
- S3のバケット名は全世界で一意なので、AWSアカウントIDを付けている。
- 公開アクセスブロックで、**バケットを完全に非公開にする**。S3のURLを直接叩いても読めない。

```hcl
resource "aws_cloudfront_origin_access_control" "frontend" {
  signing_behavior = "always"
  signing_protocol = "sigv4"
}

resource "aws_s3_bucket_policy" "frontend" {
  policy = jsonencode({
    Statement = [{
      Principal = { Service = "cloudfront.amazonaws.com" }
      Action    = "s3:GetObject"
      Condition = { StringEquals = { "AWS:SourceArn" = aws_cloudfront_distribution.frontend.arn } }
    }]
  })
}
```
- **OAC（Origin Access Control）**：CloudFrontがS3にファイルを取りに行くとき、リクエストに署名を付ける仕組み。
- バケットポリシーで「CloudFrontサービスからの読み取りで、かつ**このディストリビューションからのものだけ**」を許可する。`Condition`が無いと、他人のCloudFrontからも読めてしまう。
- 結果として、ファイルは**CloudFront経由でしか読めない**。

```hcl
resource "aws_cloudfront_distribution" "frontend" {
  default_root_object = "index.html"
  price_class         = "PriceClass_200"
  default_cache_behavior {
    viewer_protocol_policy = "redirect-to-https"
    cache_policy_id        = data.aws_cloudfront_cache_policy.caching_optimized.id
    compress               = true
  }
  custom_error_response { error_code = 403, response_code = 404, response_page_path = "/404.html" }
  custom_error_response { error_code = 404, response_code = 404, response_page_path = "/404.html" }
  viewer_certificate { cloudfront_default_certificate = true }
}
```
- `default_root_object`：`https://xxx.cloudfront.net/` に来たら`index.html`を返す。
- `PriceClass_200`：使うエッジ（世界各地の配信拠点）の範囲。`PriceClass_100`は北米・欧州だけで日本が入らないので、日本を含む200にしている。
- `redirect-to-https`：HTTPで来たらHTTPSに転送する。
- `CachingOptimized`：AWSが用意しているキャッシュ設定。静的ファイル向け。
- **`custom_error_response`で403も404にしている理由**：OACでは、存在しないファイルを要求されたときS3が404ではなく403（拒否）を返す。そのままだとユーザーに「アクセス拒否」と見えるので、どちらもNext.jsが出力した`404.html`を404で返す。
  - ⚠️ 裏返すと、**バケットポリシーの設定ミスで本当に拒否されたときも404に見える**。ページが出ないときは、まずバケットポリシーを疑う（コードのコメントに明記）。
- 独自ドメインは使わず、CloudFrontの既定ドメイン（`*.cloudfront.net`）と証明書を使う。

**ファイル自体はTerraformで管理しない。** アップロードは`frontend/scripts/deploy.sh`がやる（5.7）。

### 4.7 `batch.tf`（週報バッチ）

構成は `Scheduler → SQS → Lambda`、失敗分は`DLQ`。リソースが多いので、流れの順に見ます。

**① EventBridge Scheduler（起動のきっかけ）**

```hcl
resource "aws_scheduler_schedule" "weekly_summary" {
  schedule_expression          = var.weekly_summary_schedule   # 既定は cron(0 18 ? * FRI *)
  schedule_expression_timezone = "Asia/Tokyo"
  flexible_time_window { mode = "OFF" }
  target {
    arn      = aws_sqs_queue.weekly_summary.arn
    role_arn = aws_iam_role.weekly_summary_scheduler.arn
    input    = jsonencode({ job = "weekly_summary" })
  }
}
```
- 毎週金曜18:00（日本時間）に、SQSへ`{"job":"weekly_summary"}`というメッセージを1件送る。
- EventBridgeの「ルール」ではなく「Scheduler」を使ったのは、**タイムゾーンを指定できる**から。ルールはUTC固定で、日本時間に直す計算が要る。
- `cron(0 18 ? * FRI *)`：分 時 日 月 曜日 年。`?`は「日は指定しない（曜日で指定するので）」という意味。
- `flexible_time_window`を`OFF`にして、指定時刻ちょうどに起動する。
- 動作確認では、`-var 'weekly_summary_schedule=rate(5 minutes)'`で5分ごとに一時的に変える（`infra/README.md`）。

**② Scheduler用のIAMロール**

```hcl
resource "aws_iam_role" "weekly_summary_scheduler" {
  assume_role_policy = jsonencode({
    Statement = [{
      Principal = { Service = "scheduler.amazonaws.com" }
      Condition = { StringEquals = { "aws:SourceAccount" = data.aws_caller_identity.current.account_id } }
    }]
  })
}
resource "aws_iam_role_policy" "weekly_summary_scheduler" {
  # sqs:SendMessage を、このキューにだけ許可
}
```
- Schedulerが「このキューにメッセージを送る」ための権限。
- `aws:SourceAccount`の条件：**他のAWSアカウントのSchedulerがこのロールを使えないようにする**（「混乱した代理（confused deputy）」問題の対策）。`scheduler.amazonaws.com`というサービスは全アカウント共通なので、条件が無いと、理屈の上では他人のスケジュールからこのロールを指定できてしまう。

**③ SQSとDLQ**

```hcl
resource "aws_sqs_queue" "weekly_summary_dlq" {
  message_retention_seconds = 1209600   # 14日（最大）
}
resource "aws_sqs_queue" "weekly_summary" {
  visibility_timeout_seconds = local.weekly_summary_timeout * 6   # 30秒×6 = 180秒
  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.weekly_summary_dlq.arn
    maxReceiveCount     = 3
  })
}
```
- **可視性タイムアウト**：Lambdaがメッセージを受け取ると、そのメッセージは一定時間ほかから見えなくなる。時間内にLambdaが成功すればメッセージは消え、失敗するか時間切れになると再び見えるようになり、再試行される。
  - Lambdaのタイムアウト（30秒）より短いと、処理中なのに別のLambdaが同じメッセージを受け取ってしまう。AWSの推奨（6倍以上）に合わせて180秒。
- `maxReceiveCount = 3`：3回受け取られても成功しなかったメッセージは、DLQに移す。
- DLQの保持は最大の14日。失敗したメッセージの中身を見てから、元のキューに戻せる。

**④ Lambda本体**

```hcl
resource "aws_lambda_function" "weekly_summary" {
  function_name = "moodlog-weekly-summary"
  handler       = "app.batch.weekly_summary.handler"
  memory_size   = 128
  timeout       = 30
  filename      = local.lambda_zip_path   # API と同じzip
}

resource "aws_lambda_event_source_mapping" "weekly_summary" {
  event_source_arn = aws_sqs_queue.weekly_summary.arn
  function_name    = aws_lambda_function.weekly_summary.arn
  batch_size       = 1
}
```
- **API用と同じzip**を使い、`handler`だけ`app.batch.weekly_summary.handler`に変えている。
- **VPCには置いていない**。今はDBを使わないため。DBを使うようになったら、API用と同じく`vpc_config`が要る。ただしVPCに入れると外へ出られなくなるので、週報の生成でLLMなど外部のAPIを呼ぶなら、NATゲートウェイなどの経路が別に必要になる（#32 で決めるときに一緒に考える）。SQSからの受け取りはLambdaのサービス側がキューを読むので、VPCに入れても影響しない。
- `event_source_mapping`：「このSQSキューを見張って、メッセージが来たらこのLambdaを呼べ」という設定。SQSは自分からLambdaを呼べないので、Lambda側のこの仕組みがキューを読みに行っている。
- `batch_size = 1`：1回の呼び出しで渡すメッセージは1件。複数件まとめると「3件中1件だけ失敗した」ときの扱い（`ReportBatchItemFailures`）を考える必要がある。1件ずつなら、失敗したら丸ごと再試行で済む。
- IAMロール：ログを書く権限（`AWSLambdaBasicExecutionRole`）と、**このキューだけ**を読む権限（`ReceiveMessage`/`DeleteMessage`/`GetQueueAttributes`）。AWSが用意している`AWSLambdaSQSQueueExecutionRole`は全キューが対象なので使わない。

### 4.8 `budgets.tf`（予算アラート）

```hcl
resource "aws_budgets_budget" "monthly" {
  limit_amount = "30"
  limit_unit   = "USD"
  time_unit    = "MONTHLY"
  notification { threshold = 80,  notification_type = "ACTUAL"     ... }
  notification { threshold = 100, notification_type = "FORECASTED" ... }
}
```
- 月30ドルの予算。**実績が80%（24ドル）を超えたとき**と、**月末までの予測が100%を超えたとき**にメールが来る。
- 30ドルの根拠：見込みはRDSの月約15ドルで、他は無料枠の範囲。その2倍程度を上限にした。
- 予算は「超えたら止める」ものではなく、**通知するだけ**。止まらないので、メールに気づくことが前提。
- 通知先のメールアドレスは公開リポジトリに載せないため、`infra/terraform.tfvars`（コミットしない）で渡す。`variables.tf`で`sensitive = true`にして`plan`の表示にも出さず、`validation`で`@`を含む形かを確かめている。

### 4.9 `variables.tf` / `outputs.tf` / デプロイ手順

- `variables.tf`：GitHubのorg/repo名、デプロイ対象ブランチ(`main`)、ロール名、RDSのインスタンスクラス、予算の通知先、週報のスケジュール。通知先以外はデフォルト値あり。
- `outputs.tf`：`apply`後に表示する値。スクリプトからは`terraform -chdir=infra output -raw <名前>`で読む。

| output | 使い道 |
|---|---|
| `api_endpoint` | APIの公開URL。`deploy.sh`がフロントのビルドに埋め込む |
| `frontend_url` | 画面の公開URL |
| `frontend_bucket_name` / `frontend_distribution_id` | `deploy.sh`がアップロードとキャッシュ削除に使う |
| `github_actions_role_arn` | CI/CD（#14）のワークフローで`role-to-assume:`に指定する予定 |
| `db_endpoint` | RDSの接続先（host:port）。パスワードはSSMにある |

**今のデプロイは手元のPCから手で行います**（CI/CDは #14 で作る）。手順は`infra/README.md`にあり、順番は次のとおり。

```
1. backend/scripts/build_lambda.sh      … Lambda用zipを作る（plan の前に必須）
2. terraform -chdir=infra plan / apply   … AWSに反映（Lambdaのコードもここで更新される）
3. curl "$(terraform -chdir=infra output -raw api_endpoint)/health"  … 200 を確認
4. frontend/scripts/deploy.sh            … 画面をビルドしてS3へ
```

---

## 5. frontend/ の解説

### 5.1 構成

```
frontend/
├── app/
│   ├── layout.tsx     … 全ページ共通の枠（<html>、フォント、余白）
│   ├── page.tsx       … トップページ。/health の結果を表示する
│   └── globals.css    … Tailwind と DADS テーマの読み込み
├── lib/api/
│   └── health.ts      … backend の /health を呼ぶAPIクライアント
├── components/dads/   … DADS公式のReactスニペットをコピーしたもの
├── scripts/deploy.sh  … ビルド → S3 → キャッシュ削除
├── next.config.ts
└── .env.example       … APIのURLの設定例
```

設計原則の「表示（components）とデータ取得（APIクライアント）を分ける」に沿って、`fetch`は`lib/api/health.ts`に閉じ込め、`page.tsx`は結果を表示するだけにしています。

### 5.2 `next.config.ts`

```ts
const nextConfig: NextConfig = {
  output: "export",
  agentRules: false,
  turbopack: { rules: { "*.css": { loaders: ["@tailwindcss/turbopack"], as: "*.css" } } },
};
```
- **`output: "export"`が一番重要**。`npm run build`で、HTML/JS/CSSだけの静的ファイルを`out/`に書き出す。Node.jsのサーバーが要らないので、S3に置くだけで配信できる（ADR 0005）。
  - 代わりに、サーバー側で動く機能（SSR、API Routes、`next/image`の最適化など）は使えない。データはすべて**ブラウザからAPIを呼んで取る**形になる。
- `agentRules: false`：`next dev`がAIエージェント向けの`AGENTS.md`を勝手に作らないようにする。作業の指示はCLAUDE.mdだけに置く方針（同じ内容を複数箇所に書かない）。
- `turbopack`：Tailwind CSS v4をTurbopack（Next.jsのビルドツール）で処理する設定。`create-next-app`が作る既定の構成そのまま。

### 5.3 `app/layout.tsx`

```tsx
const notoSansJp = Noto_Sans_JP({ weight: ["400", "700"], display: "swap", preload: false });

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="ja">
      <body className={`${notoSansJp.className} bg-white text-solid-gray-800 text-std-16N-170 px-4 py-8 desktop:px-8`}>
        {children}
      </body>
    </html>
  );
}
```
- `Noto_Sans_JP`：DADSが指定する書体。`next/font/google`は**ビルド時に**フォントをダウンロードして`out/`に含めるので、利用者のブラウザがGoogleに取りに行かない。
  - `weight: ["400", "700"]`：DADSの太さはN（400）とB（700）の2段階。
  - `preload: false`：preloadには`subsets`（文字セット）の指定が要るが、選べるのは`latin`などで日本語が無いため、preloadしない。
- `className`はTailwindのクラス。`text-solid-gray-800`や`text-std-16N-170`（Standard・16px・Normal・行高170%）はDADSのテーマプラグインが提供するトークン。
- `bg-white`：DADSは「文字色を指定するなら背景色も指定する」よう求めている。ブラウザの設定で背景色が変わっても、コントラストを保つため。
- 左右の余白（モバイル16px、デスクトップ32px）は、DADSに具体値の定めがないため自分で決めた（コメントに理由あり）。
- `{ children }`の型を自分で書いているのは、Next.jsが生成する`LayoutProps`型に頼ると、`next dev`/`next build`を一度も実行していない状態（CIの型チェックなど）で型エラーになるため。

### 5.4 `lib/api/health.ts`（APIクライアント）

```ts
export const fetchHealth = async (baseUrl: string): Promise<HealthResult> => {
  let response: Response;
  try {
    response = await fetch(`${baseUrl}/health`);
  } catch {
    // CORSで止められた場合も、ここに来る
    throw new HealthFetchError("network error");
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new HealthFetchError("response is not JSON", response.status);
  }

  if (!isHealthResponse(body)) {
    throw new HealthFetchError("unexpected response shape", response.status);
  }
  return { httpStatus: response.status, body };
};
```
失敗のしかたを3段階に分けて、それぞれ`HealthFetchError`を投げます。

1. **`fetch`自体が失敗**：ネットワークエラー、またはCORSで拒否された。ブラウザはCORSの拒否理由をJSに教えないので、区別できない。HTTPステータスは無い（`undefined`）。
2. **JSONではない**：ありえないはずだが、HTMLのエラーページが返ったときなど。
3. **JSONだが`/health`の形ではない**：API Gatewayの流量制限（429）やLambdaのエラー（500）は`{"message": "..."}`という形を返す。`isHealthResponse`で`status`が文字列・`db`が真偽値かを確かめ、違えばエラーにする。

- **2xx以外でもエラーにしない**ところがポイント。`/health`はDBが落ちていると**503と`{"status":"error","db":false}`**を返す。これは「APIは動いていてDBが落ちている」という正しい結果なので、エラーにせず結果として返す。`response.ok`だけで判定すると、この情報が消える。
- `body: unknown`：`response.json()`の結果は中身が分からないので、`any`ではなく`unknown`で受け、`isHealthResponse`（型ガード：`true`を返すとTypeScriptが型を絞り込んでくれる関数）を通してから`HealthResponse`として扱う。これで「型は合っているのに実際の値が違う」状態を防ぐ。

### 5.5 `app/page.tsx`（トップページ）

```tsx
"use client";

type State =
  | { kind: "loading" }
  | { kind: "success"; result: HealthResult }
  | { kind: "error"; httpStatus: number | undefined };

const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL;
```
- `"use client"`：このファイルのコンポーネントをブラウザで動かす指定。`useState`/`useEffect`はブラウザでしか動かないため要る。静的エクスポートなので、どのみち動的な処理はすべてブラウザで行う。
- `State`：画面の状態を3つの形のどれか1つとして表す（判別可能なユニオン型）。`kind`を見ればどの形か分かり、`success`のときだけ`result`がある、とTypeScriptが保証する。「読み込み中なのにエラーもある」のような矛盾した状態を作れない。
- **`NEXT_PUBLIC_API_BASE_URL`はビルド時に埋め込まれる**。`NEXT_PUBLIC_`で始まる環境変数は、ビルドのときに値そのものがJSに書き込まれる。実行時に変えられないので、APIのURLが変わったらビルドし直す（`deploy.sh`は毎回ビルドする）。未設定なら`MissingApiBaseUrl`のエラー表示を出す。

```tsx
useEffect(() => {
  let ignore = false;
  fetchHealth(baseUrl)
    .then((result) => { if (!ignore) setState({ kind: "success", result }); })
    .catch((error: unknown) => { ... if (!ignore) setState({ kind: "error", httpStatus }); });
  return () => { ignore = true; };
}, [baseUrl]);
```
- ページを開いたときに1回`/health`を呼ぶ。
- `ignore`フラグ：Reactの公式が勧めるパターン。結果が返る前にコンポーネントが消えたり作り直されたりしたら（開発モードのStrictModeでは`useEffect`が2回走る）、古いリクエストの結果で状態を上書きしない。

表示は状態ごとにDADSのコンポーネントを使い分けています。

| 状態 | 表示 | 補足 |
|---|---|---|
| loading | `ProgressIndicator`（スピナー＋「読み込み中」） | 自動で始まる読み込みなので、スクリーンリーダーへの通知はしない（DADSの公式の説明に従う。コメントにリンクあり） |
| error | `NotificationBanner`（type="error"）を`role="alert"`で囲む | `role="alert"`で、スクリーンリーダーがエラーを読み上げる |
| success | `Dl`/`Dt`/`Dd`（説明リスト）で status / db / HTTPステータス | 503でも、ここに`db: false`として出る |

### 5.6 `components/dads/` と `globals.css`

- DADSの公式React版スニペット（`design-system-example-components-react` v2.7.0）から、使う4つ（Heading、Dl、NotificationBanner、ProgressIndicator）をディレクトリごとコピーしている。ゼロから自作しない方針（`.claude/rules/dads.md`）。
- 各ファイルの先頭に出典を書き、MIT Licenseの全文を`LICENSE`に置いている。
- このリポジトリのlintに通すため、または使わない部分を除くために変えた箇所には、その場所に`// moodLog での変更: ...`とコメントがある（例：`forwardRef`のコンポーネントに`displayName`を付けた）。
- `globals.css`：

  ```css
  @import "tailwindcss";
  @import "@digital-go-jp/tailwind-theme-plugin/v4";
  @theme { --breakpoint-desktop: 48em; }
  ```
  TailwindとDADSのテーマを読み込む。公式スニペットが使う`desktop:`（768px以上）のブレークポイントは、テーマプラグインのv3版にしか定義がなく、v4版に無いので、同じ値をここで補っている（ADR 0008）。

### 5.7 `scripts/deploy.sh` と `.env.example`

```bash
api_endpoint="$(tf_output api_endpoint)"
...
(cd "${frontend_dir}" && NEXT_PUBLIC_API_BASE_URL="${api_endpoint}" npm run build)
aws s3 sync "${frontend_dir}/out/" "s3://${bucket}/" --delete --only-show-errors
aws cloudfront create-invalidation --distribution-id "${distribution_id}" --paths "/*"
```
1. `terraform output`からAPIのURL・バケット名・ディストリビューションIDを読む。値をスクリプトに直書きしないので、インフラを作り直しても動く。
2. APIのURLを環境変数で渡してビルド（`.env.local`より環境変数が優先される）。
3. `aws s3 sync --delete`：`out/`の中身をS3と同じにする。`out/`に無いファイルはS3からも消す。
4. `create-invalidation --paths "/*"`：CloudFrontのキャッシュを全部消す。消さないと、エッジに残った古いファイルが最大でキャッシュ期間のあいだ配信され続ける。

- `.env.example`：ローカル開発用。`.env.local`にコピーし、本番APIのURLを書く（`.env.local`はコミットしない）。ローカルの`npm run dev`（localhost:3000）から本番APIを呼べるのは、CORSで`localhost:3000`を許可しているから（4.5）。

### 5.8 フロントエンドの機械判定

テストは書かず、`npm run lint`（ESLint、Next.jsの推奨設定）と`npm run typecheck`（`tsc --noEmit`）で判定する（CLAUDE.md）。`tsconfig.json`は`strict: true`。

---

## 6. 用語集

| 用語 | 意味 |
|---|---|
| ADR (Architecture Decision Record) | 「なぜこの技術・構成を選んだか」を記録する文書 |
| walking skeleton | 機能はほぼ無いが、画面→API→DB→デプロイまで全層が細くつながった状態 |
| SQLAlchemy | PythonからDBを操作するためのライブラリ |
| コネクションプール | DB接続を使い捨てずに再利用する仕組み |
| Mangum | AWS LambdaのイベントとFastAPI(ASGI)の形式を相互変換するアダプタ |
| Lambda handler | Lambdaが呼び出す入口の関数。`モジュール名.変数名`で指定する |
| wheel | Pythonのビルド済みパッケージ。OS・CPUごとに別のファイルがある |
| arm64 / Graviton | AWSのARM系CPU。x86_64より安い |
| OIDC | 外部サービス（GitHub）がAWSに「本人確認」するための標準規格。アクセスキーの代わりに使う |
| IAM Role | AWS上の「権限のまとまり」。誰が引き受けられるかを条件で絞れる |
| リソースベースポリシー | 権限を「使う側」ではなく「使われる側」（Lambda、S3バケットなど）に付ける許可。`aws_lambda_permission`やバケットポリシー |
| 混乱した代理（confused deputy） | AWSのサービスが、他人の指示で自分のアカウントのリソースを操作させられてしまう問題。`aws:SourceAccount`などの条件で防ぐ |
| tfstate | Terraformが管理するリソースの「現在の状態」を記録したファイル |
| VPC / サブネット | AWS上の自分専用のネットワークと、その中の区画 |
| プライベートサブネット | インターネットへの出入り口が無いサブネット |
| NATゲートウェイ / VPCエンドポイント | プライベートサブネットから外（インターネット / AWSのAPI）へ出るための経路。どちらも有料なので作っていない |
| セキュリティグループ | AWSリソースの手前に置く通信の許可リスト。`ingress`が入る通信、`egress`が出る通信 |
| SSM Parameter Store | 設定値や秘密情報を保存するAWSのサービス。`SecureString`にすると暗号化して保存する |
| HTTP API | API Gatewayの安価な種類（v2）。REST API（v1）より機能は少ない |
| CORS | ブラウザが、別ドメインへのリクエストを相手の許可がない限りブロックする仕組み |
| スロットリング | 一定時間あたりのリクエスト数の上限。超えると429を返す |
| OAC (Origin Access Control) | CloudFrontが署名付きでS3を読む仕組み。S3を非公開のまま配信できる |
| キャッシュの無効化（invalidation） | CloudFrontのエッジに残っている古いファイルを消す操作 |
| 静的エクスポート | Next.jsをサーバーなしのHTML/JS/CSSとして書き出すこと |
| EventBridge Scheduler | 時刻を指定してAWSのサービスを呼ぶサービス。タイムゾーンを指定できる |
| SQS / DLQ | メッセージを溜めるキュー / 何度も失敗したメッセージの退避先キュー |
| 可視性タイムアウト | SQSで、受け取られたメッセージが他から見えなくなる時間。この間に処理が成功しないと再試行される |
| 冪等（べきとう） | 同じ処理を2回やっても結果が1回と同じ性質。SQSは同じメッセージを2回届けることがあるので必要 |
| Alembic | SQLAlchemy用のDBマイグレーション（テーブル定義の変更履歴）管理ツール |
| Mock (unittest.mock.patch) | テスト時に関数を一時的に差し替える仕組み。差し替え対象は「importした先」のモジュール |
| ruff | Pythonのlinter（コードの書き方を機械的に検査するツール） |
| DADS | デジタル庁デザインシステム。色・文字・コンポーネント・アクセシビリティの基準 |
| デザイントークン | 色や文字サイズなどの値に付けた名前（例：`text-std-16N-170`）。値を直書きせずこれを使う |

---

## 7. 開発の進め方（AIと一緒に作るための仕組み）

ルールの中身はそれぞれのファイルが正なので、ここでは「どこに何があるか」だけ書きます。

| ファイル | 役割 |
|---|---|
| `CLAUDE.md` | Claude Codeへの作業指示（Issue・ブランチ・計画・機械判定・PRのルール） |
| `docs/design-principles.md` | コードの設計原則の正。PRの「設計判断」に、適用した/しなかった原則を書く |
| `.claude/rules/dads.md` | UIのデザインの正。`frontend/`を触るときだけ読み込まれる（先頭の`paths`） |
| `.claude/commands/pr.md` | `/pr <Issue番号>`の手順。機械判定 → 独立レビュー → PR作成 |
| `.claude/agents/design-reviewer.md` | 実装の経緯を知らない立場でレビューするサブエージェント。Issue・差分・ルールだけを根拠にする |
| `.github/pull_request_template.md` | PR本文のテンプレート。「設計判断」と「レビューしてほしいポイント」が中心 |
| `docs/open-considerations.md` | 今はやらない仕組みのメモ。CLAUDE.mdから参照しない（Claudeのコンテキストに入れない） |

流れは「Issue → ブランチ（`feat/<番号>-名前`）→（非自明なら計画をIssueコメントに書いてレビュー・承認）→ 実装と機械判定 → `/pr` → 人がマージ」です。

---

## 8. 現状の進捗

| 状態 | Issue/内容 |
|---|---|
| 完了・AWS上で稼働中 | #7 OIDC・IAMロール / #9 RDS・SSM / #36 VPC / #10 Lambda+API Gateway / #12 S3+CloudFront / #13 週報バッチ（空） / #6 AWS Budgets |
| 完了（コード・ルール） | #3 ADR / #5 monorepo / #8 FastAPI最小構成 / #11 Next.js最小ページ / #46・#47・#49 DADS導入 / #26 AI駆動開発のルール / #34 `/pr`コマンド / #28 ruff |
| 未着手（walking skeletonの残り） | #14 CI/CD / #15 ブランチ保護のstatus checks |
| 未着手（決めること） | #32 週次まとめの生成方法 / #33 OAuthログインの方式 |
| 未着手（改善） | #31 `/health`を`Depends`に / #43 DB接続のタイムアウト / #44 DB用SGをLambdaに絞る / #25 tfstateを東京へ / #16 運用確認・ADR記載 |

**公開URLで動いている**のは、`/health`の結果を表示するページだけ。アプリの機能（気分の記録、週報、ログイン）はまだ何もなく、テーブルも無い。

---

## 9. 既知の注意点・負債リスト（レビュー時に見るべき箇所）

**セキュリティ・権限**

1. **GitHub Actions用ロールの権限が広すぎる**（`infra/oidc.tf`、`AdministratorAccess`）。ADR 0006で一時措置と決めている。#14で絞る。
2. **DB用セキュリティグループがVPC全体から5432番を受け入れる**（`infra/db.tf`）。Lambda用SGだけに絞れる（#44）。
3. **DBのパスワードが平文で見える場所がある**：tfstate（シドニーのS3。東京への移行は #25）と、API用Lambdaの環境変数（コンソールで見える）。SSMは`SecureString`で暗号化しているが、復号の権限がある人は読める。
4. **CORSで`http://localhost:3000`を本番でも許可している**（`infra/api_gateway.tf`）。ログインを入れるときに見直す（#33）。

**動作・運用**

5. **DB接続エラーが握りつぶされ、ログも出ない**（`backend/app/db.py`の`except Exception`）。本番で503の原因を調べにくい。
6. **DB接続のタイムアウトが無い**（`backend/app/db.py`）。経路の設定ミスがLambdaのタイムアウトとして現れ、切り分けにくい（#43）。
7. **`DATABASE_URL`が無くても落ちずにlocalhostへフォールバックする**（`backend/app/config.py`）。
8. **RDSが消しやすい設定のまま**（`infra/db.tf`）。バックアップ1日、最終スナップショットなし、削除保護なし。本番のデータを入れる前に見直す。
9. **Lambdaのzipがビルドのたびに変わり、毎回Lambdaの更新が出る**（`infra/lambda.tf`）。#14で見直す。
10. **デプロイが手作業**。zipのビルドを忘れて`apply`すると古いコードのまま。CI/CDは #14。
11. **本番DBへのマイグレーションの流し方が決まっていない**。RDSはVPCの外から直接つながらない。

**設計**

12. **`/health`が設計原則（`Depends`で注入）に沿っていない**（`backend/app/main.py`）。次のエンドポイントが真似ないよう #31 で直す。テストの`patch`先を間違えると気づけない落とし穴もこれで消える。
13. **テーブル定義が1つもない**。テーブル設計は、ユーザー情報に関わる #33（OAuth）を決めてから。
14. **週報の生成方法（LLMを使うか）が決まっていない**（#32）。週報バッチは今ログを出すだけ。

---

## 10. 次に手を動かすなら

walking skeletonの仕上げとして **#14（CI/CD）→ #15（ブランチ保護）** が自然です。#14では、手作業のデプロイ（4.9）をGitHub Actionsに移し、同時に負債の1（権限）・9（zipのハッシュ）・10（手作業）を解消できます。

その後、アプリの機能に入る前に **#33（OAuth）と #32（週報の生成方法）を決めてADRにする** 必要があります。どちらもテーブル設計とAWSに足すサービスを左右するためです。小さく片付けられる改善（#31、#43、#44）は、機能を作り始める前に済ませておくと、新しいコードが古い書き方を真似ずに済みます。
