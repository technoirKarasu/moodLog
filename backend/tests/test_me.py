import json

from fastapi.testclient import TestClient

from app.main import app, handler

client = TestClient(app)


def _api_gateway_event(authorizer: dict | None) -> dict:
    # API Gateway（HTTP API、ペイロード形式 2.0）が Lambda に渡すイベントのうち、
    # Mangum が使う部分
    request_context = {
        "http": {
            "method": "GET",
            "path": "/me",
            "protocol": "HTTP/1.1",
            "sourceIp": "192.0.2.1",
        },
        "stage": "$default",
    }
    if authorizer is not None:
        request_context["authorizer"] = authorizer
    return {
        "version": "2.0",
        "routeKey": "$default",
        "rawPath": "/me",
        "rawQueryString": "",
        "headers": {"host": "example.com"},
        "requestContext": request_context,
        "isBase64Encoded": False,
    }


def test_me_returns_sub_from_jwt_claims():
    event = _api_gateway_event({"jwt": {"claims": {"sub": "user-123"}, "scopes": None}})

    response = handler(event, None)

    assert response["statusCode"] == 200
    assert json.loads(response["body"]) == {"sub": "user-123"}


def test_me_returns_401_when_event_has_no_authorizer():
    response = handler(_api_gateway_event(None), None)

    assert response["statusCode"] == 401


def test_me_returns_401_without_api_gateway_event():
    # ローカルの uvicorn と同じく、scope に aws.event がない
    response = client.get("/me")

    assert response.status_code == 401
