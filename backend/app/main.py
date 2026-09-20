from fastapi import FastAPI, Response
from mangum import Mangum

from app.db import check_connection

app = FastAPI()


@app.get("/health")
def health(response: Response) -> dict:
    db_ok = check_connection()
    response.status_code = 200 if db_ok else 503
    return {"status": "ok" if db_ok else "error", "db": db_ok}


handler = Mangum(app)
