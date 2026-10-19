// backend の /entries（記録の登録と、直近7日分の取得）を呼ぶAPIクライアント。ログインが必要

import type { Mood } from "@/lib/mood";

export type Entry = {
  id: number;
  mood: Mood;
  note: string | null;
  // UTC の ISO 8601
  recorded_at: string;
};

export type EntryInput = {
  mood: Mood;
  note: string | null;
};

// 通信に失敗したとき（ネットワークエラー、2xx以外、JSONでない応答、想定と違う形の応答）に投げる
export class EntriesFetchError extends Error {
  // 応答が返ってきた場合のHTTPステータス。ネットワークエラーのときは undefined。
  // 401 はトークンがない・期限切れ、422 は入力の誤り
  readonly httpStatus: number | undefined;

  constructor(message: string, httpStatus?: number) {
    super(message);
    this.name = "EntriesFetchError";
    this.httpStatus = httpStatus;
  }
}

const isEntry = (value: unknown): value is Entry => {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.id === "number" &&
    (record.mood === 1 || record.mood === 2 || record.mood === 3) &&
    (typeof record.note === "string" || record.note === null) &&
    typeof record.recorded_at === "string"
  );
};

const requestJson = async (
  url: string,
  accessToken: string,
  init: RequestInit = {},
): Promise<unknown> => {
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      headers: { ...init.headers, Authorization: `Bearer ${accessToken}` },
    });
  } catch {
    // CORSで止められた場合も、ここに来る
    throw new EntriesFetchError("network error");
  }

  if (!response.ok) {
    throw new EntriesFetchError("unexpected status", response.status);
  }

  try {
    return await response.json();
  } catch {
    throw new EntriesFetchError("response is not JSON", response.status);
  }
};

export const fetchEntries = async (baseUrl: string, accessToken: string): Promise<Entry[]> => {
  const body = await requestJson(`${baseUrl}/entries`, accessToken);
  if (!Array.isArray(body) || !body.every(isEntry)) {
    throw new EntriesFetchError("unexpected response shape");
  }
  return body;
};

export const createEntry = async (
  baseUrl: string,
  accessToken: string,
  input: EntryInput,
): Promise<Entry> => {
  const body = await requestJson(`${baseUrl}/entries`, accessToken, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!isEntry(body)) {
    throw new EntriesFetchError("unexpected response shape");
  }
  return body;
};
