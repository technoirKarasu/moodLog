from unittest.mock import patch

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_health_returns_200_when_db_is_reachable():
    with patch("app.main.check_connection", return_value=True):
        response = client.get("/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok", "db": True}


def test_health_returns_503_when_db_is_unreachable():
    with patch("app.main.check_connection", return_value=False):
        response = client.get("/health")

    assert response.status_code == 503
    assert response.json() == {"status": "error", "db": False}
