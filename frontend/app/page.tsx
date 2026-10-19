"use client";

import type { User } from "oidc-client-ts";
import { useEffect, useId, useState } from "react";

import { Button } from "@/components/dads/Button";
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
import { fetchMe, MeFetchError, type MeResponse } from "@/lib/api/me";
import { type AuthConfig, authConfig, loadUser, signIn, signOut } from "@/lib/auth";

type State =
  | { kind: "loading" }
  | { kind: "success"; result: HealthResult }
  | { kind: "error"; httpStatus: number | undefined };

type AccountState =
  | { kind: "loading" }
  | { kind: "signedOut" }
  | { kind: "signedIn"; user: User }
  | { kind: "error" };

type MeState =
  | { kind: "loading" }
  | { kind: "success"; me: MeResponse }
  | { kind: "error"; httpStatus: number | undefined };

// ビルド時に埋め込まれる（静的エクスポートのため、実行時には変えられない）
const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL;

export default function Home() {
  return (
    <main className="grid gap-8">
      <Heading size="32">
        <HeadingTitle level="h1">moodLog</HeadingTitle>
      </Heading>
      {apiBaseUrl && authConfig ? (
        <>
          <Account baseUrl={apiBaseUrl} config={authConfig} />
          <HealthStatus baseUrl={apiBaseUrl} />
        </>
      ) : (
        <MissingConfig />
      )}
    </main>
  );
}

function Account({ baseUrl, config }: { baseUrl: string; config: AuthConfig }) {
  const [state, setState] = useState<AccountState>({ kind: "loading" });
  const labelId = useId();

  useEffect(() => {
    let ignore = false;
    // マネージドログインから戻ってきたときは、ここで認可コードをトークンに替える
    loadUser(config)
      .then((user) => {
        if (!ignore) setState(user ? { kind: "signedIn", user } : { kind: "signedOut" });
      })
      .catch(() => {
        if (!ignore) setState({ kind: "error" });
      });
    return () => {
      ignore = true;
    };
  }, [config]);

  if (state.kind === "loading") {
    // ページを開いたときに自動で始まる読み込みのため、通知はしない（HealthStatus と同じ）
    return (
      <ProgressIndicator type="stacked" aria-labelledby={labelId}>
        <ProgressIndicatorSpinner size="lg" />
        <span id={labelId}>ログイン状態を確認中</span>
      </ProgressIndicator>
    );
  }

  if (state.kind === "signedIn") {
    return (
      <div className="grid gap-4">
        <Dl>
          <Dt>メールアドレス</Dt>
          <Dd>{state.user.profile.email ?? "（不明）"}</Dd>
          <MeStatus baseUrl={baseUrl} accessToken={state.user.access_token} />
        </Dl>
        {/* 画面の主な操作ではない機能ボタンのため、重要度を下げてアウトラインにする（DADSのボタン「使い方」） */}
        <Button size="md" variant="outline" onClick={() => void signOut(config)}>
          ログアウト
        </Button>
      </div>
    );
  }

  return (
    <div className="grid gap-4">
      {state.kind === "error" && (
        <div role="alert">
          <NotificationBanner bannerStyle="standard" type="error" title="ログインできませんでした">
            <NotificationBannerBody>
              <p>もう一度ログインしてください。</p>
            </NotificationBannerBody>
          </NotificationBanner>
        </div>
      )}
      <Button size="md" variant="solid-fill" onClick={() => void signIn(config)}>
        ログイン
      </Button>
    </div>
  );
}

// 認証が必要なAPI（/me）をアクセストークン付きで呼べることを示す。Dl の中に置く
function MeStatus({ baseUrl, accessToken }: { baseUrl: string; accessToken: string }) {
  const [state, setState] = useState<MeState>({ kind: "loading" });

  useEffect(() => {
    let ignore = false;
    fetchMe(baseUrl, accessToken)
      .then((me) => {
        if (!ignore) setState({ kind: "success", me });
      })
      .catch((error: unknown) => {
        const httpStatus = error instanceof MeFetchError ? error.httpStatus : undefined;
        if (!ignore) setState({ kind: "error", httpStatus });
      });
    return () => {
      ignore = true;
    };
  }, [baseUrl, accessToken]);

  return (
    <>
      <Dt>ユーザーID（/me）</Dt>
      <Dd>
        {state.kind === "loading" && "読み込み中"}
        {state.kind === "success" && state.me.sub}
        {state.kind === "error" &&
          `取得できませんでした${state.httpStatus !== undefined ? `（HTTPステータス: ${state.httpStatus}）` : ""}`}
      </Dd>
    </>
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

function MissingConfig() {
  return (
    <div role="alert">
      <NotificationBanner
        bannerStyle="standard"
        type="error"
        title="APIまたはログインの接続先が設定されていません"
      >
        <NotificationBannerBody>
          <p>
            frontend/.env.local に NEXT_PUBLIC_API_BASE_URL と NEXT_PUBLIC_COGNITO_ISSUER、
            NEXT_PUBLIC_COGNITO_DOMAIN_URL、NEXT_PUBLIC_COGNITO_CLIENT_ID を設定してください。
          </p>
        </NotificationBannerBody>
      </NotificationBanner>
    </div>
  );
}
