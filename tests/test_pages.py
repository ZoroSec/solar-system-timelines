"""Static checks for the three routes and the constraints on /data.html."""

from __future__ import annotations

import re
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import unquote, urlparse

import pytest

ROOT = Path(__file__).resolve().parents[1]
PAGES = ["index.html", "timeline.html", "data.html"]


class PageParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.refs: list[tuple[str, str, str]] = []
        self.ids: list[str] = []
        self.h1: list[str] = []
        self._in_h1 = False
        self._h1_text: list[str] = []

    def handle_starttag(self, tag, attrs):
        values = dict(attrs)
        if "id" in values and values["id"]:
            self.ids.append(values["id"])
        for attribute in ("href", "src"):
            if values.get(attribute):
                self.refs.append((tag, attribute, values[attribute]))
        if tag == "h1":
            self._in_h1 = True
            self._h1_text = []

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)

    def handle_endtag(self, tag):
        if tag == "h1" and self._in_h1:
            self.h1.append(" ".join("".join(self._h1_text).split()))
            self._in_h1 = False

    def handle_data(self, data):
        if self._in_h1:
            self._h1_text.append(data)


def parse_page(name: str) -> PageParser:
    parser = PageParser()
    parser.feed((ROOT / name).read_text(encoding="utf-8"))
    return parser


def local_target(page: Path, ref: str) -> Path | None:
    ref = ref.strip()
    if not ref or ref.startswith("#"):
        return None
    parsed = urlparse(ref)
    if parsed.scheme or parsed.netloc:
        return None
    path = unquote(parsed.path)
    if not path:
        return None
    if path.startswith("/"):
        target = (ROOT / path.lstrip("/")).resolve()
    else:
        target = (page.parent / path).resolve()
    if target.is_dir():
        target = target / "index.html"
    return target


@pytest.mark.parametrize("name", PAGES)
def test_page_has_one_h1(name: str):
    parser = parse_page(name)
    assert len(parser.h1) == 1, (name, parser.h1)


@pytest.mark.parametrize("name", PAGES)
def test_page_ids_are_unique(name: str):
    parser = parse_page(name)
    duplicates = {value for value in parser.ids if parser.ids.count(value) > 1}
    assert not duplicates, (name, sorted(duplicates))


@pytest.mark.parametrize("name", PAGES)
def test_local_references_resolve(name: str):
    page = ROOT / name
    missing = []
    for tag, attribute, ref in parse_page(name).refs:
        target = local_target(page, ref)
        if target is not None and not target.exists():
            missing.append((tag, attribute, ref, str(target)))
    assert not missing, (name, missing)


@pytest.mark.parametrize("name", ["home.css", "styles.css", "data.css"])
def test_css_assets_resolve(name: str):
    text = (ROOT / name).read_text(encoding="utf-8")
    missing = []
    for match in re.finditer(r"url\(\s*(['\"]?)(.*?)\1\s*\)", text, re.S):
        ref = match.group(2).strip()
        if ref.startswith(("data:", "http://", "https://", "#")):
            continue
        target = (ROOT / ref).resolve()
        if not target.exists():
            missing.append(ref)
    assert not missing, (name, missing)


def test_home_and_timeline_link_to_the_data_page():
    for name in ("index.html", "timeline.html"):
        html = (ROOT / name).read_text(encoding="utf-8")
        assert 'href="./data.html"' in html, name
        assert "Data &amp; methods" in html, name


def test_data_page_has_one_route_of_its_own():
    html = (ROOT / "data.html").read_text(encoding="utf-8")
    assert 'aria-current="page"' in html
    assert 'href="./data.html"' in html
    assert 'href="./timeline.html"' in html
    assert 'href="./"' in html


