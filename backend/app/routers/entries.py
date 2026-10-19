from datetime import datetime
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, status
from pydantic import BaseModel, Field, field_validator
from sqlalchemy.orm import Session

from app.auth import current_user_sub
from app.clock import now
from app.db import get_session
from app.models import NOTE_MAX_LENGTH
from app.services import entries as entries_service

router = APIRouter(prefix="/entries")


class EntryCreate(BaseModel):
    # 1=悪い、2=ふつう、3=良い。user_id や recorded_at は持たない（送られても無視する）
    mood: Literal[1, 2, 3]
    note: str | None = Field(default=None)

    @field_validator("note")
    @classmethod
    def normalize_note(cls, value: str | None) -> str | None:
        # 前後の空白を除く → 空なら None → 文字数を判定、の順。
        # len はコードポイントで数える（DB の char_length、画面の Array.from と同じ）
        if value is None:
            return None
        stripped = value.strip()
        if not stripped:
            return None
        if len(stripped) > NOTE_MAX_LENGTH:
            raise ValueError(f"note must be at most {NOTE_MAX_LENGTH} characters")
        return stripped


class EntryResponse(BaseModel):
    id: int
    mood: int
    note: str | None
    recorded_at: datetime


@router.post("", status_code=status.HTTP_201_CREATED)
def create_entry(
    body: EntryCreate,
    session: Annotated[Session, Depends(get_session)],
    sub: Annotated[str, Depends(current_user_sub)],
) -> EntryResponse:
    entry = entries_service.create_entry(session, sub, body.mood, body.note)
    return EntryResponse.model_validate(entry, from_attributes=True)


@router.get("")
def list_entries(
    session: Annotated[Session, Depends(get_session)],
    sub: Annotated[str, Depends(current_user_sub)],
    current_time: Annotated[datetime, Depends(now)],
) -> list[EntryResponse]:
    entries = entries_service.list_recent_entries(session, sub, current_time)
    return [EntryResponse.model_validate(e, from_attributes=True) for e in entries]
