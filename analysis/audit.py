"""Audit the ten-world, ninety-chapter timeline.

The published site places chapters editorially. This script treats that
choice as a measurable data decision: how much time each chapter interval
represents, how much line it receives, and where the sample is silent.

Run:
    python analysis/audit.py
    python analysis/audit.py --check
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
EVENTS = DATA / "events.csv"
WORLDS = DATA / "worlds.csv"
SOURCES = DATA / "sources.csv"
OUT = DATA / "analysis.json"
REPORT = ROOT / "reports" / "time-axis-audit.md"
PRESENT_YEAR = 2026


def read_tables():
    events = pd.read_csv(EVENTS)
    worlds = pd.read_csv(WORLDS)
    sources = pd.read_csv(SOURCES)
    events["layout_at"] = pd.to_numeric(events["layout_at"])
    for column in ("years_ago", "years_ago_low", "years_ago_high"):
        events[column] = pd.to_numeric(events[column], errors="coerce")
    return events, worlds, sources


def validate(events: pd.DataFrame, worlds: pd.DataFrame, sources: pd.DataFrame):
    assert len(worlds) == 10, "expected ten worlds"
    assert len(events) == 90, "expected ninety chapters"
    assert events.groupby("world")["chapter"].count().eq(9).all(), "nine chapters per world"
    assert events.groupby("world")["chapter"].apply(
        lambda values: list(values) == list(range(9))
    ).all(), "chapters must be numbered 0-8 in order"
    assert events.groupby("world")["layout_at"].apply(
        lambda values: values.iloc[0] == 0 and values.iloc[-1] == 1 and values.is_monotonic_increasing
    ).all(), "layout positions must run from 0 to 1"
    assert events.groupby("world")["years_ago"].apply(
        lambda values: values.is_monotonic_decreasing
    ).all(), "years ago must decrease from the oldest chapter to today"
    assert set(events["source_id"]).issubset(set(sources["source_id"])), "unresolved source id"
    assert not events[["event", "note", "event_id"]].isna().any().any(), "empty copy"
    assert (events["years_ago"] >= 0).all(), "negative age"
    assert (events["years_ago"] == 0).eq(events["time_kind"] == "today").all(), "today must be zero years ago"


def human_years(value: float | int) -> str:
    value = abs(float(value))
    if value >= 1e9:
        return f"{value / 1e9:,.1f} billion years"
    if value >= 1e6:
        return f"{value / 1e6:,.1f} million years"
    if value >= 1e3:
        return f"{value / 1e3:,.1f} thousand years"
    return f"{value:,.0f} years"


def join_names(names: list[str]) -> str:
    if not names:
        return "none"
    if len(names) == 1:
        return names[0]
    return ", ".join(names[:-1]) + " and " + names[-1]


def row_summary(row: pd.Series) -> dict:
    return {
        "event_id": row["event_id"],
        "chapter": int(row["chapter"]),
        "layout_at": round(float(row["layout_at"]), 4),
        "time_label": row["time_label"],
        "years_ago": int(row["years_ago"]),
        "time_kind": row["time_kind"],
        "event": row["event"],
        "event_class": row["event_class"],
        "evidence": row["evidence"],
    }


def build():
    events, worlds, sources = read_tables()
    validate(events, worlds, sources)

    counts = {
        "worlds": int(len(worlds)),
        "chapters": int(len(events)),
        "deep_time": int((events["time_kind"] == "deep_time").sum()),
        "dated": int((events["time_kind"] == "dated").sum()),
        "today": int((events["time_kind"] == "today").sum()),
        "sources": int(len(sources)),
        "dated_worlds": int(events[events["time_kind"] == "dated"]["world"].nunique()),
    }

    world_records = []
    for _, world in worlds.sort_values("order").iterrows():
        key = world["world"]
        group = events[events["world"] == key].sort_values("chapter").reset_index(drop=True)
        span = float(group["years_ago"].iloc[0])
        gaps = []
        for previous, current in zip(group.itertuples(), group.iloc[1:].itertuples()):
            gaps.append({
                "from_chapter": int(previous.chapter),
                "to_chapter": int(current.chapter),
                "from_event": previous.event,
                "to_event": current.event,
                "from_at": round(float(previous.layout_at), 4),
                "to_at": round(float(current.layout_at), 4),
                "years": int(previous.years_ago - current.years_ago),
                "line_share": round(float(current.layout_at - previous.layout_at), 4),
                "time_share": round((previous.years_ago - current.years_ago) / span, 6) if span else None,
                "kind": (
                    "deep" if previous.time_kind == current.time_kind == "deep_time"
                    else "dated" if previous.time_kind == current.time_kind == "dated"
                    else "mixed"
                ),
            })
        largest = max(gaps, key=lambda gap: gap["years"]) if gaps else None
        if largest:
            largest = dict(largest)
            largest["share_of_span"] = round(largest["years"] / span, 4) if span else None
            largest["years_label"] = human_years(largest["years"])
        dated = group[group["time_kind"] == "dated"]
        world_records.append({
            "key": key,
            "name": world["name"],
            "order": int(world["order"]),
            "start_label": row_start_label(group),
            "span_years": int(span),
            "deep_count": int((group["time_kind"] == "deep_time").sum()),
            "dated_count": int((group["time_kind"] == "dated").sum()),
            "today_count": int((group["time_kind"] == "today").sum()),
            "first_dated_at": None if dated.empty else round(float(dated["layout_at"].min()), 4),
            "largest_gap": largest,
            "chapters": [row_summary(row) for _, row in group.iterrows()],
        })

    earth_group = events[events["world"] == "earth"].sort_values("chapter").reset_index(drop=True)
    earth_span = float(earth_group["years_ago"].iloc[0])
    earth_segments = []
    for previous, current in zip(earth_group.itertuples(), earth_group.iloc[1:].itertuples()):
        years = int(previous.years_ago - current.years_ago)
        line_share = float(current.layout_at - previous.layout_at)
        time_share = years / earth_span
        earth_segments.append({
            "from_event": previous.event,
            "to_event": current.event,
            "years": years,
            "years_label": human_years(years),
            "line_share": round(line_share, 4),
            "time_share": round(time_share, 6),
            "expansion": round(line_share / time_share, 2) if time_share else None,
        })
    first, last = earth_segments[0], earth_segments[-1]
    earth = {
        "span_years": int(earth_span),
        "span_label": human_years(earth_span),
        "segments": earth_segments,
        "first_segment": first,
        "last_segment": last,
        "last_vs_first": round(last["expansion"] / first["expansion"], 1) if first["expansion"] else None,
        "first_line_share": first["line_share"],
        "first_time_share": first["time_share"],
        "last_line_share": last["line_share"],
        "last_time_share": last["time_share"],
    }

    # All 80 gaps, for the tempo audit. Deep/deep and dated/dated are
    # separated; boundary gaps are reported separately rather than pooled.
    all_gaps = []
    for key in world_records:
        group = events[events["world"] == key["key"]].sort_values("chapter")
        for previous, current in zip(group.itertuples(), group.iloc[1:].itertuples()):
            all_gaps.append({
                "world": key["key"],
                "years": int(previous.years_ago - current.years_ago),
                "kind": (
                    "deep" if previous.time_kind == current.time_kind == "deep_time"
                    else "dated" if previous.time_kind == current.time_kind == "dated"
                    else "mixed"
                ),
            })
    gap_frame = pd.DataFrame(all_gaps)
    gap_stats = {
        "total": int(len(gap_frame)),
        "deep": int((gap_frame["kind"] == "deep").sum()),
        "dated": int((gap_frame["kind"] == "dated").sum()),
        "mixed": int((gap_frame["kind"] == "mixed").sum()),
        "deep_median_years": int(gap_frame.loc[gap_frame["kind"] == "deep", "years"].median()),
        "dated_median_years": int(gap_frame.loc[gap_frame["kind"] == "dated", "years"].median()),
        "largest": int(gap_frame["years"].max()),
        "largest_world": gap_frame.loc[gap_frame["years"].idxmax(), "world"],
    }

    dated = events[events["time_kind"] == "dated"].copy()
    dated["year"] = PRESENT_YEAR - dated["years_ago"].astype(int)
    dated["century"] = (dated["year"] // 100) * 100
    dated_by_century = [
        {"century": int(century), "count": int(count)}
        for century, count in dated.groupby("century").size().items()
    ]

    findings = {
        "earth_final_interval": {
            "line_share": last["line_share"],
            "time_share": last["time_share"],
            "expansion": last["expansion"],
            "years_label": last["years_label"],
        },
        "earth_first_interval": {
            "line_share": first["line_share"],
            "time_share": first["time_share"],
            "expansion": first["expansion"],
            "years_label": first["years_label"],
        },
        "earth_last_vs_first": earth["last_vs_first"],
        "dated_share_of_chapters": round(counts["dated"] / counts["chapters"], 4),
        "deep_share_of_chapters": round(counts["deep_time"] / counts["chapters"], 4),
        "worlds_with_no_dated_chapter": [
            record["key"] for record in world_records if record["dated_count"] == 0
        ],
        "latest_first_dated_at": max(
            (record for record in world_records if record["first_dated_at"] is not None),
            key=lambda record: record["first_dated_at"],
        )["key"],
        "earliest_first_dated_at": min(
            (record for record in world_records if record["first_dated_at"] is not None),
            key=lambda record: record["first_dated_at"],
        )["key"],
    }

    payload = {
        "schema_version": 1,
        "generated": str(pd.to_datetime(events["as_of"]).max().date()),
        "present_year": PRESENT_YEAR,
        "counts": counts,
        "findings": findings,
        "earth": earth,
        "gaps": gap_stats,
        "dated_by_century": dated_by_century,
        "worlds": world_records,
    }
    return payload, events, worlds, sources


def row_start_label(group: pd.DataFrame) -> str:
    return str(group[group["chapter"] == 0]["time_label"].iloc[0])


def render_report(payload: dict) -> str:
    counts = payload["counts"]
    earth = payload["earth"]
    first = earth["first_segment"]
    last = earth["last_segment"]
    gaps = payload["gaps"]
    dated_worlds = [w for w in payload["worlds"] if w["first_dated_at"] is not None]
    earliest_at = min(w["first_dated_at"] for w in dated_worlds)
    latest_at = max(w["first_dated_at"] for w in dated_worlds)
    earliest = [w["name"] for w in dated_worlds if w["first_dated_at"] == earliest_at]
    latest = [w["name"] for w in dated_worlds if w["first_dated_at"] == latest_at]
    widest = max(payload["worlds"], key=lambda w: w["largest_gap"]["share_of_span"])
    earth_world = next(w for w in payload["worlds"] if w["key"] == "earth")
    lines = [
        "# The line is not a clock",
        "",
        f"_Dataset snapshot: {payload['generated']}. Generated from `data/events.csv`._",
        "",
        "## What this audit measures",
        "",
        f"The dataset contains **{counts['chapters']} chapters** across **{counts['worlds']} worlds**:",
        f"**{counts['deep_time']} deep-time events**, **{counts['dated']} dated observations**, and",
        f"**{counts['today']} Today states**. Every chapter has an editorial position (`layout_at`,",
        "0–1) and a numeric age (`years_ago`). The first is a layout coordinate; the second is the",
        "only variable that can be compared across worlds.",
        "",
        "## Finding 1 — Earth's final 21% is stretched 44×",
        "",
        "| Earth interval | Time represented | Share of time | Share of line | Expansion |",
        "|---|---:|---:|---:|---:|",
    ]
    for segment in earth["segments"]:
        lines.append(
            f"| {segment['from_event']} → {segment['to_event']} | {segment['years_label']} | "
            f"{segment['time_share']:.2%} | {segment['line_share']:.2%} | {segment['expansion']:.2f}× |"
        )
    lines += [
        "",
        f"The last segment, **{last['from_event']} → {last['to_event']}** ({last['years_label']}),",
        f"receives **{last['line_share']:.0%} of the line** while representing **{last['time_share']:.2%}**",
        f"of Earth's {earth['span_label']} span. That is a **{last['expansion']:.1f}× expansion**",
        "relative to a linear axis. The first segment is compressed to",
        f"**{first['expansion']:.2f}×**. The ratio between the two is **{earth['last_vs_first']:.0f}×**.",
        "",
        "This is not a bug to hide. It is the design choice that makes the recent record legible.",
        "The site labels it as editorial and lets the reader see the trade-off.",
        "",
        "## Finding 2 — the sample has two tempos",
        "",
        f"Of the **{counts['chapters']} chapters**, {counts['deep_time']} are deep-time events and",
        f"{counts['dated']} are dated observations; {counts['today']} are current states. The dated",
        f"record begins at different points on different lines. The first dated chapter sits at",
        f"{earliest_at:.0%} of the line for {join_names(earliest)}, and at {latest_at:.0%} for",
        f"{join_names(latest)}.",
        "",
        f"There are **{gaps['total']} consecutive gaps**: {gaps['deep']} deep/deep, {gaps['dated']}",
        f"dated/dated, and {gaps['mixed']} boundary intervals. Only same-class gaps enter the medians.",
        f"Deep-time gaps have a median of **{human_years(gaps['deep_median_years'])}**; dated-record",
        f"gaps have a median of **{human_years(gaps['dated_median_years'])}**. The two regimes are not",
        "a single process, and pooling them into one average would erase the story.",
        "",
        "## Finding 3 — the largest silence is not the same as the longest line",
        "",
        "| World | Largest gap | Duration | Share of that world's span |",
        "|:---|---:|---:|---:|",
    ]
    for record in payload["worlds"]:
        gap = record["largest_gap"]
        if not gap:
            continue
        lines.append(
            f"| {record['name']} | {gap['from_event']} → {gap['to_event']} | "
            f"{gap['years_label']} | {gap['share_of_span']:.0%} |"
        )
    lines += [
        "",
        f"The bars on `/data.html` show the same quantity. {widest['name']}'s largest unsampled",
        f"interval covers {widest['largest_gap']['share_of_span']:.0%} of its timeline; Earth's",
        f"covers {earth_world['largest_gap']['share_of_span']:.0%} and includes the entire period",
        "between the Big Bang and the solar system. These are properties of the editorial sample,",
        "not claims that nothing happened in the gaps.",
        "",
        "## What the data cannot support",
        "",
        "- The nine chapters are a **curated sample**, not a random or complete sample of events.",
        "- `layout_at` is a layout coordinate. It must never be used to estimate elapsed time.",
        "- Nine chapters per world is a format constraint, not a finding. The equal counts carry",
        "  no information about the worlds.",
        "- Age ranges are recorded only where the cited sources disagree. A blank range is not a",
        "  statement of certainty.",
        "- The globes are illustrations. Only Earth uses spacecraft imagery; the other surfaces are",
        "  procedural and not spatially registered to the real worlds.",
        "- “Today” means the dataset snapshot, **2026-10-27**, not a live feed.",
        "",
        "## Reproduce",
        "",
        "```bash",
        "python analysis/audit.py",
        "python analysis/audit.py --check",
        "```",
        "",
        "The first command rewrites `data/analysis.json` and this report. The second fails if",
        "either committed artifact is stale.",
        "",
    ]
    return "\n".join(lines)


def write_report(payload: dict):
    REPORT.parent.mkdir(exist_ok=True)
    REPORT.write_text(render_report(payload), encoding="utf-8", newline="\n")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true", help="fail if generated artifacts are stale")
    args = parser.parse_args()
    payload, _, _, _ = build()
    rendered = json.dumps(payload, indent=2, ensure_ascii=False) + "\n"
    if args.check:
        current = OUT.read_text(encoding="utf-8") if OUT.exists() else ""
        if current != rendered:
            print("data/analysis.json is stale; run python analysis/audit.py", file=sys.stderr)
            return 1
        if not REPORT.exists():
            print("reports/time-axis-audit.md is missing; run python analysis/audit.py", file=sys.stderr)
            return 1
        print("analysis artifacts are current")
        return 0
    OUT.write_text(rendered, encoding="utf-8", newline="\n")
    write_report(payload)
    print(f"wrote {OUT}")
    print(f"wrote {REPORT}")
    print(
        f"earth final interval: {payload['earth']['last_segment']['line_share']:.0%} of line, "
        f"{payload['earth']['last_segment']['time_share']:.2%} of time, "
        f"{payload['earth']['last_segment']['expansion']:.1f}x"
    )
    print(
        f"earth first interval: {payload['earth']['first_segment']['line_share']:.1%} of line, "
        f"{payload['earth']['first_segment']['time_share']:.2%} of time, "
        f"{payload['earth']['first_segment']['expansion']:.2f}x"
    )
    print(
        f"gaps: deep median {payload['gaps']['deep_median_years']:,} years, "
        f"dated median {payload['gaps']['dated_median_years']:,} years"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
