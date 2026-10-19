output "github_actions_role_arn" {
  description = "GitHub Actionsがassumeする IAM ロールのARN"
  value       = aws_iam_role.github_actions.arn
}

output "db_endpoint" {
  description = "RDSのエンドポイント（host:port）。接続情報自体はSSM Parameter Store(/moodlog/database_url)を参照する"
  value       = aws_db_instance.moodlog.endpoint
}

output "api_endpoint" {
  description = "API Gatewayの公開URL。/health で動作を確認できる"
  value       = aws_apigatewayv2_api.api.api_endpoint
}

output "frontend_url" {
  description = "フロントエンドの公開URL（CloudFront）"
  value       = "https://${aws_cloudfront_distribution.frontend.domain_name}"
}

output "frontend_bucket_name" {
  description = "フロントエンドの静的ファイルを置くS3バケット。frontend/scripts/deploy.sh がアップロードする"
  value       = aws_s3_bucket.frontend.bucket
}

output "frontend_distribution_id" {
  description = "CloudFrontディストリビューションのID。frontend/scripts/deploy.sh がキャッシュを消すときに使う"
  value       = aws_cloudfront_distribution.frontend.id
}

output "cognito_issuer" {
  description = "CognitoのトークンのIssuer。画面（oidc-client-ts の authority）とJWTオーソライザーが使う"
  value       = "https://${aws_cognito_user_pool.main.endpoint}"
}

output "cognito_domain_url" {
  description = "マネージドログインのURL。画面がログアウトに使う。GoogleのOAuthクライアントのリダイレクトURIは、これに /oauth2/idpresponse を付けたもの"
  value       = "https://${aws_cognito_user_pool_domain.main.domain}.auth.ap-northeast-1.amazoncognito.com"
}

output "cognito_client_id" {
  description = "画面用のCognitoアプリクライアントID"
  value       = aws_cognito_user_pool_client.frontend.id
}
