"""Compare manual validation CSV against listings-scored.geojson."""

from __future__ import annotations

import csv
import json
import re
from dataclasses import dataclass
from pathlib import Path

from padestrian.paths import DATA_DIR, LISTINGS_SCORED_PATH

VALIDATION_CSV = DATA_DIR / "validation_30_filled.csv"


@dataclass
class RowResult:
    address: str
    manual_transit: bool | None
    manual_grocery: bool | None
    manual_class: str
    app_transit: bool
    app_grocery: bool
    app_class: str
    class_match: bool
    transit_match: bool
    grocery_match: bool
    transit_via: str
    nearest_stop_m: int | None
    notes: str
    grocery_mins_in_notes: int | None
    strict_grocery_10: bool | None


def _parse_bool_col(value: str | None) -> bool | None:
    if value is None or str(value).strip() == "":
        return None
    t = str(value).strip().lower()
    if t.startswith("true"):
        return True
    if "false" in t:
        return False
    return None


def _mins_in_notes(notes: str) -> int | None:
    found = [int(m) for m in re.findall(r"(\d+)\s*min", notes.lower())]
    return min(found) if found else None


def _classify(transit: bool | None, grocery: bool | None) -> str:
    if transit and grocery:
        return "walkable"
    if grocery and not transit:
        return "grocery"
    if transit and not grocery:
        return "transit"
    return "neither"


def _app_class(props: dict) -> str:
    if props.get("eligible"):
        return "walkable"
    if props.get("near_grocery") and not props.get("near_transit"):
        return "grocery"
    if props.get("near_transit") and not props.get("near_grocery"):
        return "transit"
    return "neither"


def _index_scored(path: Path) -> dict[tuple[float, float], dict]:
    fc = json.loads(path.read_text(encoding="utf-8"))
    out: dict[tuple[float, float], dict] = {}
    for feat in fc.get("features") or []:
        coords = feat.get("geometry", {}).get("coordinates") or []
        if len(coords) < 2:
            continue
        key = (round(float(coords[1]), 5), round(float(coords[0]), 5))
        out[key] = feat
    return out


def _pr(pairs: list[tuple[bool, bool]]) -> dict[str, float | int]:
    tp = sum(1 for truth, pred in pairs if truth and pred)
    fp = sum(1 for truth, pred in pairs if not truth and pred)
    fn = sum(1 for truth, pred in pairs if truth and not pred)
    tn = sum(1 for truth, pred in pairs if not truth and not pred)
    prec = tp / (tp + fp) if (tp + fp) else 0.0
    rec = tp / (tp + fn) if (tp + fn) else 0.0
    return {"tp": tp, "fp": fp, "fn": fn, "tn": tn, "precision": prec, "recall": rec}


def run_validation(
    csv_path: Path | None = None,
    scored_path: Path = LISTINGS_SCORED_PATH,
) -> tuple[list[RowResult], dict]:
    csv_path = csv_path or VALIDATION_CSV
    if not csv_path.is_file():
        raise FileNotFoundError(f"Missing {csv_path}")
    if not scored_path.is_file():
        raise FileNotFoundError(f"Missing {scored_path}. Run filter-listings first.")

    by_key = _index_scored(scored_path)
    results: list[RowResult] = []

    with csv_path.open(encoding="utf-8-sig", newline="") as f:
        for row in csv.DictReader(f):
            lat = float(row["lat"])
            lon = float(row["lon"])
            key = (round(lat, 5), round(lon, 5))
            feat = by_key.get(key)
            if feat is None:
                continue

            props = feat.get("properties") or {}
            notes = (row.get("notes") or "").replace("\n", " ").strip()
            mt = _parse_bool_col(row.get("manual_transit_10"))
            mg = _parse_bool_col(row.get("manual_grocery_10"))
            gm = _mins_in_notes(notes)
            strict_g = (gm <= 10) if gm is not None else mg

            at = bool(props.get("near_transit"))
            ag = bool(props.get("near_grocery"))
            mc = _classify(mt, mg)
            ac = _app_class(props)

            nsm = props.get("nearest_stop_m")
            results.append(
                RowResult(
                    address=row["address"],
                    manual_transit=mt,
                    manual_grocery=mg,
                    manual_class=mc,
                    app_transit=at,
                    app_grocery=ag,
                    app_class=ac,
                    class_match=mc == ac,
                    transit_match=mt == at if mt is not None else False,
                    grocery_match=mg == ag if mg is not None else False,
                    transit_via=str(props.get("transit_via") or ""),
                    nearest_stop_m=int(nsm) if nsm is not None else None,
                    notes=notes,
                    grocery_mins_in_notes=gm,
                    strict_grocery_10=strict_g,
                )
            )

    valid = [r for r in results if r.manual_transit is not None and r.manual_grocery is not None]
    strict_valid = [r for r in valid if r.strict_grocery_10 is not None]

    summary = {
        "rows": len(results),
        "class_accuracy": sum(1 for r in valid if r.class_match) / len(valid) if valid else 0,
        "transit": _pr([(r.manual_transit, r.app_transit) for r in valid]),
        "grocery_column": _pr([(r.manual_grocery, r.app_grocery) for r in valid]),
        "grocery_strict_10min": _pr(
            [(bool(r.strict_grocery_10), r.app_grocery) for r in strict_valid]
        ),
    }
    return results, summary


def print_report(results: list[RowResult], summary: dict) -> None:
    print(f"Validation rows matched: {summary['rows']}")
    print(f"Overall class accuracy: {summary['class_accuracy']:.0%}\n")

    for label, key in (
        ("Transit", "transit"),
        ("Grocery (your TRUE/FALSE columns)", "grocery_column"),
        ("Grocery (strict: <=10 min in notes)", "grocery_strict_10min"),
    ):
        s = summary[key]
        print(
            f"{label}: precision={s['precision']:.0%} recall={s['recall']:.0%} "
            f"(TP={s['tp']} FP={s['fp']} FN={s['fn']} TN={s['tn']})"
        )

    print("\n--- Class mismatches ---")
    for r in results:
        if not r.class_match:
            print(f"  {r.address[:55]}")
            print(f"    manual={r.manual_class}  app={r.app_class}")
            if r.notes:
                print(f"    notes: {r.notes[:90]}")

    print("\n--- Grocery: you said yes, app said no ---")
    for r in results:
        if r.manual_grocery and not r.app_grocery:
            extra = f" ({r.grocery_mins_in_notes} min in notes)" if r.grocery_mins_in_notes else ""
            print(f"  {r.address[:50]}{extra} — {r.notes[:70]}")

    print("\n--- Transit: you said no, app said yes ---")
    for r in results:
        if r.manual_transit is False and r.app_transit:
            print(
                f"  {r.address[:50]} via={r.transit_via} "
                f"nearest_stop_m={r.nearest_stop_m}"
            )
