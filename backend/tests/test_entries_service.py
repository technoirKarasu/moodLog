from datetime import UTC, datetime

import pytest

from app.repositories.entries import EntryRow
from app.services import entries as entries_service


class FakeSession:
    def __init__(self) -> None:
        self.committed = False

    def commit(self) -> None:
        self.committed = True


@pytest.mark.parametrize(
    ("now", "expected"),
    [
        # 日本時間 2026-10-20 08:59。起点は日本時間 10-14 0:00 = UTC 10-13 15:00
        (
            datetime(2026, 10, 19, 23, 59, tzinfo=UTC),
            datetime(2026, 10, 13, 15, 0, tzinfo=UTC),
        ),
        # 日本時間 2026-10-20 23:59（日付の境目の直前）
        (
            datetime(2026, 10, 20, 14, 59, tzinfo=UTC),
            datetime(2026, 10, 13, 15, 0, tzinfo=UTC),
        ),
        # 日本時間 2026-10-21 0:00（日付の境目）
        (
            datetime(2026, 10, 20, 15, 0, tzinfo=UTC),
            datetime(2026, 10, 14, 15, 0, tzinfo=UTC),
        ),
    ],
)
def test_recent_since_is_midnight_jst_six_days_ago(now, expected):
    assert entries_service.recent_since(now) == expected


def test_create_entry_registers_user_adds_entry_and_commits(monkeypatch):
    session = FakeSession()
    entry = EntryRow(1, 3, "よい日", datetime(2026, 10, 20, tzinfo=UTC))
    calls = []
    monkeypatch.setattr(
        entries_service.users_repo,
        "get_or_create_user_id",
        lambda s, sub: calls.append(("user", sub)) or 42,
    )
    monkeypatch.setattr(
        entries_service.entries_repo,
        "add_entry",
        lambda s, user_id, mood, note: calls.append(("entry", user_id, mood, note))
        or entry,
    )

    result = entries_service.create_entry(session, "sub-1", 3, "よい日")

    assert result == entry
    assert calls == [("user", "sub-1"), ("entry", 42, 3, "よい日")]
    assert session.committed


def test_create_entry_does_not_commit_when_adding_fails(monkeypatch):
    session = FakeSession()
    monkeypatch.setattr(
        entries_service.users_repo, "get_or_create_user_id", lambda s, sub: 42
    )

    def fail(s, user_id, mood, note):
        raise RuntimeError("insert failed")

    monkeypatch.setattr(entries_service.entries_repo, "add_entry", fail)

    with pytest.raises(RuntimeError):
        entries_service.create_entry(session, "sub-1", 3, None)
    assert not session.committed


def test_list_recent_entries_returns_empty_for_unknown_user(monkeypatch):
    monkeypatch.setattr(entries_service.users_repo, "find_user_id", lambda s, sub: None)

    def must_not_be_called(*args):
        raise AssertionError("list_entries_since must not be called")

    monkeypatch.setattr(
        entries_service.entries_repo, "list_entries_since", must_not_be_called
    )

    assert entries_service.list_recent_entries(
        FakeSession(), "sub-1", datetime(2026, 10, 20, tzinfo=UTC)
    ) == []


def test_list_recent_entries_does_not_register_user(monkeypatch):
    def must_not_be_called(*args):
        raise AssertionError("get_or_create_user_id must not be called")

    monkeypatch.setattr(
        entries_service.users_repo, "get_or_create_user_id", must_not_be_called
    )
    monkeypatch.setattr(entries_service.users_repo, "find_user_id", lambda s, sub: 42)
    received = []
    monkeypatch.setattr(
        entries_service.entries_repo,
        "list_entries_since",
        lambda s, user_id, since: received.append((user_id, since)) or [],
    )

    entries_service.list_recent_entries(
        FakeSession(), "sub-1", datetime(2026, 10, 20, 15, 0, tzinfo=UTC)
    )

    assert received == [(42, datetime(2026, 10, 14, 15, 0, tzinfo=UTC))]
