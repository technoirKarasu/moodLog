"use client";

import type { User } from "oidc-client-ts";
import { useCallback, useEffect, useId, useState } from "react";

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
import {
  type AuthConfig,
  authConfig,
  loadUser,
  renewUser,
  signIn,
  signOut,
  watchUser,
} from "@/lib/auth";
import { NOTE_MAX_LENGTH } from "@/lib/mood";

type AccountState =
  | { kind: "loading" }
  | { kind: "signedOut" }
  | { kind: "signedIn"; user: User }
  // リフレッシュトークンも切れて、トークンを取り直せなかった
  | { kind: "expired" }
  | { kind: "error" };

type EntriesState =
  | { kind: "loading" }
  | { kind: "success"; entries: Entry[] }
  | { kind: "error"; httpStatus: number | undefined };

// 登録に失敗したときのメッセージ。入力は画面で先に確かめているが、backend の検証とずれたときに 422 が返る。
// 401 はトークンを取り直して呼び直してから届くため（callWithRenewal）、ほかの失敗と同じに扱う
const submitErrorMessage = (httpStatus: number | undefined): string => {
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
        <Account baseUrl={apiBaseUrl} config={authConfig} />
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
  // Entries の一覧の取得が、描画のたびにやり直されないよう、同じ関数を渡し続ける
  const handleSessionExpired = useCallback(() => setState({ kind: "expired" }), []);

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

  // トークンを取り直したら、ユーザー（アクセストークン）だけを差し替える。
  // signedIn のまま描画する部品は変わらないため、入力の途中の気分とひとことは消えない
  useEffect(
    () =>
      watchUser(config, (change) => {
        setState(change.kind === "renewed" ? { kind: "signedIn", user: change.user } : { kind: "expired" });
      }),
    [config],
  );

  if (state.kind === "loading") {
    // ページを開いたときに自動で始まる読み込みのため、useProgressIndicatorAnnouncer での通知はしない
    // （公式の説明: 暗黙的な操作で始まる読み込みでは通知は不要。https://github.com/digital-go-jp/design-system-example-components-react/blob/68b452e/src/components/ProgressIndicator/ProgressIndicator.stories.tsx#L296）
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
        <Entries
          baseUrl={baseUrl}
          config={config}
          accessToken={state.user.access_token}
          onSessionExpired={handleSessionExpired}
        />
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
        {state.kind === "expired" && (
          <div role="alert">
            <NotificationBanner bannerStyle="standard" type="error" title="ログインの有効期限が切れました">
              <NotificationBannerBody>
                <p>もう一度ログインしてください。</p>
              </NotificationBannerBody>
            </NotificationBanner>
          </div>
        )}
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

type EntriesProps = {
  baseUrl: string;
  config: AuthConfig;
  accessToken: string;
  // トークンを取り直せず、ログインし直しが要るときに呼ぶ
  onSessionExpired: () => void;
};

// 記録の入力欄と、直近7日の一覧。登録に成功したら一覧を取り直す
function Entries({ baseUrl, config, accessToken, onSessionExpired }: EntriesProps) {
  const [state, setState] = useState<EntriesState>({ kind: "loading" });
  // 登録に成功するたびに増やし、一覧を取り直すきっかけにする
  const [version, setVersion] = useState(0);

  // API を呼び、401 ならトークンを取り直して1回だけ呼び直す。
  // - 取り直せない（Cognitoが拒んだ）: ログインし直しを親に知らせる
  // - 取り直しの通信の失敗、呼び直しもまた 401: 例外のまま返し、ふつうのエラーとして出す
  const callWithRenewal = useCallback(
    async <T,>(call: (token: string) => Promise<T>): Promise<T> => {
      try {
        return await call(accessToken);
      } catch (error: unknown) {
        if (!(error instanceof EntriesFetchError && error.httpStatus === 401)) throw error;
        const user = await renewUser(config);
        if (user === null) {
          onSessionExpired();
          throw error;
        }
        // 取り直したトークンは、親にも watchUser で届き、accessToken が差し替わる
        return call(user.access_token);
      }
    },
    [config, accessToken, onSessionExpired],
  );

  useEffect(() => {
    let ignore = false;
    callWithRenewal((token) => fetchEntries(baseUrl, token))
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
  }, [baseUrl, callWithRenewal, version]);

  const handleSubmit = async (input: EntryInput): Promise<SubmitResult> => {
    try {
      await callWithRenewal((token) => createEntry(baseUrl, token, input));
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
                  <p>時間をおいて再読み込みしてください。</p>
                </NotificationBannerBody>
              </NotificationBanner>
            </div>
          )}
        </section>
      </Panel>
    </>
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
