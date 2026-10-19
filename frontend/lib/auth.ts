// Cognitoのマネージドログインでのログイン・ログアウト（docs/adr/0009-auth.md、docs/adr/0010-token-storage.md）
//
// 認可コードフロー＋PKCEでトークンを受け取る。トークンは oidc-client-ts の既定どおり sessionStorage に持つ。
// コールバックはトップページ（/）で受ける。静的エクスポートでは /callback が callback.html になり、
// CloudFrontから引けないため。

import { type User, UserManager } from "oidc-client-ts";

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

// ログイン中のユーザーを返す。ログインしていない、またはトークンの期限が切れていれば null
export const loadUser = async (config: AuthConfig): Promise<User | null> => {
  const manager = getUserManager(config);
  await handleCallbackIfPresent(manager);
  const user = await manager.getUser();
  return user && !user.expired ? user : null;
};
