from fastapi import HTTPException, Request, status


def current_user_sub(request: Request) -> str:
    """ログインしているユーザーの Cognito の sub を返す。

    トークンの検証は API Gateway の JWT オーソライザーが済ませている（ADR 0009）。
    検証済みのクレームは、Mangum が scope["aws.event"] に渡す
    API Gateway のイベントに入っている。
    イベントがない（ローカルの uvicorn など）、またはクレームがない場合は401を返す。
    """
    event = request.scope.get("aws.event") or {}
    claims = (
        event.get("requestContext", {})
        .get("authorizer", {})
        .get("jwt", {})
        .get("claims", {})
    )
    sub = claims.get("sub")
    if not sub:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED)
    return sub
