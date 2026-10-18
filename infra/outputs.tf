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
