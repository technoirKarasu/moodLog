"use client";

// 気分と短文を入力して記録する欄。API の呼び出しは onSubmit で親から受け取る（表示とデータ取得を分ける）

import { type FormEvent, useId, useState } from "react";

import { Button } from "@/components/dads/Button";
import { ErrorText } from "@/components/dads/ErrorText";
import { Label } from "@/components/dads/Label";
import { Legend } from "@/components/dads/Legend";
import { Radio } from "@/components/dads/Radio";
import { RequirementBadge } from "@/components/dads/RequirementBadge";
import { SupportText } from "@/components/dads/SupportText";
import { Textarea } from "@/components/dads/Textarea";
import { MoodIcon } from "@/components/MoodIcon";
import { countNoteLength, type Mood, MOODS, NOTE_MAX_LENGTH } from "@/lib/mood";

// 登録の結果。失敗したときは画面に出すメッセージを返す
export type SubmitResult = { ok: true } | { ok: false; message: string };

type Props = {
  onSubmit: (input: { mood: Mood; note: string | null }) => Promise<SubmitResult>;
};

export function EntryForm({ onSubmit }: Props) {
  const [mood, setMood] = useState<Mood | null>(null);
  const [note, setNote] = useState("");
  // 送信を試みた後だけ、気分の未選択をエラーとして出す
  const [triedSubmit, setTriedSubmit] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const moodErrorId = useId();
  const noteId = useId();
  const noteCounterId = useId();
  const noteErrorId = useId();

  const noteLength = countNoteLength(note);
  const noteTooLong = noteLength > NOTE_MAX_LENGTH;
  const moodMissing = triedSubmit && mood === null;

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    // 送信中の二重送信を防ぐ。DADSに従い、ボタンは disabled にしない
    if (submitting) return;
    setTriedSubmit(true);
    setSaved(false);
    setSubmitError(null);
    if (mood === null || noteTooLong) return;

    setSubmitting(true);
    const trimmed = note.trim();
    const result = await onSubmit({ mood, note: trimmed === "" ? null : trimmed });
    setSubmitting(false);

    if (result.ok) {
      setMood(null);
      setNote("");
      setTriedSubmit(false);
      setSaved(true);
    } else {
      setSubmitError(result.message);
    }
  };

  return (
    <form className="grid gap-6" onSubmit={handleSubmit} noValidate>
      <fieldset>
        <Legend>
          今の気分<RequirementBadge>※必須</RequirementBadge>
        </Legend>
        <div className="mt-1 flex flex-wrap gap-x-6">
          {MOODS.map((option) => (
            <Radio
              key={option.value}
              name="mood"
              value={option.value}
              checked={mood === option.value}
              onChange={() => setMood(option.value)}
              isError={moodMissing}
              aria-describedby={moodMissing ? moodErrorId : undefined}
            >
              <span className="inline-flex items-center gap-1">
                <MoodIcon mood={option.value} />
                {option.label}
              </span>
            </Radio>
          ))}
        </div>
        {moodMissing && (
          <ErrorText className="mt-2" id={moodErrorId}>
            ＊気分を選んでください。
          </ErrorText>
        )}
      </fieldset>

      <div className="flex flex-col items-start gap-2">
        <Label htmlFor={noteId}>
          ひとこと（{NOTE_MAX_LENGTH}文字以内）<RequirementBadge isOptional>任意</RequirementBadge>
        </Label>
        <Textarea
          id={noteId}
          className="w-full"
          rows={3}
          value={note}
          onChange={(event) => setNote(event.target.value)}
          isError={noteTooLong}
          aria-describedby={noteTooLong ? `${noteErrorId} ${noteCounterId}` : noteCounterId}
        />
        {/* 文字数の上限を超えても入力は止めない（maxLength は UTF-16 で数え、絵文字で数がずれるため使わない） */}
        <SupportText id={noteCounterId}>
          {noteLength}/{NOTE_MAX_LENGTH}文字
        </SupportText>
        {noteTooLong && (
          <ErrorText id={noteErrorId}>
            ＊入力できる文字数を超えています。（入力文字数{noteLength}文字）
          </ErrorText>
        )}
      </div>

      <div className="grid justify-items-start gap-2">
        <Button type="submit" size="md" variant="solid-fill">
          記録する
        </Button>
        {submitError !== null && <ErrorText role="alert">＊{submitError}</ErrorText>}
        {/* 成功を、スクリーンリーダーにも伝える */}
        <p role="status">{saved && "記録しました。"}</p>
      </div>
    </form>
  );
}
