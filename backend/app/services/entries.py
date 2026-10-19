from datetime import UTC, datetime, timedelta, timezone

from sqlalchemy.orm import Session

from app.repositories import entries as entries_repo
from app.repositories import users as users_repo
from app.repositories.entries import EntryRow

# 夏時間がないため固定のオフセットで足りる。
# zoneinfo はLambdaにタイムゾーンのデータがある保証がない
JST = timezone(timedelta(hours=9), "Asia/Tokyo")

# 一覧に出す日数（今日を含む）
RECENT_DAYS = 7


def recent_since(now: datetime) -> datetime:
    """直近 RECENT_DAYS 日の起点を UTC で返す。

    起点は、日本時間で RECENT_DAYS - 1 日前の0時。
    """
    today_jst = now.astimezone(JST).replace(
        hour=0, minute=0, second=0, microsecond=0
    )
    return (today_jst - timedelta(days=RECENT_DAYS - 1)).astimezone(UTC)


def create_entry(
    session: Session, cognito_sub: str, mood: int, note: str | None
) -> EntryRow:
    """記録を追加する。初めてのユーザーは users に登録する。

    レスポンスを作る前に commit を終える（get_session の docstring を参照）。
    """
    user_id = users_repo.get_or_create_user_id(session, cognito_sub)
    entry = entries_repo.add_entry(session, user_id, mood, note)
    session.commit()
    return entry


def list_recent_entries(
    session: Session, cognito_sub: str, now: datetime
) -> list[EntryRow]:
    """直近の記録を新しい順に返す。users には登録しない（GET で更新しない）。"""
    user_id = users_repo.find_user_id(session, cognito_sub)
    if user_id is None:
        return []
    return entries_repo.list_entries_since(session, user_id, recent_since(now))
