/* The data page: read the published tables, derive the charts, and keep
   every number traceable to data/analysis.json or data/events.csv.

   No chart library, no WebGL, no animation loop. The SVGs are drawn once
   per layout width and redrawn on resize. */

const NS = "http://www.w3.org/2000/svg";

const state = {
  analysis: null,
  events: [],
  sources: new Map(),
  worlds: new Map(),
  filters: { search: "", world: "", kind: "" },
};

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

/* formatting ----------------------------------------------------------- */

function trim(value, digits) {
  return value
    .toFixed(digits)
    .replace(/(\.\d*?)0+$/, "$1")
    .replace(/\.$/, "");
}

function fmtPct(value, digits = 0) {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return (
    (value * 100).toLocaleString("en-US", {
      maximumFractionDigits: digits,
      minimumFractionDigits: 0,
    }) + "%"
  );
}

function fmtMult(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  if (value < 1) return `${trim(value, 2)}×`;
  if (value >= 100) return `${Math.round(value).toLocaleString("en-US")}×`;
  return `${trim(value, 1)}×`;
}

function fmtLongYears(value) {
  const years = Math.abs(Number(value));
  if (years >= 1e9) return `${trim(years / 1e9, 1)} billion years`;
  if (years >= 1e6) return `${trim(years / 1e6, 0)} million years`;
  if (years >= 1e3) return `${trim(years / 1e3, 0)} thousand years`;
  return `${Math.round(years).toLocaleString("en-US")} years`;
}

function fmtAge(value) {
  const years = Number(value);
  if (!years) return "today";
  if (years >= 1e9) return `${trim(years / 1e9, years >= 1e10 ? 1 : 2)} Ga`;
  if (years >= 1e6) return `${trim(years / 1e6, 0)} Ma`;
  if (years >= 1e3) return `${trim(years / 1e3, 0)} ka`;
  return `${years.toLocaleString("en-US")} yr`;
}

function kindLabel(kind) {
  if (kind === "deep_time") return "deep time";
  if (kind === "dated") return "dated observation";
  if (kind === "today") return "today";
  return kind || "event";
}

/* DOM and SVG helpers -------------------------------------------------- */

function svgEl(tag, attributes = {}, text) {
  const node = document.createElementNS(NS, tag);
  for (const [key, value] of Object.entries(attributes)) {
    if (value === undefined || value === null) continue;
    node.setAttribute(key, value);
  }
  if (text !== undefined && text !== null) node.textContent = String(text);
  return node;
}

let chartSequence = 0;

function chartSvg(width, height, title, description) {
  const svg = svgEl("svg", {
    viewBox: `0 0 ${width} ${height}`,
    preserveAspectRatio: "xMidYMid meet",
    role: "img",
  });
  const id = ++chartSequence;
  const titleId = `chart-${id}-title`;
  const descId = `chart-${id}-desc`;
  svg.setAttribute("aria-labelledby", `${titleId} ${descId}`);
  svg.append(
    svgEl("title", { id: titleId }, title),
    svgEl("desc", { id: descId }, description)
  );
  return svg;
}

function svgText(x, y, value, className, anchor = "start") {
  return svgEl("text", { x, y, class: className, "text-anchor": anchor }, value);
}

function mount(host, svg) {
  host.replaceChildren(svg);
}

function widthOf(host) {
  return Math.max(320, Math.round(host.getBoundingClientRect().width || 320));
}

function escapeTitle(text) {
  return String(text ?? "").replace(/\s+/g, " ").trim();
}

/* CSV ------------------------------------------------------------------ */

function parseCSV(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (char !== "\r") {
      field += char;
    }
  }

  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }

  const headers = (rows.shift() || []).map((header) => header.trim());
  return rows
    .filter((candidate) => candidate.some((value) => value !== ""))
    .map((candidate) =>
      Object.fromEntries(headers.map((header, index) => [header, candidate[index] ?? ""]))
    );
}

/* chart 1: chapter coverage -------------------------------------------- */

