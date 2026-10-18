# 0004 EventBridge + SQS の構成

## 状況

週報生成（毎週金曜トリガー）を中心とした非同期処理の構成を検討した。

## 決定

EventBridgeでスケジュール起動し、SQS経由でLambdaを実行する。失敗分はDLQに送る。

## 捨てた選択肢

Lambdaの直接スケジュール実行（DLQによる失敗ハンドリングがないため見送り）（この理由は不正確だった。結果欄を参照）

## 結果

`infra/batch.tf` で構築した（Issue #13）。

- EventBridge Scheduler（`aws_scheduler_schedule`）で、毎週金曜 18:00（Asia/Tokyo）にSQSへメッセージを送る。EventBridgeのルールではなくSchedulerにしたのは、タイムゾーンを指定できるため
- SQSのキューからLambda（`moodlog-weekly-summary`）を1件ずつ起動する。3回失敗したメッセージはDLQ（保持14日）に移る
- 今のLambdaは、メッセージごとにログを1行出すだけ（`backend/app/batch/weekly_summary.py`）

「捨てた選択肢」の理由（直接実行ではDLQによる失敗ハンドリングがない）は不正確だった。今は EventBridge Scheduler 自体にリトライとDLQがあり、Lambdaの非同期呼び出しにも失敗時の送信先がある。SQSを挟む理由は次のとおり。

- 週報を「ユーザーごとに1メッセージ」に分けて流すとき、同時に動く数を抑えたり、失敗したユーザーの分だけやり直したりしやすい
- 失敗したメッセージがDLQに残り、中身を見てから再投入できる
