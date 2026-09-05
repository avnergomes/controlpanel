"""Pre-project and simplify the world/timezone GeoJSON into ready-to-use SVG paths.

Why: the dashboard used to download ~355 KB of GeoJSON at startup and re-project
every coordinate on each render. This script runs once (build time) and emits
``assets/world-paths.json`` with equirectangular-projected, Douglas-Peucker
simplified path strings for a 900x400 viewBox. The browser then only sets ``d``.

Usage:
    py -3 scripts/build_world_paths.py [--tolerance 0.7] [--width 900] [--height 400]

Pure standard library (no shapely/GDAL needed).
"""
from __future__ import annotations

import argparse
import json
import math
from pathlib import Path
from typing import Iterable

ROOT = Path(__file__).resolve().parent.parent
ASSETS = ROOT / "assets"
COUNTRIES = ASSETS / "countries.geojson"
TIMEZONES = ASSETS / "timezones.geojson"
OUTPUT = ASSETS / "world-paths.json"

Point = tuple[float, float]


def project(lon: float, lat: float, width: int, height: int) -> Point:
    """Equirectangular projection into the SVG viewBox (matches the old runtime)."""
    return ((lon + 180.0) / 360.0 * width, (90.0 - lat) / 180.0 * height)


def perpendicular_distance(point: Point, start: Point, end: Point) -> float:
    (px, py), (sx, sy), (ex, ey) = point, start, end
    dx, dy = ex - sx, ey - sy
    if dx == 0 and dy == 0:
        return math.hypot(px - sx, py - sy)
    t = ((px - sx) * dx + (py - sy) * dy) / (dx * dx + dy * dy)
    t = max(0.0, min(1.0, t))
    cx, cy = sx + t * dx, sy + t * dy
    return math.hypot(px - cx, py - cy)


def douglas_peucker(points: list[Point], tolerance: float) -> list[Point]:
    """Iterative Douglas-Peucker (no recursion limit issues on long coastlines)."""
    if len(points) < 3:
        return list(points)
    keep = [False] * len(points)
    keep[0] = keep[-1] = True
    stack: list[tuple[int, int]] = [(0, len(points) - 1)]
    while stack:
        first, last = stack.pop()
        max_dist, index = 0.0, -1
        for i in range(first + 1, last):
            d = perpendicular_distance(points[i], points[first], points[last])
            if d > max_dist:
                max_dist, index = d, i
        if index != -1 and max_dist > tolerance:
            keep[index] = True
            stack.append((first, index))
            stack.append((index, last))
    return [p for p, k in zip(points, keep) if k]


def ring_to_path(ring: Iterable[Iterable[float]], width: int, height: int, tolerance: float) -> str:
    projected = [project(float(pt[0]), float(pt[1]), width, height) for pt in ring]
    # Drop closing duplicate before simplification, re-close with Z.
    if len(projected) > 1 and projected[0] == projected[-1]:
        projected = projected[:-1]
    simplified = douglas_peucker(projected, tolerance)
    if len(simplified) < 3:
        return ""
    parts = [f"M{simplified[0][0]:.1f},{simplified[0][1]:.1f}"]
    parts.extend(f"L{x:.1f},{y:.1f}" for x, y in simplified[1:])
    return "".join(parts) + "Z"


def geometry_to_path(geometry: dict, width: int, height: int, tolerance: float) -> str:
    gtype = geometry.get("type")
    coords = geometry.get("coordinates") or []
    rings: list = []
    if gtype == "Polygon":
        rings = list(coords)
    elif gtype == "MultiPolygon":
        rings = [ring for polygon in coords for ring in polygon]
    return "".join(
        path for path in (ring_to_path(ring, width, height, tolerance) for ring in rings) if path
    )


def build(width: int, height: int, tolerance: float) -> dict:
    countries = json.loads(COUNTRIES.read_text(encoding="utf-8"))
    timezones = json.loads(TIMEZONES.read_text(encoding="utf-8"))

    country_paths = [
        path
        for path in (
            geometry_to_path(f.get("geometry") or {}, width, height, tolerance)
            for f in countries.get("features", [])
        )
        if path
    ]

    # Merge every feature of the same UTC offset into a single path (one DOM node per zone).
    zones: dict[float, dict] = {}
    for feature in timezones.get("features", []):
        props = feature.get("properties") or {}
        zone = props.get("zone")
        if zone is None:
            continue
        zone = float(zone)
        path = geometry_to_path(feature.get("geometry") or {}, width, height, tolerance)
        if not path:
            continue
        entry = zones.setdefault(zone, {"zone": zone, "label": props.get("utc_format") or f"UTC{zone:+}", "d": ""})
        entry["d"] += path

    return {
        "width": width,
        "height": height,
        "tolerance": tolerance,
        "countries": country_paths,
        "zones": [zones[z] for z in sorted(zones)],
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--width", type=int, default=900)
    parser.add_argument("--height", type=int, default=400)
    parser.add_argument("--tolerance", type=float, default=0.7, help="simplification tolerance in viewBox px")
    args = parser.parse_args()

    result = build(args.width, args.height, args.tolerance)
    OUTPUT.write_text(json.dumps(result, separators=(",", ":"), ensure_ascii=False), encoding="utf-8")
    before = COUNTRIES.stat().st_size + TIMEZONES.stat().st_size
    after = OUTPUT.stat().st_size
    print(
        f"wrote {OUTPUT.name}: {after:,} bytes "
        f"({len(result['countries'])} country paths, {len(result['zones'])} zones) "
        f"vs {before:,} bytes of GeoJSON ({100 - after * 100 // before}% smaller)"
    )


if __name__ == "__main__":
    main()
