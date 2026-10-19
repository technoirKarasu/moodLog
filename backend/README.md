# backend

FastAPI (Python) によるバックエンド。Mangum で Lambda + API Gateway 上で動かし、マイグレーションは Alembic で管理する。

## セットアップ

Lambdaランタイムに合わせて Python 3.13 を使う。

```sh
python3.13 -m venv .venv
.venv/bin/pip install -r requirements-dev.txt
```

## ローカルDB

```sh
docker compose up -d
```

`DATABASE_URL` 未設定時は `postgresql+psycopg2://moodlog:moodlog@localhost:5432/moodlog` に接続する。

## マイグレーション

```sh
.venv/bin/alembic upgrade head
```

## 起動

```sh
.venv/bin/uvicorn app.main:app --reload
```

`GET /health` にアクセスするとDB接続の成否を含めて返す（成功時200、失敗時503）。

ログインが必要なAPI（`/me`、`/entries`）は、トークンの検証を API Gateway が行うため、ローカルの uvicorn では401になる。

## ディレクトリ

`app/` は `routers`（HTTPの入出力）→ `services`（業務ルール）→ `repositories`（DBアクセス）の層に分ける（`docs/design-principles.md`）。

- `app/models.py`: テーブルの定義（ORM）。`migrations/env.py` の autogenerate にも使う
- `app/routers/`、`app/services/`、`app/repositories/`: 上の層
- `app/auth.py`: ログイン中のユーザー（Cognito の `sub`）を返す依存関数
- `app/clock.py`: 現在時刻を返す依存関数（テストで固定する）
- `app/migrate.py`: 本番DBにマイグレーションを流すLambda（ADR 0011）
- `app/batch/`: 定期処理のLambda
- `migrations/`: Alembic のマイグレーション

## テスト・lint

```sh
.venv/bin/pytest
.venv/bin/ruff check .   # 設定は ruff.toml
```
