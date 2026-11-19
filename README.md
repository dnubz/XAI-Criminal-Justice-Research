# Peta Risiko Kekerasan

A local static dashboard for Indonesian province risk estimates. The site contains only the map, filters, province detail, SHAP/LIME selector, and CSV download. Navigation for province tables, methodology and project information has been removed.

## Current data and model

Source: `data-source/data_bersih_dasbor.csv`, copied unchanged from the supplied file. It contains 134 province/year rows for 2021–2024. The latest year has data for 32 provinces. The map contains 38 modern province boundaries; missing regions remain gray. Historical Papua outputs remain in the details but are not colored on unverified modern boundaries.

The source CSV's old classes are outputs of another model. They are preserved as `previous_model_output` and are not used to train the new model. New target columns are `rate_seksual` and `rate_non_seksual`.

Four columns are provisionally treated as original inputs: `PDRB_per_kapita_HK`, `PDRB_per_kapita`, `PPKMLA`, and `IPG`. The complete dataset before feature engineering was not supplied. All density, per-1000, gap, index-derived, log-population, province ID, year, prior prediction, and prior class columns are excluded from model inputs. No missing original features are reconstructed from FE columns. A definitive original-feature dictionary can change this provisional feature selection.

Thirty configurations from linear models, tree ensembles, boosting, SVR, nearest neighbors and a mean baseline were compared. Selection uses forward validation in 2022 and 2023. Final fitting uses 2021–2023; 2024 is a separate 32-row test set. The selected configuration is the best among those tested on the declared validation metric, not a universal best model or a claim that it beats the earlier model.

Risk classes are regenerated using tertiles of observed training rates. They are relative model categories, not calibrated individual probabilities. Predictions for 2021–2023 are in-sample and labeled as training data. No 2025/2026 forecasts are generated without original input values for those years.

Published predictions, test metrics and XAI diagnostics are included in `dist/data/predictions.json`. Dependencies are frozen in `requirements-ml.txt`. Running the model commands below generates `model-artifacts/RESULTS.md`, `model-artifacts/benchmark.json`, `model-artifacts/model.joblib`, and `dist/data/model-report.json` locally. These generated artifacts are excluded from Git and the source ZIP; they are not required to run or deploy the website.

## Local preview

Run `node serve.mjs` and open `http://127.0.0.1:4173`. No front-end install or build is required. Mouse-wheel, plus/minus buttons, touch drag and pinch zoom are enabled. The zoom-out floor adapts to the viewport to show the whole country. Resizing and resetting restore the full-country view. The server is bound to localhost.

The deployable site is `dist`. The GitHub Pages workflow uploads `./dist` when changes are pushed to `main`. The source package contains website assets and data, model scripts, the original CSV, dependency requirements, tests, and the deployment workflow. Git history, OpenAI/Sites hosting metadata, virtual environments, generated model artifacts, previews, and old archives are excluded.

## Reproduce the model

Use Python 3.12 in an isolated environment:

```text
python -m venv .venv-ml
.venv-ml\Scripts\python.exe -m pip install -r requirements-ml.txt
.venv-ml\Scripts\python.exe scripts\import_dashboard_csv.py data-source\data_bersih_dasbor.csv
.venv-ml\Scripts\python.exe scripts\train_original_model.py --stage benchmark
.venv-ml\Scripts\python.exe scripts\train_original_model.py --stage explain
```

The import step resets dashboard outputs to the CSV values and clears explanations. Run the model/explanation steps afterward to publish the new local model outputs. Import validates column names, finite numeric values, duplicate province/year keys and supported classes. The source CSV stays unchanged.

## Raw measurements and explanations

`dist/data/predictions.json` holds records by `province_code` and `year`. `indicators` stores the original column name, measured value, display unit, observation year and source. Raw values are independent from `contribution`. Missing values stay missing; zero stays zero. The interface displays original model inputs and ranks the top three by absolute contribution of the selected explanation method.

The province detail compares the selected prediction with the unweighted mean of all available province predictions in that year (32 in 2024). Missing provinces are excluded, not assigned zero. Map filters do not change the reference. Raw feature comparisons also use other available provinces in the same year, excluding the selected province and missing values; equal values are not counted as strictly above or below.

Exact SHAP uses all original-feature province rows in the selected year as the explanation background. Its baseline equals the displayed mean prediction, and all four contributions reconstruct the selected prediction. `scripts/refresh_dashboard_explanations.py` refreshes labels and this reference without refitting the saved model or changing predictions, classes, evaluation metrics or LIME. Held-out outcomes are never used for the explanation reference. The ordinary explanation pipeline also applies this refresh before saving.

LIME is a local linear approximation of that same predictor. Its signed coefficients use the feature standardization internal to LIME and are not SHAP baseline contributions. Local fidelity R² is shown when LIME is selected. Neither explanation is a causal effect or a guarantee of a global monotonic relationship. The default explanation is SHAP. The three largest effects are shown, with the fourth expandable. Bar lengths compare absolute contributions, not probabilities.

Feature names and definitions are stored in `dist/data/feature-labels.json`, transcribed from the user's feature dictionary screenshots. PDRB labels distinguish constant and current prices; currency units remain unspecified. PPKMLA is displayed as the supplied percentage of ever-married women who had their first child before age 20, without multiplying by 100. `IPG` is shown in index points. The target-rate unit (victims per 100,000 residents) follows the user's supplied dashboard reference image, rather than inferred CSV metadata. `miskin_rate` is interpreted as a 0–1 proportion and retained as both the source value and percent display value. `RLS_gap` remains a difference. The original-input dashboard does not display FE columns or invent missing raw counts.

CSV download includes measured original inputs, observation years, source, predicted and observed values, both explanation methods, training status, boundary status and model version.

## Verify

JavaScript checks can run directly. Python model-integrity checks also need the local model artifacts: run the model commands above first when starting from a fresh clone or source ZIP.

```text
node --test tests/indicators.test.mjs
.venv-ml\Scripts\python.exe -m unittest discover -s tests -p test_model_integrity.py -v
```

Checks cover original-feature identity, temporal split, absence of fabricated years/regions, source values, SHAP additivity, regenerated class thresholds, missing/zero values, locale formatting and local explanation wording. Browser checks cover real wheel zoom, zoom-out limits, responsive layout, province search, year/category/method switching, gray missing regions and CSV export. Pinch support is enabled through Leaflet; testing in a narrow desktop browser is not a physical-phone test.

## Sources and licenses

- Province GeoJSON: https://github.com/mashadinoor/Indonesia-Geojson-2026 (MIT; `dist/assets/GEOJSON-LICENSE.txt`).
- Leaflet 1.9.4: https://leafletjs.com/reference-1.9.4.html (`dist/assets/LEAFLET-LICENSE.txt`).
- scikit-learn leakage guidance: https://scikit-learn.org/stable/common_pitfalls.html
- SHAP documentation: https://shap.readthedocs.io/en/stable/
- LIME documentation: https://lime-ml.readthedocs.io/en/latest/lime.html

No individual incident or personal records are included. Geographic boundary compatibility and upstream CSV cleaning provenance still require research review.
