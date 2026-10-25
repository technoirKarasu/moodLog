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

# デプロイ（docs/adr/0012-deploy.md）に必要な権限だけを持たせる（docs/adr/0013-github-actions-deploy-policy.md）。
# Issue #83: AdministratorAccess から付け替えた。
# マネージドポリシーは 6,144 文字まで。1つにまとめると超える（約 6,600 文字）ので、読み取りと書き込みで分ける。
# 書き込みも上限に近い（約5,000文字）。超えるときは、サービスごとに3つ目のポリシーへ移す
#
# 読み取りは、terraform plan の refresh が属性を広く読むため、サービスごとのワイルドカードにする。
# ただし、中身のデータを返す読み取り（S3 のオブジェクト、SSM の値、Cognito の利用者）は moodlog のものに絞る
resource "aws_iam_policy" "github_actions_read" {
  name        = "moodlog-github-actions-read"
  description = "terraform plan で、管理しているリソースを読む"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "apigateway:GET",
          "budgets:ViewBudget",
          "budgets:ListTagsForResource",
          "cloudfront:Get*",
          "cloudfront:List*",
          # 対象をユーザープールに絞れない
          "cognito-idp:DescribeUserPoolDomain",
          "ec2:Describe*",
          "iam:Get*",
          "iam:List*",
          "logs:Describe*",
          "logs:List*",
          "rds:Describe*",
          "rds:List*",
          "scheduler:Get*",
          "scheduler:List*",
          "sqs:GetQueueAttributes",
          "sqs:GetQueueUrl",
          "sqs:ListQueueTags",
          "ssm:DescribeParameters",
        ]
        Resource = "*"
      },
      {
        # GetFunction はコードのダウンロード URL と環境変数を返すので、moodlog の関数に絞る。
        # 対象 * の ListFunctions も、すべての関数の環境変数を返すので、List* も同じ対象に絞る（ListFunctions は許可されない）
        Effect = "Allow"
        Action = ["lambda:Get*", "lambda:List*"]
        Resource = [
          aws_lambda_function.api.arn,
          aws_lambda_function.migrate.arn,
          aws_lambda_function.weekly_summary.arn,
          aws_lambda_event_source_mapping.weekly_summary.arn,
        ]
      },
      {
        # ListUsers や Admin* は利用者の情報を返すので含めない
        Effect = "Allow"
        Action = [
          "cognito-idp:Describe*",
          "cognito-idp:GetUserPoolMfaConfig",
          "cognito-idp:ListUserPoolClients",
          "cognito-idp:ListTagsForResource",
        ]
        Resource = aws_cognito_user_pool.main.arn
      },
      {
        Effect = "Allow"
        Action = [
          "ssm:GetParameter",
          "ssm:GetParameters",
          "ssm:ListTagsForResource",
        ]
        Resource = aws_ssm_parameter.database_url.arn
      },
      {
        # バケットの設定。オブジェクトは含まない。
        # ListTagsForResource は、プロバイダがバケットのタグを読むときに使う（Issue #93）。名前が List で始まり、Get* に入らない
        Effect = "Allow"
        Action = [
          "s3:Get*",
          "s3:ListBucket",
          "s3:ListTagsForResource",
        ]
        Resource = [
          "arn:aws:s3:::moodlog-tfstate-96-tokyo",
          aws_s3_bucket.frontend.arn,
        ]
      },
    ]
  })
}