function renderCoverage(host, worlds) {
  const width = widthOf(host);
  const compact = width < 620;
  const rowHeight = compact ? 25 : 30;
  const top = compact ? 20 : 24;
  const bottom = 38;
  const height = top + worlds.length * rowHeight + bottom;
  const labelWidth = compact ? 56 : 88;
  const rightWidth = compact ? 9 : 104;
  const x0 = labelWidth + 6;
  const x1 = width - rightWidth;
  const trackWidth = x1 - x0;
  const rowsBottom = top + worlds.length * rowHeight;

  const svg = chartSvg(
    width,
    height,
    "Chapter coverage by world",
    "Ten rows, one per world. Nine marks per row sit at the chapter's editorial position from 0 to 1. Hollow marks are deep-time chapters, rust marks are dated observations, and black marks are Today states."
  );

  for (const position of [0, 0.25, 0.5, 0.75, 1]) {
    const x = x0 + position * trackWidth;
    svg.append(
      svgEl("line", {
        x1: x,
        x2: x,
        y1: top - 8,
        y2: rowsBottom - 1,
        class: "svg-grid",
      })
    );
  }

  for (const position of [0, 0.5, 1]) {
    svg.append(
      svgText(x0 + position * trackWidth, rowsBottom + 16, trim(position, 1), "svg-axis", "middle")
    );
  }

  svg.append(svgText((x0 + x1) / 2, height - 6, "editorial position — not time", "svg-axis svg-axis--title", "middle"));

  worlds.forEach((world, index) => {
    const y = top + index * rowHeight + rowHeight / 2;
    const nameClass = world.key === "earth" ? "svg-label svg-label--signal" : "svg-label";
    svg.append(svgText(0, y + 4, world.name, nameClass));
    svg.append(svgEl("line", { x1: x0, x2: x1, y1: y, y2: y, class: "svg-rule" }));

    for (const chapter of world.chapters) {
      const x = x0 + chapter.layout_at * trackWidth;
      const kind = chapter.time_kind;
      const radius = kind === "today" ? 4.2 : kind === "dated" ? 4 : 3.2;
      const cls = kind === "deep_time" ? "svg-deep" : kind === "dated" ? "svg-dated" : "svg-today";
      const group = svgEl("g");
      group.append(
        svgEl(
          "title",
          {},
          `${escapeTitle(world.name)} · ${escapeTitle(chapter.time_label)} — ${escapeTitle(chapter.event)} (${kindLabel(kind)})`
        ),
        svgEl("circle", { cx: x, cy: y, r: radius, class: cls })
      );
      svg.append(group);
    }

    if (!compact) {
      svg.append(
        svgText(width, y + 4, `${world.dated_count} dated`, "svg-muted", "end")
      );
    }
  });

  mount(host, svg);
}

/* chart 2: Earth editorial vs linear ---------------------------------- */

const EARTH_PALETTE = [
  "#e9e4da",
  "#e0d7c8",
  "#d5c9b6",
  "#c9baa3",
  "#bcaa90",
  "#ae9a7c",
  "#9f8969",
  "#b2542b",
];

