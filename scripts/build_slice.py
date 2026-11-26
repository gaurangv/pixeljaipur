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
        data/build/<slice>.lanes.json         (lane graph + pedestrian walks, for src/actors)

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
        if kind == "square":
            # A named square/roundabout: the convex hull of its named road pieces (covers the island too).
            parts = [shape(f["geometry"]) for f in feats_out
                     if f["properties"]["kind"] in ("road", "open") and f["properties"].get("name") == arg]
            if not parts:
                return None, None
            filled = unary_union(parts).convex_hull.buffer(2)
            return filled, filled.centroid
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

    # Higher-priority zones win where they overlap (e.g. the Badi Chaupar circle over the bazaar roads).
    taken = Polygon()
    for p in sorted(places, key=lambda p: -p["priority"]):
        p["zone"] = p["zone"].difference(taken)
        taken = taken.union(p["zone"])

    fwd = Transformer.from_crs("EPSG:4326", "EPSG:32643", always_xy=True)
    inv = Transformer.from_crs("EPSG:32643", "EPSG:4326", always_xy=True)
    ox, oy = fwd.transform(ORIGIN_LON, ORIGIN_LAT)

    out = []
    for p in places:
        lon, lat = inv.transform(p["anchor"].x + ox, p["anchor"].y + oy)
        p["lonlat"] = [round(lon, 6), round(lat, 6)]
        polys = to_polys(p["zone"].simplify(0.5))
        out.append({**{k: v for k, v in p.items() if k not in ("zone", "anchor")},
                    "anchor": [round(p["anchor"].x, 2), round(p["anchor"].y, 2)],
                    "zone": [[[round(x, 2), round(y, 2)] for x, y in q.exterior.coords] for q in polys]})
    return out


# --- lane graph (p2-traffic) --------------------------------------------------------------
# A directed lane graph for LEFT-hand traffic, from the OSM centrelines. Written to
# data/build/<slice>.lanes.json and loaded by src/actors/lanes.ts. Lanes are offset to the
# left of the centreline (two-way roads) or split into a left and right lane (wide one-ways),
# trimmed back at junctions and joined there by short Bezier connectors.
LANE_SNAP = 1.5  # m; a dangling road end this close to another road is joined to it
LANE_MIN_EDGE = 1.5  # m; edges shorter than this collapse into a single node
LANE_MIN_NETWORK = 40.0  # m; drop disconnected road fragments shorter than this in total
LANE_BOUNDARY = 2.0  # m; a road end this close to the slice edge is a source / sink
RING_NAME = "Badi Chaupar"
WALK_OFF = 0.9  # m; pedestrians walk this far out from a shop front
WALK_HAWA = 2.6  # m; ... and this far out from the Hawa Mahal facade line (in front of the plinth step)
FOOT_CLASSES = {"pedestrian", "footway", "path", "steps"}
LANE_CLASS = {**{c: 0 for c in MAIN_ROADS}, "unclassified": 1, "residential": 1, "living_street": 2, "service": 2}


def _offset_left(cs: list[tuple[float, float]], d: float) -> list[tuple[float, float]]:
    """Offset a polyline by d to its LEFT (mitred, miter clamped to 2d)."""
    if abs(d) < 1e-9:
        return list(cs)
    out = []
    for i in range(len(cs)):
        ns = []
        for a, b in ((i - 1, i), (i, i + 1)):
            if 0 <= a and b < len(cs):
                dx, dy = cs[b][0] - cs[a][0], cs[b][1] - cs[a][1]
                n = math.hypot(dx, dy) or 1.0
                ns.append((-dy / n, dx / n))
        nx, ny = sum(n[0] for n in ns) / len(ns), sum(n[1] for n in ns) / len(ns)
        k = math.hypot(nx, ny) or 1.0
        nx, ny = nx / k, ny / k
        cos_half = max(0.5, nx * ns[0][0] + ny * ns[0][1])
        out.append((cs[i][0] + nx * d / cos_half, cs[i][1] + ny * d / cos_half))
    return out


