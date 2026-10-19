// 気分の値とラベルの対応。値は backend の entries.mood（1=悪い、2=ふつう、3=良い）と同じ

export type Mood = 1 | 2 | 3;

// 選択肢に並べる順（良い → 悪い）
export const MOODS: readonly { value: Mood; label: string }[] = [
  { value: 3, label: "良い" },
  { value: 2, label: "ふつう" },
  { value: 1, label: "悪い" },
];

export const moodLabel = (mood: Mood): string =>
  MOODS.find((m) => m.value === mood)?.label ?? "";

// 短文の最大文字数。backend の NOTE_MAX_LENGTH と同じ
export const NOTE_MAX_LENGTH = 140;

// backend と同じく、前後の空白を除いてからコードポイントで数える。
// String.length は UTF-16 の単位で数えるため、絵文字などで数がずれる
export const countNoteLength = (note: string): number => Array.from(note.trim()).length;