function renderEarth(host, earth) {
  const width = widthOf(host);
  const compact = width < 620;
  const barHeight = compact ? 26 : 32;
  const barWidth = width - 1;
  const y1 = 18;
  const annotation1 = y1 + barHeight + 18;
  const y2 = annotation1 + 30;
  const annotation2 = y2 + barHeight + 18;
  const height = annotation2 + 24;
  const last = earth.segments.length - 1;

  const svg = chartSvg(
    width,
    height,
    "Earth: the same intervals, two scales",
    `Two bars show the same eight intervals. The top bar uses the published editorial spacing; the bottom bar uses true duration. The final interval takes ${fmtPct(earth.last_segment.line_share)} of the line and ${fmtPct(earth.last_segment.time_share, 2)} of the time.`
  );

  svg.append(svgText(0, 8, "EDITORIAL LINE", "svg-kicker"));
  svg.append(svgText(width, 8, "as published", "svg-muted", "end"));

  let x = 0;
  earth.segments.forEach((segment, index) => {
    const segmentWidth = segment.line_share * barWidth;
    const fill = EARTH_PALETTE[index] || EARTH_PALETTE[last];
    const group = svgEl("g");
    group.append(
      svgEl(
        "title",
        {},
        `${escapeTitle(segment.from_event)} → ${escapeTitle(segment.to_event)}: ${escapeTitle(segment.years_label)}; ${fmtPct(segment.line_share, 2)} of line; ${fmtPct(segment.time_share, 2)} of time; ${fmtMult(segment.expansion)} expansion`
      ),
      svgEl("rect", {
        x,
        y: y1,
        width: Math.max(segmentWidth - 1, 1),
        height: barHeight,
        fill,
      })
    );
    if (segmentWidth > 22) {
      group.append(
        svgText(
          x + segmentWidth / 2,
          y1 + barHeight / 2 + 3,
          index + 1,
          index === last ? "svg-seg-num svg-seg-num--light" : "svg-seg-num",
          "middle"
        )
      );
    }
    svg.append(group);
    x += segmentWidth;
  });

  svg.append(svgText(0, annotation1, `${fmtPct(earth.first_segment.line_share, 1)} of line`, "svg-annot"));
  svg.append(
    svgText(width, annotation1, `${fmtPct(earth.last_segment.line_share)} of line`, "svg-annot svg-annot--signal", "end")
  );

  svg.append(svgText(0, y2 - 10, "LINEAR TIME", "svg-kicker"));
  svg.append(svgText(width, y2 - 10, "same eight intervals", "svg-muted", "end"));

  x = 0;
  earth.segments.forEach((segment, index) => {
    const segmentWidth = segment.time_share * barWidth;
    const fill = EARTH_PALETTE[index] || EARTH_PALETTE[last];
    const group = svgEl("g");
    group.append(
      svgEl(
        "title",
        {},
        `${escapeTitle(segment.from_event)} → ${escapeTitle(segment.to_event)}: ${escapeTitle(segment.years_label)}; ${fmtPct(segment.line_share, 2)} of line; ${fmtPct(segment.time_share, 2)} of time; ${fmtMult(segment.expansion)} expansion`
      ),
      svgEl("rect", {
        x,
        y: y2,
        width: Math.max(segmentWidth - 1, 1),
        height: barHeight,
        fill,
      })
    );
    if (segmentWidth > 22) {
      group.append(
        svgText(
          x + segmentWidth / 2,
          y2 + barHeight / 2 + 3,
          index + 1,
          index === last ? "svg-seg-num svg-seg-num--light" : "svg-seg-num",
          "middle"
        )
      );
    }
    svg.append(group);
    x += segmentWidth;
  });

  svg.append(
    svgText(0, annotation2, `${fmtPct(earth.first_segment.time_share, 2)} of time`, "svg-annot svg-annot--strong")
  );
  svg.append(
    svgText(width, annotation2, `${fmtPct(earth.last_segment.time_share, 2)} of time`, "svg-annot svg-annot--signal", "end")
  );

  svg.append(svgText(0, height - 4, `${earth.span_label} ago`, "svg-axis"));
  svg.append(svgText(width, height - 4, "today", "svg-axis", "end"));

  mount(host, svg);
}

/* chart 3: largest gap shares ----------------------------------------- */

function renderGaps(host, worlds) {
  const width = widthOf(host);
  const compact = width < 620;
  const sorted = [...worlds].sort(
    (a, b) => b.largest_gap.share_of_span - a.largest_gap.share_of_span
  );
  const rowHeight = compact ? 27 : 31;
  const top = 18;
  const bottom = 36;
  const height = top + sorted.length * rowHeight + bottom;
  const labelWidth = compact ? 58 : 88;
  const rightWidth = compact ? 46 : 136;
  const x0 = labelWidth + 6;
  const x1 = width - rightWidth;
  const barWidth = x1 - x0;
  const rowsBottom = top + sorted.length * rowHeight;

  const svg = chartSvg(
    width,
    height,
    "Largest unsampled interval, by world",
    "Horizontal bars show each world's largest interval between consecutive chapters as a share of that world's total timeline span. The bars are normalized by each world's own span."
  );

  for (const position of [0, 0.25, 0.5, 0.75, 1]) {
    const x = x0 + position * barWidth;
    svg.append(
      svgEl("line", {
        x1: x,
        x2: x,
        y1: top - 8,
        y2: rowsBottom - 1,
        class: "svg-grid",
      })
    );
    svg.append(svgText(x, height - 7, fmtPct(position), "svg-axis", "middle"));
  }

  sorted.forEach((world, index) => {
    const gap = world.largest_gap;
    const y = top + index * rowHeight + rowHeight / 2;
    const isEarth = world.key === "earth";
    const group = svgEl("g");
    group.append(
      svgEl(
        "title",
        {},
        `${escapeTitle(world.name)}: ${escapeTitle(gap.from_event)} → ${escapeTitle(gap.to_event)}, ${escapeTitle(gap.years_label)}, ${fmtPct(gap.share_of_span)} of the world's span`
      ),
      svgText(
        0,
        y + 4,
        world.name,
        isEarth ? "svg-label svg-label--signal" : "svg-label"
      ),
      svgEl("rect", {
        x: x0,
        y: y - 4,
        width: barWidth,
        height: 8,
        rx: 1,
        class: "svg-bar-bg",
      }),
      svgEl("rect", {
        x: x0,
        y: y - 4,
        width: Math.max(gap.share_of_span * barWidth, 1),
        height: 8,
        rx: 1,
        class: isEarth ? "svg-bar-fill svg-bar-fill--signal" : "svg-bar-fill",
      }),
      svgText(
        width,
        y + 4,
        fmtPct(gap.share_of_span),
        isEarth ? "svg-label svg-label--signal" : "svg-label",
        "end"
      )
    );
    if (!compact) {
      group.append(svgText(x1 + 9, y + 4, gap.years_label, "svg-muted"));
    }
    svg.append(group);
  });

  svg.append(svgText(x0, height - 24, "share of each world's span", "svg-axis"));

  mount(host, svg);
}

