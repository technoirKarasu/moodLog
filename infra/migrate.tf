# 本番DBにマイグレーション（alembic upgrade head）を流すLambda。
# Issue #58: 本番DBへのマイグレーションの実行方法を決める（docs/adr/0011-prod-migration.md参照）
#
# RDSはプライベートサブネットにあり手元からつながらないため、APIのLambdaと同じVPCに置く。
# APIと同じzip（backend/build/lambda.zip）を使い、ハンドラーだけを変える。
# 呼び方は infra/README.md。API GatewayやEventBridgeからは呼べないようにする（aws_lambda_permission を作らない）。

locals {
  migrate_function_name = "moodlog-migrate"
}

# APIのLambdaとは変更理由が違うため、ロールとセキュリティグループを分ける（週報バッチと同じ）
resource "aws_iam_role" "migrate" {
  name = "moodlog-migrate-lambda"

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
resource "aws_iam_role_policy_attachment" "migrate_vpc_access" {
  role       = aws_iam_role.migrate.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaVPCAccessExecutionRole"
}

# 外向きの通信は、VPC内のPostgreSQL（RDS）だけを許可する
# descriptionに使える文字はAWS側で英数字と一部の記号に限られるため、英語で書く
resource "aws_security_group" "migrate" {
  name        = "moodlog-migrate-lambda"
  description = "Outbound access from the migration Lambda"
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
resource "aws_cloudwatch_log_group" "migrate" {
  name              = "/aws/lambda/${local.migrate_function_name}"
  retention_in_days = 14
}

resource "aws_lambda_function" "migrate" {
  function_name = local.migrate_function_name
  role          = aws_iam_role.migrate.arn

  runtime       = "python3.13"
  architectures = ["arm64"]
  handler       = "app.migrate.handler"
  memory_size   = 512
  # テーブルの作成や列の追加を想定した長さ。重いデータ移行が必要になったら見直す
  timeout = 60

  # 同じマイグレーションが並行して流れないよう、同時に動くのを1つにする
  reserved_concurrent_executions = 1

  filename         = local.lambda_zip_path
  source_code_hash = filebase64sha256(local.lambda_zip_path)

  vpc_config {
    subnet_ids         = [aws_subnet.private_a.id, aws_subnet.private_c.id]
    security_group_ids = [aws_security_group.migrate.id]
  }

  # APIのLambdaと同じく、SSMに保存した接続文字列をデプロイ時に環境変数で渡す（docs/adr/0007-vpc.md）
  environment {
    variables = {
      DATABASE_URL = aws_ssm_parameter.database_url.value
    }
  }

  # ロググループ: 関数が先に呼ばれるとロググループが自動作成され、上のロググループの作成が失敗するため
  # ポリシーのアタッチ: VPC内に関数を作るとき、ENIを作る権限が先に必要なため
  depends_on = [
    aws_cloudwatch_log_group.migrate,
    aws_iam_role_policy_attachment.migrate_vpc_access,
  ]
}
