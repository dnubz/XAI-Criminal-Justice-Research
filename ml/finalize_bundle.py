import json
from pathlib import Path

import joblib
import numpy as np

from train_pipeline import (
    DIST_DATA, FEATURES, PUBLISHED, RF_PARAMS, SCHEMA_VERSION, SOURCE,
    TARGETS, read_inputs, sha256, write_json,
)


def main():
    rows, X, _, reference, metadata = read_inputs()
    data = json.loads((PUBLISHED / "predictions.json").read_text(encoding="utf-8"))
    if data["source_sha256"] != sha256(SOURCE):
        raise ValueError("Generated predictions belong to a different source CSV; rerun ml/train_pipeline.py")
    model_id = data["model_version"]
    versioned = PUBLISHED / f"predictions.{model_id}.json"
    if not versioned.exists() or json.loads(versioned.read_text(encoding="utf-8")) != data:
        raise ValueError("Versioned prediction artifact is missing or inconsistent")
    bundle = joblib.load(PUBLISHED / "model.joblib")
    model = bundle["model"] if "model" in bundle else bundle.get("models", [None])[0]
    if model is None or bundle.get("features") != FEATURES:
        raise ValueError("No matching fitted estimator with the declared feature order")
    predicted = model.predict(X)
    errors = np.abs(predicted - reference)
    if np.max(errors) > data["prediction_agreement"][TARGETS[1]]["atol"]:
        raise ValueError("Saved estimator does not reproduce source prediction columns")
    bundle.update({"features": FEATURES, "targets": TARGETS, "model_version": model_id})
    if "thresholds" not in bundle:
        bundle["thresholds"] = np.asarray([[data["risk_thresholds"][category][key] for key in ("low_to_moderate", "moderate_to_high")] for category in ("sexual", "nonsexual")])
    joblib.dump(bundle, PUBLISHED / "model.joblib", compress=3)
    report = {key: value for key, value in data.items() if key != "predictions"}
    report["record_count"] = len(rows)
    report["model_file"] = "data/published/model.joblib"
    report["model_artifact_sha256"] = sha256(PUBLISHED / "model.joblib")
    write_json(PUBLISHED / "model-report.json", report)
    write_json(PUBLISHED / "feature-labels.json", metadata)

    geometry = json.loads((DIST_DATA / "provinces.geojson").read_text(encoding="utf-8"))
    provinces, source_by_display = [], {}
    for feature in geometry["features"]:
        props = feature["properties"]
        code = str(props["KODE_PROV"]).zfill(2)
        numeric = int(code)
        island = "sumatera" if numeric < 30 else "java" if numeric < 40 else "bali-nusa-tenggara" if numeric < 60 else "kalimantan" if numeric < 70 else "sulawesi" if numeric < 80 else "maluku" if numeric < 90 else "papua"
        provinces.append({"province_code": code, "province_name": str(props["PROVINSI"]), "island": island})
        source_by_display[code] = code
    source_by_display.update(data["papua_display_mapping"]["display_to_source_code"])
    mapping_name = data["province_mapping_file"]
    province_mapping = {"schema_version": SCHEMA_VERSION, "data_version": model_id, "provinces": provinces, "source_by_display_code": source_by_display}
    write_json(PUBLISHED / mapping_name, province_mapping)
    manifest = {"schema_version": 1, "data_version": model_id, "predictions_file": versioned.name, "province_mapping_file": mapping_name}
    write_json(PUBLISHED / "manifest.json", manifest)

    try:
        for path, value in ((DIST_DATA / "predictions.json", data), (DIST_DATA / "model-report.json", report), (DIST_DATA / "feature-labels.json", metadata)):
            write_json(path, value)
        print("Completed API bundle and static data mirror.")
    except (PermissionError, OSError) as error:
        print(f"Completed API bundle; static mirror deferred because a local file is locked: {error}")


if __name__ == "__main__":
    main()