/* chart 4: record mix + dated by century ------------------------------- */

function renderMix(host, worlds, datedByCentury) {
  const width = widthOf(host);
  const compact = width < 620;
  const rowHeight = compact ? 22 : 25;
  const top = 18;
  const labelWidth = compact ? 58 : 88;
  const rightWidth = compact ? 0 : 74;
  const x0 = labelWidth + 6;
  const x1 = width - rightWidth;
  const barWidth = x1 - x0;
  const rows = worlds.length + 1;
  const barsBottom = top + rows * rowHeight;
  const ruleY = barsBottom + 8;
  const centuryTitleY = barsBottom + 29;
  const centuryHeight = compact ? 58 : 70;
  const centuryBase = centuryTitleY + 16 + centuryHeight;
  const height = centuryBase + 30;

  const totals = worlds.reduce(
    (accumulator, world) => {
      accumulator.deep += world.deep_count;
      accumulator.dated += world.dated_count;
      accumulator.today += world.today_count;
      return accumulator;
    },
    { deep: 0, dated: 0, today: 0 }
  );

  const svg = chartSvg(
    width,
    height,
    "Record mix and dated observations",
    `Stacked bars show the composition of nine chapters per world; the lower panel counts the ${totals.dated} dated chapters by century. The final row aggregates all ${totals.deep + totals.dated + totals.today} chapters.`
  );

  const rowsToDraw = [
    ...worlds.map((world) => ({
      key: world.key,
      label: world.name,
      deep: world.deep_count,
      dated: world.dated_count,
      today: world.today_count,
      total: 9,
      aggregate: false,
    })),
    {
      key: "all",
      label: "All worlds",
      deep: totals.deep,
      dated: totals.dated,
      today: totals.today,
      total: totals.deep + totals.dated + totals.today,
      aggregate: true,
    },
  ];

  rowsToDraw.forEach((row, index) => {
    const y = top + index * rowHeight + rowHeight / 2;
    const isEarth = row.key === "earth";
    const labelClass = isEarth
      ? "svg-label svg-label--signal"
      : row.aggregate
        ? "svg-label svg-label--strong"
        : "svg-label";
    const group = svgEl("g");
    group.append(svgEl("title", {}, `${escapeTitle(row.label)}: ${row.deep} deep-time, ${row.dated} dated, ${row.today} today`));

    if (row.aggregate) {
      group.append(
        svgEl("line", {
          x1: x0,
          x2: width,
          y1: y - rowHeight / 2 + 6,
          y2: y - rowHeight / 2 + 6,
          class: "svg-baseline",
        })
      );
    }

    group.append(svgText(0, y + 4, row.label, labelClass));

    let x = x0;
    const segments = [
      { value: row.deep, className: "svg-bar-bg" },
      { value: row.dated, className: "svg-bar-fill svg-bar-fill--signal" },
      { value: row.today, className: "svg-bar-fill" },
    ];
    for (const segment of segments) {
      if (!segment.value) continue;
      const segmentWidth = (segment.value / row.total) * barWidth;
      const rect = svgEl("rect", {
        x,
        y: y - 4.5,
        width: segmentWidth,
        height: 9,
        class: segment.className,
      });
      group.append(rect);
      if (segmentWidth > 15) {
        group.append(
          svgText(
            x + segmentWidth / 2,
            y + 3,
            segment.value,
            segment.className.includes("svg-bar-bg") ? "svg-seg-num" : "svg-seg-num svg-seg-num--light",
            "middle"
          )
        );
      }
      x += segmentWidth;
    }

    if (!compact) {
      group.append(
        svgText(width, y + 4, `${row.dated}/${row.total} dated`, "svg-muted", "end")
      );
    }

    svg.append(group);
  });

  svg.append(svgEl("line", { x1: x0, x2: x1, y1: ruleY, y2: ruleY, class: "svg-baseline" }));
  svg.append(svgText(x0, centuryTitleY, "Dated chapters by century", "svg-kicker"));
  svg.append(svgText(x1, centuryTitleY, `n = ${totals.dated}`, "svg-muted", "end"));

  const maxCount = Math.max(...datedByCentury.map((entry) => entry.count), 1);
  const band = barWidth / Math.max(datedByCentury.length, 1);
  datedByCentury.forEach((entry, index) => {
    const ratio = entry.count / maxCount;
    const columnHeight = ratio * centuryHeight;
    const columnWidth = Math.min(compact ? 22 : 38, band * 0.46);
    const columnX = x0 + (index + 0.5) * band - columnWidth / 2;
    const columnY = centuryBase - columnHeight;
    const group = svgEl("g");
    group.append(
      svgEl("title", {}, `${entry.century}s: ${entry.count} dated chapters`),
      svgEl("rect", {
        x: columnX,
        y: columnY,
        width: columnWidth,
        height: Math.max(columnHeight, 1),
        class: "svg-century-fill",
        "fill-opacity": (0.34 + 0.66 * ratio).toFixed(2),
      }),
      svgText(columnX + columnWidth / 2, columnY - 6, entry.count, "svg-label", "middle"),
      svgText(columnX + columnWidth / 2, centuryBase + 14, `${entry.century}s`, "svg-axis", "middle")
    );
    svg.append(group);
  });

  svg.append(
    svgEl("line", {
      x1: x0,
      x2: x1,
      y1: centuryBase,
      y2: centuryBase,
      class: "svg-baseline",
    })
  );

  mount(host, svg);
}

