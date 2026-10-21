// Cognitoのマネージドログインでのログイン・ログアウト（docs/adr/0009-auth.md、docs/adr/0010-token-storage.md）
//
// 認可コードフロー＋PKCEでトークンを受け取る。トークンは oidc-client-ts の既定どおり sessionStorage に持つ。
// コールバックはトップページ（/）で受ける。静的エクスポートでは /callback が callback.html になり、
// CloudFrontから引けないため。
//
// アクセストークン（1時間）は、リフレッシュトークン（Cognitoの既定で30日）で取り直す（Issue #72）。
// - 期限の前: automaticSilentRenew が自動で取り直す
// - 再読み込みで期限が切れていたとき、APIが401を返したとき: renewUser で取り直す
// Cognitoが取り直しを拒んだ（リフレッシュトークンの期限切れなど）ときだけログインし直しにする。
// 通信の一時的な失敗では、ログインしたままにする（入力の途中のひとことを消さないため）

import { ErrorResponse, type User, UserManager } from "oidc-client-ts";

export type AuthConfig = {
  // CognitoのトークンのIssuer（https://cognito-idp.<リージョン>.amazonaws.com/<ユーザープールID>）。
  // OIDCのディスカバリー文書はここにある
  issuer: string;
  // マネージドログインのURL。ログアウトに使う
  domainUrl: string;
  clientId: string;
};

// ビルド時に埋め込まれる（静的エクスポートのため、実行時には変えられない）
const issuer = process.env.NEXT_PUBLIC_COGNITO_ISSUER;
const domainUrl = process.env.NEXT_PUBLIC_COGNITO_DOMAIN_URL;
const clientId = process.env.NEXT_PUBLIC_COGNITO_CLIENT_ID;

export const authConfig: AuthConfig | undefined =
  issuer && domainUrl && clientId ? { issuer, domainUrl, clientId } : undefined;

// 戻り先はトップページ。Cognitoに登録したURLと完全一致させるため、末尾の / を付ける（infra/auth.tf）
const redirectUri = () => `${window.location.origin}/`;

// UserManager は sessionStorage（window）を使うため、ビルド時（window がない）に作らないよう、初めて要るときに作る
let userManager: UserManager | undefined;

const getUserManager = (config: AuthConfig): UserManager => {
  userManager ??= new UserManager({
    authority: config.issuer,
    client_id: config.clientId,
    redirect_uri: redirectUri(),
    response_type: "code",
    scope: "openid email",
    // 既定で有効だが、期限の前に取り直すことに頼っているため明示する。
    // リフレッシュトークンがあれば iframe を使わずに取り直す
    automaticSilentRenew: true,
  });
  return userManager;
};

export const signIn = (config: AuthConfig): Promise<void> =>
  getUserManager(config).signinRedirect();

// Cognitoのディスカバリー文書には end_session_endpoint がなく、signoutRedirect() は使えない。
// 画面のトークンを消したうえで、Cognitoの /logout に移ってCognito側のセッションも消す。
// 消さないと、次のログインでパスワードを聞かれずに入れてしまう
export const signOut = async (config: AuthConfig): Promise<void> => {
  await getUserManager(config).removeUser();
  const logoutUrl = new URL("/logout", config.domainUrl);
  logoutUrl.search = new URLSearchParams({
    client_id: config.clientId,
    logout_uri: redirectUri(),
  }).toString();
  window.location.assign(logoutUrl);
};

// 開発時の React Strict Mode では effect が2回呼ばれる。認可コードは1回しか使えないため、処理を1回にまとめる
let callbackPromise: Promise<void> | undefined;

// マネージドログインから戻ってきたとき（URLに code と state がある）だけ、認可コードをトークンに替える。
// 替えたあとは、成功しても失敗しても、URLから code と state を消す
const handleCallbackIfPresent = (manager: UserManager): Promise<void> => {
  const params = new URLSearchParams(window.location.search);
  if (!params.has("code") || !params.has("state")) {
    return Promise.resolve();
  }
  // 失敗したときも消す。残すと、再読み込みのたびに同じ認可コードで失敗し続ける
  callbackPromise ??= manager
    .signinRedirectCallback()
    .then(() => undefined)
    .finally(() => {
      window.history.replaceState(null, "", "/");
    });
  return callbackPromise;
};

// renewUser どうしの同時呼び出し（401の呼び直しが重なる、Strict Mode で loadUser が2回走る）を1回にまとめる。
// 自動の更新はライブラリが signinSilent を直接呼ぶため、これと重なると2回取り直すことがある。
// Cognitoのリフレッシュトークンのローテーションは既定で無効（infra/auth.tf では設定していない）なので、どちらも成功し問題ない
let renewPromise: Promise<User | null> | undefined;

// アクセストークンを取り直す。
// - Cognitoが拒んだ（ErrorResponse）ときは、保存したユーザーを消して null を返す（ログインし直しが要る）
// - 通信の失敗などそれ以外のときは、例外をそのまま投げる（一時的なエラー。ログインしたままにする）
export const renewUser = (config: AuthConfig): Promise<User | null> => {
  const manager = getUserManager(config);
  // 終わったら共有をやめる。残すと、次の取り直しで終わった古い結果が返り続ける
  renewPromise ??= manager
    .signinSilent()
    .catch(async (error: unknown) => {
      if (error instanceof ErrorResponse) {
        await manager.removeUser();
        return null;
      }
      throw error;
    })
    .finally(() => {
      renewPromise = undefined;
    });
  return renewPromise;
};

export type LoadedUser =
  | { kind: "signedIn"; user: User }
  | { kind: "signedOut" }
  // 期限が切れていて、Cognitoが取り直しを拒んだ（ログインし直しが要る）
  | { kind: "expired" };

// ログイン状態を返す。期限が切れていても、リフレッシュトークンがあれば取り直す。
// 取り直しの通信の失敗などは、例外のまま投げる
export const loadUser = async (config: AuthConfig): Promise<LoadedUser> => {
  const manager = getUserManager(config);
  await handleCallbackIfPresent(manager);
  const user = await manager.getUser();
  if (user === null) return { kind: "signedOut" };
  if (!user.expired) return { kind: "signedIn", user };
  if (!user.refresh_token) return { kind: "expired" };
  const renewed = await renewUser(config);
  return renewed ? { kind: "signedIn", user: renewed } : { kind: "expired" };
};

export type UserChange =
  // 取り直した（自動の更新・renewUser のどちらでも）
  | { kind: "renewed"; user: User }
  // 自動の更新で、Cognitoが取り直しを拒んだ。保存したユーザーは消してある
  | { kind: "expired" };

// 自動の更新と renewUser の結果を受け取る。解除する関数を返す。
// 自動の更新の通信の失敗は、ここでは知らせない（ログインしたままにする）。ライブラリが取り直し直すのは
// タイムアウトのときだけで、それ以外の失敗では次の期限前の更新は仕掛けられない。その後は、APIが401を
// 返したときに callWithRenewal（app/page.tsx）で取り直す
export const watchUser = (config: AuthConfig, onChange: (change: UserChange) => void): (() => void) => {
  const manager = getUserManager(config);
  const handleLoaded = (user: User) => onChange({ kind: "renewed", user });
  const handleRenewError = async (error: Error) => {
    if (!(error instanceof ErrorResponse)) return;
    await manager.removeUser();
    onChange({ kind: "expired" });
  };
  manager.events.addUserLoaded(handleLoaded);
  manager.events.addSilentRenewError(handleRenewError);
  return () => {
    manager.events.removeUserLoaded(handleLoaded);
    manager.events.removeSilentRenewError(handleRenewError);
  };
};
