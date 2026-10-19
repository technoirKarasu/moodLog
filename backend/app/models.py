"""DBのテーブル定義（ORM）。

マイグレーションの autogenerate にも使う（migrations/env.py）。

ORMのオブジェクトは repository の外に出さない。repository は値（dataclass）を返す。
"""

from datetime import datetime

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    MetaData,
    SmallInteger,
    Text,
    func,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

# 制約の名前を決めておき、autogenerate や downgrade で名前がぶれないようにする
NAMING_CONVENTION = {
    "ix": "ix_%(column_0_label)s",
    "uq": "uq_%(table_name)s_%(column_0_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s",
}

NOTE_MAX_LENGTH = 140


class Base(DeclarativeBase):
    metadata = MetaData(naming_convention=NAMING_CONVENTION)


class User(Base):
    """ADR 0009: メールアドレスなどの個人情報は持たない。"""

    __tablename__ = "users"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    cognito_sub: Mapped[str] = mapped_column(Text, unique=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class Entry(Base):
    __tablename__ = "entries"
    __table_args__ = (
        # 1=悪い、2=ふつう、3=良い
        CheckConstraint("mood BETWEEN 1 AND 3", name="mood_range"),
        # char_length はコードポイントで数える（APIの検証と同じ）
        CheckConstraint(
            f"char_length(note) <= {NOTE_MAX_LENGTH}", name="note_length"
        ),
        # 一覧の取得（ユーザーごとに recorded_at の新しい順）に使う。
        # 外部キーの索引も兼ねる
        Index("ix_entries_user_id_recorded_at", "user_id", "recorded_at"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    user_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("users.id"))
    mood: Mapped[int] = mapped_column(SmallInteger)
    note: Mapped[str | None] = mapped_column(Text)
    recorded_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
