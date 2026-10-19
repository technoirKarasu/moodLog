// backend の GET /me を呼ぶAPIクライアント。ログインが必要（API GatewayのJWTオーソライザーが検証する）

export type MeResponse = {
  sub: string;
};

// 通信に失敗したとき（ネットワークエラー、2xx以外、JSONでない応答、/me の形でない応答）に投げる
export class MeFetchError extends Error {
  // 応答が返ってきた場合のHTTPステータス。ネットワークエラーのときは undefined
  readonly httpStatus: number | undefined;

  constructor(message: string, httpStatus?: number) {
    super(message);
    this.name = "MeFetchError";
    this.httpStatus = httpStatus;
  }
}

const isMeResponse = (value: unknown): value is MeResponse => {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return typeof record.sub === "string";
};

export const fetchMe = async (baseUrl: string, accessToken: string): Promise<MeResponse> => {
  let response: Response;
  try {
    response = await fetch(`${baseUrl}/me`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
  } catch {
    // CORSで止められた場合も、ここに来る
    throw new MeFetchError("network error");
  }

  // トークンがない・無効なとき、API Gatewayは401と {"message":"Unauthorized"} を返す
  if (!response.ok) {
    throw new MeFetchError("unexpected status", response.status);
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new MeFetchError("response is not JSON", response.status);
  }

  if (!isMeResponse(body)) {
    throw new MeFetchError("unexpected response shape", response.status);
  }
  return body;
};
