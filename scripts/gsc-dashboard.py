#!/usr/bin/env python3
"""
Build the GSC dashboard HTML from the snapshots in docs/gsc/snapshots/.

Deterministic: all metrics and classification live here, so the weekly scheduled
run produces the same numbers a human would compute by hand. Narrative belongs
in the chat summary, not in this file.

  python3 scripts/gsc-dashboard.py                    # -> docs/gsc/dashboard.html
  python3 scripts/gsc-dashboard.py --out other.html

Reads every snapshot present, so the scoreboard history grows one point per
weekly run without any extra bookkeeping.
"""

import argparse
import datetime as dt
import glob
import html
import json
import os
import re
from collections import defaultdict

SNAP_DIR = "docs/gsc/snapshots"

# Classification. Kept explicit and boring on purpose -- see docs/SEO_PLAN_2026-09-08.md.
BRAND = re.compile(r"picnic ?stor|^the picnic|piknik|picknic|thepicnic", re.I)
VENUE = re.compile(
    r"beige|countryside|country ?side|castle valley|castle farms|om niwas|"
    r"once upon|sunroom|leopard trail|terracottage|terra ?cottage|bagh|"
    r"cottage entry|aravali|house of amer",
    re.I,
)
TERRA = re.compile(r"terracottage", re.I)


def classify(q):
    if BRAND.search(q):
        return "brand"
    if VENUE.search(q):
        return "venue"
    return "other"


def load(pattern):
    """Newest snapshot matching a suffix, or None."""
    files = sorted(glob.glob(os.path.join(SNAP_DIR, pattern)))
    if not files:
        return None
    with open(files[-1], "r", encoding="utf-8") as fh:
        return json.load(fh)


def scoreboard_history():
    """One point per dated query snapshot: non-brand non-venue clicks."""
    pts = []
    for path in sorted(glob.glob(os.path.join(SNAP_DIR, "gsc-*-query.json"))):
        try:
            with open(path, "r", encoding="utf-8") as fh:
                d = json.load(fh)
        except Exception:
            continue
        rows = d.get("rows", [])
        c = sum(r["clicks"] for r in rows if classify(r["keys"][0]) == "other")
        i = sum(r["impressions"] for r in rows if classify(r["keys"][0]) == "other")
        pts.append({"end": d.get("end", "?"), "clicks": c, "impressions": i})
    return pts


def bars(series, value_key, label_key, color_var, height=132):
    """Vertical bars, 2px gaps, rounded tops, native tooltips. One series -> no legend."""
    if not series:
        return '<p class="empty">No data in this window.</p>'
    vmax = max(s[value_key] for s in series) or 1
    n = len(series)
    W, PAD_L, PAD_B = 720, 30, 22
    plot_w = W - PAD_L - 8
    slot = plot_w / n
    bw = max(3, slot - 2)  # 2px surface gap between adjacent bars

    # y ticks: 0, mid, max -- every label names a value the scale reaches
    ticks = sorted({0, round(vmax / 2), vmax})
    grid, ylab = [], []
    for t in ticks:
        y = height - (t / vmax) * height
        grid.append(f'<line x1="{PAD_L}" y1="{y:.1f}" x2="{W-8}" y2="{y:.1f}" class="grid"/>')
        ylab.append(f'<text x="{PAD_L-6}" y="{y+3.5:.1f}" class="ytick">{t}</text>')

    rects, xlab = [], []
    for i, s in enumerate(series):
        v = s[value_key]
        h = (v / vmax) * height
        x = PAD_L + i * slot
        y = height - h
        lbl = html.escape(f"{s[label_key]}: {v}")
        rects.append(
            f'<rect x="{x:.1f}" y="{y:.1f}" width="{bw:.1f}" height="{max(h,0.8):.1f}" '
            f'rx="2" fill="var({color_var})"><title>{lbl}</title></rect>'
        )
        # label first, last, and roughly every 7th so ticks never collide
        if i == 0 or i == n - 1 or i % 7 == 0:
            d = str(s[label_key])[-5:]
            rects.append("")
            xlab.append(
                f'<text x="{x + bw/2:.1f}" y="{height + 15:.1f}" class="xtick">{html.escape(d)}</text>'
            )

    return (
        f'<svg viewBox="0 0 {W} {height + PAD_B}" class="chart" '
        f'role="img" preserveAspectRatio="xMidYMid meet">'
        + "".join(grid) + "".join(ylab) + "".join(rects) + "".join(xlab)
        + f'<line x1="{PAD_L}" y1="{height}" x2="{W-8}" y2="{height}" class="axis"/>'
        + "</svg>"
    )


