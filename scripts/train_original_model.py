"""Temporal model comparison and real SHAP/LIME using four provisional original inputs."""
import argparse
import csv
import hashlib
import importlib.metadata
import json
import os
import time
from pathlib import Path

import numpy as np
import joblib
from sklearn.base import clone
from sklearn.compose import TransformedTargetRegressor
from sklearn.dummy import DummyRegressor
from sklearn.ensemble import ExtraTreesRegressor, RandomForestRegressor, HistGradientBoostingRegressor
from sklearn.impute import SimpleImputer
from sklearn.linear_model import Ridge, ElasticNet
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score, f1_score, accuracy_score
from sklearn.neighbors import KNeighborsRegressor
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler
from sklearn.svm import SVR
from catboost import CatBoostRegressor
from xgboost import XGBRegressor

from import_dashboard_csv import convert_records

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "data-source/data_bersih_dasbor.csv"
ARTIFACTS = ROOT / "model-artifacts"
FEATURES = ["PDRB_per_kapita_HK", "PDRB_per_kapita", "PPKMLA", "IPG"]
TARGETS = ["rate_seksual", "rate_non_seksual"]
CATEGORIES = ["sexual", "nonsexual"]
SEED = 42


def read_source():
    with SOURCE.open(encoding="utf-8-sig", newline="") as stream:
        rows = sorted(list(csv.DictReader(stream)), key=lambda r: (int(r["year"]), r["province_code"]))
    X = np.asarray([[float(row[feature]) for feature in FEATURES] for row in rows], dtype=float)
    y = np.asarray([[float(row[target]) for target in TARGETS] for row in rows], dtype=float)
    years = np.asarray([int(row["year"]) for row in rows])
    if not np.isfinite(X).all() or not np.isfinite(y).all():
        raise ValueError("Original input features and observed targets must be finite")
    return rows, X, y, years


def candidates():
    result = [("Mean baseline", {}, DummyRegressor(strategy="mean"), False)]
    for alpha in (.1, 1, 10, 100):
        result.append(("Ridge", {"alpha": alpha}, Ridge(alpha=alpha), True))
    for alpha in (.01, .1, 1):
        result.append(("ElasticNet", {"alpha": alpha}, ElasticNet(alpha=alpha, l1_ratio=.25, max_iter=20000, random_state=SEED), True))
    for depth, leaf in ((3, 3), (5, 3), (None, 2), (None, 6)):
        params = {"max_depth": depth, "min_samples_leaf": leaf}
        result.append(("Random Forest", params, RandomForestRegressor(n_estimators=250, **params, random_state=SEED, n_jobs=2), False))
        result.append(("Extra Trees", params, ExtraTreesRegressor(n_estimators=250, **params, random_state=SEED, n_jobs=2), False))
    for leaves in (3, 7, 15):
        params = {"max_leaf_nodes": leaves, "min_samples_leaf": 5}
        result.append(("Histogram Gradient Boosting", params, HistGradientBoostingRegressor(**params, max_iter=200, learning_rate=.04, l2_regularization=5, early_stopping=False, random_state=SEED), False))
    for depth in (2, 4, 6):
        params = {"depth": depth, "l2_leaf_reg": 10}
        result.append(("CatBoost", params, CatBoostRegressor(**params, iterations=350, learning_rate=.04, loss_function="RMSE", thread_count=2, random_seed=SEED, verbose=False, allow_writing_files=False), False))
    for depth in (2, 3, 4):
        params = {"max_depth": depth, "min_child_weight": 5}
        result.append(("XGBoost", params, XGBRegressor(**params, n_estimators=250, learning_rate=.04, reg_lambda=10, subsample=.9, colsample_bytree=1, objective="reg:squarederror", tree_method="hist", n_jobs=2, random_state=SEED, verbosity=0), False))
    for c in (1, 10, 100):
        result.append(("RBF SVR", {"C": c}, SVR(C=c, epsilon=.1), True))
    for k in (5, 10):
        result.append(("Nearest neighbors", {"n_neighbors": k}, KNeighborsRegressor(n_neighbors=k, weights="distance"), True))
    return result


