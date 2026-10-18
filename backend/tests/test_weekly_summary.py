import logging

from app.batch.weekly_summary import handler


def _sqs_event(*message_ids: str) -> dict:
    return {
        "Records": [
            {"messageId": message_id, "body": '{"job":"weekly_summary"}'}
            for message_id in message_ids
        ]
    }


def test_handler_logs_one_line_per_record(caplog):
    with caplog.at_level(logging.INFO, logger="app.batch.weekly_summary"):
        handler(_sqs_event("message-1", "message-2"), None)

    records = [r for r in caplog.records if r.name == "app.batch.weekly_summary"]
    assert len(records) == 2
    assert all(r.levelno == logging.INFO for r in records)
    assert "message-1" in records[0].getMessage()
    assert "message-2" in records[1].getMessage()