def test_data_page_charts_and_table_are_present():
    html = (ROOT / "data.html").read_text(encoding="utf-8")
    for chart in ("coverage", "earth", "gaps", "mix"):
        assert f'data-chart="{chart}"' in html
        assert f'data-table="{chart}"' in html
    for control in ("table-search", "table-world", "table-kind", "table-reset", "events-body"):
        assert f'id="{control}"' in html
    for download in ("events.csv", "worlds.csv", "sources.csv", "analysis.json"):
        assert download in html
    assert "analysis/audit.py" in html
    assert "reports/time-axis-audit.md" in html


def test_data_page_describes_the_real_schema():
    header = (ROOT / "data" / "events.csv").read_text(encoding="utf-8").splitlines()[0]
    assert len(header.split(",")) == 17
    html = (ROOT / "data.html").read_text(encoding="utf-8")
    assert "seventeen columns" in html
    assert "nineteen columns" not in html


def test_data_page_states_its_limitations():
    html = (ROOT / "data.html").read_text(encoding="utf-8")
    assert "Limitations" in html
    assert "curated sample" in html
    assert "not a random or complete inventory" in html
    assert "not evidence that nothing happened" in html
    assert "blank range means" in html
    assert "2026-10-27" in html


def test_data_page_explains_the_gap_classes():
    html = (ROOT / "data.html").read_text(encoding="utf-8")
    js = (ROOT / "data.js").read_text(encoding="utf-8")
    assert 'data-stat="mixed-gaps"' in html
    assert "boundary gaps" in html
    assert "only deep-to-deep and dated-to-dated gaps enter the two figures" in html
    assert 'setStat("mixed-gaps", gaps.mixed)' in js


def test_data_page_is_accessible_static_markup():
    html = (ROOT / "data.html").read_text(encoding="utf-8")
    assert '<a class="skip-link" href="#main">' in html
    assert '<main id="main">' in html
    assert 'aria-live="polite"' in html
    assert '<noscript>' in html
    assert 'role="img"' not in html  # SVGs add their own accessible names in JS


def test_data_page_avoids_webgl_and_animation_loops():
    html = (ROOT / "data.html").read_text(encoding="utf-8")
    js = (ROOT / "data.js").read_text(encoding="utf-8")
    assert "<canvas" not in html.lower()
    assert "getcontext(" not in js.lower()
    assert "requestanimationframe" not in js.lower()
    assert "three.module" not in html.lower()


def test_data_page_does_not_reintroduce_hidden_overflow():
    css = (ROOT / "data.css").read_text(encoding="utf-8")
    compact = re.sub(r"\s+", "", css).lower()
    assert "overflow:hidden" not in compact
    assert ".colophon" not in css
    site_head = re.search(r"\.site-head\s*\{(.*?)\}", css, re.S)
    assert site_head is not None
    assert "position:fixed" not in re.sub(r"\s+", "", site_head.group(1)).lower()


def test_data_script_fetches_existing_local_files():
    js = (ROOT / "data.js").read_text(encoding="utf-8")
    refs = re.findall(r'fetch\(\s*["\'](\.[^"\']+)["\']', js)
    assert set(refs) == {"./data/analysis.json", "./data/events.csv", "./data/sources.csv"}
    for ref in refs:
        assert (ROOT / ref).resolve().exists(), ref


def test_readme_local_references_resolve():
    text = (ROOT / "README.md").read_text(encoding="utf-8")
    missing = []
    for ref in re.findall(r"!?\[[^\]]*\]\(([^)]+)\)", text):
        ref = ref.strip()
        if ref.startswith(("http://", "https://", "#", "mailto:")):
            continue
        target = (ROOT / ref.split("#")[0]).resolve()
        if not target.exists():
            missing.append(ref)
    assert not missing, missing


def test_timeline_discloses_the_editorial_scale():
    html = (ROOT / "timeline.html").read_text(encoding="utf-8")
    assert "Editorial spacing, not to scale" in html
    assert "spacing is editorial" in html
    assert 'id="scale-disclosure"' in html
    assert 'aria-describedby="scale-disclosure"' in html
    assert "The timeline's spacing is editorial and not to scale." in html
