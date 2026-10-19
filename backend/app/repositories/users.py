from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.models import User


def get_or_create_user_id(session: Session, cognito_sub: str) -> int:
    """cognito_sub のユーザーの ID を返す。いなければ作る。

    同時に呼ばれても重複しないよう、一意制約に任せて ON CONFLICT DO NOTHING で入れる。
    入らなかった（他のリクエストが先に入れた）ときは SELECT で引く。PostgreSQL の既定の
    READ COMMITTED では、この SELECT は相手が commit した行を見られる。
    """
    inserted = session.execute(
        insert(User)
        .values(cognito_sub=cognito_sub)
        .on_conflict_do_nothing(index_elements=[User.cognito_sub])
        .returning(User.id)
    ).scalar_one_or_none()
    if inserted is not None:
        return inserted
    return session.execute(
        select(User.id).where(User.cognito_sub == cognito_sub)
    ).scalar_one()


def find_user_id(session: Session, cognito_sub: str) -> int | None:
    return session.execute(
        select(User.id).where(User.cognito_sub == cognito_sub)
    ).scalar_one_or_none()
