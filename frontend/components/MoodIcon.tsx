// 気分の顔のアイコン。DADSに気分を表すアイコンがないため自作した。
// 意味は横に置く文字のラベルで伝えるため、スクリーンリーダーからは隠す（aria-hidden）。
// 色は currentColor で、周りの文字色に従う

import type { Mood } from "@/lib/mood";

// 口の形（24x24 の座標）。3=良い は笑った口、2=ふつう はまっすぐ、1=悪い はへの字
const mouths: Record<Mood, string> = {
  3: "M8 14.5 Q12 18 16 14.5",
  2: "M8.5 15.5 H15.5",
  1: "M8 16.5 Q12 13 16 16.5",
};

export function MoodIcon({ mood, className }: { mood: Mood; className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      width="24"
      height="24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="12" cy="12" r="10" />
      <circle cx="9" cy="10" r="1" fill="currentColor" stroke="none" />
      <circle cx="15" cy="10" r="1" fill="currentColor" stroke="none" />
      <path d={mouths[mood]} />
    </svg>
  );
}