# 書き込みは、既存のリソースの更新だけを許す。作成・削除・作り直しと、IAM・S3 のバケットポリシー・公開アクセスブロックの変更は、
# infra/scripts/check_plan.sh で止めて手元で apply するので、ここには含めない。
# 名前に Delete を含む操作は、リソースを消さず、更新の中で属性を外すものだけを許す
resource "aws_iam_policy" "github_actions_deploy" {
  name        = "moodlog-github-actions-deploy"
  description = "main マージ時のデプロイで、既存のリソースを更新する"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["s3:GetObject", "s3:PutObject"]
        Resource = "arn:aws:s3:::moodlog-tfstate-96-tokyo/moodlog/terraform.tfstate*"
      },
      {
        # use_lockfile のロックは、apply が終わると消す
        Effect   = "Allow"
        Action   = "s3:DeleteObject"
        Resource = "arn:aws:s3:::moodlog-tfstate-96-tokyo/moodlog/terraform.tfstate.tflock"
      },
      {
        # frontend/scripts/deploy.sh の aws s3 sync --delete
        Effect   = "Allow"
        Action   = ["s3:PutObject", "s3:DeleteObject"]
        Resource = "${aws_s3_bucket.frontend.arn}/*"
      },
      {
        Effect = "Allow"
        Action = [
          "lambda:UpdateFunctionCode",
          "lambda:UpdateFunctionConfiguration",
          "lambda:PutFunctionConcurrency",
          "lambda:DeleteFunctionConcurrency",
        ]
        Resource = [
          aws_lambda_function.api.arn,
          aws_lambda_function.migrate.arn,
          aws_lambda_function.weekly_summary.arn,
        ]
      },
      {
        Effect   = "Allow"
        Action   = "lambda:UpdateEventSourceMapping"
        Resource = aws_lambda_event_source_mapping.weekly_summary.arn
      },
      {
        # backend/scripts/migrate_prod.sh
        Effect   = "Allow"
        Action   = "lambda:InvokeFunction"
        Resource = aws_lambda_function.migrate.arn
      },
      {
        Effect = "Allow"
        Action = "iam:PassRole"
        Resource = [
          aws_iam_role.lambda.arn,
          aws_iam_role.migrate.arn,
          aws_iam_role.weekly_summary.arn,
        ]
        Condition = {
          StringEquals = { "iam:PassedToService" = "lambda.amazonaws.com" }
        }
      },
      {
        Effect   = "Allow"
        Action   = "iam:PassRole"
        Resource = aws_iam_role.weekly_summary_scheduler.arn
        Condition = {
          StringEquals = { "iam:PassedToService" = "scheduler.amazonaws.com" }
        }
      },
      {
        Effect = "Allow"
        Action = "apigateway:PATCH"
        Resource = [
          "arn:aws:apigateway:ap-northeast-1::/apis/${aws_apigatewayv2_api.api.id}",
          "arn:aws:apigateway:ap-northeast-1::/apis/${aws_apigatewayv2_api.api.id}/*",
        ]
      },
      {
        # cors_configuration を外すとき
        Effect   = "Allow"
        Action   = "apigateway:DELETE"
        Resource = "arn:aws:apigateway:ap-northeast-1::/apis/${aws_apigatewayv2_api.api.id}/cors"
      },
      {
        Effect = "Allow"
        Action = [
          "cognito-idp:UpdateUserPool",
          "cognito-idp:UpdateUserPoolClient",
          "cognito-idp:UpdateIdentityProvider",
          "cognito-idp:UpdateUserPoolDomain",
          "cognito-idp:UpdateManagedLoginBranding",
          "cognito-idp:SetUserPoolMfaConfig",
        ]
        Resource = aws_cognito_user_pool.main.arn
      },
      {
        Effect   = "Allow"
        Action   = ["cloudfront:UpdateDistribution", "cloudfront:CreateInvalidation"]
        Resource = aws_cloudfront_distribution.frontend.arn
      },
      {
        Effect   = "Allow"
        Action   = "cloudfront:UpdateOriginAccessControl"
        Resource = aws_cloudfront_origin_access_control.frontend.arn
      },
      {
        Effect   = "Allow"
        Action   = ["ec2:ModifyVpcAttribute", "ec2:CreateTags", "ec2:DeleteTags"]
        Resource = aws_vpc.main.arn
      },
      {
        Effect   = "Allow"
        Action   = ["ec2:ModifySubnetAttribute", "ec2:CreateTags", "ec2:DeleteTags"]
        Resource = [aws_subnet.private_a.arn, aws_subnet.private_c.arn]
      },
      {
        Effect = "Allow"
        Action = [
          "ec2:AuthorizeSecurityGroupIngress",
          "ec2:AuthorizeSecurityGroupEgress",
          "ec2:RevokeSecurityGroupIngress",
          "ec2:RevokeSecurityGroupEgress",
          "ec2:UpdateSecurityGroupRuleDescriptionsIngress",
          "ec2:UpdateSecurityGroupRuleDescriptionsEgress",
          "ec2:CreateTags",
          "ec2:DeleteTags",
        ]
        Resource = [
          aws_security_group.db.arn,
          aws_security_group.lambda.arn,
          aws_security_group.migrate.arn,
        ]
      },
      {
        # 変更する内容によっては、つないでいるサブネットグループ・パラメータグループ・オプショングループの ARN でも判定される。
        # パラメータグループとオプショングループは既定のもの（変更できない）
        Effect = "Allow"
        Action = "rds:ModifyDBInstance"
        Resource = [
          aws_db_instance.moodlog.arn,
          aws_db_subnet_group.moodlog.arn,
          "arn:aws:rds:ap-northeast-1:${data.aws_caller_identity.current.account_id}:pg:default.postgres16",
          "arn:aws:rds:ap-northeast-1:${data.aws_caller_identity.current.account_id}:og:default:postgres-16",
        ]
      },
      {
        Effect   = "Allow"
        Action   = "rds:ModifyDBSubnetGroup"
        Resource = aws_db_subnet_group.moodlog.arn
      },
      {
        Effect = "Allow"
        Action = ["logs:PutRetentionPolicy", "logs:DeleteRetentionPolicy"]
        # 操作によっては、末尾に :* が付いた ARN で判定される。provider の arn には付いていないので、両方を書く
        Resource = [
          aws_cloudwatch_log_group.lambda.arn,
          "${aws_cloudwatch_log_group.lambda.arn}:*",
          aws_cloudwatch_log_group.migrate.arn,
          "${aws_cloudwatch_log_group.migrate.arn}:*",
          aws_cloudwatch_log_group.weekly_summary.arn,
          "${aws_cloudwatch_log_group.weekly_summary.arn}:*",
        ]
      },
      {
        Effect   = "Allow"
        Action   = "sqs:SetQueueAttributes"
        Resource = [aws_sqs_queue.weekly_summary.arn, aws_sqs_queue.weekly_summary_dlq.arn]
      },
      {
        Effect   = "Allow"
        Action   = "ssm:PutParameter"
        Resource = aws_ssm_parameter.database_url.arn
      },
      {
        Effect   = "Allow"
        Action   = "scheduler:UpdateSchedule"
        Resource = aws_scheduler_schedule.weekly_summary.arn
      },
      {
        Effect   = "Allow"
        Action   = "budgets:ModifyBudget"
        Resource = aws_budgets_budget.monthly.arn
      },
    ]
  })
}

resource "aws_iam_role_policy_attachment" "github_actions_read" {
  role       = aws_iam_role.github_actions.name
  policy_arn = aws_iam_policy.github_actions_read.arn
}

resource "aws_iam_role_policy_attachment" "github_actions_deploy" {
  role       = aws_iam_role.github_actions.name
  policy_arn = aws_iam_policy.github_actions_deploy.arn
}
