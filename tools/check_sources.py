"""Check every source URL without making the test suite depend on the network.

Publisher bot protection returns 401/403/429 for real pages, so those are
reported as blocked rather than broken. Every other non-2xx response fails.

Usage:
    python tools/check_sources.py
    python tools/check_sources.py --strict   # blocked counts as failure
"""

from __future__ import annotations

import argparse
import csv
import ssl
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SOURCES = ROOT / "data" / "sources.csv"
USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36"
)


def check(row: dict, timeout: float) -> dict:
    request = urllib.request.Request(
        row["url"],
        headers={"User-Agent": USER_AGENT, "Accept": "text/html,*/*"},
    )
    try:
        with urllib.request.urlopen(
            request, timeout=timeout, context=ssl.create_default_context()
        ) as response:
            return {
                "id": row["source_id"],
                "status": response.status,
                "final": response.geturl(),
                "error": "",
            }
    except urllib.error.HTTPError as error:
        return {
            "id": row["source_id"],
            "status": error.code,
            "final": row["url"],
            "error": str(error.reason),
        }
    except Exception as error:  # noqa: BLE001 - report the failure, keep going
        return {
            "id": row["source_id"],
            "status": 0,
            "final": row["url"],
            "error": f"{type(error).__name__}: {error}",
        }


def classify(status: int) -> str:
    if 200 <= status < 400:
        return "ok"
    if status in (401, 403, 429):
        return "blocked"
    return "broken"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--timeout", type=float, default=30.0)
    parser.add_argument("--strict", action="store_true", help="fail on blocked responses")
    args = parser.parse_args()

    with SOURCES.open(encoding="utf-8", newline="") as handle:
        rows = list(csv.DictReader(handle))
    urls = {row["source_id"]: row["url"] for row in rows}

    with ThreadPoolExecutor(max_workers=8) as pool:
        results = list(pool.map(lambda row: check(row, args.timeout), rows))

    failures = []
    for result in sorted(results, key=lambda item: item["id"]):
        state = classify(result["status"])
        moved = "" if result["final"] == urls[result["id"]] else f" -> {result['final']}"
        print(f"{state.upper():7} {result['status']:3} {result['id']:24}{moved}")
        if state == "broken" or (args.strict and state == "blocked"):
            failures.append(result)
            if result["error"]:
                print(f"        {result['error']}")

    print(
        f"\n{len(results)} sources: "
        f"{sum(classify(item['status']) == 'ok' for item in results)} ok, "
        f"{sum(classify(item['status']) == 'blocked' for item in results)} blocked, "
        f"{sum(classify(item['status']) == 'broken' for item in results)} broken."
    )
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
