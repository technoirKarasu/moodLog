"""本番DBにマイグレーションを流すLambda handler（docs/adr/0011-prod-migration.md）。

手元や CI/CD から `aws lambda invoke` で呼ぶ。
API Gateway や EventBridge からは呼ばれない。

契約:
- 成功したら、適用後のリビジョンを {"revision": "..."} で返す
- 失敗したら、例外をそのまま投げる（invoke のレスポンスに FunctionError が付く）
- 何度呼んでも、head まで適用済みなら何もしない（alembic の upgrade の性質）

ログはここでは出さない。migrations/env.py の fileConfig が既存のロガーを無効にするため。
alembic 自身のログは stderr に出て、CloudWatch Logs に届く。
"""

from pathlib import Path
from typing import Any

from alembic import command
from alembic.config import Config
from alembic.runtime.migration import MigrationContext

from app.db import engine

# リポジトリでは backend/alembic.ini、zip では /var/task/alembic.ini（app/ の1つ上）
ALEMBIC_INI = Path(__file__).resolve().parent.parent / "alembic.ini"


def alembic_config() -> Config:
    return Config(str(ALEMBIC_INI))


def current_revision() -> str | None:
    with engine.connect() as conn:
        return MigrationContext.configure(conn).get_current_revision()


def handler(event: dict[str, Any], context: Any) -> dict[str, str | None]:
    command.upgrade(alembic_config(), "head")
    return {"revision": current_revision()}
