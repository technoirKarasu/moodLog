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

## テスト

```sh
.venv/bin/pytest
```