/* stats --------------------------------------------------------------- */

function setStat(name, value) {
  $$(`[data-stat="${name}"]`).forEach((node) => {
    node.textContent = value;
  });
}

function applyStats() {
  const { counts, earth, gaps, findings } = state.analysis;
  const final = earth.last_segment;
  const first = earth.first_segment;
  const datedWorlds = state.analysis.worlds.filter((world) => world.first_dated_at !== null);
  const earliest = datedWorlds.reduce((a, b) =>
    a.first_dated_at <= b.first_dated_at ? a : b
  );
  const latest = datedWorlds.reduce((a, b) =>
    a.first_dated_at >= b.first_dated_at ? a : b
  );
  const gapWorlds = [...state.analysis.worlds].sort(
    (a, b) => b.largest_gap.share_of_span - a.largest_gap.share_of_span
  );
  const maxGap = gapWorlds[0];
  const longest = [...state.analysis.worlds].sort(
    (a, b) => b.largest_gap.years - a.largest_gap.years
  )[0];
  const earthWorld = state.analysis.worlds.find((world) => world.key === "earth");

  const topCenturies = [...state.analysis.dated_by_century]
    .sort((a, b) => b.count - a.count)
    .slice(0, 2);
  const topSum = topCenturies.reduce((sum, entry) => sum + entry.count, 0);
  const peaks = [...topCenturies]
    .sort((a, b) => a.century - b.century)
    .map((entry) => `${entry.century}s`);

  setStat("chapters", counts.chapters);
  setStat("worlds", counts.worlds);
  setStat("sources", counts.sources);
  setStat("deep-count", counts.deep_time);
  setStat("dated-count", counts.dated);
  setStat("dated-count-2", counts.dated);
  setStat("today-count", counts.today);
  setStat("dated-worlds", counts.dated_worlds);

  setStat("earth-expansion", fmtMult(final.expansion));
  setStat("earth-expansion-2", fmtMult(final.expansion));
  setStat("earth-final-line", fmtPct(final.line_share));
  setStat("earth-final-line-2", fmtPct(final.line_share));
  setStat("earth-final-time", fmtPct(final.time_share, 2));
  setStat("earth-final-time-2", fmtPct(final.time_share, 2));
  setStat("earth-final-time-3", fmtPct(final.time_share, 2));
  setStat("earth-first-line", fmtPct(first.line_share, 1));
  setStat("earth-first-time", fmtPct(first.time_share, 2));
  setStat("earth-last-vs-first", fmtMult(earth.last_vs_first));
  setStat("earth-span", earth.span_label);

  setStat("deep-median", fmtLongYears(gaps.deep_median_years));
  setStat("deep-median-2", fmtLongYears(gaps.deep_median_years));
  setStat("deep-median-3", fmtLongYears(gaps.deep_median_years));
  setStat("dated-median", fmtLongYears(gaps.dated_median_years));
  setStat("dated-median-2", fmtLongYears(gaps.dated_median_years));
  setStat("mixed-gaps", gaps.mixed);

  setStat("earth-dated", earthWorld ? earthWorld.dated_count : 0);
  setStat("earth-dated-2", earthWorld ? earthWorld.dated_count : 0);

  setStat("first-dated-min", fmtPct(earliest.first_dated_at));
  setStat("first-dated-max", fmtPct(latest.first_dated_at));
  setStat("first-dated-min-world", earliest.name);
  setStat("first-dated-max-world", latest.name);

  setStat("max-gap-share", fmtPct(maxGap.largest_gap.share_of_span));
  setStat("max-gap-world", maxGap.name);
  setStat("longest-gap-years", fmtLongYears(longest.largest_gap.years));
  setStat("longest-gap-world", longest.name);

  setStat("century-share", fmtPct(topSum / counts.dated));
  setStat("century-peaks", peaks.join(" and "));

  // The values exist in findings as well; touching them here keeps the
  // page honest if the sample changes.
  if (findings.worlds_with_no_dated_chapter.length) {
    setStat("earth-dated", 0);
    setStat("earth-dated-2", 0);
  }
}

