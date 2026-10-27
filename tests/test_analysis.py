"""Recompute the audit and verify the committed, deterministic artifacts."""

from __future__ import annotations

import importlib.util
import json
import subprocess
import sys
from pathlib import Path

import pandas as pd
import pytest

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
AUDIT = ROOT / "analysis" / "audit.py"
REPORT = ROOT / "reports" / "time-axis-audit.md"


def load_audit():
    spec = importlib.util.spec_from_file_location("timeline_audit", AUDIT)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"cannot import {AUDIT}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


audit = load_audit()


@pytest.fixture(scope="module")
def payload() -> dict:
    result, _, _, _ = audit.build()
    return result


def test_committed_analysis_is_deterministic(payload: dict):
    rendered = json.dumps(payload, indent=2, ensure_ascii=False) + "\n"
    assert (DATA / "analysis.json").read_text(encoding="utf-8") == rendered
    assert REPORT.read_text(encoding="utf-8") == audit.render_report(payload)


def test_audit_check_mode_passes():
    result = subprocess.run(
        [sys.executable, str(AUDIT), "--check"],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0, result.stderr or result.stdout


def test_counts(payload: dict):
    assert payload["schema_version"] == 1
    assert payload["present_year"] == 2026
    assert payload["counts"] == {
        "worlds": 10,
        "chapters": 90,
        "deep_time": 46,
        "dated": 34,
        "today": 10,
        "sources": 36,
        "dated_worlds": 9,
    }


def test_snapshot_is_pinned_to_the_dataset(payload: dict):
    events = pd.read_csv(DATA / "events.csv")
    expected = str(pd.to_datetime(events["as_of"]).max().date())
    assert payload["generated"] == expected == "2026-10-27"
    assert expected in audit.render_report(payload)


def test_earth_distortion(payload: dict):
    earth = payload["earth"]
    first = earth["first_segment"]
    last = earth["last_segment"]

    assert earth["span_label"] == "13.8 billion years"
    assert len(earth["segments"]) == 8
    assert sum(segment["years"] for segment in earth["segments"]) == earth["span_years"]
    assert sum(segment["line_share"] for segment in earth["segments"]) == pytest.approx(1.0, abs=1e-3)
    assert sum(segment["time_share"] for segment in earth["segments"]) == pytest.approx(1.0, abs=1e-5)

    assert last["line_share"] == pytest.approx(0.21)
    assert last["time_share"] == pytest.approx(0.004783)
    assert last["expansion"] == pytest.approx(43.91)
    assert first["line_share"] == pytest.approx(0.075)
    assert first["time_share"] == pytest.approx(0.666667)
    assert first["expansion"] == pytest.approx(0.11)
    assert earth["last_vs_first"] == pytest.approx(399.2)
    assert all(segment["expansion"] > 0 for segment in earth["segments"])


def test_gap_statistics(payload: dict):
    gaps = payload["gaps"]
    assert gaps["total"] == 80
    assert gaps["deep"] + gaps["dated"] + gaps["mixed"] == gaps["total"]
    assert gaps["deep"] == 36
    assert gaps["dated"] == 25
    assert gaps["mixed"] == 19
    assert gaps["deep_median_years"] == 400_000_000
    assert gaps["dated_median_years"] == 55
    assert gaps["largest"] == 9_200_000_000
    assert gaps["largest_world"] == "earth"


def test_findings(payload: dict):
    findings = payload["findings"]
    assert findings["dated_share_of_chapters"] == pytest.approx(0.3778)
    assert findings["deep_share_of_chapters"] == pytest.approx(0.5111)
    assert findings["earth_last_vs_first"] == pytest.approx(399.2)
    assert findings["worlds_with_no_dated_chapter"] == ["earth"]
    assert findings["earliest_first_dated_at"] == "jupiter"
    assert findings["latest_first_dated_at"] == "mars"
    assert findings["earth_final_interval"]["expansion"] == pytest.approx(43.91)
    assert findings["earth_first_interval"]["expansion"] == pytest.approx(0.11)


def test_dated_chapters_by_century(payload: dict):
    counts = {entry["century"]: entry["count"] for entry in payload["dated_by_century"]}
    assert counts == {1600: 10, 1700: 2, 1800: 4, 1900: 14, 2000: 4}
    assert sum(counts.values()) == payload["counts"]["dated"]


def test_world_records(payload: dict):
    worlds = payload["worlds"]
    assert [world["order"] for world in worlds] == list(range(10))
    assert len(worlds) == 10
    earth = next(world for world in worlds if world["key"] == "earth")
    assert earth["dated_count"] == 0
    assert earth["first_dated_at"] is None
    for world in worlds:
        assert len(world["chapters"]) == 9
        assert world["deep_count"] + world["dated_count"] + world["today_count"] == 9
        assert world["largest_gap"] is not None
        assert world["largest_gap"]["years"] > 0
        assert world["largest_gap"]["years_label"]
        assert 0 < world["largest_gap"]["share_of_span"] <= 1
        if world["key"] != "earth":
            assert world["first_dated_at"] is not None
            assert 0 <= world["first_dated_at"] <= 1


def test_report_tells_the_same_story(payload: dict):
    report = audit.render_report(payload)
    assert "# The line is not a clock" in report
    assert "Dataset snapshot: 2026-10-27" in report
    assert "## Finding 1" in report
    assert "## Finding 2" in report
    assert "## Finding 3" in report
    assert "## What the data cannot support" in report
    assert "9.2 billion years" in report
    assert "400.0 million years" in report
    assert "55 years" in report
