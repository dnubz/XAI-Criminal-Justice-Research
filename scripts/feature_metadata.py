"""Display definitions supplied by the user; keep model input codes and values intact."""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def definitions():
    return json.loads((ROOT / "dist/data/feature-labels.json").read_text(encoding="utf-8"))["features"]


def apply_labels(indicator, mapping=None):
    mapping = definitions() if mapping is None else mapping
    definition = mapping.get(indicator.get("column"))
    if not definition:
        return indicator
    item = dict(indicator)
    item["feature"] = definition["label"]
    item["description"] = definition.get("description", "")
    if "unit" in definition:
        item["unit"] = definition["unit"]
    if definition.get("qualifier"):
        item["qualifier"] = definition["qualifier"]
    return item
