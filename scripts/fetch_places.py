# /// script
# requires-python = ">=3.11"
# dependencies = ["requests", "shapely>=2"]
# ///
"""Look up Wikipedia/Wikidata info for the slice's places (build time only).

    uv run scripts/fetch_places.py [--slice slice1] [--refresh]

Reads   data/places.curated.json, data/boundary/<slice>.geojson
Writes  data/raw/<slice>.places.json  (committed; cached unless --refresh)

- checks every curated 'wiki' title exists (following redirects) and gets its Wikidata id
- Wikipedia geosearch inside the boundary finds other articles (minus 'discover.exclude')
- Hindi labels from Wikidata for discovered places
The browser fetches the card text itself at runtime; this only decides which titles to use.
"""

from __future__ import annotations

import argparse
import json
import math
import re
from pathlib import Path

import requests
from shapely.geometry import Point, shape

ROOT = Path(__file__).resolve().parent.parent
HEADERS = {"User-Agent": "PixelJaipur/0.1 (https://github.com/gaurangv/pixeljaipur)"}
WP = "https://en.wikipedia.org/w/api.php"
WD = "https://www.wikidata.org/w/api.php"


def get(url: str, **params) -> dict:
    r = requests.get(url, params={"format": "json", **params}, headers=HEADERS, timeout=30)
    r.raise_for_status()
    return r.json()


def resolve_titles(titles: list[str]) -> dict[str, dict]:
    """title -> {title (canonical), qid} or {missing: True}."""
    if not titles:
        return {}
    q = get(WP, action="query", redirects=1, prop="pageprops", ppprop="wikibase_item", titles="|".join(titles))["query"]
    alias = {n["from"]: n["to"] for n in q.get("normalized", [])}
    alias.update({r["from"]: r["to"] for r in q.get("redirects", [])})
    pages = {p["title"]: p for p in q["pages"].values()}
    out = {}
    for t in titles:
        c = alias.get(alias.get(t, t), alias.get(t, t))
        p = pages.get(c, {})
        out[t] = {"missing": True} if "missing" in p or not p else {"title": c, "qid": p.get("pageprops", {}).get("wikibase_item")}
    return out


def hindi_labels(qids: list[str]) -> dict[str, str]:
    qids = [q for q in qids if q]
    if not qids:
        return {}
    e = get(WD, action="wbgetentities", ids="|".join(qids), props="labels", languages="hi")["entities"]
    return {k: v["labels"]["hi"]["value"] for k, v in e.items() if "hi" in v.get("labels", {})}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--slice", default="slice1")
    ap.add_argument("--refresh", action="store_true")
    args = ap.parse_args()
    out = ROOT / "data/raw" / f"{args.slice}.places.json"
    if out.exists() and not args.refresh:
        print(f"Using cached {out.relative_to(ROOT)} (use --refresh to re-query)")
        return

    curated = json.loads((ROOT / "data/places.curated.json").read_text(encoding="utf-8"))
    b = json.loads((ROOT / "data/boundary" / f"{args.slice}.geojson").read_text(encoding="utf-8"))
    poly = shape(b["features"][0]["geometry"])
    c = poly.centroid
    # radius (m) that covers the whole boundary, roughly
    r = max(math.hypot((x - c.x) * 111_320 * math.cos(math.radians(c.y)), (y - c.y) * 110_574) for x, y in poly.exterior.coords)

    titles = [p["wiki"] for p in curated["places"] if p.get("wiki")]
    resolved = resolve_titles(titles)
    for t, v in resolved.items():
        print(f"  curated  {t!r}: {'MISSING' if v.get('missing') else v}")

    geo = get(WP, action="query", list="geosearch", gscoord=f"{c.y}|{c.x}", gsradius=min(10_000, int(r) + 50), gslimit=100)
    exclude = [re.compile(p, re.I) for p in curated.get("discover", {}).get("exclude", [])]
    known = {v.get("title") for v in resolved.values()} | set(titles)
    found = []
    for g in geo["query"]["geosearch"]:
        t = g["title"]
        if t in known or any(p.search(t) for p in exclude) or not poly.contains(Point(g["lon"], g["lat"])):
            continue
        found.append({"title": t, "lon": g["lon"], "lat": g["lat"]})
    extra = resolve_titles([f["title"] for f in found])
    hi = hindi_labels([v.get("qid") for v in extra.values()])
    for f in found:
        f["qid"] = extra.get(f["title"], {}).get("qid")
        if f["qid"] in hi:
            f["nameHi"] = hi[f["qid"]]
        print(f"  discovered {f}")
    if not found:
        print("  discovered nothing new inside the boundary")

    out.write_text(json.dumps({"curated": resolved, "discovered": found}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {out.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
