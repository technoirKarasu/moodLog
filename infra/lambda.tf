# FastAPI（backend/app）を動かすLambda。
# Issue #10: Lambda + API GatewayをTerraformで構築する（docs/adr/0003-compute.md参照）
#
# デプロイ前に backend/scripts/build_lambda.sh で backend/build/lambda.zip を作っておく。

locals {
  lambda_function_name = "moodlog-api"
  lambda_zip_path      = "${path.module}/../backend/build/lambda.zip"
}

resource "aws_iam_role" "lambda" {
  name = "moodlog-api-lambda"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect    = "Allow"
        Principal = { Service = "lambda.amazonaws.com" }
        Action    = "sts:AssumeRole"
      }
    ]
  })
}

# VPC内でネットワークの口（ENI）を作る権限と、CloudWatch Logsへの書き込み権限
resource "aws_iam_role_policy_attachment" "lambda_vpc_access" {
  role       = aws_iam_role.lambda.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaVPCAccessExecutionRole"
}

# Lambdaからの外向きの通信は、VPC内のPostgreSQL（RDS）だけを許可する
# descriptionに使える文字はAWS側で英数字と一部の記号に限られるため、英語で書く
resource "aws_security_group" "lambda" {
  name        = "moodlog-api-lambda"
  description = "Outbound access from the API Lambda"
  vpc_id      = aws_vpc.main.id

  egress {
    description = "PostgreSQL within the VPC"
    from_port   = 5432
    to_port     = 5432
    protocol    = "tcp"
    cidr_blocks = [aws_vpc.main.cidr_block]
  }
}

# 自動作成に任せると保持期間が無期限になるため、先に作って14日にする
resource "aws_cloudwatch_log_group" "lambda" {
  name              = "/aws/lambda/${local.lambda_function_name}"
  retention_in_days = 14
}

resource "aws_lambda_function" "api" {
  function_name = local.lambda_function_name
  role          = aws_iam_role.lambda.arn

  runtime       = "python3.13"
  architectures = ["arm64"]
  handler       = "app.main.handler"
  memory_size   = 512
  timeout       = 10

  # zipは、同じマシンで同じコードから作れば同じハッシュになり、コードが変わったときだけLambdaが更新される
  # （backend/scripts/build_lambda.sh、Issue #76。例外は infra/README.md の「デプロイ」）
  filename         = local.lambda_zip_path
  source_code_hash = filebase64sha256(local.lambda_zip_path)

  vpc_config {
    subnet_ids         = [aws_subnet.private_a.id, aws_subnet.private_c.id]
    security_group_ids = [aws_security_group.lambda.id]
  }

  # SSMに保存した接続文字列を、デプロイ時に環境変数で渡す。
  # LambdaはVPCの外へ出られないため、実行中にSSMを読まない（docs/adr/0007-vpc.md）
  environment {
    variables = {
      DATABASE_URL = aws_ssm_parameter.database_url.value
    }
  }

  # ロググループ: 関数が先に呼ばれるとロググループが自動作成され、上のロググループの作成が失敗するため
  # ポリシーのアタッチ: VPC内に関数を作るとき、ENIを作る権限が先に必要なため
  depends_on = [
    aws_cloudwatch_log_group.lambda,
    aws_iam_role_policy_attachment.lambda_vpc_access,
  ]
}
