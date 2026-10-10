# Ruang Aman

An Indonesian province dashboard for sexual and nonsexual violence risk predictions. This is a working design prototype. All included prediction classes and XAI values are synthetic illustrations, clearly labeled in the interface and exports.

## Preview

Run `node serve.mjs` in this directory and open `http://127.0.0.1:4173`. No installation or build is needed. Deploy the contents of `dist` to a static host such as Vercel, Cloudflare Pages, or GitHub Pages. For Vercel, select Other, leave the build command empty, and set the output directory to `dist`.

## Connect your Python model

Replace `dist/data/predictions.json`. Keep province codes as two-character strings matching `KODE_PROV` in `dist/data/provinces.geojson`. Region codes use the scheme in the included boundary source; remap your model codes explicitly if it uses a different scheme. Missing predictions are gray, never treated as low risk. One record per province and year; additional years appear automatically in the selector. No API is required for precomputed annual outputs.

```json
{
  "is_demo": false,
  "model_version": "your-model-version",
  "input_period": "actual input period",
  "methodology": "Define target categories, class cutoffs, forecast cutoff, validation results, and explanation method here.",
  "predictions": [
    {
      "province_code": "32",
      "year": 2026,
      "sexual": {"level": "high", "explanations": []},
      "nonsexual": {"level": "moderate", "explanations": []}
    }
  ]
}
```

Allowed levels: `low`, `moderate`, `high`, `unavailable`. A target may also be `null` if unavailable. Explanations are optional arrays of `{ "feature": "Indicator name", "contribution": 0.12 }`, sorted by absolute contribution. Supply local contributions for the displayed target class, using one consistent explanation method/output scale. The bars display magnitude; the signed number shows direction. The UI displays up to three features. Add model validation, class definitions, and feature methodology before publishing research results. Do not assume unsupervised cluster IDs represent ascending risk.

Do not map physical/nonphysical targets to sexual/nonsexual without an explicit target definition. Replace category labels in `dist/index.html` and `dist/app.js` if the model predicts physical/nonphysical instead.

## Included behavior

- Pan and zoom a local GeoJSON map with all 38 provinces.
- Hover tooltips show both targets; click selects a province.
- Search and keyboard navigation, island and risk filters.
- Province details, optional XAI contributions, accessible table alternative.
- Year selector from available prediction years.
- CSV export of filtered data with demo flag and model version.
- Responsive layout and methodology/source dialogs.

## Sources

Boundary GeoJSON: https://github.com/mashadinoor/Indonesia-Geojson-2026 (MIT, see `dist/assets/GEOJSON-LICENSE.txt`). This community dataset identifies BIG as its geometry source. Validate boundary vintage, region codes, and authoritative geometry for research publication. Leaflet 1.9.4 is vendored locally and retains its license notice. The map does not request external basemap tiles. Google Fonts is optional; local fallback fonts work without it.

No personal or incident-level data is included. Sites publication uses a private audience by default; the source is also ready for separate static deployment.