/* table --------------------------------------------------------------- */

function populateWorldFilter() {
  const select = $("#table-world");
  if (!select) return;
  select.replaceChildren(new Option("All worlds", ""));
  for (const world of state.analysis.worlds) {
    select.append(new Option(world.name, world.key));
  }
}

function bindFilters() {
  const search = $("#table-search");
  const world = $("#table-world");
  const kind = $("#table-kind");
  const reset = $("#table-reset");

  search?.addEventListener("input", (event) => {
    state.filters.search = event.target.value.trim().toLowerCase();
    renderTable();
  });
  world?.addEventListener("change", (event) => {
    state.filters.world = event.target.value;
    renderTable();
  });
  kind?.addEventListener("change", (event) => {
    state.filters.kind = event.target.value;
    renderTable();
  });
  reset?.addEventListener("click", () => {
    state.filters = { search: "", world: "", kind: "" };
    if (search) search.value = "";
    if (world) world.value = "";
    if (kind) kind.value = "";
    renderTable();
    search?.focus();
  });
}

function tableCell(text, className = "") {
  const cell = document.createElement("td");
  if (className) cell.className = className;
  cell.textContent = text;
  return cell;
}

function kindCell(kind) {
  const cell = document.createElement("td");
  const pill = document.createElement("span");
  pill.className =
    kind === "dated"
      ? "pill pill--dated"
      : kind === "today"
        ? "pill pill--today"
        : "pill";
  pill.textContent = kind === "deep_time" ? "deep" : kind;
  cell.append(pill);
  return cell;
}

function eventCell(row) {
  const cell = document.createElement("td");
  cell.className = "event";
  const title = document.createElement("strong");
  title.textContent = row.event;
  const note = document.createElement("span");
  note.textContent = row.note;
  cell.append(title, note);
  return cell;
}

