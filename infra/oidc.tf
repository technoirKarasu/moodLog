# GitHub ActionsがAWSを操作するためのOIDCプロバイダとIAMロール。
# Issue #7: Terraformの実行基盤を用意する

resource "aws_iam_openid_connect_provider" "github_actions" {
  url = "https://token.actions.githubusercontent.com"

  client_id_list = [
    "sts.amazonaws.com",
  ]

  # AWSは2023年7月以降、信頼済みルートCAストアでGitHubのTLS証明書を検証するため、
  # thumbprintは証明書チェーンの検証に失敗した場合のフォールバックとしてのみ使われる。
  # GitHub公式のOIDC移行アナウンスが案内する2つの中間証明書thumbprintを両方登録しておく。
  # https://github.blog/changelog/2023-06-27-github-actions-update-on-oidc-integration-with-aws/
  thumbprint_list = [
    "6938fd4d98bab03faadb97b34396831e3780aea1",
    "1c58a3a8518e8759bf075b76b750d4f2df264fcd",
  ]
}

resource "aws_iam_role" "github_actions" {
  name = var.github_actions_role_name

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Principal = {
          Federated = aws_iam_openid_connect_provider.github_actions.arn
        }
        Action = "sts:AssumeRoleWithWebIdentity"
        Condition = {
          StringEquals = {
            "token.actions.githubusercontent.com:aud" = "sts.amazonaws.com"
            # mainブランチのワークフロー実行のみ許可。PRからの実行やフォークからの実行はこのロールになれない
            "token.actions.githubusercontent.com:sub" = "repo:${var.github_org}/${var.github_repo}:ref:refs/heads/${var.github_actions_deploy_branch}"
          }
        }
      }
    ]
  })
}

# 初期段階のためAdministratorAccessを付与。将来的にデプロイに必要な範囲へ絞ることを検討
resource "aws_iam_role_policy_attachment" "github_actions_admin" {
  role       = aws_iam_role.github_actions.name
  policy_arn = "arn:aws:iam::aws:policy/AdministratorAccess"
}
