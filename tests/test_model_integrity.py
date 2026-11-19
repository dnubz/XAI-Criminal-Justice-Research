"""Validate the imported data, temporal split and exported original-feature explanations."""
import csv
import hashlib
import json
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
from import_dashboard_csv import convert_records


class ModelIntegrity(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.source = ROOT / "data-source/data_bersih_dasbor.csv"
        with cls.source.open(encoding="utf-8-sig", newline="") as stream:
            cls.rows = list(csv.DictReader(stream))
        cls.data = json.loads((ROOT / "dist/data/predictions.json").read_text(encoding="utf-8"))
        cls.report = json.loads((ROOT / "model-artifacts/benchmark.json").read_text(encoding="utf-8"))

    def test_all_source_keys_preserved_and_no_future_rows_fabricated(self):
        source_keys = {(r["province_code"], int(r["year"])) for r in self.rows}
        result_keys = {(r["province_code"], r["year"]) for r in self.data["predictions"]}
        self.assertEqual(source_keys, result_keys)
        self.assertEqual(len(source_keys), 134)
        self.assertEqual(self.data["coverage_by_year"]["2024"], 32)
        self.assertEqual(self.data["available_years"], [2021, 2022, 2023, 2024])

    def test_csv_is_unchanged_and_hash_matches_training(self):
        self.assertEqual(hashlib.sha256(self.source.read_bytes()).hexdigest(), self.report["source_sha256"])

    def test_previous_classes_not_used_as_targets_or_features(self):
        self.assertEqual(self.report["target_columns"], ["rate_seksual", "rate_non_seksual"])
        self.assertEqual(self.report["feature_columns"], ["PDRB_per_kapita_HK", "PDRB_per_kapita", "PPKMLA", "IPG"])

    def test_selection_folds_and_training_exclude_test_year(self):
        self.assertEqual(self.report["test_year"], 2024)
        self.assertEqual(self.report["test_n"], 32)
        self.assertEqual(self.report["train_years"], [2021, 2022, 2023])
        for candidate in self.report["ranking"]:
            for fold in candidate["folds"]:
                self.assertLess(max(fold["train_years"]), fold["validation_year"])
                self.assertLess(fold["validation_year"], 2024)
        self.assertEqual(len(self.report["ranking"]), 30)
        self.assertEqual(self.report["selected"]["validation_normalized_mae"], min(c["validation_normalized_mae"] for c in self.report["ranking"]))

    def test_shap_and_lime_use_only_the_four_original_inputs(self):
        expected = set(self.report["feature_columns"])
        for row in self.data["predictions"]:
            for target in ("sexual", "nonsexual"):
                for method in ("explanations", "lime_explanations"):
                    self.assertEqual({item["column"] for item in row[target][method]}, expected)
                    for item in row[target][method]:
                        self.assertEqual(item["data_year"], row["year"])
                        self.assertIsInstance(item["contribution"], float)

    def test_shap_reconstructs_each_prediction(self):
        for row in self.data["predictions"]:
            for target in ("sexual", "nonsexual"):
                output = row[target]
                reconstructed = output["shap_base_value"] + sum(item["contribution"] for item in output["explanations"])
                self.assertAlmostEqual(reconstructed, output["predicted_value"], places=7)

    def test_shap_reference_is_the_actual_same_year_province_prediction_mean(self):
        for year in self.data["available_years"]:
            rows = [row for row in self.data["predictions"] if row["year"] == year]
            for category in ("sexual", "nonsexual"):
                mean = sum(row[category]["predicted_value"] for row in rows) / len(rows)
                for row in rows:
                    self.assertAlmostEqual(row[category]["shap_base_value"], mean, places=9)
                    self.assertEqual(row[category]["shap_reference_count"], len(rows))
                    self.assertEqual(row[category]["shap_reference_year"], year)
                self.assertAlmostEqual(self.data["comparison_reference"][str(year)]["predictions"][category], mean, places=9)

    def test_readable_feature_names_and_percentage_units_match_user_dictionary(self):
        for row in self.data["predictions"]:
            for values in (row["indicators"], row["sexual"]["explanations"], row["nonsexual"]["lime_explanations"]):
                features = {item["column"]: item for item in values}
                self.assertEqual(features["PPKMLA"]["unit"], "%")
                self.assertIn("sebelum usia 20 tahun", features["PPKMLA"]["feature"])
                self.assertIn("pernah kawin", features["PPKMLA"]["description"])
                self.assertIn("harga konstan", features["PDRB_per_kapita_HK"]["feature"])
                self.assertIn("harga berlaku", features["PDRB_per_kapita"]["feature"])

    def test_measurements_match_source_and_engineered_ratio_is_not_mislabelled_as_raw_schooling(self):
        lookup = {(r["province_code"], int(r["year"])): r for r in self.rows}
        for row in self.data["predictions"]:
            source = lookup[(row["province_code"], row["year"])]
            indicators = {i["column"]: i for i in row["indicators"]}
            self.assertAlmostEqual(indicators["miskin_rate"]["value"], float(source["miskin_rate"]) * 100)
            self.assertIn("Selisih", indicators["RLS_gap"]["feature"])
            for column in self.report["feature_columns"]:
                self.assertEqual(indicators[column]["value"], float(source[column]))

    def test_risk_bins_come_from_training_rates(self):
        for row in self.data["predictions"]:
            for target in ("sexual", "nonsexual"):
                cutoffs = self.data["risk_thresholds"][target]
                score = row[target]["predicted_value"]
                expected = "low" if score < cutoffs["low_to_moderate"] else "moderate" if score < cutoffs["moderate_to_high"] else "high"
                self.assertEqual(row[target]["level"], expected)

    def test_saved_model_regenerates_the_published_predictions(self):
        import joblib
        import numpy as np
        model = joblib.load(ROOT / "model-artifacts/model.joblib")
        source = {(row["province_code"], int(row["year"])): row for row in self.rows}
        for row in self.data["predictions"][::17]:
            raw = source[(row["province_code"], row["year"])]
            X = np.asarray([[float(raw[column]) for column in model["features"]]])
            for index, category in enumerate(("sexual", "nonsexual")):
                prediction = max(0, float(model["models"][index].predict(X)[0]))
                self.assertAlmostEqual(prediction, row[category]["predicted_value"], places=9)
        self.assertLess(self.report["lime_configuration_selection"]["sample_year"], self.report["test_year"])

    def test_import_rejects_duplicate_keys_and_preserves_missing_values(self):
        with self.assertRaisesRegex(ValueError, "Duplikasi"):
            convert_records([self.rows[0], self.rows[0]])
        copy = dict(self.rows[0], miskin_rate="", IPG="0")
        record = convert_records([copy])[0]
        indicators = {i["column"]: i for i in record["indicators"]}
        self.assertIsNone(indicators["miskin_rate"]["value"])
        self.assertEqual(indicators["IPG"]["value"], 0)


if __name__ == "__main__":
    unittest.main()
