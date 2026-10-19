from typing import Annotated

from fastapi import Depends, FastAPI, Response
from mangum import Mangum
from pydantic import BaseModel

from app.auth import current_user_sub
from app.db import check_connection
from app.routers import entries

app = FastAPI()
app.include_router(entries.router)


@app.get("/health")
def health(
    response: Response, db_ok: Annotated[bool, Depends(check_connection)]
) -> dict:
    response.status_code = 200 if db_ok else 503
    return {"status": "ok" if db_ok else "error", "db": db_ok}


# CORSのプリフライト。API Gatewayの OPTIONS /{proxy+} ルートから届く
# （infra/api_gateway.tf）。2xxを返すだけでよく、CORSのヘッダーはAPI Gatewayが付ける
@app.options("/{path:path}", status_code=204)
def preflight() -> Response:
    return Response(status_code=204)


class MeResponse(BaseModel):
    sub: str


@app.get("/me")
def me(sub: Annotated[str, Depends(current_user_sub)]) -> MeResponse:
    return MeResponse(sub=sub)


handler = Mangum(app)
