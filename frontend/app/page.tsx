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
import { EntryForm, type SubmitResult } from "@/components/EntryForm";
import { EntryList } from "@/components/EntryList";
import { Panel } from "@/components/Panel";
import {
  createEntry,
  type Entry,
  type EntryInput,
  EntriesFetchError,
  fetchEntries,
} from "@/lib/api/entries";
import { fetchHealth, HealthFetchError, type HealthResult } from "@/lib/api/health";
import { type AuthConfig, authConfig, loadUser, signIn, signOut } from "@/lib/auth";
import { NOTE_MAX_LENGTH } from "@/lib/mood";

type State =
  | { kind: "loading" }
  | { kind: "success"; result: HealthResult }
  | { kind: "error"; httpStatus: number | undefined };

type AccountState =
  | { kind: "loading" }
  | { kind: "signedOut" }
  | { kind: "signedIn"; user: User }
  | { kind: "error" };

type EntriesState =
  | { kind: "loading" }
  | { kind: "success"; entries: Entry[] }
  | { kind: "error"; httpStatus: number | undefined };

// トークンの期限切れ（API Gatewayが401を返す）のとき、ログインし直してもらう
const SESSION_EXPIRED_MESSAGE = "ログインの有効期限が切れました。ログアウトしてから、ログインし直してください。";

// 登録に失敗したときのメッセージ。入力は画面で先に確かめているが、backend の検証とずれたときに 422 が返る
const submitErrorMessage = (httpStatus: number | undefined): string => {
  if (httpStatus === 401) return SESSION_EXPIRED_MESSAGE;
  if (httpStatus === 422) return `入力内容を確かめてください。気分を選び、ひとことは${NOTE_MAX_LENGTH}文字以内にしてください。`;
  return "記録できませんでした。時間をおいてもう一度お試しください。";
};


// ビルド時に埋め込まれる（静的エクスポートのため、実行時には変えられない）
const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL;

export default function Home() {
  return (
    <main className="grid gap-8">
      <Heading size="32">
        <HeadingTitle level="h1" className="text-key-900">
          moodLog
        </HeadingTitle>
      </Heading>
      {apiBaseUrl && authConfig ? (
        <>
          <Account baseUrl={apiBaseUrl} config={authConfig} />
          <Panel>
            <HealthStatus baseUrl={apiBaseUrl} />
          </Panel>
        </>
      ) : (
        <Panel>
          <MissingConfig />
        </Panel>
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
      <div className="grid gap-8">
        <Dl>
          <Dt>メールアドレス</Dt>
          <Dd>{state.user.profile.email ?? "（不明）"}</Dd>
        </Dl>
        <Entries baseUrl={baseUrl} accessToken={state.user.access_token} />
        {/* 画面の主な操作ではない機能ボタンのため、重要度を下げてアウトラインにする（DADSのボタン「使い方」） */}
        <Button size="md" variant="outline" onClick={() => void signOut(config)}>
          ログアウト
        </Button>
      </div>
    );
  }

  // ログインの失敗（赤い文字）を出すため、白い面の中に置く
  return (
    <Panel>
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
    </Panel>
  );
}

// 記録の入力欄と、直近7日の一覧。登録に成功したら一覧を取り直す
function Entries({ baseUrl, accessToken }: { baseUrl: string; accessToken: string }) {
  const [state, setState] = useState<EntriesState>({ kind: "loading" });
  // 登録に成功するたびに増やし、一覧を取り直すきっかけにする
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let ignore = false;
    fetchEntries(baseUrl, accessToken)
      .then((entries) => {
        if (!ignore) setState({ kind: "success", entries });
      })
      .catch((error: unknown) => {
        const httpStatus = error instanceof EntriesFetchError ? error.httpStatus : undefined;
        if (!ignore) setState({ kind: "error", httpStatus });
      });
    return () => {
      ignore = true;
    };
  }, [baseUrl, accessToken, version]);

  const handleSubmit = async (input: EntryInput): Promise<SubmitResult> => {
    try {
      await createEntry(baseUrl, accessToken, input);
    } catch (error: unknown) {
      const httpStatus = error instanceof EntriesFetchError ? error.httpStatus : undefined;
      return { ok: false, message: submitErrorMessage(httpStatus) };
    }
    setVersion((v) => v + 1);
    return { ok: true };
  };

  return (
    <>
      <Panel>
        <section className="grid gap-4">
          <Heading size="24">
            <HeadingTitle level="h2">記録する</HeadingTitle>
          </Heading>
          <EntryForm onSubmit={handleSubmit} />
        </section>
      </Panel>
      <Panel>
        <section className="grid gap-4">
          <Heading size="24">
            <HeadingTitle level="h2">この7日間の記録</HeadingTitle>
          </Heading>
          {state.kind === "loading" && <p>読み込み中</p>}
          {state.kind === "success" && <EntryList entries={state.entries} />}
          {state.kind === "error" && (
            <div role="alert">
              <NotificationBanner bannerStyle="standard" type="error" title="記録を読み込めませんでした">
                <NotificationBannerBody>
                  <p>
                    {state.httpStatus === 401
                      ? SESSION_EXPIRED_MESSAGE
                      : "時間をおいて再読み込みしてください。"}
                  </p>
                </NotificationBannerBody>
              </NotificationBanner>
            </div>
          )}
        </section>
      </Panel>
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
