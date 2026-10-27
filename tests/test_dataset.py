"""Contract tests for the published event, world and source tables."""

from __future__ import annotations

from pathlib import Path
from urllib.parse import urlparse

import pandas as pd
import pytest

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"

EVENT_COLUMNS = [
    "event_id",
    "world",
    "chapter",
    "layout_at",
    "time_label",
    "years_ago",
    "years_ago_low",
    "years_ago_high",
    "time_kind",
    "event",
    "note",
    "event_class",
    "evidence",
    "status",
    "source_id",
    "source_note",
    "as_of",
]
WORLD_COLUMNS = [
    "world",
    "order",
    "name",
    "body_type",
    "start_label",
    "chapter_count",
    "headline",
    "credit",
    "source_id",
]
SOURCE_COLUMNS = ["source_id", "title", "publisher", "url", "kind", "notes", "accessed"]

TIME_KINDS = {"deep_time", "dated", "today"}
EVIDENCE = {"observed", "inferred", "modeled", "hypothesis", "state"}
STATUSES = {"past", "current", "ongoing", "planned"}
EVENT_CLASSES = {
    "cosmic",
    "formation",
    "geological",
    "impact",
    "climate",
    "life",
    "observation",
    "mission",
    "status",
}
SOURCE_KINDS = {"overview", "mission", "paper", "dataset", "program", "reference"}
BODY_TYPES = {"star", "planet", "moon"}
AS_OF = "2026-10-27"


@pytest.fixture(scope="module")
def events() -> pd.DataFrame:
    return pd.read_csv(DATA / "events.csv")


@pytest.fixture(scope="module")
def worlds() -> pd.DataFrame:
    return pd.read_csv(DATA / "worlds.csv")


@pytest.fixture(scope="module")
def sources() -> pd.DataFrame:
    return pd.read_csv(DATA / "sources.csv")


def test_event_table_schema(events: pd.DataFrame):
    assert list(events.columns) == EVENT_COLUMNS
    assert len(events) == 90
    assert events["event_id"].is_unique
    assert not events[["event_id", "world", "event", "note", "time_label"]].isna().any().any()
    assert set(events["time_kind"]) == TIME_KINDS
    assert set(events["evidence"]) <= EVIDENCE
    assert set(events["status"]) <= STATUSES
    assert set(events["event_class"]) <= EVENT_CLASSES
    assert set(events["as_of"].astype(str)) == {AS_OF}


def test_ten_worlds_nine_chapters_each(events: pd.DataFrame):
    counts = events.groupby("world")["chapter"].agg(["count", "min", "max"])
    assert len(counts) == 10
    assert (counts["count"] == 9).all()
    assert (counts["min"] == 0).all()
    assert (counts["max"] == 8).all()
    for world, group in events.groupby("world"):
        assert list(group["chapter"]) == list(range(9)), world


def test_event_ids_are_stable_and_ordered(events: pd.DataFrame):
    for row in events.itertuples():
        expected = f"{row.world}_{int(row.chapter) + 1:02d}"
        assert row.event_id == expected, (row.event_id, expected)


def test_layout_is_an_editorial_coordinate(events: pd.DataFrame):
    assert events["layout_at"].between(0, 1).all()
    for world, group in events.groupby("world"):
        values = group.sort_values("chapter")["layout_at"].tolist()
        assert values[0] == 0, world
        assert values[-1] == 1, world
        assert all(b > a for a, b in zip(values, values[1:])), world


def test_ages_are_numeric_and_monotonic(events: pd.DataFrame):
    assert events["years_ago"].notna().all()
    assert (events["years_ago"] >= 0).all()
    assert (events["years_ago"] == events["years_ago"].round()).all()
    for world, group in events.groupby("world"):
        values = group.sort_values("chapter")["years_ago"].tolist()
        assert values[0] > 0, world
        assert values[-1] == 0, world
        assert all(b < a for a, b in zip(values, values[1:])), world


