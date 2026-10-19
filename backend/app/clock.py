from datetime import UTC, datetime


def now() -> datetime:
    """現在時刻を UTC の aware な datetime で返す。

    テストでは Depends を差し替えて固定する。
    """
    return datetime.now(UTC)