def make_pipeline(estimator, scale):
    steps = [("imputer", SimpleImputer(strategy="median"))]
    if scale:
        steps.append(("scaler", StandardScaler()))
    steps.append(("model", clone(estimator)))
    pipeline = Pipeline(steps)
    return TransformedTargetRegressor(regressor=pipeline, transformer=StandardScaler()) if scale else pipeline


def predict(models, X):
    return np.maximum(0, np.column_stack([model.predict(X) for model in models]))


def metrics(y, pred, thresholds=None):
    result = {}
    for index, target in enumerate(TARGETS):
        values = {"mae": float(mean_absolute_error(y[:, index], pred[:, index])),
                  "rmse": float(np.sqrt(mean_squared_error(y[:, index], pred[:, index]))),
                  "r2": float(r2_score(y[:, index], pred[:, index])), "n": len(y)}
        if thresholds is not None:
            observed_class = np.searchsorted(thresholds[index], y[:, index], side="right")
            predicted_class = np.searchsorted(thresholds[index], pred[:, index], side="right")
            values["macro_f1"] = float(f1_score(observed_class, predicted_class, labels=[0, 1, 2], average="macro", zero_division=0))
            values["accuracy"] = float(accuracy_score(observed_class, predicted_class))
        result[target] = values
    return result


def save_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(".tmp.json")
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    os.replace(temporary, path)


