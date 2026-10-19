from collections.abc import Iterator

from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session, sessionmaker

from app.config import DATABASE_URL

engine = create_engine(DATABASE_URL, pool_pre_ping=True)


def check_connection() -> bool:
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        return True
    except Exception:
        return False


# Lambdaは1つの実行環境で同時に1リクエストしか処理しないため、
# 上のエンジンの接続を使い回せば足りる
SessionLocal = sessionmaker(bind=engine)


def get_session() -> Iterator[Session]:
    """リクエストごとのセッション。commit はしない（service が行う）。

    yield の後の処理はレスポンスを返した後に走るため、ここで commit すると、
    失敗しても成功のレスポンスが返ってしまう。ここでは後片付けだけを行う。
    """
    session = SessionLocal()
    try:
        yield session
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()
