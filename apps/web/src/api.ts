import type { Category, MapProvince, MapResponse, Metadata, ProvinceDetail, ProvinceGeometry, Risk } from './types';
const API_BASE = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/+$/, '');
const USE_FIXTURES = import.meta.env.MODE !== 'production' && import.meta.env.VITE_USE_FIXTURES === 'true';
const categories: Category[] = ['sexual', 'nonsexual'];
const labels = { sexual: 'Kekerasan seksual', nonsexual: 'Kekerasan nonseksual' };
const islandLabels: Record<string, string> = { sumatera: 'Sumatera', java: 'Jawa', 'bali-nusa-tenggara': 'Bali & Nusa Tenggara', kalimantan: 'Kalimantan', sulawesi: 'Sulawesi', maluku: 'Maluku', papua: 'Papua' };
type RawPrediction = {
    province_code: string;
    province_name: string;
    year: number;
    is_training: boolean;
    indicators: {
        column: string;
        feature: string;
        value: number | null;
        unit: string | null;
        data_year: number | null;
        source: string | null;
        description?: string;
        qualifier?: string;
        contribution?: number | null;
    }[];
    sexual?: RawOutput | null;
    nonsexual?: RawOutput | null;
};
type RawOutput = {
    level: Risk | null;
    predicted_value: number | null;
    observed_value: number | null;
    explanations: RawPrediction['indicators'];
    lime_explanations: RawPrediction['indicators'];
    lime_fidelity: number | null;
    shap_base_value: number | null;
};
type FixtureData = {
    data_version: string;
    model_version: string;
    target_unit: string;
    available_years: number[];
    predictions: RawPrediction[];
    papua_display_mapping?: {
        historical_years: number[];
        display_to_source_code: Record<string, string>;
        display_note: string;
        unavailable_2024_display_codes: string[];
        unavailable_2024_note: string;
    };
};
type FixtureMapping = {
    data_version: string;
    provinces: {
        province_code: string;
        province_name: string;
        island: string;
    }[];
    source_by_display_code: Record<string, string>;
};
let fixtureCache: Promise<{
    data: FixtureData;
    mapping: FixtureMapping;
}> | undefined;
const loadFixture = () => fixtureCache ??= (async () => {
    const [dataResponse, mappingResponse] = await Promise.all([fetch('/__fixture/paper-predictions.json'), fetch('/__fixture/province-mapping.json')]);
    if (!dataResponse.ok || !mappingResponse.ok)
        throw new Error('Data fixture tidak tersedia pada server pengembangan.');
    const [data, mapping] = await Promise.all([dataResponse.json(), mappingResponse.json()]);
    return { data: data as FixtureData, mapping: mapping as FixtureMapping };
})();
export async function fixtureMetadata(): Promise<Metadata> {
    const { data: raw } = await loadFixture();
    return { data_version: raw.data_version, years: raw.available_years,
        categories: categories.map(id => ({ id, label: labels[id] })),
        islands: Object.values(islandLabels),
        risk_labels: { low: 'Rendah', moderate: 'Sedang', high: 'Tinggi', unavailable: 'Belum tersedia' },
        target_unit: raw.target_unit, map_asset: '/data/provinces.geojson', model_version: raw.model_version };
}
function getSourceCode(code: string, raw: FixtureData, mapping: FixtureMapping) {
    return raw.papua_display_mapping?.display_to_source_code[code] ?? mapping.source_by_display_code[code] ?? code;
}
function getRaw(raw: FixtureData, mapping: FixtureMapping, code: string, year: number) {
    const sourceCode = getSourceCode(code, raw, mapping);
    const sourceYear = year === 2024 && raw.papua_display_mapping?.unavailable_2024_display_codes.includes(code) ? 2023 : year;
    return raw.predictions.find(row => row.province_code === sourceCode && row.year === sourceYear);
}
function sourceNoteFor(raw: FixtureData, source: RawPrediction | undefined, year: number, mapped: boolean) {
    if (!source)
        return 'Data observasi untuk provinsi dan tahun ini belum tersedia.';
    if (source.year !== year)
        return `Data ${source.year} ditampilkan untuk pilihan tahun ${year} karena data ${year} belum tersedia. ${raw.papua_display_mapping?.display_note ?? ''}`;
    return mapped ? raw.papua_display_mapping?.display_note ?? null : null;
}
function riskOf(output: RawOutput | undefined | null): Risk { return output?.level ?? 'unavailable'; }
export async function fixtureMap(year: number, category: Category, geometry: ProvinceGeometry): Promise<MapResponse> {
    void geometry;
    const { data: raw, mapping } = await loadFixture();
    const provinces: MapProvince[] = [];
    for (const definition of mapping.provinces) {
        const code = definition.province_code;
        const source = getRaw(raw, mapping, code, year);
        const mapped = source != null && source.province_code !== code;
        const sourceNote = sourceNoteFor(raw, source, year, mapped);
        provinces.push({
            province_code: code,
            province_name: definition.province_name,
            island: islandLabels[definition.island] ?? definition.island,
            risk: Object.fromEntries(categories.map(key => [key, riskOf(source?.[key])])) as Record<Category, Risk>,
            boundary_status: !source ? 'missing' : mapped ? 'mapped' : 'matched',
            source_province: (mapped || definition?.island === 'papua') && source ? { code: source.province_code, name: source.province_name } : null,
            source_explanation: sourceNote ?? null,
            source_year: source?.year ?? null,
            is_training: source?.is_training ?? false,
        });
    }
    return { data_version: raw.data_version, year, category, provinces };
}
export async function fixtureDetail(code: string, year: number, geometry: ProvinceGeometry): Promise<ProvinceDetail> {
    void geometry;
    const { data: raw, mapping } = await loadFixture();
    const definition = mapping.provinces.find(item => item.province_code === code);
    const source = getRaw(raw, mapping, code, year);
    const mapped = source != null && source.province_code !== code;
    const resolved = source ?? null;
    const predictions = Object.fromEntries(categories.map(category => {
        const output = resolved?.[category];
        const available = raw.predictions.filter(row => row.year === (resolved?.year ?? year)).map(row => row[category]?.predicted_value).filter((value): value is number => Number.isFinite(value));
        const reference_mean = available.length ? available.reduce((sum, value) => sum + value, 0) / available.length : null;
        return [category, output ? { ...output, reference_mean, reference_count: available.length, reference_year: resolved?.year ?? year } : null];
    })) as ProvinceDetail['predictions'];
    const risk = Object.fromEntries(categories.map(category => [category, predictions[category]?.level ?? 'unavailable'])) as Record<Category, Risk>;
    return {
        data_version: raw.data_version,
        province_code: code,
        province_name: definition?.province_name ?? source?.province_name ?? code,
        year,
        is_training: resolved?.is_training ?? false,
        boundary_status: !resolved ? 'missing' : mapped ? 'mapped' : 'matched',
        source_province: (mapped || definition?.island === 'papua') && resolved ? { code: resolved.province_code, name: resolved.province_name } : null,
        source_explanation: sourceNoteFor(raw, source, year, mapped),
        source_year: resolved?.year ?? null,
        risk,
        predictions,
        indicators: resolved?.indicators.map(item => ({ ...item, contribution: item.contribution ?? null })) ?? [],
    };
}
async function request<T>(path: string): Promise<T> {
    const response = await fetch(`${API_BASE}${path}`, { headers: { Accept: 'application/json' } });
    if (!response.ok)
        throw new Error(`Server API merespons ${response.status}.`);
    return response.json() as Promise<T>;
}
export const getMetadata = () => USE_FIXTURES ? fixtureMetadata() : request<Metadata>('/api/v1/metadata');
export const getMap = (year: number, category: Category, geometry: ProvinceGeometry) => USE_FIXTURES ? fixtureMap(year, category, geometry) : request<MapResponse>(`/api/v1/map?year=${year}&category=${category}`);
export const getProvince = (code: string, year: number, geometry: ProvinceGeometry) => USE_FIXTURES ? fixtureDetail(code, year, geometry) : request<ProvinceDetail>(`/api/v1/provinces/${encodeURIComponent(code)}?year=${year}`);
export const getGeometry = async (url: string): Promise<ProvinceGeometry> => {
    const response = await fetch(url);
    if (!response.ok)
        throw new Error(`Batas provinsi gagal dimuat (${response.status}).`);
    return response.json() as Promise<ProvinceGeometry>;
};
export async function getCsv(year: number, category: Category, island: string, risk: Risk | null, geometry: ProvinceGeometry) {
    if (!USE_FIXTURES) {
        const response = await fetch(csvUrl(year, category, island, risk), { headers: { Accept: 'text/csv' } });
        if (!response.ok)
            throw new Error(`Server API merespons ${response.status}.`);
        return response.blob();
    }
    const { data: raw } = await loadFixture();
    const map = await fixtureMap(year, category, geometry);
    const header: unknown[] = ['province_code', 'province_name', 'island', 'year', 'category', 'risk_level', 'predicted_value', 'observed_value', 'source_province_code', 'boundary_status', 'source_explanation', 'is_training', 'indicators_json', 'shap_values_json', 'lime_values_json', 'shap_base_value', 'lime_fidelity', 'reference_mean', 'reference_count', 'model_version', 'source_year', 'reference_year'];
    const quote = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`;
    const matching = map.provinces.filter(province => (island === 'all' || province.island === island) && (!risk || province.risk[category] === risk));
    const data: unknown[][][] = await Promise.all(matching.map(async (province) => {
        const item = await fixtureDetail(province.province_code, year, geometry);
        return [[province.province_code, province.province_name, province.island, year, category, province.risk[category], item.predictions[category]?.predicted_value, item.predictions[category]?.observed_value, province.source_province?.code, province.boundary_status, province.source_explanation, item.is_training, JSON.stringify(item.indicators), JSON.stringify(item.predictions[category]?.explanations ?? []), JSON.stringify(item.predictions[category]?.lime_explanations ?? []), item.predictions[category]?.shap_base_value, item.predictions[category]?.lime_fidelity, item.predictions[category]?.reference_mean, item.predictions[category]?.reference_count, raw.model_version, item.source_year, item.predictions[category]?.reference_year] as unknown[]];
    }));
    const lines = [header, ...data.flat()].map(row => row.map(quote).join(','));
    return new Blob(['\uFEFF', lines.join('\r\n'), '\r\n'], { type: 'text/csv;charset=utf-8' });
}
export const csvUrl = (year: number, category: Category = 'sexual', island = 'all', risk: Risk | null = null) => {
    const islandSlug: Record<string, string> = { Sumatera: 'sumatera', Jawa: 'java', 'Bali & Nusa Tenggara': 'bali-nusa-tenggara', Kalimantan: 'kalimantan', Sulawesi: 'sulawesi', Maluku: 'maluku', Papua: 'papua' };
    const query = new URLSearchParams({ year: String(year), category });
    if (island !== 'all')
        query.set('island', islandSlug[island] ?? island);
    if (risk)
        query.set('risk', risk);
    return `${API_BASE}/api/v1/export.csv?${query}`;
};