def write_summary(report):
    selected = report["selected"]
    lines = ["# Original-feature model results", "", f"Selected model: **{selected['model']}**, parameters `{json.dumps(selected['params'])}`.", "",
             "This is the best of 30 tested configurations on forward-validation normalized MAE. It is not a universal best-model claim and does not establish that the new model outperforms the earlier CSV model.", "",
             "## Inputs and targets", "", "Original inputs: `" + "`, `".join(FEATURES) + "`. Human-readable definitions come from the user's feature dictionary screenshots. PPKMLA is a percentage among ever-married women who had their first child before age 20; source values are already percentages. PDRB currency units remain unspecified. No engineered density, per-1000, gap, log, year, ID, previous prediction or previous class is used as input.", "",
             "Observed targets: `rate_seksual` and `rate_non_seksual`. The old `kelas_*` columns were produced by a previous model and are not ground-truth training labels.", "",
             "## Evaluation", "", "Selection folds: train 2021 → validate 2022; train 2021–2022 → validate 2023. Final fitting: 102 rows in 2021–2023. Final test: 32 rows in 2024. Preprocessing is fitted inside each training fold. Upstream cleaning of the supplied CSV has not been audited.", "",
             "| Target | Test MAE | Test RMSE | Test R² | Macro F1 of derived risk classes | Class accuracy |", "|---|---:|---:|---:|---:|---:|"]
    for target, metric in report["test_metrics"].items():
        lines.append(f"| {target} | {metric['mae']:.4f} | {metric['rmse']:.4f} | {metric['r2']:.4f} | {metric['macro_f1']:.4f} | {metric['accuracy']:.4f} |")
    lines += ["", "MAE/RMSE are in the source rate scale, not percentage accuracy. Sexual-violence class performance is limited; do not describe the model as meeting a blanket Macro-F1 > 0.75 requirement.", "",
              "### Baseline and prior-output comparison", "", "| Output | Sexual MAE | Nonsexual MAE | Sexual R² | Nonsexual R² |", "|---|---:|---:|---:|---:|"]
    for label, key in [("Selected four-input model", "test_metrics"), ("Training mean", "baseline_mean_test_metrics"), ("Previous year's observed rate", "baseline_last_year_test_metrics"), ("Previous model outputs supplied in CSV", "previous_csv_model_test_metrics")]:
        a, b = (report[key][target] for target in TARGETS)
        lines.append(f"| {label} | {a['mae']:.4f} | {b['mae']:.4f} | {a['r2']:.4f} | {b['r2']:.4f} |")
    lines += ["", "The prior model's supplied predictions have lower test errors than this four-input model in this file. Its training and FE provenance are unavailable, so those outputs were not used to choose or train the new model. The persistence baseline is competitive. More original inputs and additional independent years are needed for a stronger research comparison.", "",
              "### Best configuration per family", "", "| Family | Forward-validation normalized MAE | Parameters |", "|---|---:|---|"]
    families = set()
    for row in report["ranking"]:
        if row["model"] not in families:
            lines.append(f"| {row['model']} | {row['validation_normalized_mae']:.4f} | `{json.dumps(row['params'])}` |")
            families.add(row["model"])
    lines += ["", "Complete fold results for all 30 candidates are in `benchmark.json`.", "", "## Risk-class definitions", "",
              "Classes are regenerated from tertiles of observed training rates. Below the lower cutoff is low; from the lower cutoff up to the upper cutoff is moderate; at or above the upper cutoff is high. These are relative research classes and are not validated absolute danger thresholds.", "",
              "| Target | Low → moderate cutoff | Moderate → high cutoff |", "|---|---:|---:|"]
    for target, cutoffs in report["risk_thresholds"].items():
        lines.append(f"| {target} | {cutoffs['low_to_moderate']:.6f} | {cutoffs['moderate_to_high']:.6f} |")
    lines += ["", "## SHAP and LIME", "", "Both methods use exactly the four original input columns and explain the same fitted predictor in raw input coordinates. Internal feature scaling for nearest-neighbor distance is part of the fitted pipeline, not an additional FE column.", "",
              "SHAP: " + report.get("shap_reference", "Exact interventional SHAP using training background rows.") + " All 134 province/year rows and both targets were explained. Baseline plus four SHAP contributions reconstructs each exported prediction. Attributions depend on the background and correlated economic inputs; they are not causal effects.", "",
              "LIME: continuous-feature local linear approximations, 6,000 perturbations, seed 42. Its coefficient is per LIME-standardized input, not a contribution relative to the SHAP baseline. Neighborhood parameters were selected by surrogate fidelity on seven 2023 TRAINING rows only; the predictor and its test metrics were not retuned. LIME is approximate and can have low local fidelity; SHAP is the default display.", "",
              "| Target | Max SHAP additivity error | Test LIME R² minimum | Test LIME R² median | Test LIME R² maximum |", "|---|---:|---:|---:|---:|"]
    for target, values in report.get("xai_diagnostics", {}).items():
        lines.append(f"| {target} | {values['shap_max_additivity_error']:.3g} | {values['lime_test_fidelity_min']:.4f} | {values['lime_test_fidelity_median']:.4f} | {values['lime_test_fidelity_max']:.4f} |")
    if "lime_configuration_selection" in report:
        config = report["lime_configuration_selection"]["selected"]
        lines += ["", f"Chosen LIME neighborhood: sample_around_instance={config['sample_around_instance']}, kernel_width={config['kernel_width']}."]
    lines += ["", "## Coverage and reproducibility", "", "134 rows, 2021–2024. Training-year predictions are in-sample and labeled in the interface. There are no input values for 2025/2026, so no forecasts for those years are fabricated. The latest map has 32 available provinces. Historical Papua data is retained, but its modern boundary compatibility is unverified and its shapes remain gray.", "",
              f"Source SHA-256: `{report['source_sha256']}`. Model version: `{report['model_version']}`. Seed: 42. The source CSV is unchanged. Model bundle: `model.joblib`. Dependency versions: `../requirements-ml.txt`.", "",
              "Method references: [scikit-learn data leakage guidance](https://scikit-learn.org/stable/common_pitfalls.html), [SHAP](https://shap.readthedocs.io/en/stable/), [LIME](https://lime-ml.readthedocs.io/en/latest/lime.html).", ""]
    (ARTIFACTS / "RESULTS.md").write_text("\n".join(lines), encoding="utf-8")


