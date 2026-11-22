import csv
import hashlib
import json
import sys
import unittest
from pathlib import Path

import joblib
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "ml"))
from train_pipeline import FEATURES, RF_PARAMS, SOURCE, TARGETS, YEARS_TRAIN, read_inputs, risk_level


class ModelPipelineIntegrity(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.rows, cls.X, cls.y, cls.source_predictions, cls.metadata = read_inputs()
        cls.data = json.loads((ROOT / "data/published/predictions.json").read_text(encoding="utf-8"))
        cls.report = json.loads((ROOT / "data/published/model-report.json").read_text(encoding="utf-8"))
        cls.dist = json.loads((ROOT / "dist/data/predictions.json").read_text(encoding="utf-8"))
        cls.bundle = joblib.load(ROOT / "data/published/model.joblib")

    def test_source_is_unchanged_and_mirrored_exactly(self):
        canonical = ROOT / "data/source/data_bersih_dasbor.csv"
        legacy = ROOT / "data-source/data_bersih_dasbor.csv"
        self.assertEqual(canonical.read_bytes(), legacy.read_bytes())
        digest = hashlib.sha256(canonical.read_bytes()).hexdigest()
        self.assertEqual(digest, self.report["source_sha256"])
        self.assertEqual(self.data, self.dist)

    def test_backend_manifest_resolves_versioned_files_and_mapping_contract(self):
        published = ROOT / "data/published"
        manifest = json.loads((published / "manifest.json").read_text(encoding="utf-8"))
        self.assertEqual(manifest["schema_version"], 1)
        self.assertEqual(manifest["data_version"], self.data["model_version"])
        self.assertEqual(self.data["data_version"], manifest["data_version"])
        self.assertEqual(self.data["schema_version"], "1.0.0")
        predictions = json.loads((published / manifest["predictions_file"]).read_text(encoding="utf-8"))
        mapping = json.loads((published / manifest["province_mapping_file"]).read_text(encoding="utf-8"))
        self.assertEqual(predictions["model_version"], manifest["data_version"])
        self.assertEqual(mapping["data_version"], manifest["data_version"])
        self.assertEqual(mapping["schema_version"], "1.0.0")
        self.assertEqual(predictions, self.data)
        self.assertEqual(len(mapping["provinces"]), 38)
        self.assertEqual(mapping["source_by_display_code"]["93"], "91")
        self.assertEqual(mapping["source_by_display_code"]["94"], "91")
        self.assertEqual(mapping["source_by_display_code"]["95"], "91")
        self.assertEqual(mapping["source_by_display_code"]["96"], "92")

    def test_complete_source_coverage_and_unique_rows(self):
        self.assertEqual(len(self.data["predictions"]), 134)
        self.assertEqual(self.data["coverage_by_year"], {"2021": 34, "2022": 34, "2023": 34, "2024": 32})
        keys = [(r["province_code"], r["year"]) for r in self.data["predictions"]]
        self.assertEqual(len(keys), len(set(keys)))
        source_keys = [(str(r["province_code"]).zfill(2), int(r["year"])) for r in self.rows]
        self.assertEqual(set(keys), set(source_keys))

    def test_model_parameters_and_exact_23_feature_order(self):
        self.assertEqual(len(FEATURES), 23)
        self.assertEqual(self.report["model_feature_columns"], FEATURES)
        self.assertEqual(self.data["model_feature_columns"], FEATURES)
        self.assertEqual(self.report["model_parameters"], {**RF_PARAMS, "multi_target": True})
        self.assertEqual(self.report["model_training_years"], YEARS_TRAIN)
        self.assertEqual(self.report["model_test_year"], 2024)
        self.assertEqual(self.bundle["features"], FEATURES)

    def test_model_reproduces_source_prediction_columns_with_documented_tolerance(self):
        predictions = self.bundle["model"].predict(self.X)
        errors = np.abs(predictions - self.source_predictions)
        self.assertLessEqual(float(errors.max()), self.report["prediction_agreement"][TARGETS[0]]["atol"])
        self.assertAlmostEqual(float(errors[:, 0].max()), self.report["prediction_agreement"][TARGETS[0]]["max_absolute_error"])
        self.assertAlmostEqual(float(errors[:, 1].max()), self.report["prediction_agreement"][TARGETS[1]]["max_absolute_error"])

    def test_holdout_metrics_and_thresholds_are_recomputed_from_training_split(self):
        years = np.asarray([int(row["year"]) for row in self.rows])
        train, test = np.isin(years, YEARS_TRAIN), years == 2024
        thresholds = np.quantile(self.y[train], [1 / 3, 2 / 3], axis=0).T
        np.testing.assert_allclose(self.bundle["thresholds"], thresholds, rtol=0, atol=1e-14)
        self.assertEqual(int(test.sum()), 32)
        self.assertEqual(self.report["test_metrics"]["rate_seksual"]["n"], 32)
        self.assertEqual(self.report["test_metrics"]["rate_non_seksual"]["n"], 32)
        for row in self.data["predictions"]:
            for index, category in enumerate(("sexual", "nonsexual")):
                cutoff = self.data["risk_thresholds"][category]
                expected = risk_level(row[category]["predicted_value"], (cutoff["low_to_moderate"], cutoff["moderate_to_high"]))
                self.assertEqual(row[category]["level"], expected)

    def test_every_prediction_matches_saved_model_and_every_feature_is_raw_model_input(self):
        by_key = {(str(row["province_code"]).zfill(2), int(row["year"])): row for row in self.rows}
        for record in self.data["predictions"]:
            source = by_key[(record["province_code"], record["year"])]
            self.assertEqual([item["column"] for item in record["indicators"]], FEATURES)
            raw = np.asarray([[float(source[name]) for name in FEATURES]])
            self.assertEqual(len(record["sexual"]["explanations"]), 23)
            self.assertEqual(len(record["nonsexual"]["explanations"]), 23)
            for i, category in enumerate(("sexual", "nonsexual")):
                self.assertAlmostEqual(record[category]["predicted_value"], self.bundle["model"].predict(raw)[0, i], places=12)
                for method in ("explanations", "lime_explanations"):
                    self.assertEqual({item["column"] for item in record[category][method]}, set(FEATURES))
            indicators = {item["column"]: item for item in record["indicators"]}
            for code in FEATURES:
                self.assertEqual(indicators[code]["raw_value"], float(source[code]))
                multiplier = self.metadata["features"][code].get("display_multiplier", 1)
                self.assertAlmostEqual(indicators[code]["value"], float(source[code]) * multiplier)
        self.assertEqual(next(item for item in self.data["predictions"][0]["indicators"] if item["column"] == "miskin_rate")["unit"], "%")

    def test_shap_reconstruction_and_same_year_unique_source_means(self):
        for year in self.data["available_years"]:
            cohort = [row for row in self.data["predictions"] if row["year"] == year]
            for category in ("sexual", "nonsexual"):
                mean = sum(row[category]["predicted_value"] for row in cohort) / len(cohort)
                self.assertAlmostEqual(self.data["comparison_reference"][str(year)]["predictions"][category], mean, places=12)
                self.assertEqual(self.data["comparison_reference"][str(year)]["province_count"], len(cohort))
                for row in cohort:
                    output = row[category]
                    self.assertAlmostEqual(output["shap_base_value"], mean, delta=1e-7)
                    reconstructed = output["shap_base_value"] + sum(x["contribution"] for x in output["explanations"])
                    self.assertAlmostEqual(reconstructed, output["predicted_value"], delta=1e-7)
                    self.assertLessEqual(output["shap_additivity_error"], 1e-7)

    def test_lime_configuration_and_fidelity_are_explicit_and_finite(self):
        self.assertIn("3,000", self.data["explanation_methods"]["lime"])
        self.assertIn("not additive", self.data["explanation_methods"]["lime"])
        for category in ("sexual", "nonsexual"):
            diagnostic = self.data["xai_diagnostics"][category]
            self.assertEqual(diagnostic["lime_test_fidelity_n"], 32)
            for field in ("lime_test_fidelity_min", "lime_test_fidelity_median", "lime_test_fidelity_max"):
                self.assertTrue(np.isfinite(diagnostic[field]))
        for row in self.data["predictions"]:
            for category in ("sexual", "nonsexual"):
                self.assertTrue(np.isfinite(row[category]["lime_fidelity"]))
                self.assertTrue(any(item["contribution"] != 0 for item in row[category]["lime_explanations"]))

    def test_papua_aliases_are_metadata_not_duplicated_observations(self):
        mapping = self.data["papua_display_mapping"]
        self.assertEqual(mapping["display_to_source_code"], {"93": "91", "94": "91", "95": "91", "96": "92"})
        self.assertEqual(mapping["unavailable_2024_display_codes"], ["91", "92", "93", "94", "95", "96"])
        self.assertTrue(mapping["not_prediction_rows"])
        for year in (2021, 2022, 2023, 2024):
            codes = [row["province_code"] for row in self.data["predictions"] if row["year"] == year]
            self.assertNotIn("93", codes)
            self.assertNotIn("94", codes)
            self.assertNotIn("95", codes)
            self.assertNotIn("96", codes)

    def test_feature_definitions_do_not_invent_missing_units(self):
        self.assertEqual(self.metadata["features"]["PPKMLA"]["unit"], "%")
        self.assertEqual(self.metadata["features"]["IPG"]["unit"], "poin")
        self.assertIsNone(self.metadata["features"]["PDRB_per_kapita_HK"]["unit"])
        self.assertEqual(self.metadata["features"]["murid_per_sekolah"]["label"], "Murid TK per sekolah TK")
        self.assertIsNone(self.metadata["features"]["PPDPSK_avg"]["unit"])


if __name__ == "__main__":
    unittest.main()
