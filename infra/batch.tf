# 週報生成バッチ: EventBridge Scheduler → SQS → Lambda。失敗分はDLQに送る。
# Issue #13: EventBridgeの定期ジョブを空で構築する（docs/adr/0004-async.md参照）
#
# 今のLambdaはメッセージごとにログを1行出すだけ（backend/app/batch/weekly_summary.py）。
# DBを使わないため、VPCには置かない。

locals {
  weekly_summary_function_name = "moodlog-weekly-summary"
  weekly_summary_timeout       = 30
}

# --- SQS ---

resource "aws_sqs_queue" "weekly_summary_dlq" {
  name                      = "moodlog-weekly-summary-dlq"
  message_retention_seconds = 1209600 # 14日（最大）。失敗したメッセージの中身を見てから再投入できるようにする
}

resource "aws_sqs_queue" "weekly_summary" {
  name = "moodlog-weekly-summary"
  # AWSの推奨: Lambdaのタイムアウトの6倍以上
  visibility_timeout_seconds = local.weekly_summary_timeout * 6

  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.weekly_summary_dlq.arn
    maxReceiveCount     = 3
  })
}

# --- Lambda ---

resource "aws_iam_role" "weekly_summary" {
  name = "moodlog-weekly-summary-lambda"

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

# CloudWatch Logsへの書き込み
resource "aws_iam_role_policy_attachment" "weekly_summary_logs" {
  role       = aws_iam_role.weekly_summary.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

# このキューだけを読む。マネージドの AWSLambdaSQSQueueExecutionRole は全キューが対象なので使わない
resource "aws_iam_role_policy" "weekly_summary_sqs" {
  name = "receive-weekly-summary-queue"
  role = aws_iam_role.weekly_summary.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "sqs:ReceiveMessage",
          "sqs:DeleteMessage",
          "sqs:GetQueueAttributes",
        ]
        Resource = aws_sqs_queue.weekly_summary.arn
      }
    ]
  })
}

# 自動作成に任せると保持期間が無期限になるため、先に作って14日にする
resource "aws_cloudwatch_log_group" "weekly_summary" {
  name              = "/aws/lambda/${local.weekly_summary_function_name}"
  retention_in_days = 14
}

resource "aws_lambda_function" "weekly_summary" {
  function_name = local.weekly_summary_function_name
  role          = aws_iam_role.weekly_summary.arn

  runtime       = "python3.13"
  architectures = ["arm64"]
  handler       = "app.batch.weekly_summary.handler"
  memory_size   = 128
  timeout       = local.weekly_summary_timeout

  # API と同じzip（backend/scripts/build_lambda.sh が app/ ごと入れる）
  filename         = local.lambda_zip_path
  source_code_hash = filebase64sha256(local.lambda_zip_path)

  # ロググループ: 関数が先に呼ばれるとロググループが自動作成され、上のロググループの作成が失敗するため
  depends_on = [
    aws_cloudwatch_log_group.weekly_summary,
    aws_iam_role_policy_attachment.weekly_summary_logs,
  ]
}

# 1件ずつ渡す。部分的な失敗の扱い（ReportBatchItemFailures）を考えずに済む
resource "aws_lambda_event_source_mapping" "weekly_summary" {
  event_source_arn = aws_sqs_queue.weekly_summary.arn
  function_name    = aws_lambda_function.weekly_summary.arn
  batch_size       = 1

  # キューを読む権限を先に付ける
  depends_on = [aws_iam_role_policy.weekly_summary_sqs]
}

# --- EventBridge Scheduler ---

resource "aws_iam_role" "weekly_summary_scheduler" {
  name = "moodlog-weekly-summary-scheduler"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect    = "Allow"
        Principal = { Service = "scheduler.amazonaws.com" }
        Action    = "sts:AssumeRole"
        # 他のアカウントのスケジュールから使われないようにする（混乱した代理の対策）
        Condition = {
          StringEquals = {
            "aws:SourceAccount" = data.aws_caller_identity.current.account_id
          }
        }
      }
    ]
  })
}

# このキューにだけ送る
resource "aws_iam_role_policy" "weekly_summary_scheduler" {
  name = "send-weekly-summary-queue"
  role = aws_iam_role.weekly_summary_scheduler.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = "sqs:SendMessage"
        Resource = aws_sqs_queue.weekly_summary.arn
      }
    ]
  })
}

resource "aws_scheduler_schedule" "weekly_summary" {
  name = "moodlog-weekly-summary"

  # EventBridgeのルールと違い、タイムゾーンを指定できる
  schedule_expression          = var.weekly_summary_schedule
  schedule_expression_timezone = "Asia/Tokyo"

  # 指定した時刻ちょうどに起動する
  flexible_time_window {
    mode = "OFF"
  }

  target {
    arn      = aws_sqs_queue.weekly_summary.arn
    role_arn = aws_iam_role.weekly_summary_scheduler.arn
    input    = jsonencode({ job = "weekly_summary" })
  }
}
