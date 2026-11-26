# /// script
# requires-python = ">=3.11"
# dependencies = ["numpy", "shapely>=2", "pyproj>=3.6"]
# ///
"""Merge OSM + Overture buildings, add generated frontage lots, mark street fronts, place landmarks.

    uv run scripts/build_slice.py [--slice slice1]

Reads   data/build/<slice>.osm.geojson        (from fetch_osm.py, local metres)
        data/raw/<slice>.overture.geojson     (from fetch_overture.py, WGS84)
        data/boundary/<slice>.geojson
Writes  data/build/<slice>.geojson            (what the app loads)
        data/build/<slice>.landmarks.json

Building properties written:
  id, source (osm | overture:google | overture:microsoft | overture:esri | generated),
  front   indices of exterior-ring edges that face a street (ring is CCW, edge i = p[i] -> p[i+1])
  bazaar  true if a front faces a main bazaar road (primary/secondary/tertiary)
  levels  OSM/Overture floor count when known
"""

from __future__ import annotations

import argparse
import json
import math
import random
import re
from pathlib import Path

import numpy as np
import shapely
from pyproj import Transformer
from shapely.geometry import LineString, MultiLineString, MultiPolygon, Point, Polygon, mapping, shape
from shapely.geometry.polygon import orient
from shapely.ops import nearest_points, split, unary_union

ROOT = Path(__file__).resolve().parent.parent
ORIGIN_LAT, ORIGIN_LON = 26.9225798, 75.8267125  # Badi Chaupar, same as fetch_osm.py

MAIN_ROADS = {"trunk", "primary", "secondary", "tertiary"}
FRONT_DIST = 6.0  # an edge counts as a street front if its midpoint is this close to a road
OVERLAP_MAX = 0.3  # drop an Overture building if this share of it is already covered by OSM/roads
MIN_AREA = 6.0
PLACE_FRONTAGE = 14.0  # m; a bazaar's clickable zone = its road plus the shop fronts on both sides
INSET = 0.05  # m, shrink every footprint so shared walls don't z-fight
SIMPLIFY = 0.4  # m, tolerance for simplifying Overture footprints
ISLAND_MAX = 3000.0  # m^2; road-enclosed holes smaller than this are islands

# Frontage fill: lots generated where neither OSM nor Overture has a building.
FILL_SETBACK = 1.5  # footpath between the road edge and the shop front
FILL_DEPTH = 12.0
LOT_MIN, LOT_MAX = 6.0, 10.0

# Hawa Mahal: OSM node 542886858 (a point only; no footprint exists in OSM or Overture).
HAWA_MAHAL = {"lon": 75.8268652, "lat": 26.923932}
HAWA_WIDTH = 50.0  # facade length along the street (m). Tune against docs/refs/.
HAWA_DEPTH = 24.0  # reserved depth behind the facade (m)
HAWA_SETBACK = 3.0  # footpath + plinth between kerb and facade (m)


def to_polys(geom) -> list[Polygon]:
    if geom.is_empty:
        return []
    geom = shapely.make_valid(geom)
    if isinstance(geom, Polygon):
        return [geom]
    if hasattr(geom, "geoms"):
        return [p for g in geom.geoms for p in to_polys(g)]
    return []


def rnd(geom, nd: int = 2):
    return shapely.transform(geom, lambda c: np.round(c, nd))


def front_edges(poly: Polygon, roads, major) -> tuple[list[int], bool]:
    """Edges whose midpoint is near a road and whose outward normal points at it."""
    ring = list(poly.exterior.coords)
    fronts, bazaar = [], False
    for i in range(len(ring) - 1):
        (x1, y1), (x2, y2) = ring[i], ring[i + 1]
        length = math.hypot(x2 - x1, y2 - y1)
        if length < 2.0:
            continue
        mx, my = (x1 + x2) / 2, (y1 + y2) / 2
        nx, ny = (y2 - y1) / length, -(x2 - x1) / length  # outward normal for a CCW ring
        mid = Point(mx, my)
        if roads.distance(mid) > FRONT_DIST:
            continue
        out_pt, in_pt = Point(mx + 3 * nx, my + 3 * ny), Point(mx - 3 * nx, my - 3 * ny)
        if roads.distance(out_pt) >= roads.distance(in_pt):
            continue
        fronts.append(i)
        if major is not None and major.distance(mid) <= FRONT_DIST:
            bazaar = True
    return fronts, bazaar


