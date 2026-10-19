from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_preflight_returns_204_for_any_path():
    response = client.options("/me")

    assert response.status_code == 204
    assert response.content == b""