def test_today_is_one_zero_aged_state_per_world(events: pd.DataFrame):
    today = events[events["time_kind"] == "today"]
    assert len(today) == 10
    assert (today["years_ago"] == 0).all()
    assert (today["chapter"] == 8).all()
    assert (events.loc[events["years_ago"] == 0, "time_kind"] == "today").all()


def test_dated_labels_match_numeric_ages(events: pd.DataFrame):
    dated = events[events["time_kind"] == "dated"]
    labels = dated["time_label"].astype(str)
    assert labels.str.fullmatch(r"\d{4}").all()
    assert (dated["years_ago"] == 2026 - labels.astype(int)).all()


def test_ranges_are_complete_and_contain_the_point_age(events: pd.DataFrame):
    has_low = events["years_ago_low"].notna()
    has_high = events["years_ago_high"].notna()
    assert (has_low == has_high).all()
    ranged = events[has_low]
    assert len(ranged) > 0
    assert (ranged["years_ago_low"] < ranged["years_ago_high"]).all()
    assert (ranged["years_ago_low"] <= ranged["years_ago"]).all()
    assert (ranged["years_ago"] <= ranged["years_ago_high"]).all()
    assert ranged["source_note"].notna().all()
    assert (ranged["years_ago_low"] >= 0).all()
    # A blank range means "no range assigned", never a statement of certainty.
    assert events.loc[~has_low, "source_note"].isna().all()


def test_every_source_id_resolves(events: pd.DataFrame, worlds: pd.DataFrame, sources: pd.DataFrame):
    source_ids = set(sources["source_id"])
    assert set(events["source_id"]) <= source_ids
    assert set(worlds["source_id"]) <= source_ids


def test_world_table_schema(worlds: pd.DataFrame, events: pd.DataFrame, sources: pd.DataFrame):
    assert list(worlds.columns) == WORLD_COLUMNS
    assert len(worlds) == 10
    assert worlds["world"].is_unique
    assert worlds["name"].is_unique
    assert list(worlds.sort_values("order")["order"]) == list(range(10))
    assert set(worlds["world"]) == set(events["world"])
    assert (worlds["chapter_count"] == 9).all()
    assert set(worlds["body_type"]) <= BODY_TYPES
    assert not worlds[["world", "name", "start_label", "headline", "credit"]].isna().any().any()
    assert set(worlds["source_id"]) <= set(sources["source_id"])


def test_source_table_schema(sources: pd.DataFrame):
    assert list(sources.columns) == SOURCE_COLUMNS
    assert len(sources) == 36
    assert sources["source_id"].is_unique
    assert sources["url"].is_unique
    assert not sources[["source_id", "title", "publisher", "url", "kind", "notes"]].isna().any().any()
    assert set(sources["kind"]) <= SOURCE_KINDS
    assert set(sources["accessed"].astype(str)) == {AS_OF}
    for row in sources.itertuples():
        parsed = urlparse(row.url)
        assert parsed.scheme in {"http", "https"}, row.source_id
        assert parsed.netloc, row.source_id
        assert not parsed.fragment, row.source_id


def test_scientific_corrections_are_present(events: pd.DataFrame):
    indexed = events.set_index("event_id")
    assert indexed.loc["sun_04", "event"] == "Main sequence"
    assert "1659" in indexed.loc["saturn_05", "note"]
    assert indexed.loc["moon_08", "event"] == "Last samples"
    assert "November 2026" in indexed.loc["mercury_09", "note"]
    assert indexed.loc["earth_09", "note"] == "8.2 billion people"


def test_event_ids_follow_the_naming_contract(events: pd.DataFrame):
    assert events["event_id"].str.fullmatch(r"[a-z]+_\d{2}").all()
    assert set(events["world"]) == {
        "sun",
        "mercury",
        "venus",
        "earth",
        "moon",
        "mars",
        "jupiter",
        "saturn",
        "uranus",
        "neptune",
    }
    assert not events.duplicated(["world", "chapter"]).any()
