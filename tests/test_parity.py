"""Keep the authored presentation and the published dataset in lockstep."""

from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import pandas as pd
import pytest

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
EXPORT = ROOT / "tools" / "export_events.mjs"


@pytest.fixture(scope="module")
def js_export() -> dict:
    return json.loads((DATA / "js-events.json").read_text(encoding="utf-8"))


@pytest.fixture(scope="module")
def csv_tables():
    events = pd.read_csv(DATA / "events.csv")
    worlds = pd.read_csv(DATA / "worlds.csv")
    return events, worlds


def test_js_export_covers_every_world(js_export: dict, csv_tables):
    _, worlds = csv_tables
    ordered = worlds.sort_values("order")
    assert js_export["schemaVersion"] == 1
    assert js_export["presentYear"] == 2026
    assert [world["key"] for world in js_export["worlds"]] == list(ordered["world"])
    for item, row in zip(js_export["worlds"], ordered.itertuples()):
        assert item["name"] == row.name
        assert item["headline"] == row.headline
        assert item["startShort"] == row.start_label
        assert item["credit"] == row.credit
        assert len(item["chapters"]) == 9


def test_js_chapter_text_matches_the_csv(js_export: dict, csv_tables):
    events, _ = csv_tables
    indexed = events.set_index(["world", "chapter"])
    for world in js_export["worlds"]:
        for chapter in world["chapters"]:
            row = indexed.loc[(world["key"], chapter["index"])]
            assert chapter["at"] == pytest.approx(row["layout_at"], abs=1e-9)
            assert chapter["time"] == row["time_label"]
            assert chapter["event"] == row["event"]
            assert chapter["note"] == row["note"]


def test_export_script_reproduces_the_committed_artifact():
    node = shutil.which("node")
    if node is None:
        pytest.skip("node is not available")
    result = subprocess.run(
        [node, str(EXPORT)],
        cwd=ROOT,
        capture_output=True,
        check=False,
    )
    assert result.returncode == 0, result.stderr.decode("utf-8", "replace")
    committed = (DATA / "js-events.json").read_bytes()
    assert result.stdout == committed


def test_export_check_mode_passes():
    node = shutil.which("node")
    if node is None:
        pytest.skip("node is not available")
    result = subprocess.run(
        [node, str(EXPORT), "--check"],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0, result.stderr or result.stdout
    assert "is current" in result.stdout