def cut_lots(strip: Polygon, line: LineString, reach: float, rng: random.Random) -> list[Polygon]:
    """Cut a frontage strip into lots with cuts perpendicular to the road every 6-10 m."""
    cutters, d = [], rng.uniform(0, LOT_MAX)
    while d < line.length:
        p = line.interpolate(d)
        q = line.interpolate(min(d + 0.5, line.length))
        if p.distance(q) < 1e-6:
            q, p = p, line.interpolate(max(d - 0.5, 0))
        dx, dy = q.x - p.x, q.y - p.y
        n = math.hypot(dx, dy) or 1.0
        px, py = -dy / n * reach, dx / n * reach
        c = line.interpolate(d)
        cutters.append(LineString([(c.x - px, c.y - py), (c.x + px, c.y + py)]))
        d += rng.uniform(LOT_MIN, LOT_MAX)
    pieces = to_polys(split(strip, MultiLineString(cutters))) if cutters else [strip]
    lots = []
    for piece in pieces:
        if piece.area < 25:
            continue
        rect = piece.minimum_rotated_rectangle
        if rect.area and piece.area / rect.area < 0.6:
            continue  # skip slivers and odd shapes
        lots.append(piece)
    return lots


def hawa_mahal(centerlines, to_local) -> tuple[dict, Polygon]:
    node = Point(*to_local(np.array([[HAWA_MAHAL["lon"], HAWA_MAHAL["lat"]]]))[0])
    best = min(
        (f for f in centerlines if f["properties"]["class"] in MAIN_ROADS),
        key=lambda f: shape(f["geometry"]).distance(node),
    )
    line = shape(best["geometry"])
    on_road = nearest_points(line, node)[0]
    s = line.project(on_road)
    a, b = line.interpolate(max(s - 2, 0)), line.interpolate(min(s + 2, line.length))
    dx, dy = b.x - a.x, b.y - a.y
    n = math.hypot(dx, dy)
    tx, ty = dx / n, dy / n  # along the street
    nx, ny = -ty, tx  # left normal
    if nx > 0:  # the palace is on the WEST side of the street; point the normal west
        nx, ny, tx, ty = -nx, -ny, -tx, -ty
    half_road = best["properties"]["width"] / 2
    off = half_road + HAWA_SETBACK
    ax, ay = on_road.x + nx * off, on_road.y + ny * off  # facade centre at street level
    w, d = HAWA_WIDTH / 2, HAWA_DEPTH
    reserved = Polygon([
        (ax - tx * w, ay - ty * w), (ax + tx * w, ay + ty * w),
        (ax + tx * w + nx * d, ay + ty * w + ny * d), (ax - tx * w + nx * d, ay - ty * w + ny * d),
    ])
    facing = math.degrees(math.atan2(-ny, -nx))  # direction the facade looks (towards the street), from +x, CCW
    info = {
        "id": "hawaMahal",
        "name": "Hawa Mahal",
        "source": "osm node/542886858 (position only)",
        "anchor": [round(ax, 2), round(ay, 2)],
        "facingDeg": round(facing, 2),
        "width": HAWA_WIDTH,
        "depth": HAWA_DEPTH,
        "street": best["properties"].get("name", best["properties"]["id"]),
        "reserved": mapping(rnd(reserved))["coordinates"],
    }
    return info, reserved



