"""Import province/year model outputs and measurements without manufacturing XAI."""
import argparse
import csv
import hashlib
import json
import math
import os
from pathlib import Path
from feature_metadata import apply_labels, definitions

ROOT = Path(__file__).resolve().parents[1]
LEVELS = {"low", "moderate", "high", "unavailable"}
FEATURES = {
    # Display order is a reading order, never a feature-importance ranking.
    "miskin_rate": ("Persentase penduduk miskin", "%", 100, 2),
    "IPG": ("Indeks pembangunan gender", "poin", 1, 2),
    "edu_index": ("Indeks pendidikan", "poin", 1, 2),
    "PDRB_per_kapita_HK": ("PDRB per kapita (HK)", None, 1, 2),
    "PDRB_per_kapita": ("PDRB per kapita", None, 1, 2),
    "PPKMLA": ("PPKMLA", None, 1, 2),
    "ppm_rate": ("ppm_rate", None, 1, 6),
    "tk_sekolah_per_1000": ("Sekolah TK per 1.000 penduduk", "sekolah", 1, 4),
    "tk_murid_per_1000": ("Murid TK per 1.000 penduduk", "murid", 1, 4),
    "pt_per_1000": ("Perguruan tinggi per 1.000 penduduk", "perguruan tinggi", 1, 4),
    "dosen_per_1000": ("Dosen per 1.000 penduduk", "dosen", 1, 4),
    "mahasiswa_per_1000": ("Mahasiswa per 1.000 penduduk", "mahasiswa", 1, 4),
    "mahasiswa_per_PT": ("Mahasiswa per perguruan tinggi", "mahasiswa", 1, 2),
    "dosen_per_PT": ("Dosen per perguruan tinggi", "dosen", 1, 2),
    "murid_per_sekolah": ("Murid per sekolah", "murid", 1, 2),
    "guru_per_sekolah": ("Guru per sekolah", "guru", 1, 2),
    "murid_per_guru": ("Murid per guru", "murid", 1, 2),
    "smk_density": ("Densitas SMK", None, 1, 8),
    "pt_density": ("Densitas perguruan tinggi", None, 1, 8),
    "RLS_gap": ("Selisih rata-rata lama sekolah", "tahun", 1, 2),
    "PPDPSK_avg": ("PPDPSK (rata-rata)", None, 1, 2),
    "school_density": ("Densitas sekolah", None, 1, 8),
    "log_populasi": ("Log populasi", None, 1, 4),
}
KEY_COLUMNS = {"province_code", "provinsi", "year", "pred_seksual", "pred_non_seksual", "rate_seksual", "rate_non_seksual", "kelas_seksual", "kelas_non_seksual", "data_latih"}


def number(text, column):
    if text is None or str(text).strip().lower() in {"", "nan", "null", "none", "na"}:
        return None
    try:
        value = float(text)
    except (ValueError, TypeError) as error:
        raise ValueError(f"Angka tidak valid pada {column}: {text!r}") from error
    if not math.isfinite(value):
        raise ValueError(f"Angka tidak terhingga pada {column}")
    return value


