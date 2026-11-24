import { BadRequestException, Controller, Get, Header, NotFoundException, Param, Query, Res, UseInterceptors } from '@nestjs/common';
import type { Response } from 'express';
import { createHash } from 'node:crypto';
import type { Metadata, MapResponse, MapProvince, ProvinceDetail } from '@xai/contracts';
import { CATEGORIES, ISLANDS, RISKS, type Category, type Filters, type Island, type Risk, type PredictionRecord, type ProvinceDefinition, type CategoryOutput } from './schema';
import { PublishedDataService } from './published-data.service';
import { PublicDataCacheInterceptor } from './public-data-cache.interceptor';
const PROVINCES = new Map<string, ProvinceDefinition>([
    ['11', { province_code: '11', province_name: 'Aceh', island: 'sumatera' }], ['12', { province_code: '12', province_name: 'Sumatera Utara', island: 'sumatera' }], ['13', { province_code: '13', province_name: 'Sumatera Barat', island: 'sumatera' }], ['14', { province_code: '14', province_name: 'Riau', island: 'sumatera' }], ['15', { province_code: '15', province_name: 'Jambi', island: 'sumatera' }], ['16', { province_code: '16', province_name: 'Sumatera Selatan', island: 'sumatera' }], ['17', { province_code: '17', province_name: 'Bengkulu', island: 'sumatera' }], ['18', { province_code: '18', province_name: 'Lampung', island: 'sumatera' }], ['19', { province_code: '19', province_name: 'Kepulauan Bangka Belitung', island: 'sumatera' }], ['21', { province_code: '21', province_name: 'Kepulauan Riau', island: 'sumatera' }],
    ['31', { province_code: '31', province_name: 'DKI Jakarta', island: 'java' }], ['32', { province_code: '32', province_name: 'Jawa Barat', island: 'java' }], ['33', { province_code: '33', province_name: 'Jawa Tengah', island: 'java' }], ['34', { province_code: '34', province_name: 'DI Yogyakarta', island: 'java' }], ['35', { province_code: '35', province_name: 'Jawa Timur', island: 'java' }], ['36', { province_code: '36', province_name: 'Banten', island: 'java' }],
    ['51', { province_code: '51', province_name: 'Bali', island: 'bali-nusa-tenggara' }], ['52', { province_code: '52', province_name: 'Nusa Tenggara Barat', island: 'bali-nusa-tenggara' }], ['53', { province_code: '53', province_name: 'Nusa Tenggara Timur', island: 'bali-nusa-tenggara' }],
    ['61', { province_code: '61', province_name: 'Kalimantan Barat', island: 'kalimantan' }], ['62', { province_code: '62', province_name: 'Kalimantan Tengah', island: 'kalimantan' }], ['63', { province_code: '63', province_name: 'Kalimantan Selatan', island: 'kalimantan' }], ['64', { province_code: '64', province_name: 'Kalimantan Timur', island: 'kalimantan' }], ['65', { province_code: '65', province_name: 'Kalimantan Utara', island: 'kalimantan' }],
    ['71', { province_code: '71', province_name: 'Sulawesi Utara', island: 'sulawesi' }], ['72', { province_code: '72', province_name: 'Sulawesi Tengah', island: 'sulawesi' }], ['73', { province_code: '73', province_name: 'Sulawesi Selatan', island: 'sulawesi' }], ['74', { province_code: '74', province_name: 'Sulawesi Tenggara', island: 'sulawesi' }], ['75', { province_code: '75', province_name: 'Gorontalo', island: 'sulawesi' }], ['76', { province_code: '76', province_name: 'Sulawesi Barat', island: 'sulawesi' }],
    ['81', { province_code: '81', province_name: 'Maluku', island: 'maluku' }], ['82', { province_code: '82', province_name: 'Maluku Utara', island: 'maluku' }],
    ['91', { province_code: '91', province_name: 'Papua', island: 'papua' }], ['92', { province_code: '92', province_name: 'Papua Barat', island: 'papua' }], ['93', { province_code: '93', province_name: 'Papua Selatan', island: 'papua' }], ['94', { province_code: '94', province_name: 'Papua Tengah', island: 'papua' }], ['95', { province_code: '95', province_name: 'Papua Pegunungan', island: 'papua' }], ['96', { province_code: '96', province_name: 'Papua Barat Daya', island: 'papua' }],
]);
@Controller()
@UseInterceptors(PublicDataCacheInterceptor)
export class ApiController {
    constructor(private readonly published: PublishedDataService) { }
    @Get('health')
    @Header('Cache-Control', 'no-store')
    health() {
        try {
            const data = this.published.get();
            return { status: 'ok', data_version: data.manifest.data_version };
        }
        catch {
            return { status: 'degraded', data_version: null };
        }
    }
    @Get('metadata')
    metadata(): Metadata {
        const data = this.published.get();
        const categories: Metadata['categories'] = [
            { id: 'sexual', label: 'Kekerasan seksual' },
            { id: 'nonsexual', label: 'Kekerasan nonseksual' },
        ];
        return this.versioned(data, { years: data.predictions.available_years, categories, islands: ['Sumatera', 'Jawa', 'Bali & Nusa Tenggara', 'Kalimantan', 'Sulawesi', 'Maluku', 'Papua'], risk_labels: { low: 'Rendah', moderate: 'Sedang', high: 'Tinggi', unavailable: 'Belum tersedia' }, target_unit: String(data.predictions.target_unit ?? ''), map_asset: '/data/provinces.geojson', model_version: data.predictions.model_version, coverage_by_year: data.predictions.coverage_by_year ?? this.coverage(data), training_years: data.predictions.training_years ?? [], provenance: { source_file: data.predictions.source_file ?? null, source_sha256: data.predictions.source_sha256 ?? null } });
    }
    @Get('map')
    map(
    @Query()
    query: Record<string, string>): MapResponse {
        const data = this.published.get();
        const { year, category, filters } = this.parseFilters(query, data);
        const records = this.displayRecords(data, year);
        const provinces: MapProvince[] = records.filter(({ definition, record }) => {
            const level = record?.[category]?.level ?? 'unavailable';
            return (filters.island === 'all' || definition.island === filters.island) && (filters.risk === 'all' || level === filters.risk);
        }).map(({ definition, record, mapped }) => {
            const risk = Object.fromEntries(CATEGORIES.map((key) => [key, record?.[key]?.level ?? 'unavailable'])) as Record<Category, Risk>;
            const sourceProvince = (mapped || definition.island === 'papua') && record
                ? { code: record.province_code, name: record.province_name }
                : null;
            const boundaryStatus = !record ? 'missing' : mapped ? 'mapped' : 'matched';
            const sourceExplanation = this.sourceExplanation(definition.province_code, year, record, mapped, data);
            return { province_code: definition.province_code, province_name: definition.province_name, island: this.islandLabel(definition.island), risk, boundary_status: boundaryStatus, source_province: sourceProvince, source_explanation: sourceExplanation, source_year: record?.year ?? null, is_training: record?.is_training ?? false };
        });
        return this.versioned(data, { year, category, filters, count: provinces.length, provinces });
    }
    @Get('provinces/:code')
    province(
    @Param('code')
    code: string,
    @Query()
    query: Record<string, string>): ProvinceDetail {
        for (const key of Object.keys(query))
            if (key !== 'year')
                throw new BadRequestException({ error: 'InvalidQueryParameter', message: `Unsupported query parameter: ${key}.` });
        if (!/^\d{2}$/.test(code))
            throw new BadRequestException({ error: 'InvalidProvinceCode', message: 'code must be a two-character province code string.' });
        const data = this.published.get();
        const definition = data.mapping.provinces.find((province) => province.province_code === code) ?? this.resolveDefinition(code);
        if (!definition)
            throw new NotFoundException({ error: 'ProvinceNotFound', message: `Unknown province code ${code}.` });
        const year = this.parseYear(query.year, data);
        const entry = this.displayRecords(data, year).find((item) => item.definition.province_code === code);
        const record = entry?.record ?? null;
        const mapped = entry?.mapped ?? false;
        const references = this.references(data, record?.year ?? year);
        const predictions = Object.fromEntries(CATEGORIES.map((category) => {
            const output = record?.[category] ?? null;
            return [category, output ? { ...output, reference_mean: references[category].mean, reference_count: references[category].count, reference_year: record?.year ?? year } : null];
        })) as Record<Category, (CategoryOutput & {
            reference_mean: number | null;
            reference_count: number;
        }) | null>;
        const risk = Object.fromEntries(CATEGORIES.map((category) => [category, predictions[category]?.level ?? 'unavailable'])) as Record<Category, Risk>;
        const sourceProvince = (mapped || definition.island === 'papua') && record
            ? { code: record.province_code, name: record.province_name }
            : null;
        const boundaryStatus = !record ? 'missing' : mapped ? 'mapped' : 'matched';
        const sourceExplanation = this.sourceExplanation(code, year, record, mapped, data);
        return this.versioned(data, { year, province_code: code, province_name: definition.province_name, is_training: record?.is_training ?? false, boundary_status: boundaryStatus, source_province: sourceProvince, source_explanation: sourceExplanation, source_year: record?.year ?? null, risk, predictions, indicators: record?.indicators ?? [], observation_available: Boolean(record), provenance: this.provenance(data) });
    }
    @Get('export.csv')
    @Header('Content-Type', 'text/csv; charset=utf-8')
    exportCsv(
    @Query()
    query: Record<string, string>,
    @Res({ passthrough: true })
    response: Response) {
        const data = this.published.get();
        const { year, category, filters } = this.parseFilters(query, data);
        const rows = this.displayRecords(data, year).filter(({ definition, record }) => {
            const output = record?.[category] ?? null;
            const risk = output?.level ?? 'unavailable';
            return (filters.island === 'all' || definition.island === filters.island) && (filters.risk === 'all' || risk === filters.risk);
        });
        const header = ['province_code', 'province_name', 'island', 'year', 'category', 'risk_level', 'predicted_value', 'observed_value', 'source_province_code', 'boundary_status', 'source_explanation', 'is_training', 'indicators_json', 'shap_values_json', 'lime_values_json', 'shap_base_value', 'lime_fidelity', 'reference_mean', 'reference_count', 'model_version', 'source_year', 'reference_year'];
        const lines = [header.join(','), ...rows.map(({ definition, source, record, mapped }) => {
                const output = record?.[category] ?? null;
                const boundaryStatus = !record ? 'missing' : mapped ? 'mapped' : 'matched';
                const sourceCode = (mapped || definition.island === 'papua') && record ? source : null;
                const sourceExplanation = this.sourceExplanation(definition.province_code, year, record, mapped, data);
                const values: unknown[] = [definition.province_code, definition.province_name, this.islandLabel(definition.island), year, category, output?.level ?? 'unavailable', output?.predicted_value ?? null, output?.observed_value ?? null, sourceCode, boundaryStatus, sourceExplanation, record?.is_training ?? false, JSON.stringify(record?.indicators ?? []), JSON.stringify(output?.explanations ?? []), JSON.stringify(output?.lime_explanations ?? []), output?.shap_base_value ?? null, output?.lime_fidelity ?? null, this.references(data, record?.year ?? year)[category].mean, this.references(data, record?.year ?? year)[category].count, data.manifest.data_version, record?.year ?? null, record?.year ?? null];
                return values.map((value) => this.csvCell(value)).join(',');
            })];
        const csv = `\uFEFF${lines.join('\r\n')}\r\n`;
        const etag = `"${createHash('sha256').update(csv).digest('hex')}"`;
        response.setHeader('ETag', etag);
        response.setHeader('Cache-Control', 'public, max-age=300, s-maxage=3600, stale-while-revalidate=86400');
        response.setHeader('Content-Disposition', `attachment; filename="violence-risk-${year}-${category}.csv"`);
        response.setHeader('X-Data-Version', data.manifest.data_version);
        return csv;
    }
    private parseFilters(query: Record<string, string>, data: ReturnType<PublishedDataService['get']>) {
        const allowed = new Set(['year', 'category', 'island', 'risk']);
        for (const key of Object.keys(query))
            if (!allowed.has(key))
                throw new BadRequestException({ error: 'InvalidQueryParameter', message: `Unsupported query parameter: ${key}.` });
        const year = this.parseYear(query.year, data);
        const category = (query.category ?? 'sexual') as Category;
        if (!CATEGORIES.includes(category))
            throw new BadRequestException({ error: 'InvalidCategory', message: 'category must be sexual or nonsexual.' });
        const island = this.parseEnum(query.island, ISLANDS, 'island');
        const risk = this.parseEnum(query.risk, RISKS, 'risk');
        return { year, category, filters: { island, risk } satisfies Filters };
    }
    private parseYear(value: string | undefined, data: ReturnType<PublishedDataService['get']>) {
        if (value === undefined || !/^\d{4}$/.test(value))
            throw new BadRequestException({ error: 'InvalidYear', message: 'year is required as a four-digit integer.' });
        const year = Number(value);
        if (!data.predictions.available_years.includes(year))
            throw new BadRequestException({ error: 'UnsupportedYear', message: `year must be one of: ${data.predictions.available_years.join(', ')}.` });
        return year;
    }
    private parseEnum<T extends string>(value: string | undefined, values: readonly T[], field: string): T | 'all' {
        if (value === undefined || value === 'all')
            return 'all';
        if (!values.includes(value as T))
            throw new BadRequestException({ error: `Invalid${field[0].toUpperCase()}${field.slice(1)}`, message: `${field} must be all or one of: ${values.join(', ')}.` });
        return value as T;
    }
    private displayRecords(data: ReturnType<PublishedDataService['get']>, year: number) {
        return data.mapping.provinces.map((definition) => {
            const source = data.mapping.source_by_display_code[definition.province_code] ?? definition.province_code;
            const sourceYear = year === 2024 && data.predictions.papua_display_mapping.unavailable_2024_display_codes.includes(definition.province_code) ? 2023 : year;
            const record = data.predictions.predictions.find((row) => row.province_code === source && row.year === sourceYear) ?? null;
            return { definition, source, record, mapped: source !== definition.province_code };
        });
    }
    private resolveDefinition(code: string) { return PROVINCES.get(code); }
    private islandLabel(island: Island) {
        return ({ sumatera: 'Sumatera', java: 'Jawa', 'bali-nusa-tenggara': 'Bali & Nusa Tenggara', kalimantan: 'Kalimantan', sulawesi: 'Sulawesi', maluku: 'Maluku', papua: 'Papua' } as const)[island];
    }
    private references(data: ReturnType<PublishedDataService['get']>, year: number) {
        const result = {} as Record<Category, {
            mean: number | null;
            count: number;
        }>;
        for (const category of CATEGORIES) {
            const unique = new Map<string, number>();
            for (const row of data.predictions.predictions) {
                if (row.year !== year)
                    continue;
                const value = row[category]?.predicted_value;
                if (typeof value === 'number' && Number.isFinite(value))
                    unique.set(row.province_code, value);
            }
            const values = [...unique.values()];
            result[category] = { mean: values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null, count: values.length };
        }
        return result;
    }
    private coverage(data: ReturnType<PublishedDataService['get']>) {
        return Object.fromEntries(data.predictions.available_years.map((year) => [year, new Set(data.predictions.predictions.filter((row) => row.year === year).map((row) => row.province_code)).size]));
    }
    private provenance(data: ReturnType<PublishedDataService['get']>) {
        return { model_name: data.predictions.model_name ?? null, model_version: data.predictions.model_version, source_file: data.predictions.source_file ?? null, source_sha256: data.predictions.source_sha256 ?? null };
    }
    private sourceExplanation(code: string, year: number, record: PredictionRecord | null, mapped: boolean, data: ReturnType<PublishedDataService['get']>) {
        if (!record)
            return this.unavailableReason(code, year, data.predictions.papua_display_mapping);
        if (record.year !== year)
            return `Data ${record.year} ditampilkan untuk pilihan tahun ${year} karena data ${year} belum tersedia. ${data.predictions.papua_display_mapping.display_note}`;
        return mapped ? data.predictions.papua_display_mapping.display_note : null;
    }
    private unavailableReason(code: string, year: number, mapping: ReturnType<PublishedDataService['get']>['predictions']['papua_display_mapping']) {
        if (year === 2024 && mapping.unavailable_2024_display_codes?.includes(code))
            return mapping.unavailable_2024_note ?? 'Data observasi untuk provinsi dan tahun ini belum tersedia.';
        return 'Data observasi untuk provinsi dan tahun ini belum tersedia.';
    }
    private versioned<T extends object>(data: ReturnType<PublishedDataService['get']>, payload: T) { return { data_version: data.manifest.data_version, ...payload }; }
    private csvCell(value: unknown) {
        const text = value === null || value === undefined ? '' : typeof value === 'string' ? value : String(value);
        return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
    }
}
