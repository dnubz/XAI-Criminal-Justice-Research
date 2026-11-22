from __future__ import annotations

import csv
import hashlib
import importlib.metadata
import json
import os
from pathlib import Path

import joblib
import numpy as np
import shap
from lime.lime_tabular import LimeTabularExplainer
from sklearn.ensemble import RandomForestRegressor
from sklearn.metrics import accuracy_score, f1_score, mean_absolute_error, mean_squared_error, r2_score

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "data/source/data_bersih_dasbor.csv"
METADATA = ROOT / "ml/feature_metadata.json"
PUBLISHED = ROOT / "data/published"
DIST_DATA = ROOT / "dist/data"
FEATURES = [
    "PDRB_per_kapita_HK", "PDRB_per_kapita", "PPKMLA", "IPG", "miskin_rate", "ppm_rate",
    "tk_sekolah_per_1000", "tk_murid_per_1000", "pt_per_1000", "dosen_per_1000",
    "mahasiswa_per_1000", "mahasiswa_per_PT", "dosen_per_PT", "murid_per_sekolah",
    "guru_per_sekolah", "murid_per_guru", "smk_density", "pt_density", "edu_index",
    "RLS_gap", "PPDPSK_avg", "school_density", "log_populasi",
]
TARGETS = ["rate_seksual", "rate_non_seksual"]
CATEGORIES = ["sexual", "nonsexual"]
YEARS_TRAIN = [2021, 2022, 2023]
YEAR_TEST = 2024
SEED = 67
RF_PARAMS = {"n_estimators": 400, "max_depth": 10, "min_samples_leaf": 1, "max_features": "sqrt", "random_state": SEED, "n_jobs": 1}

