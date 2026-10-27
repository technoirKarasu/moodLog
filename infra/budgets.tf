# 月額の予算と、超えそうなときのメール通知。
# Issue #6: コスト超過に気づける状態を作る
#
# 予算額30ドルの根拠: 現時点の見込みはRDSの月約15ドル（docs/adr/0002-database.md）。
# Lambda・API Gateway・CloudFrontは無料枠の範囲の想定で、その2倍程度を上限にする。
# VPCエンドポイントやNATゲートウェイを足すときは見直す（週報の生成方法とあわせて Issue #32 で決める）。

resource "aws_budgets_budget" "monthly" {
  name         = "moodlog-monthly"
  budget_type  = "COST"
  limit_amount = "30"
  limit_unit   = "USD"
  time_unit    = "MONTHLY"

  # 実績が80%を超えたとき
  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 80
    threshold_type             = "PERCENTAGE"
    notification_type          = "ACTUAL"
    subscriber_email_addresses = [var.budget_notification_email]
  }

  # 月末までの予測が100%を超えたとき
  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 100
    threshold_type             = "PERCENTAGE"
    notification_type          = "FORECASTED"
    subscriber_email_addresses = [var.budget_notification_email]
  }
}
