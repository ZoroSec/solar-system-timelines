# The line is not a clock

_Dataset snapshot: 2026-10-27. Generated from `data/events.csv`._

## What this audit measures

The dataset contains **90 chapters** across **10 worlds**:
**46 deep-time events**, **34 dated observations**, and
**10 Today states**. Every chapter has an editorial position (`layout_at`,
0–1) and a numeric age (`years_ago`). The first is a layout coordinate; the second is the
only variable that can be compared across worlds.

## Finding 1 — Earth's final 21% is stretched 44×

| Earth interval | Time represented | Share of time | Share of line | Expansion |
|---|---:|---:|---:|---:|
| Big Bang → Protoplanet | 9.2 billion years | 66.67% | 7.50% | 0.11× |
| Protoplanet → Magma ocean | 100.0 million years | 0.72% | 3.70% | 5.11× |
| Magma ocean → First oceans | 100.0 million years | 0.72% | 4.00% | 5.52× |
| First oceans → First life | 700.0 million years | 5.07% | 13.30% | 2.62× |
| First life → Snowball Earth | 3.0 billion years | 22.10% | 27.50% | 1.24× |
| Snowball Earth → Pangaea | 400.0 million years | 2.90% | 10.20% | 3.52× |
| Pangaea → Chicxulub | 184.0 million years | 1.33% | 12.80% | 9.60× |
| Chicxulub → Earth | 66.0 million years | 0.48% | 21.00% | 43.91× |

The last segment, **Chicxulub → Earth** (66.0 million years),
receives **21% of the line** while representing **0.48%**
of Earth's 13.8 billion years span. That is a **43.9× expansion**
relative to a linear axis. The first segment is compressed to
**0.11×**. The ratio between the two is **399×**.

This is not a bug to hide. It is the design choice that makes the recent record legible.
The site labels it as editorial and lets the reader see the trade-off.

## Finding 2 — the sample has two tempos

Of the **90 chapters**, 46 are deep-time events and
34 are dated observations; 10 are current states. The dated
record begins at different points on different lines. The first dated chapter sits at
39% of the line for Jupiter, Saturn and Neptune, and at 74% for
Mars.

There are **80 consecutive gaps**: 36 deep/deep, 25
dated/dated, and 19 boundary intervals. Only same-class gaps enter the medians.
Deep-time gaps have a median of **400.0 million years**; dated-record
gaps have a median of **55 years**. The two regimes are not
a single process, and pooling them into one average would erase the story.

## Finding 3 — the largest silence is not the same as the longest line

| World | Largest gap | Duration | Share of that world's span |
|:---|---:|---:|---:|
| Sun | Main sequence → Spots traced | 4.1 billion years | 89% |
| Mercury | The shrinking → The first transit | 3.5 billion years | 76% |
| Venus | The runaway → Resurfacing | 2.3 billion years | 50% |
| Earth | Big Bang → Protoplanet | 9.2 billion years | 67% |
| Moon | Maria → Galileo's map | 3.2 billion years | 71% |
| Mars | Drying → Imaginary canals | 2.0 billion years | 43% |
| Jupiter | Four moons → Galileo looks | 4.0 billion years | 87% |
| Saturn | Titan is born → The rings | 4.3 billion years | 93% |
| Uranus | A mantle of ice → Moons in line | 2.0 billion years | 43% |
| Neptune | Triton, backwards → A misplaced star | 4.0 billion years | 87% |

The bars on `/data.html` show the same quantity. Saturn's largest unsampled
interval covers 93% of its timeline; Earth's
covers 67% and includes the entire period
between the Big Bang and the solar system. These are properties of the editorial sample,
not claims that nothing happened in the gaps.

## What the data cannot support

- The ninety chapters are a **curated sample**, not a random or complete sample of events.
- `layout_at` is a layout coordinate. It must never be used to estimate elapsed time.
- Nine chapters per world is a format constraint, not a finding. The equal counts carry
  no information about the worlds.
- Age ranges are recorded only where the cited sources disagree. A blank range is not a
  statement of certainty.
- The globes are illustrations. Only Earth uses spacecraft imagery; the other surfaces are
  procedural and not spatially registered to the real worlds.
- “Today” means the dataset snapshot, **2026-10-27**, not a live feed.

## Reproduce

```bash
python analysis/audit.py
python analysis/audit.py --check
```

The first command rewrites `data/analysis.json` and this report. The second fails if
either committed artifact is stale.