function sourceCell(row) {
  const cell = document.createElement("td");
  cell.className = "source col-source";
  const source = state.sources.get(row.source_id);
  cell.textContent = row.source_id;
  if (source) {
    cell.title = `${source.title} — ${source.publisher}`;
  }
  return cell;
}

function renderTable() {
  const body = $("#events-body");
  if (!body) return;

  const { search, world, kind } = state.filters;
  const filtered = state.events.filter((row) => {
    if (world && row.world !== world) return false;
    if (kind && row.time_kind !== kind) return false;
    if (search) {
      const haystack = [
        row.world,
        row.time_label,
        row.event,
        row.note,
        row.event_class,
        row.evidence,
        row.source_id,
      ]
        .join(" ")
        .toLowerCase();
      if (!haystack.includes(search)) return false;
    }
    return true;
  });

  const fragment = document.createDocumentFragment();
  if (!filtered.length) {
    const tr = document.createElement("tr");
    const td = tableCell("No chapters match these filters.", "table-empty");
    td.colSpan = 7;
    tr.append(td);
    fragment.append(tr);
  } else {
    for (const row of filtered) {
      const tr = document.createElement("tr");
      const worldCell = document.createElement("td");
      worldCell.className = "world";
      worldCell.textContent = state.worlds.get(row.world)?.name || row.world;
      const chapter = document.createElement("span");
      chapter.textContent = String(Number(row.chapter) + 1).padStart(2, "0");
      worldCell.append(chapter);

      const ageCell = tableCell(fmtAge(row.years_ago), "num col-age");
      ageCell.title = `${Number(row.years_ago).toLocaleString("en-US")} years before 2026`;

      tr.append(
        worldCell,
        tableCell(row.time_label),
        ageCell,
        kindCell(row.time_kind),
        eventCell(row),
        tableCell(row.evidence, "muted col-evidence"),
        sourceCell(row)
      );
      fragment.append(tr);
    }
  }

  body.replaceChildren(fragment);
  const count = $("#table-count");
  if (count) {
    count.textContent = `Showing ${filtered.length} of ${state.events.length} rows`;
  }
}

/* appendix tables ----------------------------------------------------- */

function miniTable(captionText, headers, rows, numericColumns = []) {
  const table = document.createElement("table");
  table.className = "mini";

  const caption = document.createElement("caption");
  caption.textContent = captionText;
  table.append(caption);

  const thead = document.createElement("thead");
  const headRow = document.createElement("tr");
  headers.forEach((header, index) => {
    const th = document.createElement("th");
    th.scope = "col";
    th.textContent = header;
    if (numericColumns.includes(index)) th.className = "num";
    headRow.append(th);
  });
  thead.append(headRow);
  table.append(thead);

  const tbody = document.createElement("tbody");
  for (const row of rows) {
    const tr = document.createElement("tr");
    row.forEach((value, index) => {
      const cell = document.createElement("td");
      cell.textContent = value;
      if (numericColumns.includes(index)) cell.className = "num";
      tr.append(cell);
    });
    tbody.append(tr);
  }
  table.append(tbody);
  return table;
}