PERMUTATION_PAIRS = 3
SHAP_MAX_EVALS = 2 * PERMUTATION_PAIRS * len(FEATURES) + 1
SHAP_ATOL = 1e-7
PREDICTION_ATOL = 1e-10
SCHEMA_VERSION = "1.0.0"


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def write_json(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(data, ensure_ascii=False, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    try:
        os.replace(temporary, path)
    except PermissionError:


        path.write_bytes(temporary.read_bytes())
        temporary.unlink(missing_ok=True)




def read_inputs():
    metadata = json.loads(METADATA.read_text(encoding="utf-8"))
    if set(metadata["features"]) != set(FEATURES):
        raise ValueError("Metadata feature codes must match the declared 23 model columns")
    with SOURCE.open(encoding="utf-8-sig", newline="") as stream:
        reader = csv.DictReader(stream)
        needed = {"province_code", "provinsi", "year", *FEATURES, *TARGETS, "pred_seksual", "pred_non_seksual"}
        missing = needed - set(reader.fieldnames or [])
        if missing:
            raise ValueError(f"Missing required CSV columns: {sorted(missing)}")
        rows = list(reader)
    rows.sort(key=lambda row: (int(row["year"]), row["provinsi"]))
    keys = [(str(row["province_code"]).zfill(2), int(row["year"])) for row in rows]
    if len(rows) != 134 or len(set(keys)) != len(rows):
        raise ValueError(f"Expected 134 unique province/year rows; found {len(rows)} rows and {len(set(keys))} keys")
    counts = {year: sum(int(row["year"]) == year for row in rows) for year in range(2021, 2025)}
    if counts != {2021: 34, 2022: 34, 2023: 34, 2024: 32}:
        raise ValueError(f"Unexpected coverage by year: {counts}")
    try:
        X = np.asarray([[float(row[name]) for name in FEATURES] for row in rows], dtype=np.float64)
        y = np.asarray([[float(row[name]) for name in TARGETS] for row in rows], dtype=np.float64)
        reference = np.asarray([[float(row["pred_seksual"]), float(row["pred_non_seksual"])] for row in rows], dtype=np.float64)
    except (TypeError, ValueError) as error:
        raise ValueError("Features, targets, and source prediction columns must be numeric and complete") from error
    if not (np.isfinite(X).all() and np.isfinite(y).all() and np.isfinite(reference).all()):
        raise ValueError("Features, targets, and source predictions must be finite")
    return rows, X, y, reference, metadata


def risk_level(value: float, cutoffs: tuple[float, float]) -> str:
    low, high = cutoffs
    return "low" if value < low else "moderate" if value < high else "high"


def score_metrics(y_true, y_pred, cutoffs):
    metrics = {}
    for i, target in enumerate(TARGETS):
        observed = [risk_level(value, cutoffs[i]) for value in y_true[:, i]]
        predicted = [risk_level(value, cutoffs[i]) for value in y_pred[:, i]]
        metrics[target] = {
            "n": int(len(y_true)),
            "mae": float(mean_absolute_error(y_true[:, i], y_pred[:, i])),
            "rmse": float(np.sqrt(mean_squared_error(y_true[:, i], y_pred[:, i]))),
            "r2": float(r2_score(y_true[:, i], y_pred[:, i])),
            "macro_f1": float(f1_score(observed, predicted, labels=["low", "moderate", "high"], average="macro", zero_division=0)),
            "accuracy": float(accuracy_score(observed, predicted)),
        }
    return metrics


def indicator_value(row, code, metadata):
    raw = float(row[code])
    definition = metadata["features"][code]
    item = {
        "column": code,
        "feature": definition["label"],
        "value": raw * definition.get("display_multiplier", 1),
        "unit": definition.get("unit"),
        "precision": definition.get("precision", 2),
        "raw_value": raw,
        "data_year": int(row["year"]),
        "source": SOURCE.name,
        "description": definition.get("description", ""),
    }
    if definition.get("qualifier"):
        item["qualifier"] = definition["qualifier"]
    return item


def main():
    rows, X, y, source_predictions, metadata = read_inputs()
    years = np.asarray([int(row["year"]) for row in rows])
    train_mask = np.isin(years, YEARS_TRAIN)
    test_mask = years == YEAR_TEST
    model = RandomForestRegressor(**RF_PARAMS).fit(X[train_mask], y[train_mask])
    predictions = model.predict(X)
    agreement = np.abs(predictions - source_predictions)
    agreement_max = agreement.max(axis=0)
    agreement_rmse = np.sqrt(np.mean(agreement ** 2, axis=0))

    if np.any(agreement_max > PREDICTION_ATOL):
        raise ValueError(f"Model predictions disagree with source prediction columns: max abs {agreement_max.tolist()}")

    cutoffs = np.quantile(y[train_mask], [1 / 3, 2 / 3], axis=0).T
    metrics = score_metrics(y[test_mask], predictions[test_mask], cutoffs)
    source_hash = sha256(SOURCE)
    metadata_hash = sha256(METADATA)
    model_id = "mt-rf-23f-seed67-" + hashlib.sha256((source_hash + metadata_hash + json.dumps(FEATURES) + json.dumps(RF_PARAMS, sort_keys=True)).encode()).hexdigest()[:12]
    reference = {}
    output_rows = []
    shap_max = {cat: 0.0 for cat in CATEGORIES}
    shap_rows = {}
    for year in sorted(set(years.tolist())):
        indices = np.flatnonzero(years == year)
        if len({rows[index]["province_code"] for index in indices}) != len(indices):
            raise ValueError(f"Repeated source province in explanation reference for {year}")
        year_X = X[indices]
        year_predictions = model.predict(year_X)
        base = year_predictions.mean(axis=0)
        reference[str(year)] = {
            "province_count": len(indices),
            "province_codes": [str(rows[index]["province_code"]).zfill(2) for index in indices],
            "predictions": {cat: float(base[k]) for k, cat in enumerate(CATEGORIES)},
            "kind": "same_year_unique_source_province_prediction_mean",
        }
        explainer = shap.PermutationExplainer(model.predict, year_X, feature_names=FEATURES, seed=SEED)
        explanation = explainer(year_X, max_evals=SHAP_MAX_EVALS)
        values = np.asarray(explanation.values)
        expected = np.asarray(explanation.base_values[0], dtype=float).reshape(-1)
        if values.shape != (len(indices), len(FEATURES), 2) or expected.shape != (2,):
            raise ValueError(f"Unexpected permutation SHAP multi-target shapes: values={values.shape}, base={expected.shape}")
        if not np.allclose(expected, base, rtol=0, atol=SHAP_ATOL):
            raise ValueError(f"SHAP expected values do not match same-year reference mean for {year}: {expected} vs {base}")
        errors = expected[None, :] + values.sum(axis=1) - year_predictions
        for k, category in enumerate(CATEGORIES):
            shap_max[category] = max(shap_max[category], float(np.abs(errors[:, k]).max()))
        shap_rows[int(year)] = {int(source_index): (values[pos], expected.copy(), float(np.max(np.abs(errors[pos])))) for pos, source_index in enumerate(indices)}

    if max(shap_max.values()) > SHAP_ATOL:
        raise ValueError(f"SHAP reconstruction exceeds absolute tolerance {SHAP_ATOL}: {shap_max}")

    lime_explainer = LimeTabularExplainer(
        X[train_mask], feature_names=FEATURES, mode="regression", random_state=SEED,
        discretize_continuous=False, sample_around_instance=False,
    )
    lime_fidelity = {cat: [] for cat in CATEGORIES}
    for i, source in enumerate(rows):
        year = int(source["year"])
        indicators = [indicator_value(source, name, metadata) for name in FEATURES]
        shap_values, shap_base, row_shap_error = shap_rows[year][i]
        record = {
            "province_code": str(source["province_code"]).zfill(2),
            "province_name": source["provinsi"].strip(),
            "year": year,
            "is_training": bool(train_mask[i]),
            "indicators": indicators,
        }
        if record["province_code"] in {"91", "92"}:
            record["boundary_status"] = "pre_2022_split"
        for k, category in enumerate(CATEGORIES):
            pred = float(predictions[i, k])
            explanation = []
            lime_callback = lambda matrix, target_index=k: model.predict(np.asarray(matrix, dtype=np.float64))[:, target_index]
            local = lime_explainer.explain_instance(X[i], lime_callback, num_features=len(FEATURES), num_samples=3000)
            local_weights = {int(feature_index): float(weight) for feature_index, weight in local.as_map()[0]}
            lime_items = []
            for j, name in enumerate(FEATURES):
                feature_record = indicators[j]
                explanation.append({**feature_record, "contribution": float(shap_values[j, k])})
                lime_items.append({**feature_record, "contribution": local_weights.get(j, 0.0)})
            output = {
                "level": risk_level(pred, tuple(cutoffs[k])),
                "predicted_value": pred,
                "observed_value": float(y[i, k]),
                "explanation_target": "risk_score",
                "explanations": explanation,
                "lime_explanations": lime_items,
                "shap_base_value": float(shap_base[k]),
                "shap_reference_year": year,
                "shap_reference_count": reference[str(year)]["province_count"],
                "shap_reference_kind": reference[str(year)]["kind"],
                "shap_additivity_error": float(shap_base[k] + shap_values[:, k].sum() - pred),
                "lime_fidelity": float(local.score),
                "lime_local_prediction": float(np.ravel(local.local_pred)[0]),
                "lime_intercept": float(np.ravel(next(iter(local.intercept.values())) if isinstance(local.intercept, dict) else local.intercept)[0]),
            }
            if year == YEAR_TEST:
                lime_fidelity[category].append(float(local.score))
            record[category] = output
        output_rows.append(record)

    thresholds = {cat: {"low_to_moderate": float(cutoffs[k, 0]), "moderate_to_high": float(cutoffs[k, 1])} for k, cat in enumerate(CATEGORIES)}
    mapping = {
        "description": "For display only: use the unique source observation once in research metrics and same-year reference means.",
        "historical_years": [2021, 2022, 2023],
        "source_to_display_codes": {"91": ["91", "93", "94", "95"], "92": ["92", "96"]},
        "display_to_source_code": {"93": "91", "94": "91", "95": "91", "96": "92"},
        "display_note": "Memakai data Papua sebelum pemekaran 2022.",
        "unavailable_2024_display_codes": ["91", "92", "93", "94", "95", "96"],
        "unavailable_2024_note": "Data 2024 tidak tersedia karena pemekaran Papua membuat data tidak sebanding dengan tahun sebelumnya.",
        "not_prediction_rows": True,
    }
    python_version = __import__("sys").version.split()[0]
    package_versions = {name: importlib.metadata.version(name) for name in ("numpy", "scikit-learn", "shap", "lime", "joblib")}
    data = {
        "is_demo": False,
        "schema_version": SCHEMA_VERSION,
        "data_version": model_id,
        "model_version": model_id,
        "model_name": "Random Forest multi-target",
        "input_period": "2021–2024",
        "source_file": SOURCE.name,
        "source_sha256": source_hash,
        "source_csv_sha256": source_hash,
        "source_sha256_matches_legacy_copy": source_hash == sha256(ROOT / "data-source/data_bersih_dasbor.csv"),
        "available_years": [2021, 2022, 2023, 2024],
        "coverage_by_year": {str(year): sum(int(row["year"]) == year for row in rows) for year in range(2021, 2025)},
        "training_years": YEARS_TRAIN,
        "model_training_years": YEARS_TRAIN,
        "model_test_year": YEAR_TEST,
        "model_feature_columns": FEATURES,
        "model_feature_assumption": "All 23 declared socioeconomic indicators are used as raw CSV values; province code, name, year, source predictions, and old classes are excluded.",
        "model_parameters": {**RF_PARAMS, "multi_target": True},
        "model_seed": SEED,
        "target_columns": TARGETS,
        "target_unit": "Korban per 100.000 penduduk (sesuai referensi dashboard pengguna; tidak tersedia dalam header CSV).",
        "risk_thresholds": thresholds,
        "risk_threshold_method": "Empirical 1/3 and 2/3 quantiles of observed training outcomes, 2021–2023.",
        "test_metrics": metrics,
        "prediction_agreement": {target: {"max_absolute_error": float(agreement_max[k]), "rmse": float(agreement_rmse[k]), "atol": PREDICTION_ATOL, "rows": int(len(rows))} for k, target in enumerate(TARGETS)},
        "comparison_reference": reference,
        "papua_display_mapping": mapping,
        "province_mapping_file": f"province-mapping.{model_id}.json",
        "explanation_methods": {
            "shap": f"SHAP PermutationExplainer with {PERMUTATION_PAIRS} forward/reverse permutation pairs (max_evals={SHAP_MAX_EVALS}), seed {SEED}; each year uses every unique available source-province feature row. Baseline is the same-year unweighted mean model prediction. This is a sampled interventional attribution, not TreeSHAP.",
            "lime": "LIME local linear surrogate, 3,000 perturbations, seed 67, continuous features not discretized. Coefficients are local surrogate weights, not additive SHAP contributions.",
        },
        "xai_diagnostics": {category: {
            "shap_max_additivity_error": shap_max[category],
            "shap_additivity_atol": SHAP_ATOL,
            "lime_test_fidelity_min": float(np.min(lime_fidelity[category])),
            "lime_test_fidelity_median": float(np.median(lime_fidelity[category])),
            "lime_test_fidelity_max": float(np.max(lime_fidelity[category])),
            "lime_test_fidelity_n": len(lime_fidelity[category]),
        } for category in CATEGORIES},
        "feature_metadata_file": "ml/feature_metadata.json",
        "feature_metadata_version": metadata["metadata_version"],
        "package_versions": package_versions,
        "python_version": python_version,
        "methodology": (
            "Random Forest multi-target (400 trees, max_depth 10, min_samples_leaf 1, max_features sqrt, random seed 67) "
            "using the 23 declared socioeconomic indicators. Fit 2021–2023; hold out 2024. Source prediction columns are "
            "checked against the refit model. Risk cutoffs are training-derived relative tertiles. SHAP and LIME describe "
            "the fitted model and do not establish causal effects. Historical Papua source observations are mapped for "
            "display only; they are not duplicated in metrics or reference means. No claim of independent paper agreement is made."
        ),
        "predictions": output_rows,
    }
    PUBLISHED.mkdir(parents=True, exist_ok=True)
    DIST_DATA.mkdir(parents=True, exist_ok=True)
    predictions_file = f"predictions.{model_id}.json"
    write_json(PUBLISHED / predictions_file, data)
    write_json(PUBLISHED / "predictions.json", data)
    write_json(DIST_DATA / "predictions.json", data)
    report = {key: value for key, value in data.items() if key != "predictions"}
    report["record_count"] = len(output_rows)
    report["source_sha256"] = source_hash
    report["model_file"] = "data/published/model.joblib"
    joblib.dump({"model": model, "features": FEATURES, "targets": TARGETS, "thresholds": cutoffs, "model_version": model_id}, PUBLISHED / "model.joblib", compress=3)
    report["model_artifact_sha256"] = sha256(PUBLISHED / "model.joblib")
    write_json(PUBLISHED / "model-report.json", report)
    write_json(DIST_DATA / "model-report.json", report)

    write_json(PUBLISHED / "feature-labels.json", metadata)
    write_json(DIST_DATA / "feature-labels.json", metadata)
    geometry = json.loads((DIST_DATA / "provinces.geojson").read_text(encoding="utf-8"))
    provinces = []
    source_by_display_code = {}
    for feature in geometry["features"]:
        props = feature["properties"]
        code = str(props["KODE_PROV"]).zfill(2)
        numeric = int(code)
        island = "sumatera" if numeric < 30 else "java" if numeric < 40 else "bali-nusa-tenggara" if numeric < 60 else "kalimantan" if numeric < 70 else "sulawesi" if numeric < 80 else "maluku" if numeric < 90 else "papua"
        provinces.append({"province_code": code, "province_name": str(props["PROVINSI"]), "island": island})
        source_by_display_code[code] = code
    source_by_display_code.update(mapping["display_to_source_code"])
    province_mapping = {"schema_version": SCHEMA_VERSION, "data_version": model_id, "provinces": provinces, "source_by_display_code": source_by_display_code}
    mapping_path = PUBLISHED / data["province_mapping_file"]
    write_json(mapping_path, province_mapping)
    manifest = {"schema_version": 1, "data_version": model_id, "predictions_file": predictions_file, "province_mapping_file": mapping_path.name}
    write_json(PUBLISHED / "manifest.json", manifest)
    print(json.dumps({"model_version": model_id, "rows": len(output_rows), "source_sha256": source_hash,
                      "prediction_agreement": data["prediction_agreement"], "test_metrics": metrics,
                      "xai_diagnostics": data["xai_diagnostics"]}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
