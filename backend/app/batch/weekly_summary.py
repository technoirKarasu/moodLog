"""週報生成バッチのLambda handler（EventBridge Scheduler → SQS → Lambda）。

今は処理内容を持たず、受け取ったメッセージごとにログを1行出すだけ（Issue #13）。

冪等性: 同じメッセージが2回届いても、ログが2行出るだけで副作用はない。
週報の生成処理を足すときも、この性質を保つ（SQSは同じメッセージを2回以上届けることがある）。
"""

import logging
from typing import Any

logger = logging.getLogger(__name__)
# LambdaのPythonランタイムは、既定ではルートロガーがWARNINGのため、
# INFOを出すにはここで設定する
logger.setLevel(logging.INFO)


def handler(event: dict[str, Any], context: Any) -> None:
    for record in event["Records"]:
        logger.info(
            "weekly_summary received message_id=%s body=%s",
            record["messageId"],
            record["body"],
        )
