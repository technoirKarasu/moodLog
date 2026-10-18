from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient

from app.db import check_connection
from app.main import app

client = TestClient(app)


@pytest.fixture
def clear_overrides() -> Iterator[None]:
    yield
    app.dependency_overrides.clear()


def test_health_returns_200_when_db_is_reachable(clear_overrides):
    app.dependency_overrides[check_connection] = lambda: True

    response = client.get("/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok", "db": True}


def test_health_returns_503_when_db_is_unreachable(clear_overrides):
    app.dependency_overrides[check_connection] = lambda: False

    response = client.get("/health")

    assert response.status_code == 503
    assert response.json() == {"status": "error", "db": False}
