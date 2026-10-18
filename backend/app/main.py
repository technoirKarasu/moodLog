from fastapi import Depends, FastAPI, Response
from mangum import Mangum

from app.db import check_connection

app = FastAPI()


@app.get("/health")
def health(response: Response, db_ok: bool = Depends(check_connection)) -> dict:
    response.status_code = 200 if db_ok else 503
    return {"status": "ok" if db_ok else "error", "db": db_ok}


handler = Mangum(app)
