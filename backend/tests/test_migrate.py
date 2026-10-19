import pytest
from alembic.script import ScriptDirectory

from app import migrate


def test_handler_upgrades_to_head_and_returns_revision(monkeypatch):
    calls = []
    monkeypatch.setattr(
        migrate.command, "upgrade", lambda config, rev: calls.append(rev)
    )
    monkeypatch.setattr(migrate, "current_revision", lambda: "5bd71c859282")

    result = migrate.handler({}, None)

    assert calls == ["head"]
    assert result == {"revision": "5bd71c859282"}


def test_handler_raises_when_upgrade_fails(monkeypatch):
    def fail(config, rev):
        raise RuntimeError("migration failed")

    monkeypatch.setattr(migrate.command, "upgrade", fail)

    with pytest.raises(RuntimeError, match="migration failed"):
        migrate.handler({}, None)


def test_alembic_config_finds_migrations():
    # zip の中と同じ相対位置（alembic.ini と migrations/）で読めることを確かめる
    script = ScriptDirectory.from_config(migrate.alembic_config())

    head = script.get_revision(script.get_current_head())
    assert head.revision == "c257885c8449"
    assert head.down_revision == "5bd71c859282"