def table(rows, cols, cls=""):
    head = "".join(f"<th>{html.escape(c[0])}</th>" for c in cols)
    body = []
    for r in rows:
        tds = "".join(f"<td>{c[1](r)}</td>" for c in cols)
        body.append(f"<tr>{tds}</tr>")
    return (
        f'<div class="tablewrap"><table class="{cls}"><thead><tr>{head}</tr></thead>'
        f"<tbody>{''.join(body)}</tbody></table></div>"
    )


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="docs/gsc/dashboard.html")
    ap.add_argument("--artifact", action="store_true",
                    help="emit inner content only (the Artifact tool supplies the skeleton)")
    args = ap.parse_args()

    q = load("gsc-*-query.json")
    p = load("gsc-*-page.json")
    d = load("gsc-*-date.json")
    q90 = load("gsc-*-query-90d.json")
    if not q:
        raise SystemExit(f"No query snapshot in {SNAP_DIR}. Run scripts/gsc-pull.py --out first.")

    site = q.get("site_totals", {})
    s_clicks = site.get("clicks", 0)
    s_impr = site.get("impressions", 0)
    s_ctr = site.get("ctr", 0) * 100
    s_pos = site.get("position", 0)
    coverage = q.get("coverage_pct", 0)

    qrows = q.get("rows", [])
    buckets = defaultdict(lambda: {"clicks": 0, "impressions": 0, "terms": 0})
    for r in qrows:
        b = buckets[classify(r["keys"][0])]
        b["clicks"] += r["clicks"]
        b["impressions"] += r["impressions"]
        b["terms"] += 1
    other = buckets["other"]

    terra = sum(
        r["impressions"] for r in (p.get("rows", []) if p else []) if TERRA.search(r["keys"][0])
    )
    terra_c = sum(
        r["clicks"] for r in (p.get("rows", []) if p else []) if TERRA.search(r["keys"][0])
    )

    o90 = None
    if q90:
        rr = q90.get("rows", [])
        o90 = {
            "clicks": sum(r["clicks"] for r in rr if classify(r["keys"][0]) == "other"),
            "impressions": sum(r["impressions"] for r in rr if classify(r["keys"][0]) == "other"),
        }

    hist = scoreboard_history()
    days = sorted(d.get("rows", []), key=lambda r: r["keys"][0]) if d else []
    dseries = [{"d": r["keys"][0], "clicks": r["clicks"], "impressions": r["impressions"]} for r in days]

    top_q = sorted(qrows, key=lambda r: -r["impressions"])[:14]
    top_p = sorted(p.get("rows", []) if p else [], key=lambda r: -r["impressions"])[:12]

    def badge(q_):
        c = classify(q_)
        lbl = {"brand": "brand", "venue": "venue name", "other": "non-brand"}[c]
        return f'<span class="badge b-{c}">{lbl}</span>'

    def short_url(u):
        return html.escape(u.replace("https://www.picnicstories.com", "").replace(
            "https://picnicstories.com", "(non-www)") or "/")

    gen = dt.datetime.now().strftime("%d %b %Y, %H:%M")
    window = f"{q.get('start','?')} to {q.get('end','?')}"

    hist_rows = ""
    if len(hist) > 1:
        hist_rows = (
            '<section class="block"><h2>Scoreboard over time</h2>'
            '<p class="note">One point per weekly run. Read the trend, not the week.</p>'
            + bars([{"d": h["end"], "clicks": h["clicks"]} for h in hist], "clicks", "d",
                   "--series-1", height=90)
            + "</section>"
        )

    doc = f"""<title>Picnic Stories Search Console</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;500;600&display=swap">
<style>
:root {{
  color-scheme: light;
  --surface: #fcfcfb;
  --plane: #f4f4f1;
  --ink: #0b0b0b;
  --ink-2: #52514e;
  --muted: #898781;
  --grid: #e1e0d9;
  --axis: #c3c2b7;
  --rule: rgba(11,11,11,.10);
  --series-1: #2a78d6;
  --warn: #b06a00;
  --sans: "IBM Plex Sans", system-ui, -apple-system, "Segoe UI", sans-serif;
  --mono: "IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
}}
@media (prefers-color-scheme: dark) {{
  :root:not([data-theme="light"]) {{
    color-scheme: dark;
    --surface: #1a1a19; --plane: #0d0d0d; --ink: #fff; --ink-2: #c3c2b7;
    --muted: #898781; --grid: #2c2c2a; --axis: #383835;
    --rule: rgba(255,255,255,.12); --series-1: #3987e5; --warn: #eda100;
  }}
}}
:root[data-theme="dark"] {{
  color-scheme: dark;
  --surface: #1a1a19; --plane: #0d0d0d; --ink: #fff; --ink-2: #c3c2b7;
  --muted: #898781; --grid: #2c2c2a; --axis: #383835;
  --rule: rgba(255,255,255,.12); --series-1: #3987e5; --warn: #eda100;
}}
* {{ box-sizing: border-box; }}
body {{
  margin: 0; background: var(--plane); color: var(--ink);
  font-family: var(--sans); font-size: 15px; line-height: 1.5;
  -webkit-font-smoothing: antialiased;
}}
.wrap {{ max-width: 1040px; margin: 0 auto; padding: 32px 20px 64px; }}
header {{ border-bottom: 1px solid var(--rule); padding-bottom: 20px; margin-bottom: 28px; }}
h1 {{ font-size: 22px; font-weight: 600; margin: 0 0 4px; letter-spacing: -.01em; }}
.meta {{ font-family: var(--mono); font-size: 12px; color: var(--muted); }}
.meta strong {{ color: var(--ink-2); font-weight: 500; }}
h2 {{ font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: .07em;
     color: var(--ink-2); margin: 0 0 10px; }}
.block {{ margin-bottom: 34px; }}
.note {{ font-size: 13px; color: var(--muted); margin: -4px 0 12px; max-width: 62ch; }}

.scoreboard {{ background: var(--surface); border: 1px solid var(--rule);
  border-left: 3px solid var(--series-1); padding: 20px 22px; margin-bottom: 22px; }}
.scoreboard .k {{ font-size: 12px; text-transform: uppercase; letter-spacing: .07em;
  color: var(--ink-2); font-weight: 600; }}
.big {{ font-family: var(--mono); font-size: 46px; font-weight: 500; line-height: 1.05;
  margin: 6px 0 2px; }}
.scoreboard .sub {{ font-size: 13px; color: var(--muted); max-width: 60ch; }}

.tiles {{ display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 1px;
  background: var(--rule); border: 1px solid var(--rule); }}
.tile {{ background: var(--surface); padding: 14px 16px; }}
.tile .k {{ font-size: 11px; text-transform: uppercase; letter-spacing: .06em; color: var(--muted); }}
.tile .v {{ font-family: var(--mono); font-size: 24px; margin-top: 3px; }}
.tile .n {{ font-size: 11px; color: var(--muted); font-family: var(--mono); }}

.card {{ background: var(--surface); border: 1px solid var(--rule); padding: 16px 16px 8px; }}
.chart {{ width: 100%; height: auto; display: block; }}
.grid {{ stroke: var(--grid); stroke-width: 1; }}
.axis {{ stroke: var(--axis); stroke-width: 1; }}
.ytick {{ fill: var(--muted); font: 10px var(--mono); text-anchor: end; }}
.xtick {{ fill: var(--muted); font: 10px var(--mono); text-anchor: middle; }}
.empty {{ color: var(--muted); font-size: 13px; }}

.tablewrap {{ overflow-x: auto; }}
table {{ width: 100%; border-collapse: collapse; font-size: 13px; }}
th {{ text-align: left; font-weight: 500; font-size: 11px; text-transform: uppercase;
  letter-spacing: .05em; color: var(--muted); padding: 7px 10px 7px 0;
  border-bottom: 1px solid var(--rule); white-space: nowrap; }}
td {{ padding: 7px 10px 7px 0; border-bottom: 1px solid var(--rule); vertical-align: top; }}
td.n {{ font-family: var(--mono); text-align: right; font-variant-numeric: tabular-nums;
  white-space: nowrap; }}
th.n {{ text-align: right; }}
.q {{ font-family: var(--mono); font-size: 12.5px; }}
.badge {{ font-size: 10px; text-transform: uppercase; letter-spacing: .05em; padding: 2px 6px;
  border: 1px solid var(--rule); color: var(--muted); white-space: nowrap; }}
.b-other {{ color: var(--series-1); border-color: var(--series-1); }}

details {{ margin-top: 10px; border-top: 1px solid var(--rule); padding-top: 8px; }}
summary {{ cursor: pointer; font-size: 12px; color: var(--muted); }}
summary:focus-visible {{ outline: 2px solid var(--series-1); outline-offset: 2px; }}
.reading {{ background: var(--surface); border: 1px solid var(--rule); padding: 18px 20px; }}
.reading li {{ margin-bottom: 8px; font-size: 13.5px; color: var(--ink-2); max-width: 70ch; }}
.reading code {{ font-family: var(--mono); font-size: 12px; }}
.flag {{ color: var(--warn); font-weight: 600; }}
</style>

<div class="wrap">

<header>
  <h1>Picnic Stories Search Console</h1>
  <div class="meta">
    <strong>sc-domain:picnicstories.com</strong> &nbsp;·&nbsp; window {window}
    &nbsp;·&nbsp; generated {gen} &nbsp;·&nbsp; GSC lags ~3 days
  </div>
</header>

<div class="scoreboard">
  <div class="k">Scoreboard — non-brand, non-venue clicks</div>
  <div class="big">{other['clicks']}</div>
  <div class="sub">
    On {other['impressions']} impressions across {other['terms']} terms, in 28 days.
    This is the only number that measures SEO progress here. Brand searches and
    partner-venue names are demand you already had.
  </div>
</div>

<div class="tiles block">
  <div class="tile"><div class="k">Site clicks</div><div class="v">{s_clicks}</div>
    <div class="n">28 days</div></div>
  <div class="tile"><div class="k">Site impressions</div><div class="v">{s_impr}</div>
    <div class="n">CTR {s_ctr:.2f}%</div></div>
  <div class="tile"><div class="k">Query coverage</div><div class="v">{coverage:.0f}%</div>
    <div class="n">of impressions named</div></div>
  <div class="tile"><div class="k">TerraCottage</div><div class="v">{terra}</div>
    <div class="n">impressions · {terra_c} clicks</div></div>
</div>

<section class="block">
  <h2>Daily clicks</h2>
  <div class="card">{bars(dseries, 'clicks', 'd', '--series-1')}
    <details><summary>Table view</summary>
      {table(dseries, [("Date", lambda r: html.escape(r['d'])),
                       ("Clicks", lambda r: f'<span class="n">{r["clicks"]}</span>'),
                       ("Impressions", lambda r: f'<span class="n">{r["impressions"]}</span>')])}
    </details>
  </div>
</section>

<section class="block">
  <h2>Daily impressions</h2>
  <p class="note">Plotted separately from clicks on purpose — one scale per chart. Two
  measures of different magnitude on shared axes invents a correlation that isn't there.</p>
  <div class="card">{bars(dseries, 'impressions', 'd', '--series-1')}</div>
</section>

{hist_rows}

<section class="block">
  <h2>Where impressions came from</h2>
  <p class="note">Split computed on the {coverage:.0f}% of impressions GSC actually names.
  The rest are anonymised long-tail queries — so treat these as shares of the visible
  slice, never of the site.</p>
  {table([("Brand", buckets['brand']), ("Partner / venue names", buckets['venue']),
          ("Non-brand, non-venue", other)],
         [("Group", lambda r: r[0]),
          ("Terms", lambda r: f'<span class="n">{r[1]["terms"]}</span>'),
          ("Clicks", lambda r: f'<span class="n">{r[1]["clicks"]}</span>'),
          ("Impressions", lambda r: f'<span class="n">{r[1]["impressions"]}</span>')])}
</section>

<section class="block">
  <h2>Top queries</h2>
  {table(top_q, [("Query", lambda r: f'<span class="q">{html.escape(r["keys"][0])}</span>'),
                 ("", lambda r: badge(r["keys"][0])),
                 ("Clicks", lambda r: f'<span class="n">{r["clicks"]}</span>'),
                 ("Impr.", lambda r: f'<span class="n">{r["impressions"]}</span>'),
                 ("Pos.", lambda r: f'<span class="n">{r["position"]:.1f}</span>')])}
</section>

<section class="block">
  <h2>Top pages</h2>
  {table(top_p, [("Page", lambda r: f'<span class="q">{short_url(r["keys"][0])}</span>'),
                 ("Clicks", lambda r: f'<span class="n">{r["clicks"]}</span>'),
                 ("Impr.", lambda r: f'<span class="n">{r["impressions"]}</span>'),
                 ("Pos.", lambda r: f'<span class="n">{r["position"]:.1f}</span>')])}
</section>

<section class="block">
  <h2>How to read this</h2>
  <div class="reading">
    <ul>
      <li><span class="flag">Never quote site-level average position.</span> It moves with
        the mix of what draws impressions, not with ranking. Partner-venue impressions
        flooding in or draining out will swing it several places while nothing about your
        rankings changed.</li>
      <li><span class="flag">Always state coverage.</span> This window names
        <code>{coverage:.0f}%</code> of impressions. Any percentage split above is a share
        of that slice only.</li>
      <li><span class="flag">A week is noise.</span> At this volume, week-over-week
        movement is within normal variation. Compare 28-day windows, and compare a fixed
        query set across them rather than the headline.</li>
      <li><span class="flag">Clicks are not bookings.</span> Almost all confirmed bookings
        never touched the site. Rising clicks do not imply rising revenue here.</li>
    </ul>
  </div>
</section>

<div class="meta">Source: Google Search Console API · built by
<code>scripts/gsc-dashboard.py</code> from <code>{SNAP_DIR}/</code> ·
method in <code>docs/SEO_PLAN_2026-09-08.md</code></div>

</div>
"""

    if not args.artifact:
        doc = (
            '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n'
            '<meta name="viewport" content="width=device-width, initial-scale=1">\n'
            + doc.replace('<div class="wrap">', '</head>\n<body>\n<div class="wrap">', 1)
            + "</body>\n</html>\n"
        )

    os.makedirs(os.path.dirname(args.out) or ".", exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as fh:
        fh.write(doc)

    print(f"[dashboard] wrote {args.out}")
    print(f"[dashboard] window {window}  site {s_clicks}c/{s_impr}i  coverage {coverage:.0f}%")
    print(f"[dashboard] SCOREBOARD non-brand non-venue: {other['clicks']}c / {other['impressions']}i")
    if o90:
        print(f"[dashboard] 90d non-brand non-venue: {o90['clicks']}c / {o90['impressions']}i")
    print(f"[dashboard] TerraCottage: {terra_c}c / {terra}i   history points: {len(hist)}")


if __name__ == "__main__":
    main()