def convert_records(rows, allowed_codes=None, source_name="data_bersih_dasbor.csv"):
    predictions, seen = [], set()
    labels = definitions()
    for row in rows:
        code = str(row["province_code"]).strip().zfill(2)
        year_value = number(row["year"], "year")
        if year_value is None or not year_value.is_integer():
            raise ValueError("Tahun harus bilangan bulat")
        year = int(year_value)
        key = (code, year)
        if key in seen:
            raise ValueError(f"Duplikasi provinsi/tahun: {code}/{year}")
        seen.add(key)
        if allowed_codes is not None and code not in allowed_codes:
            raise ValueError(f"Kode provinsi tidak ada pada peta: {code}")
        flag = str(row["data_latih"]).strip().lower()
        if flag not in {"true", "false"}:
            raise ValueError(f"Penanda data_latih tidak valid: {flag}")
        indicators = []
        for column, (label, unit, scale, precision) in FEATURES.items():
            raw = number(row.get(column), column)
            if column == "miskin_rate" and raw is not None and not 0 <= raw <= 1:
                raise ValueError("miskin_rate diasumsikan proporsi 0–1; periksa satuan CSV")
            indicators.append(apply_labels({
                "column": column, "feature": label,
                "value": raw * scale if raw is not None else None,
                "unit": unit, "precision": precision, "raw_value": raw,
                "data_year": year, "source": source_name,
            }, labels))
        prediction = {
            "province_code": code, "province_name": row["provinsi"].strip(),
            "year": year, "is_training": flag == "true", "indicators": indicators,
        }
        # The CSV uses 34 region names in historical years, while the map has 38.
        # Do not project historical Papua outputs onto unverified modern extents.
        if code in {"91", "92"}:
            prediction["boundary_status"] = "unverified"
        for target, suffix in (("sexual", "seksual"), ("nonsexual", "non_seksual")):
            level = str(row[f"kelas_{suffix}"]).strip().lower() or "unavailable"
            if level not in LEVELS:
                raise ValueError(f"Kelas risiko tidak valid: {level}")
            prediction[target] = {
                "level": level,
                "predicted_value": number(row[f"pred_{suffix}"], f"pred_{suffix}"),
                "observed_value": number(row[f"rate_{suffix}"], f"rate_{suffix}"),
                "explanations": [],
            }
        predictions.append(prediction)
    return sorted(predictions, key=lambda row: (row["year"], row["province_code"]))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("csv", type=Path)
    parser.add_argument("--output", type=Path, default=ROOT / "dist/data/predictions.json")
    args = parser.parse_args()
    with args.csv.open(encoding="utf-8-sig", newline="") as stream:
        reader = csv.DictReader(stream)
        missing = (KEY_COLUMNS | set(FEATURES)) - set(reader.fieldnames or [])
        if missing:
            raise ValueError(f"Kolom wajib tidak ditemukan: {', '.join(sorted(missing))}")
        rows = list(reader)
    geometry = json.loads((ROOT / "dist/data/provinces.geojson").read_text(encoding="utf-8-sig"))
    allowed_codes = {feature["properties"]["KODE_PROV"] for feature in geometry["features"]}
    predictions = convert_records(rows, allowed_codes, args.csv.name)
    if not predictions:
        raise ValueError("CSV tidak berisi baris data")
    years = sorted({row["year"] for row in predictions})
    data = {
        "is_demo": False, "model_version": None,
        "input_period": f"{min(years)}–{max(years)} (tahun pada CSV)",
        "source_file": args.csv.name,
        "source_sha256": hashlib.sha256(args.csv.read_bytes()).hexdigest(),
        "available_years": years,
        "coverage_by_year": {str(year): sum(row["year"] == year for row in predictions) for year in years},
        "training_years": sorted({row["year"] for row in predictions if row["is_training"]}),
        "xai_available": False,
        "methodology": "Kelas risiko dan nilai prediksi diambil langsung dari kolom kelas_* dan pred_* CSV. Kontribusi SHAP/LIME tidak disertakan. Indikator yang tampil tanpa XAI tidak diurutkan berdasarkan pengaruh. miskin_rate diperlakukan sebagai proporsi 0–1 dan ditampilkan sebagai persen. Satuan variabel yang tidak dinyatakan dalam nama kolom tidak ditebak. Data Papua historis tetap tersedia di tabel/detail, tetapi tidak diwarnai pada batas modern sebelum cakupan wilayah dikonfirmasi.",
        "predictions": predictions,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    temporary = args.output.with_suffix(".tmp.json")
    temporary.write_text(json.dumps(data, ensure_ascii=False, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    os.replace(temporary, args.output)
    print(f"Imported {len(predictions)} province/year records, years {years}; no XAI values generated.")


if __name__ == "__main__":
    main()
