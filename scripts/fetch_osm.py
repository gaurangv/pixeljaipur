# /// script
# requires-python = ">=3.11"
# dependencies = ["requests", "numpy", "shapely>=2", "pyproj>=3.6"]
# ///
"""Fetch OSM features for a boundary polygon and project them to local metres.

    uv run scripts/fetch_osm.py                       # slice1, uses cached raw if present
    uv run scripts/fetch_osm.py --slice slice1 --refresh

Reads   data/boundary/<slice>.geojson   (WGS84 polygon)
Writes  data/raw/<slice>.osm.json       (Overpass response, committed; never hand-edit)
        data/build/<slice>.osm.geojson  (local metres: +x east, +y north, origin Badi Chaupar)

scripts/build_slice.py then merges this with Overture into data/build/<slice>.geojson.

Area features are Polygon/MultiPolygon with properties.kind in:
building | road | footway | open | green | water. Roads are buffered to polygons.
Roads also emit a kind=centerline LineString (with properties.class) for later steps.
Map data (c) OpenStreetMap contributors, ODbL.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

import requests
from pyproj import Transformer
import numpy as np
import shapely
from shapely import make_valid
from shapely.geometry import LineString, MultiPolygon, Polygon, mapping, shape
from shapely.ops import polygonize, unary_union

ROOT = Path(__file__).resolve().parent.parent

# Local origin: Badi Chaupar (OSM node "Badi Chaupar", place=locality).
ORIGIN_LAT, ORIGIN_LON = 26.9225798, 75.8267125

MIRRORS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
]
USER_AGENT = "pixeljaipur-data-script/0.1"

# Approximate carriageway widths in metres, by OSM highway class.
ROAD_WIDTHS = {
    "trunk": 16, "primary": 14, "secondary": 12, "tertiary": 10,
    "unclassified": 7, "residential": 6, "living_street": 5, "service": 4,
    "trunk_link": 8, "primary_link": 8, "secondary_link": 7, "tertiary_link": 6,
}
FOOT_WIDTHS = {"pedestrian": 6, "footway": 3, "path": 2, "steps": 3, "cycleway": 2}

OPEN_TAGS = {
    ("place", "square"), ("highway", "pedestrian"), ("amenity", "marketplace"),
    ("amenity", "parking"), ("landuse", "retail"), ("landuse", "commercial"),
}
GREEN_TAGS = {
    ("leisure", "park"), ("leisure", "garden"), ("landuse", "grass"),
    ("landuse", "recreation_ground"), ("natural", "scrub"), ("natural", "wood"),
}


def overpass_query(poly_wgs: Polygon) -> str:
    # Overpass poly filter wants "lat lon lat lon ..."
    coords = " ".join(f"{lat:.7f} {lon:.7f}" for lon, lat in poly_wgs.exterior.coords[:-1])
    f = f'(poly:"{coords}")'
    return f"""[out:json][timeout:90];
