variable "github_org" {
  description = "GitHub Actions OIDCの信頼ポリシーで許可するGitHub Organization名"
  type        = string
  default     = "technoirKarasu"
}

variable "github_repo" {
  description = "GitHub Actions OIDCの信頼ポリシーで許可するリポジトリ名"
  type        = string
  default     = "moodLog"
}

variable "github_actions_deploy_branch" {
  description = "GitHub Actionsからのロール引き受けを許可するブランチ名"
  type        = string
  default     = "main"
}

variable "github_actions_role_name" {
  description = "GitHub Actionsがassumeする IAM ロール名"
  type        = string
  default     = "moodlog-github-actions"
}

variable "db_instance_class" {
  description = "RDSのインスタンスクラス"
  type        = string
  default     = "db.t4g.micro"
}

# 公開リポジトリにアドレスを載せないため、デフォルト値を持たせず infra/terraform.tfvars（コミットしない）で渡す
variable "budget_notification_email" {
  description = "AWS Budgetsの通知を送るメールアドレス"
  type        = string
  sensitive   = true

  validation {
    condition     = can(regex("^[^@\\s]+@[^@\\s]+$", var.budget_notification_email))
    error_message = "budget_notification_email にはメールアドレスを指定してください。"
  }
}
