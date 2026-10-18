"use client";

import { useEffect, useId, useState } from "react";

import { Dd, Dl, Dt } from "@/components/dads/Dl";
import { Heading, HeadingTitle } from "@/components/dads/Heading";
import {
  NotificationBanner,
  NotificationBannerBody,
} from "@/components/dads/NotificationBanner";
import {
  ProgressIndicator,
  ProgressIndicatorSpinner,
} from "@/components/dads/ProgressIndicator";
import { fetchHealth, HealthFetchError, type HealthResult } from "@/lib/api/health";

type State =
  | { kind: "loading" }
  | { kind: "success"; result: HealthResult }
  | { kind: "error"; httpStatus: number | undefined };

// ビルド時に埋め込まれる（静的エクスポートのため、実行時には変えられない）
const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL;

export default function Home() {
  return (
    <main className="grid gap-8">
      <Heading size="32">
        <HeadingTitle level="h1">moodLog</HeadingTitle>
      </Heading>
      {apiBaseUrl ? <HealthStatus baseUrl={apiBaseUrl} /> : <MissingApiBaseUrl />}
    </main>
  );
}

function HealthStatus({ baseUrl }: { baseUrl: string }) {
  const [state, setState] = useState<State>({ kind: "loading" });
  const labelId = useId();

  useEffect(() => {
    let ignore = false;
    fetchHealth(baseUrl)
      .then((result) => {
        if (!ignore) setState({ kind: "success", result });
      })
      .catch((error: unknown) => {
        const httpStatus = error instanceof HealthFetchError ? error.httpStatus : undefined;
        if (!ignore) setState({ kind: "error", httpStatus });
      });
    return () => {
      ignore = true;
    };
  }, [baseUrl]);

  if (state.kind === "loading") {
    // ページを開いたときに自動で始まる読み込みのため、useProgressIndicatorAnnouncer での通知はしない
    // （公式の説明: 暗黙的な操作で始まる読み込みでは通知は不要。https://github.com/digital-go-jp/design-system-example-components-react/blob/68b452e/src/components/ProgressIndicator/ProgressIndicator.stories.tsx#L296）
    return (
      <ProgressIndicator type="stacked" aria-labelledby={labelId}>
        <ProgressIndicatorSpinner size="lg" />
        <span id={labelId}>読み込み中</span>
      </ProgressIndicator>
    );
  }

  if (state.kind === "error") {
    return (
      <div role="alert">
        <NotificationBanner bannerStyle="standard" type="error" title="APIに接続できませんでした">
          <NotificationBannerBody>
            <p>時間をおいて再読み込みしてください。</p>
            {state.httpStatus !== undefined && <p>HTTPステータス: {state.httpStatus}</p>}
          </NotificationBannerBody>
        </NotificationBanner>
      </div>
    );
  }

  const { httpStatus, body } = state.result;
  return (
    <Dl>
      <Dt>status</Dt>
      <Dd>{body.status}</Dd>
      <Dt>db</Dt>
      <Dd>{String(body.db)}</Dd>
      <Dt>HTTPステータス</Dt>
      <Dd>{httpStatus}</Dd>
    </Dl>
  );
}

function MissingApiBaseUrl() {
  return (
    <div role="alert">
      <NotificationBanner
        bannerStyle="standard"
        type="error"
        title="APIの接続先が設定されていません"
      >
        <NotificationBannerBody>
          <p>
            frontend/.env.local に NEXT_PUBLIC_API_BASE_URL を設定してください。
          </p>
        </NotificationBannerBody>
      </NotificationBanner>
    </div>
  );
}
