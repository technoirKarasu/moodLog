from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import insert, select
from sqlalchemy.orm import Session

from app.models import Entry


@dataclass(frozen=True)
class EntryRow:
    id: int
    mood: int
    note: str | None
    recorded_at: datetime


_COLUMNS = (Entry.id, Entry.mood, Entry.note, Entry.recorded_at)


def add_entry(session: Session, user_id: int, mood: int, note: str | None) -> EntryRow:
    # recorded_at は DB が付けるため、RETURNING で受け取る
    row = session.execute(
        insert(Entry)
        .values(user_id=user_id, mood=mood, note=note)
        .returning(*_COLUMNS)
    ).one()
    return EntryRow(*row)


def list_entries_since(
    session: Session, user_id: int, since: datetime
) -> list[EntryRow]:
    """user_id の記録のうち、since 以降のものを新しい順に返す。"""
    rows = session.execute(
        select(*_COLUMNS)
        .where(Entry.user_id == user_id, Entry.recorded_at >= since)
        .order_by(Entry.recorded_at.desc(), Entry.id.desc())
    ).all()
    return [EntryRow(*row) for row in rows]