def benchmark():
    rows, X, y, years = read_source()
    # Two forward validation folds; 2024 never participates in selection.
    folds = [(years < 2022, years == 2022), (years < 2023, years == 2023)]
    specs = candidates()
    results = []
    for number, (name, params, estimator, scale) in enumerate(specs):
        started = time.time()
        fold_results, scores = [], []
        for train, validation in folds:
            models = [make_pipeline(estimator, scale).fit(X[train], y[train, index]) for index in range(2)]
            output = predict(models, X[validation])
            naive = np.tile(y[train].mean(axis=0), (validation.sum(), 1))
            normalizer = np.maximum(np.mean(np.abs(y[validation] - naive), axis=0), 1e-12)
            score = float(np.mean(np.mean(np.abs(y[validation] - output), axis=0) / normalizer))
            scores.append(score)
            fold_results.append({"train_years": sorted(set(years[train].tolist())), "validation_year": int(years[validation][0]), "train_n": int(train.sum()), "validation_n": int(validation.sum()), "normalized_mae": score, "metrics": metrics(y[validation], output)})
        result = {"candidate_index": number, "model": name, "params": params, "validation_normalized_mae": float(np.mean(scores)), "folds": fold_results, "seconds": round(time.time() - started, 3)}
        results.append(result)
        print(f"[{number+1}/{len(specs)}] {name} {params}: normalized MAE={result['validation_normalized_mae']:.4f}", flush=True)
    ordered = sorted(results, key=lambda value: value["validation_normalized_mae"])
    winner = ordered[0]
    _, _, estimator, scale = specs[winner["candidate_index"]]
    train, test = years < 2024, years == 2024
    models = [make_pipeline(estimator, scale).fit(X[train], y[train, index]) for index in range(2)]
    thresholds = np.quantile(y[train], [1/3, 2/3], axis=0).T
    all_predictions = predict(models, X)
    naive = np.tile(y[train].mean(axis=0), (test.sum(), 1))
    previous = np.asarray([[float(row["pred_seksual"]), float(row["pred_non_seksual"])] for row in rows])[test]
    previous_observed = {(row["province_code"], int(row["year"])): y[index] for index, row in enumerate(rows)}
    persistence = np.asarray([previous_observed[(row["province_code"], 2023)] for row in rows if int(row["year"]) == 2024])
    digest = hashlib.sha256(SOURCE.read_bytes()).hexdigest()
    version = "original-features-" + hashlib.sha256((digest + json.dumps(winner["params"], sort_keys=True) + winner["model"]).encode()).hexdigest()[:10]
    report = {
        "model_version": version, "selected": winner, "ranking": ordered,
        "feature_columns": FEATURES, "feature_assumption": "Four provisionally original columns present in the dashboard CSV. Engineered features and old predictions/classes are excluded. Full pre-FE dataset was not supplied.",
        "target_columns": TARGETS, "source_sha256": digest, "seed": SEED,
        "selection_metric": "Mean target-normalized MAE across forward validation in 2022 and 2023; normalization uses the training-mean baseline error on each validation fold.",
        "train_years": sorted(set(years[train].tolist())), "train_n": int(train.sum()),
        "test_year": 2024, "test_n": int(test.sum()),
        "test_metrics": metrics(y[test], all_predictions[test], thresholds),
        "baseline_mean_test_metrics": metrics(y[test], naive, thresholds),
        "baseline_last_year_test_metrics": metrics(y[test], persistence, thresholds),
        "previous_csv_model_test_metrics": metrics(y[test], previous, thresholds),
        "previous_model_note": "Provided predictions only; original model training/FE/validation provenance is unavailable, so this is a descriptive comparison, not an equivalent model-selection candidate.",
        "risk_thresholds": {category: {"low_to_moderate": float(thresholds[index, 0]), "moderate_to_high": float(thresholds[index, 1])} for index, category in enumerate(CATEGORIES)},
        "risk_threshold_method": "Tertiles of observed training rates (2021–2023), not thresholds from old model predictions. These are relative research categories, not calibrated individual risks.",
        "available_years": sorted(set(years.tolist())),
        "future_prediction_note": "No 2025/2026 predictions: original feature values for those years were not supplied.",
        "package_versions": {name: importlib.metadata.version(name) for name in ("numpy", "scikit-learn", "catboost", "xgboost", "shap", "lime")},
    }
    ARTIFACTS.mkdir(parents=True, exist_ok=True)
    joblib.dump({"models": models, "features": FEATURES, "targets": TARGETS, "thresholds": thresholds, "model_version": version}, ARTIFACTS / "model.joblib", compress=3)
    save_json(ARTIFACTS / "benchmark.json", report)
    print("SELECTED:", winner["model"], winner["params"], flush=True)
    print("HOLDOUT 2024:", json.dumps(report["test_metrics"]), flush=True)


