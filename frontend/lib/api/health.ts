// backend の GET /health を呼ぶAPIクライアント

export type HealthResponse = {
  status: string;
  db: boolean;
};

export type HealthResult = {
  httpStatus: number;
  body: HealthResponse;
};

// 通信に失敗したとき（ネットワークエラー、JSONでない応答、/health の形でない応答）に投げる
export class HealthFetchError extends Error {
  // 応答が返ってきた場合のHTTPステータス。ネットワークエラーのときは undefined
  readonly httpStatus: number | undefined;

  constructor(message: string, httpStatus?: number) {
    super(message);
    this.name = "HealthFetchError";
    this.httpStatus = httpStatus;
  }
}

// API Gatewayの流量制限（429）やLambdaのエラー（500）は {"message": ...} を返すため、形を確かめる
const isHealthResponse = (value: unknown): value is HealthResponse => {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return typeof record.status === "string" && typeof record.db === "boolean";
};

// /health はDBに接続できないとき503と {"status":"error","db":false} を返すため、
// 2xx以外でも /health の形なら結果として返す
export const fetchHealth = async (baseUrl: string): Promise<HealthResult> => {
  let response: Response;
  try {
    response = await fetch(`${baseUrl}/health`);
  } catch {
    // CORSで止められた場合も、ここに来る
    throw new HealthFetchError("network error");
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new HealthFetchError("response is not JSON", response.status);
  }

  if (!isHealthResponse(body)) {
    throw new HealthFetchError("unexpected response shape", response.status);
  }
  return { httpStatus: response.status, body };
};