function renderDetails() {
  const { earth, worlds, dated_by_century } = state.analysis;

  const coverageHost = $('[data-table="coverage"]');
  if (coverageHost) {
    coverageHost.replaceChildren(
      miniTable(
        "Chapter counts and first dated position",
        ["World", "Deep", "Dated", "Today", "First dated at"],
        worlds.map((world) => [
          world.name,
          world.deep_count,
          world.dated_count,
          world.today_count,
          world.first_dated_at === null ? "—" : fmtPct(world.first_dated_at),
        ]),
        [1, 2, 3, 4]
      )
    );
  }

  const earthHost = $('[data-table="earth"]');
  if (earthHost) {
    earthHost.replaceChildren(
      miniTable(
        "Earth intervals, editorial position and true duration",
        ["Interval", "Duration", "Line", "Time", "Expansion"],
        earth.segments.map((segment) => [
          `${segment.from_event} → ${segment.to_event}`,
          segment.years_label,
          fmtPct(segment.line_share, 2),
          fmtPct(segment.time_share, 2),
          fmtMult(segment.expansion),
        ]),
        [2, 3, 4]
      )
    );
  }

  const gapsHost = $('[data-table="gaps"]');
  if (gapsHost) {
    const sorted = [...worlds].sort(
      (a, b) => b.largest_gap.share_of_span - a.largest_gap.share_of_span
    );
    gapsHost.replaceChildren(
      miniTable(
        "Largest gap between consecutive chapters",
        ["World", "Largest gap", "Duration", "Share"],
        sorted.map((world) => [
          world.name,
          `${world.largest_gap.from_event} → ${world.largest_gap.to_event}`,
          world.largest_gap.years_label,
          fmtPct(world.largest_gap.share_of_span),
        ]),
        [3]
      )
    );
  }

  const mixHost = $('[data-table="mix"]');
  if (mixHost) {
    const totals = worlds.reduce(
      (accumulator, world) => {
        accumulator.deep += world.deep_count;
        accumulator.dated += world.dated_count;
        accumulator.today += world.today_count;
        return accumulator;
      },
      { deep: 0, dated: 0, today: 0 }
    );
    mixHost.replaceChildren(
      miniTable(
        "Chapter composition by world",
        ["World", "Deep", "Dated", "Today"],
        [
          ...worlds.map((world) => [
            world.name,
            world.deep_count,
            world.dated_count,
            world.today_count,
          ]),
          ["All worlds", totals.deep, totals.dated, totals.today],
        ],
        [1, 2, 3]
      ),
      miniTable(
        "Dated chapters by century",
        ["Century", "Dated chapters"],
        dated_by_century.map((entry) => [`${entry.century}s`, entry.count]),
        [1]
      )
    );
  }
}

/* lifecycle ----------------------------------------------------------- */

function renderCharts() {
  if (!state.analysis) return;
  const coverage = $('[data-chart="coverage"]');
  const earth = $('[data-chart="earth"]');
  const gaps = $('[data-chart="gaps"]');
  const mix = $('[data-chart="mix"]');

  if (coverage) renderCoverage(coverage, state.analysis.worlds);
  if (earth) renderEarth(earth, state.analysis.earth);
  if (gaps) renderGaps(gaps, state.analysis.worlds);
  if (mix) renderMix(mix, state.analysis.worlds, state.analysis.dated_by_century);
  renderDetails();
}

function announce(message) {
  const status = $("#data-status");
  if (status) status.textContent = message;
}

function showDataError() {
  const message =
    "The dataset could not be loaded. The downloadable files are still available below.";
  $$(".chart__canvas").forEach((host) => {
    const paragraph = document.createElement("p");
    paragraph.className = "chart-error";
    paragraph.textContent = message;
    host.replaceChildren(paragraph);
  });
  const body = $("#events-body");
  if (body) {
    const tr = document.createElement("tr");
    const td = tableCell(message, "table-empty");
    td.colSpan = 7;
    tr.append(td);
    body.replaceChildren(tr);
  }
  const count = $("#table-count");
  if (count) count.textContent = "Dataset unavailable";
  announce(message);
}

async function init() {
  try {
    const [analysisResponse, eventsResponse, sourcesResponse] = await Promise.all([
      fetch("./data/analysis.json"),
      fetch("./data/events.csv"),
      fetch("./data/sources.csv"),
    ]);
    if (!analysisResponse.ok || !eventsResponse.ok || !sourcesResponse.ok) {
      throw new Error("dataset files returned an error");
    }

    state.analysis = await analysisResponse.json();
    state.events = parseCSV(await eventsResponse.text());
    const sources = parseCSV(await sourcesResponse.text());
    state.sources = new Map(sources.map((source) => [source.source_id, source]));
    state.worlds = new Map(
      state.analysis.worlds.map((world) => [world.key, world])
    );

    applyStats();
    populateWorldFilter();
    bindFilters();
    renderTable();
    if (document.fonts?.ready) await document.fonts.ready;
    renderCharts();
    document.body.classList.add("is-ready");
    announce(
      `Dataset loaded: ${state.events.length} rows across ${state.analysis.worlds.length} worlds.`
    );
  } catch (error) {
    console.error(error);
    showDataError();
    document.body.classList.add("is-ready", "has-error");
  }
}

let resizeTimer = 0;
window.addEventListener("resize", () => {
  window.clearTimeout(resizeTimer);
  resizeTimer = window.setTimeout(() => {
    if (state.analysis) renderCharts();
  }, 160);
});

init();