def explain():
    import shap
    from lime.lime_tabular import LimeTabularExplainer
    rows, X, y, years = read_source()
    bundle = joblib.load(ARTIFACTS / "model.joblib")
    report = json.loads((ARTIFACTS / "benchmark.json").read_text(encoding="utf-8"))
    if hashlib.sha256(SOURCE.read_bytes()).hexdigest() != report["source_sha256"]:
        raise ValueError("CSV changed after benchmark; run benchmark again")
    models, thresholds = bundle["models"], bundle["thresholds"]
    train = years < 2024
    background = X[train]
    rng = np.random.default_rng(SEED)
    background = background[rng.choice(len(background), size=min(64, len(background)), replace=False)]
    data = json.loads((ROOT / "dist/data/predictions.json").read_text(encoding="utf-8-sig"))
    records = {(row["province_code"], row["year"]): row for row in data["predictions"]}
    # Choose the neighborhood on seven TRAINING rows, without using 2024 outcomes.
    calibration_rows = np.where(years == 2023)[0][::5]
    calibration = []
    for around, width in [(False, 1.5), (True, 1.5), (True, 1.0), (True, .75), (True, .5)]:
        scores = []
        for target_index in range(2):
            local_explainer = LimeTabularExplainer(X[train], feature_names=FEATURES, mode="regression", discretize_continuous=False, sample_around_instance=around, kernel_width=width, random_state=SEED)
            callback = lambda Z: np.maximum(0, models[target_index].predict(Z))
            scores.extend(float(local_explainer.explain_instance(X[index], callback, num_features=len(FEATURES), num_samples=6000).score) for index in calibration_rows)
        configuration = {"sample_around_instance": around, "kernel_width": width, "mean_training_fidelity": float(np.mean(scores)), "median_training_fidelity": float(np.median(scores))}
        calibration.append(configuration)
        print("LIME training-neighborhood check:", configuration, flush=True)
    lime_config = max(calibration, key=lambda value: value["mean_training_fidelity"])
    report["lime_configuration_selection"] = {"candidates": calibration, "selected": lime_config, "sample_year": 2023, "sample_provinces": [rows[index]["province_code"] for index in calibration_rows], "note": "Neighborhood selected by mean surrogate fidelity on training rows only. This does not change or retune the predictor. Test fidelity is reported separately."}
    summaries = {}
    for target_index, category in enumerate(CATEGORIES):
        model = models[target_index]
        predict_target = lambda values: np.maximum(0, model.predict(np.asarray(values, dtype=float)))
        predictions = predict_target(X)
        print("Computing exact SHAP:", category, flush=True)
        explainer = shap.Explainer(predict_target, background, algorithm="exact", feature_names=FEATURES)
        explanation = explainer(X, max_evals=2**len(FEATURES), batch_size=512, silent=True)
        values = np.asarray(explanation.values)
        base_values = np.asarray(explanation.base_values).reshape(-1)
        residual = float(np.max(np.abs(values.sum(axis=1) + base_values - predictions)))
        if residual > 1e-6:
            raise ValueError(f"SHAP additivity check failed: {residual}")
        lime_explainer = LimeTabularExplainer(X[train], feature_names=FEATURES, training_labels=y[train, target_index], mode="regression", discretize_continuous=False, sample_around_instance=lime_config["sample_around_instance"], kernel_width=lime_config["kernel_width"], random_state=SEED)
        fidelities = []
        for index, source_row in enumerate(rows):
            record = records[(source_row["province_code"], int(source_row["year"]))]
            output = record[category]
            previous_output = output.get("previous_model_output") or {key: output[key] for key in ("level", "predicted_value", "observed_value")}
            raw_by_column = {item["column"]: item for item in record["indicators"]}
            local = lime_explainer.explain_instance(X[index], predict_target, num_features=len(FEATURES), num_samples=6000)
            lime_weights = dict(local.as_map()[1])
            def feature_items(contributions):
                return [{**raw_by_column[column], "contribution": float(contributions[position])} for position, column in enumerate(FEATURES)]
            shap_items = feature_items(values[index])
            lime_items = feature_items([lime_weights.get(position, 0.0) for position in range(len(FEATURES))])
            output.update({
                "previous_model_output": previous_output,
                "level": ["low", "moderate", "high"][int(np.searchsorted(thresholds[target_index], predictions[index], side="right"))],
                "predicted_value": float(predictions[index]), "explanation_target": "risk_score",
                "explanations": shap_items, "lime_explanations": lime_items,
                "shap_base_value": float(base_values[index]), "shap_additivity_error": float(abs(values[index].sum() + base_values[index] - predictions[index])),
                "lime_fidelity": float(local.score), "lime_local_prediction": float(np.asarray(local.local_pred).ravel()[0]),
                "lime_intercept": float(local.intercept[1]),
            })
            record["is_training"] = bool(years[index] < 2024)
            fidelities.append(float(local.score))
            if index % 16 == 0 or index == len(rows) - 1:
                print(f"{category}: SHAP + LIME {index+1}/{len(rows)}", flush=True)
        test_fidelity = np.asarray(fidelities)[years == 2024]
        summaries[category] = {"shap_max_additivity_error": residual, "lime_test_fidelity_min": float(test_fidelity.min()), "lime_test_fidelity_median": float(np.median(test_fidelity)), "lime_test_fidelity_max": float(test_fidelity.max())}
    data.update({
        "is_demo": False, "model_version": bundle["model_version"],
        "model_name": report["selected"]["model"], "model_feature_columns": FEATURES,
        "model_feature_assumption": report["feature_assumption"],
        "model_training_years": report["train_years"], "model_test_year": report["test_year"],
        "risk_thresholds": report["risk_thresholds"], "risk_threshold_method": report["risk_threshold_method"],
        "test_metrics": report["test_metrics"], "xai_available": True,
        "explanation_methods": {"shap": "Exact SHAP with 64 training background rows; raw rate prediction output", "lime": f"Local linear surrogate on original features, 6000 perturbations, sample_around_instance={lime_config['sample_around_instance']}, kernel_width={lime_config['kernel_width']}, continuous features standardized inside LIME, seed 42"},
        "xai_diagnostics": summaries,
        "methodology": "Model dilatih pada empat kolom yang sementara dianggap fitur asli: PDRB_per_kapita_HK, PDRB_per_kapita, PPKMLA, dan IPG. Fitur FE, ID provinsi, tahun, prediksi lama, dan kelas lama tidak digunakan sebagai input. Target memakai rate kasus asli. Pemilihan model menggunakan validasi maju 2022 dan 2023; pengujian akhir memakai 2024. Model final dilatih pada 2021–2023. Kategori risiko memakai tertil rate observasi data latih. SHAP dan LIME dihitung langsung pada empat input yang sama. Prediksi tahun pelatihan adalah hasil in-sample. Belum ada masukan fitur 2025/2026. Data Papua historis belum diselaraskan dengan batas modern.",
    })
    report["xai_diagnostics"] = summaries
    from refresh_dashboard_explanations import refresh
    data, report = refresh(data, report, bundle)
    save_json(ARTIFACTS / "benchmark.json", report)
    save_json(ROOT / "dist/data/predictions.json", data)
    save_json(ROOT / "dist/data/model-report.json", report)
    write_summary(report)
    print("Saved real predictions and original-feature SHAP/LIME for all", len(rows), "province/year records", flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--stage", choices=["benchmark", "explain", "all"], default="all")
    stage = parser.parse_args().stage
    if stage in {"benchmark", "all"}:
        benchmark()
    if stage in {"explain", "all"}:
        explain()