def _substring(cs: list[tuple[float, float]], a: float, b: float) -> list[tuple[float, float]]:
    line = LineString(cs)
    from shapely.ops import substring

    sub = substring(line, a, b)
    return list(sub.coords) if isinstance(sub, LineString) else [tuple(sub.coords[0])] * 2


def _bezier(p0, d0, p2, d2, uturn=False) -> list[tuple[float, float]]:
    dist = math.hypot(p2[0] - p0[0], p2[1] - p0[1])
    k = (1.3 if uturn else 0.4) * max(dist, 0.5)
    c1 = (p0[0] + d0[0] * k, p0[1] + d0[1] * k)
    c2 = (p2[0] - d2[0] * k, p2[1] - d2[1] * k)
    n = max(2, min(10, math.ceil((dist * (2 if uturn else 1)) / 1.5)))
    pts = []
    for i in range(n + 1):
        t = i / n
        u = 1 - t
        pts.append((u**3 * p0[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t**3 * p2[0],
                    u**3 * p0[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t**3 * p2[1]))
    return pts


def _unit(ax, ay, bx, by):
    dx, dy = bx - ax, by - ay
    n = math.hypot(dx, dy) or 1.0
    return dx / n, dy / n


def build_lanes(centerlines, raw_osm: dict, clip, roads, buildings, to_local, landmark) -> dict:
    tags = {f"way/{el['id']}": el.get("tags", {}) for el in raw_osm.get("elements", []) if el["type"] == "way"}

    def oneway_of(wid: str) -> int:
        t = tags.get(wid, {})
        ow = t.get("oneway")
        if ow is None and t.get("junction") in ("roundabout", "circular"):
            ow = "yes"
        return 1 if ow in ("yes", "1", "true") else -1 if ow == "-1" else 0

    # 1. road parts as vertex lists (2 dp, the same rounding as the OSM step, so shared nodes match)
    parts: list[dict] = []
    for f in sorted(centerlines, key=lambda f: f["properties"]["id"]):
        g = shape(f["geometry"])
        lines = [g] if isinstance(g, LineString) else [x for x in getattr(g, "geoms", []) if isinstance(x, LineString)]
        p = f["properties"]
        for ln in lines:
            cs: list[tuple[float, float]] = []
            for x, y in ln.coords:
                q = (round(x, 2), round(y, 2))
                if not cs or q != cs[-1]:
                    cs.append(q)
            if len(cs) >= 2:
                parts.append({"cs": cs, "id": p["id"], "cls": p["class"], "w": float(p["width"]),
                              "name": p.get("name"), "ow": oneway_of(p["id"])})

    # 2. snap dangling ends onto nearby roads (insert a vertex there)
    def counts():
        c: dict = {}
        for pt in parts:
            for q in set(pt["cs"]):
                c[q] = c.get(q, 0) + 1
        return c

    cnt = counts()
    for pi, pt in enumerate(parts):
        for end in (0, -1):
            q = pt["cs"][end]
            if cnt[q] > 1 or clip.exterior.distance(Point(q)) < LANE_BOUNDARY:
                continue
            best = None
            for oi, other in enumerate(parts):
                if oi == pi:
                    continue
                ol = LineString(other["cs"])
                d = ol.distance(Point(q))
                if d < LANE_SNAP and (best is None or d < best[0]):
                    best = (d, oi, ol.project(Point(q)))
            if best is None:
                continue
            _, oi, s = best
            ocs = parts[oi]["cs"]
            near = min(ocs, key=lambda v: math.hypot(v[0] - q[0], v[1] - q[1]))
            if math.hypot(near[0] - q[0], near[1] - q[1]) < LANE_SNAP:
                target = near
            else:
                ip = LineString(ocs).interpolate(s)
                target = (round(ip.x, 2), round(ip.y, 2))
                acc = 0.0
                for k in range(len(ocs) - 1):
                    seg = math.hypot(ocs[k + 1][0] - ocs[k][0], ocs[k + 1][1] - ocs[k][1])
                    if acc + seg >= s:
                        ocs.insert(k + 1, target)
                        break
                    acc += seg
            pt["cs"][end] = target
            cnt = counts()

    # 3. split at nodes (shared vertices and ends) into undirected edges
    node_of: dict = {}
    nodes: list[list[float]] = []

    def node(q):
        if q not in node_of:
            node_of[q] = len(nodes)
            nodes.append([q[0], q[1]])
        return node_of[q]

    edges: list[dict] = []
    for pt in parts:
        cs = pt["cs"]
        cur = [cs[0]]
        for q in cs[1:]:
            cur.append(q)
            if cnt[q] > 1 or q == cs[-1]:
                if len(cur) >= 2:
                    edges.append({**{k: v for k, v in pt.items() if k != "cs"}, "cs": cur, "a": node(cur[0]), "b": node(cur[-1])})
                cur = [q]

    # 4. collapse very short edges (merge their end nodes)
    parent = list(range(len(nodes)))

    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    for e in edges:
        if LineString(e["cs"]).length < LANE_MIN_EDGE:
            parent[find(e["b"])] = find(e["a"])
    kept = []
    for e in edges:
        a, b = find(e["a"]), find(e["b"])
        if a == b:
            continue
        cs = list(e["cs"])
        cs[0], cs[-1] = tuple(nodes[a]), tuple(nodes[b])
        kept.append({**e, "a": a, "b": b, "cs": cs})
    edges = kept

    # 5. never drive through a building: drop edges whose lanes would cross one (mapped roads
    #    sometimes run under OSM / Overture footprints), then drop small disconnected fragments
    solid = buildings.buffer(-0.1)
    blocked_edges = 0
    kept = []
    for e in edges:
        offs = [0.22 * e["w"], -0.22 * e["w"]] if e["ow"] else [e["w"] / 4, -e["w"] / 4]
        # a vehicle body (about 0.6 m either side of its lane) must not enter a footprint
        if any(LineString(_offset_left(e["cs"], o)).buffer(0.6).intersection(solid).area > 0.3 for o in offs):
            blocked_edges += 1
            continue
        kept.append(e)
    edges = kept
    comp = list(range(len(nodes)))

    def cfind(i):
        while comp[i] != i:
            comp[i] = comp[comp[i]]
            i = comp[i]
        return i

    for e in edges:
        comp[cfind(e["a"])] = cfind(e["b"])
    total: dict = {}
    for e in edges:
        total[cfind(e["a"])] = total.get(cfind(e["a"]), 0.0) + LineString(e["cs"]).length
    dropped = [e for e in edges if total[cfind(e["a"])] < LANE_MIN_NETWORK]
    edges = [e for e in edges if total[cfind(e["a"])] >= LANE_MIN_NETWORK]

    # 6. the roundabout: one-way edges on the Badi Chaupar circle
    ring_pts = [q for e in edges if e["name"] == RING_NAME for q in e["cs"]]
    rc = (sum(q[0] for q in ring_pts) / len(ring_pts), sum(q[1] for q in ring_pts) / len(ring_pts)) if ring_pts else (0.0, 0.0)
    rr = sum(math.hypot(q[0] - rc[0], q[1] - rc[1]) for q in ring_pts) / max(1, len(ring_pts))
    for e in edges:
        e["ring"] = bool(ring_pts) and e["ow"] != 0 and all(abs(math.hypot(q[0] - rc[0], q[1] - rc[1]) - rr) < 8 for q in e["cs"])

    degree: dict = {}
    for ei, e in enumerate(edges):
        degree.setdefault(e["a"], []).append(ei)
        degree.setdefault(e["b"], []).append(ei)
    boundary = {n for n in degree if clip.exterior.distance(Point(nodes[n])) < LANE_BOUNDARY}

    def away(ei, n):
        """Unit direction of edge ei leaving node n."""
        cs = edges[ei]["cs"]
        if edges[ei]["a"] == n:
            return _unit(*cs[0], *cs[1])
        return _unit(*cs[-1], *cs[-2])

    def trim(ei, n):
        e = edges[ei]
        length = LineString(e["cs"]).length
        inc = degree[n]
        if len(inc) == 1:
            return 0.0 if n in boundary else min(e["w"] / 4 + 1.0, 0.4 * length)
        u = away(ei, n)
        t = 1.0
        for fi in inc:
            if fi == ei:
                continue
            v = away(fi, n)
            dot = u[0] * v[0] + u[1] * v[1]
            sin = abs(u[0] * v[1] - u[1] * v[0])
            t = max(t, edges[fi]["w"] / 2 * (1.0 if dot >= 0 else sin) + 0.75)
        return min(t, 0.42 * length)

    # 7. lanes on the directed edges
    inside = clip.buffer(-1.5).intersection(roads.buffer(0.2))
    lanes: list[dict] = []
    by_dir: dict = {}  # (edge, forward) -> [lane ids], index 0 = left lane
    for ei, e in enumerate(edges):
        dirs = [True] if e["ow"] == 1 else [False] if e["ow"] == -1 else [True, False]
        for fwd in dirs:
            cs = e["cs"] if fwd else e["cs"][::-1]
            a, b = (e["a"], e["b"]) if fwd else (e["b"], e["a"])
            w = e["w"]
            offs = ([0.22 * w, -0.22 * w] if w >= 10 else [0.0]) if e["ow"] else [w / 4]
            ids = []
            for off in offs:
                oc = _offset_left(cs, off)
                length = LineString(oc).length
                t0, t1 = trim(ei, a), trim(ei, b)
                if length - t0 - t1 < 0.5:
                    t0 = t1 = max(0.0, (length - 0.5) / 2)
                pts = _substring(oc, t0, length - t1)
                if a in boundary or b in boundary:
                    # end the lane inside the diorama (offset lanes at an oblique slice edge poke out)
                    inner = to_polys_lines(LineString(pts).intersection(inside))
                    if inner:
                        pts = list(max(inner, key=lambda g: g.length).coords)
                ids.append(len(lanes))
                lanes.append({"pts": pts, "a": a, "b": b, "edge": ei, "fwd": fwd, "cls": LANE_CLASS.get(e["cls"], 2),
                              "w": w, "ring": e["ring"], "conn": False, "next": []})
            by_dir[(ei, fwd)] = ids

    # 8. connectors at every node
    n_road = len(lanes)
    for n, inc in degree.items():
        if n in boundary:
            continue  # sources and sinks
        ins = [(ei, fwd) for ei in inc for fwd in (True, False) if (ei, fwd) in by_dir and (edges[ei]["b"] if fwd else edges[ei]["a"]) == n]
        outs = [(ei, fwd) for ei in inc for fwd in (True, False) if (ei, fwd) in by_dir and (edges[ei]["a"] if fwd else edges[ei]["b"]) == n]
        dead_end = len(inc) == 1
        for ein in ins:
            for eout in outs:
                uturn = ein[0] == eout[0]
                if uturn and not dead_end:
                    continue
                Ls, Ms = by_dir[ein], by_dir[eout]
                for i, li in enumerate(Ls):
                    for j, mi in enumerate(Ms):
                        if not (len(Ls) == 1 or len(Ms) == 1 or i == j):
                            continue
                        L, M = lanes[li], lanes[mi]
                        p0, p2 = L["pts"][-1], M["pts"][0]
                        d0 = _unit(*L["pts"][-2], *p0)
                        d2 = _unit(*p2, *M["pts"][1])
                        turn = math.degrees(math.atan2(d0[0] * d2[1] - d0[1] * d2[0], d0[0] * d2[0] + d0[1] * d2[1]))
                        if abs(turn) > 150 and not uturn:
                            continue
                        cid = len(lanes)
                        lanes.append({"pts": _bezier(p0, d0, p2, d2, uturn), "a": n, "b": n, "edge": -1, "cls": M["cls"],
                                      "w": min(L["w"], M["w"]), "ring": L["ring"] and M["ring"], "conn": True,
                                      "yield": (not L["ring"]) and M["ring"], "next": [mi]})
                        L["next"].append(cid)

    # 9. pedestrian walks: in front of street-facing building edges, along footways, and the Hawa Mahal front
    bgrid = buildings.buffer(0.45)  # walkers sway up to 0.3 m off the line
    walks: list[list[tuple[float, float]]] = []
    busy: list[int] = []  # 1 = a bazaar shop front (or the Hawa Mahal): busier with shoppers

    def keep_walk(cs, bazaar=False):
        line = LineString(cs)
        for piece in to_polys_lines(line.difference(bgrid).intersection(clip.buffer(-1.0))):
            if piece.length >= 2.0:
                walks.append(list(piece.coords))
                busy.append(1 if bazaar else 0)

    th = math.radians(landmark["facingDeg"])
    fx, fy = math.cos(th), math.sin(th)
    ax, ay = landmark["anchor"][0] + fx * WALK_HAWA, landmark["anchor"][1] + fy * WALK_HAWA
    half = landmark["width"] / 2 - 1.0
    keep_walk([(ax + fy * half, ay - fx * half), (ax - fy * half, ay + fx * half)], True)
    return {"edges": edges, "lanes": lanes, "nodes": nodes, "boundary": boundary, "ring": (rc, rr), "walks": walks, "busy": busy,
            "dropped": dropped, "blocked": blocked_edges, "n_road": n_road, "keep_walk": keep_walk}


def to_polys_lines(geom) -> list[LineString]:
    if geom.is_empty:
        return []
    if isinstance(geom, LineString):
        return [geom]
    if hasattr(geom, "geoms"):
        return [p for g in geom.geoms for p in to_polys_lines(g)]
    return []


def finish_lanes(sl: str, lg: dict, out_feats: list, raw_osm: dict, to_local, clip, roads) -> None:
    """Add walks from building fronts / footways, check lanes against roads and buildings, write JSON."""
    keep_walk = lg["keep_walk"]
    for f in out_feats:
        pr = f["properties"]
        if pr["kind"] != "building" or not pr.get("front"):
            continue
        ring = f["geometry"]["coordinates"][0]
        for i in pr["front"]:
            (x1, y1), (x2, y2) = ring[i], ring[i + 1]
            length = math.hypot(x2 - x1, y2 - y1)
            if length < 2.5:
                continue
            ux, uy = (x2 - x1) / length, (y2 - y1) / length
            nx, ny = uy, -ux  # outward for CCW
            a = (x1 + ux * 0.3 + nx * WALK_OFF, y1 + uy * 0.3 + ny * WALK_OFF)
            b = (x2 - ux * 0.3 + nx * WALK_OFF, y2 - uy * 0.3 + ny * WALK_OFF)
            keep_walk([a, b], bool(pr.get("bazaar")))
    for el in sorted(raw_osm.get("elements", []), key=lambda e: e["id"]):
        if el["type"] != "way" or el.get("tags", {}).get("highway") not in FOOT_CLASSES:
            continue
        coords = [(p["lon"], p["lat"]) for p in el.get("geometry", []) if p]
        if len(coords) < 2 or el["tags"].get("area") == "yes":
            continue
        keep_walk([tuple(c) for c in to_local(np.array(coords))])

    # sanity: how much of every lane lies on the road surface / inside a building
    bld = unary_union([shape(f["geometry"]) for f in out_feats if f["properties"]["kind"] == "building"]).buffer(-0.2)
    road_area = roads.buffer(0.3)
    off_road = in_bld = total = 0
    for L in lg["lanes"]:
        line = LineString(L["pts"])
        for k in range(int(line.length) + 1):
            p = line.interpolate(k)
            total += 1
            off_road += not road_area.contains(p)
            in_bld += bld.contains(p)

    nodes, lanes = lg["nodes"], lg["lanes"]
    used = sorted({n for L in lanes for n in (L["a"], L["b"])})
    remap = {n: i for i, n in enumerate(used)}
    r1 = lambda v: round(v, 1)
    out = {
        "slice": sl,
        "note": "Lane graph for left-hand traffic (build_slice.py). Lane: p=flat [x,y,...] polyline (local metres), "
                "n=next lane ids, a/b=from/to node, c=class (0 main, 1 residential, 2 service/lane), w=road width, "
                "j=junction connector, r=on the Badi Chaupar ring, y=give way (enters the ring). Node: [x, y, 1 if slice edge]. "
                "walks: pedestrian polylines; busy: 1 for walks along bazaar shop fronts.",
        "ring": {"c": [r1(lg["ring"][0][0]), r1(lg["ring"][0][1])], "r": r1(lg["ring"][1])},
        "nodes": [[r1(nodes[n][0]), r1(nodes[n][1]), 1 if n in lg["boundary"] else 0] for n in used],
        "lanes": [
            {"p": [r1(v) for q in L["pts"] for v in q], "n": L["next"], "a": remap[L["a"]], "b": remap[L["b"]],
             "c": L["cls"], "w": L["w"],
             **({"j": 1} if L["conn"] else {}), **({"r": 1} if L["ring"] else {}), **({"y": 1} if L.get("yield") else {})}
            for L in lanes
        ],
        "walks": [[r1(v) for q in w for v in q] for w in lg["walks"]],
        "busy": lg["busy"],
    }
    path = ROOT / "data/build" / f"{sl}.lanes.json"
    path.write_text(json.dumps(out, separators=(",", ":")), encoding="utf-8")
    print(f"Lanes: {lg['n_road']} road lanes + {len(lanes) - lg['n_road']} connectors on {len(lg['edges'])} edges "
          f"(dropped {len(lg["dropped"])} fragment edges, {lg["blocked"]} through buildings); {len(out['walks'])} walks; "
          f"{off_road}/{total} lane samples off the road surface, {in_bld} inside buildings; "
          f"ring centre {out['ring']['c']} r={out['ring']['r']}; {path.stat().st_size // 1024} KB")


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
    for n, f in enumerate(ov["features"]):
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
            # Overture keeps its GERS id on the feature, not in properties.
            oid = f.get("id") or pr.get("id") or f"idx{n}"
            props = {"id": f"overture/{oid}" + (f"#{i}" if i else ""), "source": f"overture:{tag}"}
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

    # Kerbs: the outline of the merged road network (not each overlapping road piece).
    kerb = roads.boundary.intersection(clip.buffer(-0.5))
    if not kerb.is_empty:
        out_feats.append({"type": "Feature", "geometry": mapping(rnd(kerb.simplify(0.2))), "properties": {"kind": "kerb", "id": "kerbs"}})

    order = ["open", "green", "water", "footway", "road", "building", "kerb"]
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
            # The diorama base: slice boundary in local metres, CCW, closed.
            "boundary": [[round(x, 2), round(y, 2)] for x, y in orient(clip, 1.0).exterior.coords],
        },
        "features": out_feats,
    }
    (ROOT / "data/build" / f"{sl}.geojson").write_text(json.dumps(out, separators=(",", ":")), encoding="utf-8")
    places = build_places(sl, out_feats, landmark, reserved, to_local)
    (ROOT / "data/build" / f"{sl}.places.json").write_text(json.dumps({"places": places}, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"Places: {[p['id'] + ('' if p['wiki'] else ' (blurb only)') for p in places]}")
    (ROOT / "data/build" / f"{sl}.landmarks.json").write_text(json.dumps({"landmarks": [landmark]}, indent=2), encoding="utf-8")
    # Lane graph + pedestrian walks for the traffic system (p2-traffic).
    raw_osm = json.loads((ROOT / "data/raw" / f"{sl}.osm.json").read_text(encoding="utf-8"))
    bld_union = unary_union([shape(f["geometry"]) for f in out_feats if f["properties"]["kind"] == "building"] + [reserved])
    lg = build_lanes(centerlines, raw_osm, clip, roads, bld_union, to_local, landmark)
    finish_lanes(sl, lg, out_feats, raw_osm, to_local, clip, roads)
    print(f"Buildings by source {src_count} (overture added {added}, skipped as overlapping {skipped}); "
          f"{fronted} with street fronts")
    print(f"Hawa Mahal anchor {landmark['anchor']} facing {landmark['facingDeg']} deg on '{landmark['street']}'")


if __name__ == "__main__":
    main()
