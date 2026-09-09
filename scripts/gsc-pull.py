#!/usr/bin/env python3
"""
Pull Google Search Console data for picnicstories.com.

Runs on the machine that holds the service-account key, so the key is never
uploaded anywhere. Credentials are resolved in this order:

  1. --sa <path>
  2. $GSC_SA_JSON
  3. auto-discovery: any *.json under $HOME/mnt/*/ (or ./) whose contents are a
     service_account key

Only dependency is google-auth (for RS256 JWT signing); everything else is
stdlib. Install with:  python3 -m pip install --quiet google-auth

Usage
-----
  python3 scripts/gsc-pull.py                          # 28d, by query
  python3 scripts/gsc-pull.py --days 90 --dim page
  python3 scripts/gsc-pull.py --start 2026-08-11 --end 2026-09-05
  python3 scripts/gsc-pull.py --days 28 --out docs/gsc/gsc-2026-09-08.json

Read the numbers with the traps in mind — see docs/SEO_PLAN_2026-09-08.md:
never quote site-level average position, and always state query-table coverage
before quoting any percentage split.
"""

import argparse
import datetime as dt
import glob
import json
import os
import sys
import urllib.error
import urllib.request

PROPERTY = "sc-domain:picnicstories.com"
SCOPE = "https://www.googleapis.com/auth/webmasters.readonly"
API = "https://searchconsole.googleapis.com/webmasters/v3/sites/{}/searchAnalytics/query"


def find_sa(explicit=None):
    """Locate the service-account JSON without ever printing its contents."""
    candidates = []
    if explicit:
        candidates.append(explicit)
    if os.environ.get("GSC_SA_JSON"):
        candidates.append(os.environ["GSC_SA_JSON"])
    # Explicit shallow patterns only. A recursive walk would crawl multi-GB of
    # untracked media, and plain glob() silently skips dot-directories such as
    # .secrets/ -- which is exactly where the key lives.
    for pat in (
        "~/mnt/*/.secrets/*.json",
        "~/mnt/*/.credentials/*.json",
        "~/mnt/*/credentials/*.json",
        "~/mnt/*/*.json",
        "./.secrets/*.json",
        "./*.json",
    ):
        candidates.extend(sorted(glob.glob(os.path.expanduser(pat))))

    for path in candidates:
        try:
            with open(path, "r", encoding="utf-8") as fh:
                blob = json.load(fh)
        except Exception:
            continue
        if isinstance(blob, dict) and blob.get("type") == "service_account":
            return path, blob
    return None, None


def get_token(sa):
    from google.oauth2 import service_account
    from google.auth.transport.requests import Request

    creds = service_account.Credentials.from_service_account_info(sa, scopes=[SCOPE])
    creds.refresh(Request())
    return creds.token


def query(token, start, end, dimensions, limit):
    body = {
        "startDate": start,
        "endDate": end,
        "dimensions": dimensions,
        "rowLimit": limit,
        "type": "web",
    }
    req = urllib.request.Request(
        API.format(urllib.parse.quote(PROPERTY, safe="")),
        data=json.dumps(body).encode(),
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
    )
    with urllib.request.urlopen(req, timeout=60) as resp:
        return json.load(resp)


def main():
    ap = argparse.ArgumentParser(description="Pull GSC search analytics.")
    ap.add_argument("--sa", help="path to the service-account JSON")
    ap.add_argument("--days", type=int, default=28)
    ap.add_argument("--start")
    ap.add_argument("--end")
    ap.add_argument("--dim", default="query",
                help="query | page | date | device | country; comma-separate to cross them, e.g. query,page")
    ap.add_argument("--limit", type=int, default=1000)
    ap.add_argument("--out", help="write full JSON here")
    args = ap.parse_args()

    sa_path, sa = find_sa(args.sa)
    if not sa:
        sys.exit(
            "No service-account JSON found.\n"
            "Pass --sa <path>, set $GSC_SA_JSON, or make sure the credentials\n"
            "folder is connected to this session."
        )
    print(f"[gsc] credentials: {sa_path}", file=sys.stderr)
    print(f"[gsc] account:     {sa.get('client_email')}", file=sys.stderr)

    # GSC data lags ~3 days; default window ends there so runs are comparable.
    end = args.end or (dt.date.today() - dt.timedelta(days=3)).isoformat()
    start = args.start or (
        dt.date.fromisoformat(end) - dt.timedelta(days=args.days - 1)
    ).isoformat()

    try:
        token = get_token(sa)
        dims = [d.strip() for d in args.dim.split(",") if d.strip()]
        # True site totals come from a separate dimension-less query. Summing the
        # returned rows is NOT the site total: --limit truncates, and GSC omits
        # anonymised long-tail queries entirely from the query dimension.
        site = query(token, start, end, [], 1)
        data = query(token, start, end, dims, args.limit)
    except ImportError:
        sys.exit("google-auth missing. Run: python3 -m pip install --quiet google-auth")
    except urllib.error.HTTPError as e:
        sys.exit(f"HTTP {e.code}: {e.read().decode()[:400]}")

    rows = data.get("rows", [])
    clicks = sum(r.get("clicks", 0) for r in rows)
    impressions = sum(r.get("impressions", 0) for r in rows)
    ctr = (clicks / impressions * 100) if impressions else 0

    srow = (site.get("rows") or [{}])[0]
    s_clicks = srow.get("clicks", 0)
    s_impr = srow.get("impressions", 0)
    coverage = (impressions / s_impr * 100) if s_impr else 0

    print(f"\n{PROPERTY}   {start} -> {end}   (dimension: {args.dim})")
    print(f"SITE TOTALS    clicks {s_clicks}   impressions {s_impr}   "
          f"CTR {srow.get('ctr', 0) * 100:.2f}%   avg pos {srow.get('position', 0):.1f}")
    print(f"RETURNED ROWS  {len(rows)} rows   clicks {clicks}   impressions {impressions}   "
          f"CTR {ctr:.2f}%")
    print(f"COVERAGE       these rows are {coverage:.0f}% of site impressions "
          f"-- state this before quoting any % split")
    print("-" * 78)
    for r in sorted(rows, key=lambda r: -r.get("impressions", 0))[:30]:
        key = r.get("keys", ["?"])[0]
        print(
            f"{r.get('clicks',0):>4}c {r.get('impressions',0):>6}i "
            f"pos {r.get('position',0):>5.1f}  {key[:58]}"
        )

    if args.out:
        os.makedirs(os.path.dirname(args.out) or ".", exist_ok=True)
        with open(args.out, "w", encoding="utf-8") as fh:
            json.dump(
                {
                    "property": PROPERTY,
                    "start": start,
                    "end": end,
                    "dimension": args.dim,
                    "site_totals": srow,
                    "coverage_pct": round(coverage, 1),
                    "pulled_at": dt.datetime.now().isoformat(timespec="seconds"),
                    "totals": {
                        "clicks": clicks,
                        "impressions": impressions,
                        "ctr": round(ctr, 2),
                    },
                    "rows": rows,
                },
                fh,
                indent=1,
            )
        print(f"\n[gsc] wrote {args.out}")


if __name__ == "__main__":
    import urllib.parse  # noqa: E402  (used in query())

    main()
