import hashlib
import json
import os
from pathlib import Path

import joblib
import numpy as np
import shap

from feature_metadata import definitions, apply_labels

ROOT = Path(__file__).resolve().parents[1]


def save(path, value):
    temporary = path.with_suffix(".tmp.json")
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    os.replace(temporary, path)


def refresh(data, report, bundle):
    mapping = definitions()
    features = bundle["features"]
    for row in data["predictions"]:
        row["indicators"] = [apply_labels(item, mapping) for item in row.get("indicators", [])]
        for category in ("sexual", "nonsexual"):
            for method in ("explanations", "lime_explanations"):
                row[category][method] = [apply_labels(item, mapping) for item in row[category].get(method, [])]
    reference = {}
    max_error = {"sexual": 0.0, "nonsexual": 0.0}
    for year in sorted({row["year"] for row in data["predictions"]}):
        cohort = [row for row in data["predictions"] if row["year"] == year]
        X = np.asarray([[next(item["raw_value"] for item in row["indicators"] if item["column"] == name) for name in features] for row in cohort], dtype=float)
        reference[str(year)] = {"province_count": len(cohort), "predictions": {}}
        for target_index, category in enumerate(("sexual", "nonsexual")):
            estimator = bundle["models"][target_index]
            predict = lambda Z: np.maximum(0, estimator.predict(np.asarray(Z, dtype=float)))
            predictions = predict(X)

            explainer = shap.Explainer(predict, X, algorithm="exact", feature_names=features)
            result = explainer(X, max_evals=2 ** len(features), batch_size=512, silent=True)
            expected = float(np.mean(predictions))
            values = np.asarray(result.values)
            bases = np.asarray(result.base_values).reshape(-1)
            if not np.allclose(bases, expected, atol=1e-10):
                raise ValueError("SHAP reference does not equal the available province mean")
            reference[str(year)]["predictions"][category] = expected
            for index, row in enumerate(cohort):
                output = row[category]
                if not np.isclose(output["predicted_value"], predictions[index], atol=1e-10):
                    raise ValueError("The frozen model prediction changed")
                measured = {item["column"]: item for item in row["indicators"]}
                output["explanations"] = [{**measured[column], "contribution": float(values[index, position])} for position, column in enumerate(features)]
                output["shap_base_value"] = expected
                output["shap_reference_year"] = year
                output["shap_reference_count"] = len(cohort)
                output["shap_reference_kind"] = "same_year_province_prediction_mean"
                error = abs(expected + float(values[index].sum()) - output["predicted_value"])
                output["shap_additivity_error"] = error
                max_error[category] = max(max_error[category], error)
            print(f"SHAP reference {year}/{category}: mean={expected:.6f}, provinces={len(cohort)}", flush=True)
    description = "Exact interventional SHAP using every available original-feature province row in the selected year; baseline equals the unweighted same-year mean model prediction. Only input features are used for this post-fit explanation reference, never observed test outcomes."
    data["comparison_reference"] = reference
    data["feature_definition_source"] = "User-provided screenshots of Feature in dataset"
    data["target_unit"] = "Korban per 100.000 penduduk"
    data["target_unit_source"] = "User-provided dashboard reference image"
    data["explanation_methods"]["shap"] = description
    report["shap_reference"] = description
    report["feature_definition_source"] = data["feature_definition_source"]
    report["target_unit_source"] = data["target_unit_source"]
    for category in ("sexual", "nonsexual"):
        data["xai_diagnostics"][category]["shap_max_additivity_error"] = max_error[category]
        report["xai_diagnostics"][category]["shap_max_additivity_error"] = max_error[category]
    return data, report


def main():
    path = ROOT / "dist/data/predictions.json"
    model_path = ROOT / "model-artifacts/model.joblib"
    before = hashlib.sha256(model_path.read_bytes()).hexdigest()
    data = json.loads(path.read_text(encoding="utf-8"))
    report = json.loads((ROOT / "model-artifacts/benchmark.json").read_text(encoding="utf-8"))
    data, report = refresh(data, report, joblib.load(model_path))
    save(path, data)
    save(ROOT / "model-artifacts/benchmark.json", report)
    save(ROOT / "dist/data/model-report.json", report)
    if hashlib.sha256(model_path.read_bytes()).hexdigest() != before:
        raise ValueError("Model artifact unexpectedly changed")
    print("Labels and SHAP references refreshed; model artifact and predictions unchanged.", flush=True)


if __name__ == "__main__":
    main()
