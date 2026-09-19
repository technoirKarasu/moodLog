output "github_actions_role_arn" {
  description = "GitHub Actionsがassumeする IAM ロールのARN"
  value       = aws_iam_role.github_actions.arn
}
