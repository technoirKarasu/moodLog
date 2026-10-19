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

# 週報生成バッチの起動スケジュール（EventBridge Schedulerの式、Asia/Tokyo）。
# 動作を確かめるときだけ -var 'weekly_summary_schedule=rate(5 minutes)' で上書きする（infra/README.md）
variable "weekly_summary_schedule" {
  description = "週報生成バッチの起動スケジュール"
  type        = string
  default     = "cron(0 18 ? * FRI *)"

  validation {
    condition     = can(regex("^(cron|rate|at)\\(.+\\)$", var.weekly_summary_schedule))
    error_message = "weekly_summary_schedule には cron(...)、rate(...)、at(...) のいずれかを指定してください。"
  }
}

# GoogleでログインするためのOAuthクライアント（Google Cloud Consoleで作る。手順は infra/README.md）。
# 公開リポジトリに載せないため、デフォルト値を持たせず infra/terraform.tfvars（コミットしない）で渡す。
# シークレットはtfstate（S3、暗号化あり）に平文で入る
variable "google_client_id" {
  description = "GoogleのOAuthクライアントID"
  type        = string
}

variable "google_client_secret" {
  description = "GoogleのOAuthクライアントシークレット"
  type        = string
  sensitive   = true
}
