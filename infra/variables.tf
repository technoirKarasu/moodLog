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
