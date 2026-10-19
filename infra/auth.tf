# ログイン（Cognitoのユーザープール、マネージドログイン、Googleの外部IDプロバイダ）。
# Issue #59: Cognitoでログインを構築する（docs/adr/0009-auth.md、docs/adr/0010-token-storage.md参照）
#
# 画面は認可コードフロー＋PKCEでトークンを受け取り、APIにはアクセストークンを送る。
# トークンの検証はAPI GatewayのJWTオーソライザーが行う（infra/api_gateway.tf）。

resource "aws_cognito_user_pool" "main" {
  name = "moodlog"
  # マネージドログインはEssentials以上の機能（ADR 0009）
  user_pool_tier = "ESSENTIALS"

  # メールアドレスをユーザー名として使う。大文字・小文字の違いで別ユーザーにならないようにする
  username_attributes      = ["email"]
  auto_verified_attributes = ["email"]
  username_configuration {
    case_sensitive = false
  }

  account_recovery_setting {
    recovery_mechanism {
      name     = "verified_email"
      priority = 1
    }
  }

  # 確認コードのメールはCognito標準の送信機能で送る（1日50通まで。ADR 0009）
  email_configuration {
    email_sending_account = "COGNITO_DEFAULT"
  }
}

# マネージドログインのURLとして公開されるため、AWSアカウントIDではなくランダムな接尾辞で一意にする
resource "random_string" "auth_domain_suffix" {
  length  = 8
  upper   = false
  special = false
}

resource "aws_cognito_user_pool_domain" "main" {
  domain       = "moodlog-${random_string.auth_domain_suffix.result}"
  user_pool_id = aws_cognito_user_pool.main.id
  # 2 = マネージドログイン（1 は旧来のホストされたUI）
  managed_login_version = 2
}

resource "aws_cognito_identity_provider" "google" {
  user_pool_id  = aws_cognito_user_pool.main.id
  provider_name = "Google"
  provider_type = "Google"

  provider_details = {
    client_id        = var.google_client_id
    client_secret    = var.google_client_secret
    authorize_scopes = "openid email"
    # 以下はCognitoがGoogleの既定値として自動で入れる値。書いておかないと、plan のたびに削除する差分が出る
    attributes_url                = "https://people.googleapis.com/v1/people/me?personFields="
    attributes_url_add_attributes = "true"
    authorize_url                 = "https://accounts.google.com/o/oauth2/v2/auth"
    oidc_issuer                   = "https://accounts.google.com"
    token_request_method          = "POST"
    token_url                     = "https://www.googleapis.com/oauth2/v4/token"
  }

  # しないと、Googleでログインしたユーザーの IDトークンに email が入らない（ADR 0009）
  attribute_mapping = {
    email    = "email"
    username = "sub"
  }
}

locals {
  # Cognitoは完全一致で照合するため、末尾の / まで含める。コールバックはトップページで受ける
  # （静的エクスポートでは /callback が callback.html になり、CloudFrontから引けないため）
  auth_redirect_urls = [
    "https://${aws_cloudfront_distribution.frontend.domain_name}/",
    "http://localhost:3000/",
  ]
}

resource "aws_cognito_user_pool_client" "frontend" {
  name         = "moodlog-frontend"
  user_pool_id = aws_cognito_user_pool.main.id

  # ブラウザで動く画面のため、シークレットは持たない（PKCEで守る）
  generate_secret = false

  allowed_oauth_flows_user_pool_client = true
  allowed_oauth_flows                  = ["code"]
  allowed_oauth_scopes                 = ["openid", "email"]
  supported_identity_providers         = ["COGNITO", aws_cognito_identity_provider.google.provider_name]

  callback_urls = local.auth_redirect_urls
  logout_urls   = local.auth_redirect_urls

  # リフレッシュトークンでのトークンの更新だけを許可する。ログイン自体はマネージドログインで行う
  explicit_auth_flows = ["ALLOW_REFRESH_TOKEN_AUTH"]
}

# マネージドログインの画面には、ブランディングの設定が要る。見た目はCognitoの既定のまま使う
resource "aws_cognito_managed_login_branding" "frontend" {
  user_pool_id                = aws_cognito_user_pool.main.id
  client_id                   = aws_cognito_user_pool_client.frontend.id
  use_cognito_provided_values = true
}