(
  way["building"]{f};
  relation["building"]{f};
  way["highway"]{f};
  way["landuse"]{f};
  way["leisure"]{f};
  way["natural"]{f};
  way["amenity"~"marketplace|parking"]{f};
  way["place"="square"]{f};
  relation["type"="multipolygon"]["landuse"]{f};
  relation["type"="multipolygon"]["leisure"]{f};
);
out geom tags;"""


def fetch(query: str) -> dict:
    delay = 5
    last_err: Exception | None = None
    for attempt in range(6):
        url = MIRRORS[attempt % len(MIRRORS)]
        try:
            print(f"  Overpass: {url} (attempt {attempt + 1})")
            r = requests.post(url, data={"data": query}, headers={"User-Agent": USER_AGENT}, timeout=180)
            if r.status_code == 200:
                return r.json()
            last_err = RuntimeError(f"HTTP {r.status_code}: {r.text[:120]!r}")
        except (requests.RequestException, ValueError) as e:
            last_err = e
        print(f"  failed: {last_err}; retrying in {delay}s")
        time.sleep(delay)
        delay *= 2
    raise SystemExit(f"Overpass failed on all mirrors: {last_err}")


def way_coords(el: dict) -> list[tuple[float, float]]:
    return [(p["lon"], p["lat"]) for p in el.get("geometry", []) if p]


def relation_polygon(el: dict):
    outers, inners = [], []
    for m in el.get("members", []):
        if m.get("type") != "way" or not m.get("geometry"):
            continue
        line = LineString([(p["lon"], p["lat"]) for p in m["geometry"]])
        (inners if m.get("role") == "inner" else outers).append(line)
    outer = unary_union(list(polygonize(outers)))
    if outer.is_empty:
        return None
    inner = unary_union(list(polygonize(inners)))
    return outer.difference(inner) if not inner.is_empty else outer


def classify(tags: dict, closed: bool) -> tuple[str, float | None] | None:
    """Return (kind, buffer_width or None for areas)."""
    if "building" in tags and closed:
        return "building", None
    hw = tags.get("highway")
    if hw:
        if tags.get("area") == "yes" and closed:
            return ("open" if hw == "pedestrian" else "road"), None
        if hw in ROAD_WIDTHS:
            return "road", ROAD_WIDTHS[hw]
        if hw in FOOT_WIDTHS:
            return "footway", FOOT_WIDTHS[hw]
        return None
    if not closed:
        return None
    pairs = set(tags.items())
    if pairs & GREEN_TAGS:
        return "green", None
    if pairs & OPEN_TAGS:
        return "open", None
    if tags.get("natural") == "water" or tags.get("landuse") in {"reservoir", "basin"}:
        return "water", None
    return None


def to_polys(geom) -> list[Polygon]:
    geom = make_valid(geom)
    if isinstance(geom, Polygon):
        return [geom]
    if isinstance(geom, MultiPolygon):
        return list(geom.geoms)
    if hasattr(geom, "geoms"):
        return [g for sub in geom.geoms for g in to_polys(sub)]
    return []


def round_geom(geom, nd: int = 2):
    return shapely.transform(geom, lambda c: np.round(c, nd))


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--slice", default="slice1")
    ap.add_argument("--refresh", action="store_true", help="re-download even if data/raw exists")
    args = ap.parse_args()

    boundary_path = ROOT / "data/boundary" / f"{args.slice}.geojson"
    raw_path = ROOT / "data/raw" / f"{args.slice}.osm.json"
    out_path = ROOT / "data/build" / f"{args.slice}.osm.geojson"

    b = json.loads(boundary_path.read_text(encoding="utf-8"))
    poly_wgs = shape(b["features"][0]["geometry"] if b.get("type") == "FeatureCollection" else b["geometry"])

    if raw_path.exists() and not args.refresh:
        print(f"Using cached {raw_path.relative_to(ROOT)}")
        raw = json.loads(raw_path.read_text(encoding="utf-8"))
    else:
        print("Fetching from Overpass ...")
        raw = fetch(overpass_query(poly_wgs))
        raw_path.write_text(json.dumps(raw, ensure_ascii=False, indent=1), encoding="utf-8")
        print(f"Saved {raw_path.relative_to(ROOT)}")

    # WGS84 -> UTM 43N -> shift so Badi Chaupar is (0, 0).
    utm = Transformer.from_crs("EPSG:4326", "EPSG:32643", always_xy=True)
    ox, oy = utm.transform(ORIGIN_LON, ORIGIN_LAT)

    def to_local(coords: np.ndarray) -> np.ndarray:
        ux, uy = utm.transform(coords[:, 0], coords[:, 1])
        return np.column_stack([np.asarray(ux) - ox, np.asarray(uy) - oy])

    clip = shapely.transform(poly_wgs, to_local)

    features = []
    counts: dict[str, int] = {}
    for el in raw.get("elements", []):
        tags = el.get("tags", {})
        if el["type"] == "way":
            coords = way_coords(el)
            if len(coords) < 2:
                continue
            closed = len(coords) >= 4 and coords[0] == coords[-1]
            c = classify(tags, closed)
            if not c:
                continue
            kind, width = c
            geom = LineString(coords) if width else Polygon(coords)
        elif el["type"] == "relation":
            c = classify(tags, True)
            if not c or c[1]:
                continue
            kind, width = c
            geom = relation_polygon(el)
            if geom is None:
                continue
        else:
            continue

        local = shapely.transform(geom, to_local)
        if width and kind == "road":
            line = local.intersection(clip)
            if not line.is_empty:
                features.append({"type": "Feature", "geometry": mapping(round_geom(line)), "properties": {
                    "kind": "centerline", "class": tags["highway"], "width": width,
                    "id": f"{el['type']}/{el['id']}", **({"name": tags["name"]} if "name" in tags else {})}})
        if width:
            local = local.buffer(width / 2, cap_style="flat", join_style="round", quad_segs=4)
        local = local.intersection(clip)
        polys = [p for p in to_polys(local) if p.area > 0.5]
        if not polys:
            continue
        g = round_geom(polys[0] if len(polys) == 1 else MultiPolygon(polys))
        props = {"kind": kind, "id": f"{el['type']}/{el['id']}", "source": "osm"}
        if kind == "road":
            props["class"] = tags.get("highway")
        if name := tags.get("name:en") or tags.get("name"):
            props["name"] = name
        if (lv := tags.get("building:levels")) and lv.replace(".", "", 1).isdigit():
            props["levels"] = float(lv)
        features.append({"type": "Feature", "geometry": mapping(g), "properties": props})
        counts[kind] = counts.get(kind, 0) + 1

    # Stable order (by kind, then id) so diffs of data/build stay readable.
    order = ["open", "green", "water", "footway", "road", "building", "centerline"]
    features.sort(key=lambda f: (order.index(f["properties"]["kind"]), f["properties"]["id"]))
    out = {
        "type": "FeatureCollection",
        "properties": {
            "slice": args.slice,
            "crs": "local metres from EPSG:32643, origin Badi Chaupar",
            "origin": [ORIGIN_LON, ORIGIN_LAT],
            "attribution": "(c) OpenStreetMap contributors, ODbL",
        },
        "features": features,
    }
    out_path.write_text(json.dumps(out, separators=(",", ":")), encoding="utf-8")
    print(f"Wrote {out_path.relative_to(ROOT)}: {len(features)} features {counts}")


if __name__ == "__main__":
    sys.exit(main())