def build_places(sl: str, feats_out: list, landmark: dict, reserved: Polygon, to_local) -> list[dict]:
    """Info-card places: curated + discovered, each with a zone polygon, pin anchor and height."""
    cur_path = ROOT / "data/places.curated.json"
    raw_path = ROOT / "data/raw" / f"{sl}.places.json"
    if not cur_path.exists():
        return []
    curated = json.loads(cur_path.read_text(encoding="utf-8"))
    raw = json.loads(raw_path.read_text(encoding="utf-8")) if raw_path.exists() else {"curated": {}, "discovered": []}

    def zone_for(spec: str):
        kind, _, arg = spec.partition(":")
        if kind == "landmark" and arg == landmark["id"]:
            return reserved, Point(*landmark["anchor"])
        if kind == "osm":
            for f in feats_out:
                if f["properties"].get("id") == arg:
                    g = shape(f["geometry"])
                    return g, g.representative_point()
            return None, None
        if kind == "roads":
            parts = [shape(f["geometry"]) for f in feats_out
                     if f["properties"]["kind"] == "road" and f["properties"].get("name") == arg]
            if not parts:
                return None, None
            road = unary_union(parts)
            anchor = nearest_points(road, road.centroid)[0]
            return road.buffer(PLACE_FRONTAGE), anchor  # include the shop fronts on both sides
        if kind == "circle":
            x, y, r = (float(v) for v in arg.split(","))
            return Point(x, y).buffer(r, quad_segs=8), Point(x, y)
        return None, None

    places = []
    for c in curated["places"]:
        zone, anchor = zone_for(c["zone"])
        if zone is None:
            print(f"  place {c['id']}: zone {c['zone']!r} not found in this slice, skipped")
            continue
        res = raw["curated"].get(c["wiki"], {}) if c.get("wiki") else {}
        places.append({
            "id": c["id"], "name": c["name"], "nameHi": c.get("nameHi"),
            "wiki": None if not c.get("wiki") or res.get("missing") else res.get("title", c["wiki"]),
            "qid": res.get("qid"), "blurb": c["blurb"], "review": bool(c.get("review")),
            "priority": c.get("priority", 1), "height": c.get("height", 10), "zone": zone, "anchor": anchor,
        })
    for d in raw.get("discovered", []):
        pt = Point(*to_local(np.array([[d["lon"], d["lat"]]]))[0])
        slug = re.sub(r"[^a-z0-9]+", "-", d["title"].lower()).strip("-")
        places.append({
            "id": slug, "name": d["title"], "nameHi": d.get("nameHi"), "wiki": d["title"], "qid": d.get("qid"),
            "blurb": f"{d['title']} — see Wikipedia.", "review": False, "priority": 2, "height": 10,
            "zone": pt.buffer(15, quad_segs=8), "anchor": pt,
        })

    out = []
    for p in places:
        polys = to_polys(p["zone"].simplify(0.5))
        out.append({**{k: v for k, v in p.items() if k not in ("zone", "anchor")},
                    "anchor": [round(p["anchor"].x, 2), round(p["anchor"].y, 2)],
                    "zone": [[[round(x, 2), round(y, 2)] for x, y in q.exterior.coords] for q in polys]})
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--slice", default="slice1")
    args = ap.parse_args()
    sl = args.slice

    osm = json.loads((ROOT / "data/build" / f"{sl}.osm.geojson").read_text(encoding="utf-8"))
    ov = json.loads((ROOT / "data/raw" / f"{sl}.overture.geojson").read_text(encoding="utf-8"))
    bnd = json.loads((ROOT / "data/boundary" / f"{sl}.geojson").read_text(encoding="utf-8"))

    utm = Transformer.from_crs("EPSG:4326", "EPSG:32643", always_xy=True)
    ox, oy = utm.transform(ORIGIN_LON, ORIGIN_LAT)

    def to_local(c: np.ndarray) -> np.ndarray:
        ux, uy = utm.transform(c[:, 0], c[:, 1])
        return np.column_stack([np.asarray(ux) - ox, np.asarray(uy) - oy])

    clip = shapely.transform(shape(bnd["features"][0]["geometry"]), to_local)

    feats = osm["features"]
    by_kind = lambda *k: [f for f in feats if f["properties"]["kind"] in k]
    centerlines = by_kind("centerline")
    roads = unary_union([shape(f["geometry"]) for f in by_kind("road")])
    major = unary_union([shape(f["geometry"]) for f in by_kind("road") if f["properties"].get("class") in MAIN_ROADS])
    open_land = unary_union([shape(f["geometry"]) for f in by_kind("open", "green", "water")])
    footways = unary_union([shape(f["geometry"]) for f in by_kind("footway")])
    # Small holes enclosed by road polygons are roundabouts / traffic islands (e.g. the
    # Badi Chaupar circle), never building plots.
    islands = unary_union([Polygon(h) for r in to_polys(roads) for h in r.interiors if Polygon(h).area < ISLAND_MAX])

    landmark, reserved = hawa_mahal(centerlines, to_local)

    # --- buildings: OSM first --------------------------------------------------
    buildings: list[tuple[Polygon, dict]] = []
    for f in by_kind("building"):
        for i, p in enumerate(to_polys(shape(f["geometry"]))):
            props = {k: v for k, v in f["properties"].items() if k in ("id", "source", "name", "levels")}
            if i:
                props["id"] += f"#{i}"
            buildings.append((p, props))
    osm_union = unary_union([p for p, _ in buildings])

    # --- then Overture where OSM has nothing -----------------------------------
    added = skipped = 0
    blocked = unary_union([osm_union, roads, reserved, islands])
    for f in ov["features"]:
        pr = f["properties"]
        src = ((pr.get("sources") or [{}])[0] or {}).get("dataset", "")
        if src == "OpenStreetMap":
            continue  # already have OSM directly (and fresher)
        tag = {"Google Open Buildings": "google", "Microsoft ML Buildings": "microsoft", "Esri Community Maps": "esri"}.get(src, "other")
        # Machine-traced outlines are jagged; simplify so walls read as clean planes.
        geom = shapely.transform(shape(f["geometry"]), to_local).simplify(SIMPLIFY, preserve_topology=True).intersection(clip)
        for i, p in enumerate(to_polys(geom)):
            if p.area < MIN_AREA:
                continue
            if p.intersection(blocked).area > OVERLAP_MAX * p.area:
                skipped += 1
                continue
            p = to_polys(p.difference(blocked))
            p = max(p, key=lambda q: q.area) if p else None
            if p is None or p.area < MIN_AREA:
                continue
            props = {"id": f"overture/{pr.get('id', '?')}" + (f"#{i}" if i else ""), "source": f"overture:{tag}"}
            if pr.get("num_floors"):
                props["levels"] = float(pr["num_floors"])
            buildings.append((p, props))
            blocked = blocked.union(p)
            added += 1

    # --- frontage fill along main bazaars --------------------------------------
    rng = random.Random(f"{sl}-frontage")
    fill_block = unary_union([blocked, open_land, footways.buffer(0.5)]).buffer(0.5)
    generated = 0
    for f in sorted(centerlines, key=lambda f: f["properties"]["id"]):
        if f["properties"]["class"] not in MAIN_ROADS:
            continue
        line = shape(f["geometry"])
        if not isinstance(line, LineString) or line.length < LOT_MIN:
            continue
        hw = f["properties"]["width"] / 2
        inner, outer = hw + FILL_SETBACK, hw + FILL_SETBACK + FILL_DEPTH
        strip = line.buffer(outer, cap_style="flat").difference(line.buffer(inner, cap_style="flat"))
        strip = strip.difference(fill_block).intersection(clip)
        for part in to_polys(strip):
            for lot in cut_lots(part, line, outer + 5, rng):
                buildings.append((lot, {"id": f"gen/{generated}", "source": "generated"}))
                fill_block = fill_block.union(lot.buffer(0.3))
                generated += 1

    # --- fronts, orientation, output -------------------------------------------
    out_feats = [f for f in feats if f["properties"]["kind"] not in ("building", "centerline")]
    for poly, props in buildings:
        # Inset slightly so neighbours never share a coplanar wall (z-fighting stripes).
        inset = to_polys(poly.buffer(-INSET, join_style="mitre"))
        if not inset:
            continue
        poly = orient(rnd(max(inset, key=lambda q: q.area)), 1.0)  # CCW exterior
        if not poly.is_valid or poly.area < MIN_AREA:
            continue
        fronts, bazaar = front_edges(poly, roads, major)
        props = {"kind": "building", **props, "front": fronts}
        if bazaar:
            props["bazaar"] = True
        out_feats.append({"type": "Feature", "geometry": mapping(poly), "properties": props})

    order = ["open", "green", "water", "footway", "road", "building"]
    out_feats.sort(key=lambda f: (order.index(f["properties"]["kind"]), f["properties"]["id"]))
    src_count: dict[str, int] = {}
    for f in out_feats:
        if f["properties"]["kind"] == "building":
            s = f["properties"]["source"].split(":")[0]
            src_count[s] = src_count.get(s, 0) + 1
    fronted = sum(1 for f in out_feats if f["properties"].get("front"))

    out = {
        "type": "FeatureCollection",
        "properties": {
            "slice": sl,
            "crs": "local metres from EPSG:32643, origin Badi Chaupar",
            "origin": [ORIGIN_LON, ORIGIN_LAT],
            "attribution": "(c) OpenStreetMap contributors (ODbL); Overture Maps Foundation (ODbL), incl. Google Open Buildings and Microsoft ML Buildings",
        },
        "features": out_feats,
    }
    (ROOT / "data/build" / f"{sl}.geojson").write_text(json.dumps(out, separators=(",", ":")), encoding="utf-8")
    places = build_places(sl, out_feats, landmark, reserved, to_local)
    (ROOT / "data/build" / f"{sl}.places.json").write_text(json.dumps({"places": places}, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"Places: {[p['id'] + ('' if p['wiki'] else ' (blurb only)') for p in places]}")
    (ROOT / "data/build" / f"{sl}.landmarks.json").write_text(json.dumps({"landmarks": [landmark]}, indent=2), encoding="utf-8")
    print(f"Buildings by source {src_count} (overture added {added}, skipped as overlapping {skipped}); "
          f"{fronted} with street fronts")
    print(f"Hawa Mahal anchor {landmark['anchor']} facing {landmark['facingDeg']} deg on '{landmark['street']}'")


if __name__ == "__main__":
    main()
