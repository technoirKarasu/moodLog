// 直近の記録を、日本時間の日ごとにまとめて新しい順に並べる

import { Heading, HeadingTitle } from "@/components/dads/Heading";
import { MoodIcon } from "@/components/MoodIcon";
import type { Entry } from "@/lib/api/entries";
import { moodLabel } from "@/lib/mood";

// 日付のまとめに使うキー（YYYY-MM-DD）
const dayKeyFormat = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Tokyo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const dayLabelFormat = new Intl.DateTimeFormat("ja-JP", {
  timeZone: "Asia/Tokyo",
  month: "long",
  day: "numeric",
  weekday: "short",
});
const timeFormat = new Intl.DateTimeFormat("ja-JP", {
  timeZone: "Asia/Tokyo",
  hour: "2-digit",
  minute: "2-digit",
});

type Day = { key: string; label: string; entries: Entry[] };

// entries は API から新しい順で届く。その順のまま日ごとにまとめる
const groupByDay = (entries: Entry[]): Day[] => {
  const days: Day[] = [];
  for (const entry of entries) {
    const date = new Date(entry.recorded_at);
    const key = dayKeyFormat.format(date);
    const last = days.at(-1);
    if (last?.key === key) {
      last.entries.push(entry);
    } else {
      days.push({ key, label: dayLabelFormat.format(date), entries: [entry] });
    }
  }
  return days;
};

export function EntryList({ entries }: { entries: Entry[] }) {
  if (entries.length === 0) {
    return <p>この7日間の記録はまだありません。</p>;
  }

  return (
    <div className="grid gap-6">
      {groupByDay(entries).map((day) => (
        <section key={day.key} className="grid gap-2">
          <Heading size="18">
            <HeadingTitle level="h3">{day.label}</HeadingTitle>
          </Heading>
          <ul className="grid gap-2">
            {day.entries.map((entry) => (
              <li key={entry.id} className="flex flex-wrap items-start gap-x-4 gap-y-1">
                <time dateTime={entry.recorded_at}>
                  {timeFormat.format(new Date(entry.recorded_at))}
                </time>
                <span className="inline-flex items-center gap-1">
                  <MoodIcon mood={entry.mood} />
                  {moodLabel(entry.mood)}
                </span>
                {entry.note !== null && <span className="break-all">{entry.note}</span>}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
