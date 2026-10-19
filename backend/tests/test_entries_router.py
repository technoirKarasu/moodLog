from collections.abc import Iterator
from datetime import UTC, datetime

import pytest
from fastapi.testclient import TestClient

from app.auth import current_user_sub
from app.clock import now
from app.db import get_session
from app.main import app
from app.repositories.entries import EntryRow
from app.routers import entries as entries_router

client = TestClient(app)

FIXED_NOW = datetime(2026, 10, 20, 3, 0, tzinfo=UTC)
FAKE_SESSION = object()


@pytest.fixture
def overrides() -> Iterator[None]:
    app.dependency_overrides[get_session] = lambda: FAKE_SESSION
    app.dependency_overrides[now] = lambda: FIXED_NOW
    app.dependency_overrides[current_user_sub] = lambda: "sub-from-token"
    yield
    app.dependency_overrides.clear()


@pytest.fixture
def created(monkeypatch) -> list[tuple]:
    calls: list[tuple] = []

    def fake_create_entry(session, sub, mood, note):
        calls.append((session, sub, mood, note))
        return EntryRow(1, mood, note, FIXED_NOW)

    monkeypatch.setattr(
        entries_router.entries_service, "create_entry", fake_create_entry
    )
    return calls


def test_post_entries_returns_201_and_created_entry(overrides, created):
    response = client.post("/entries", json={"mood": 3, "note": "よい日"})

    assert response.status_code == 201
    assert response.json() == {
        "id": 1,
        "mood": 3,
        "note": "よい日",
        "recorded_at": "2026-10-20T03:00:00Z",
    }


def test_post_entries_uses_sub_from_token_and_ignores_extra_fields(overrides, created):
    response = client.post(
        "/entries",
        json={
            "mood": 2,
            "user_id": 999,
            "recorded_at": "2000-01-01T00:00:00Z",
        },
    )

    assert response.status_code == 201
    assert created == [(FAKE_SESSION, "sub-from-token", 2, None)]


@pytest.mark.parametrize("body", [{}, {"mood": 0}, {"mood": 4}, {"mood": "3"}])
def test_post_entries_rejects_invalid_mood(overrides, created, body):
    response = client.post("/entries", json=body)

    assert response.status_code == 422
    assert created == []


@pytest.mark.parametrize(
    ("note", "status_code"),
    [
        ("あ" * 140, 201),
        ("あ" * 141, 422),
        # BMP外の文字（UTF-16では2単位）もコードポイントで1文字と数える
        ("😀" * 140, 201),
        ("😀" * 141, 422),
        # 前後の空白を除いてから数える
        ("  " + "あ" * 140 + "\n", 201),
    ],
)
def test_post_entries_limits_note_length(overrides, created, note, status_code):
    response = client.post("/entries", json={"mood": 2, "note": note})

    assert response.status_code == status_code


@pytest.mark.parametrize(("note", "expected"), [("  よい日 ", "よい日"), ("   ", None)])
def test_post_entries_strips_note(overrides, created, note, expected):
    client.post("/entries", json={"mood": 2, "note": note})

    assert created[0][3] == expected


def test_get_entries_returns_recent_entries(overrides, monkeypatch):
    received = []
    rows = [
        EntryRow(2, 1, None, datetime(2026, 10, 20, 2, 0, tzinfo=UTC)),
        EntryRow(1, 3, "よい日", datetime(2026, 10, 19, 2, 0, tzinfo=UTC)),
    ]

    def fake_list(session, sub, current_time):
        received.append((session, sub, current_time))
        return rows

    monkeypatch.setattr(
        entries_router.entries_service, "list_recent_entries", fake_list
    )

    response = client.get("/entries")

    assert response.status_code == 200
    assert response.json() == [
        {"id": 2, "mood": 1, "note": None, "recorded_at": "2026-10-20T02:00:00Z"},
        {"id": 1, "mood": 3, "note": "よい日", "recorded_at": "2026-10-19T02:00:00Z"},
    ]
    assert received == [(FAKE_SESSION, "sub-from-token", FIXED_NOW)]


@pytest.mark.parametrize("method", ["GET", "POST"])
def test_entries_return_401_without_login(method):
    # current_user_sub は差し替えない（API Gatewayのイベントがないので401）
    app.dependency_overrides[get_session] = lambda: FAKE_SESSION
    try:
        response = client.request(method, "/entries", json={"mood": 2})
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 401
