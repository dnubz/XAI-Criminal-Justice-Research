import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import geometryText from '../public/data/provinces.geojson?raw';
import { fixtureDetail, fixtureMap, fixtureMetadata, getCsv } from './api';
import type { ProvinceGeometry } from './types';
const geometry = JSON.parse(geometryText) as ProvinceGeometry;
const predictionFixture = JSON.parse(readFileSync(new URL('./fixtures/paper-predictions.json', import.meta.url), 'utf8'));
const mappingFixture = JSON.parse(readFileSync(new URL('./fixtures/province-mapping.json', import.meta.url), 'utf8'));
beforeEach(() => vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(JSON.stringify(String(url).includes('province-mapping') ? mappingFixture : predictionFixture), { status: 200 }))));
afterEach(() => vi.unstubAllGlobals());
describe('API contract fixtures', () => {
    it('provides 38 province boundaries and historical Papua source mappings for 2023', async () => {
        const result = await fixtureMap(2023, 'sexual', geometry);
        expect(geometry.features).toHaveLength(38);
        expect(result.provinces).toHaveLength(38);
        expect(result.provinces.find(row => row.province_code === '93')).toMatchObject({ boundary_status: 'mapped', source_province: { code: '91', name: 'PAPUA' }, source_explanation: expect.stringContaining('pemekaran') });
        expect(result.provinces.find(row => row.province_code === '96')).toMatchObject({ boundary_status: 'mapped', source_province: { code: '92', name: 'PAPUA BARAT' } });
    }, 15000);
    it('uses 2023 Papua values and reference means in the 2024 view', async () => {
        const result = await fixtureMap(2024, 'sexual', geometry);
        for (const code of ['91', '92', '93', '94', '95', '96']) {
            const historical = await fixtureDetail(code, 2023, geometry);
            const fallback = await fixtureDetail(code, 2024, geometry);
            expect(result.provinces.find(row => row.province_code === code)).toMatchObject({ source_year: 2023, risk: historical.risk });
            expect(fallback.year).toBe(2024);
            expect(fallback.source_year).toBe(2023);
            expect(fallback.predictions).toEqual(historical.predictions);
            expect(fallback.indicators).toEqual(historical.indicators);
            expect(fallback.source_province).toEqual(historical.source_province);
            expect(fallback.predictions.sexual?.reference_count).toBe(34);
            expect(fallback.predictions.sexual?.reference_year).toBe(2023);
        }
        expect(result.provinces.filter(row => row.risk.sexual !== 'unavailable')).toHaveLength(38);
    }, 15000);
    it('includes both explanation methods and a same-year reference from the API fixture', async () => {
        const detail = await fixtureDetail('32', 2023, geometry);
        expect(detail.predictions.sexual?.explanations.length).toBeGreaterThan(3);
        expect(detail.predictions.sexual?.lime_explanations.length).toBeGreaterThan(3);
        expect(detail.predictions.sexual?.lime_fidelity).toBeTypeOf('number');
        expect(detail.predictions.sexual?.reference_count).toBe(34);
        expect(detail.predictions.sexual?.reference_mean).toBeCloseTo(1.343505135, 6);
    });
    it('declares the available years and categories without derived frontend thresholds', async () => {
        const metadata = await fixtureMetadata();
        expect(metadata.years).toEqual([2021, 2022, 2023, 2024]);
        expect(metadata.categories.map(item => item.id)).toEqual(['sexual', 'nonsexual']);
        expect(metadata.target_unit).toContain('100.000');
    });
    it('exports a downloadable CSV that identifies Papua source and reference years', async () => {
        const blob = await getCsv(2024, 'sexual', 'all', null, geometry);
        const csv = await blob.text();
        expect(blob.type).toContain('text/csv');
        expect(csv).toContain('Papua Tengah');
        expect(csv).toContain('source_year');
        expect(csv).toContain('reference_year');
        expect(csv).toContain('Data 2023 ditampilkan untuk pilihan tahun 2024');
        expect(csv).not.toContain('unavailable');
    });
    it('serializes CSV island and risk filters to the shared API URL contract', async () => {
        const { csvUrl } = await import('./api');
        expect(csvUrl(2023, 'nonsexual', 'Bali & Nusa Tenggara', 'high')).toBe('/api/v1/export.csv?year=2023&category=nonsexual&island=bali-nusa-tenggara&risk=high');
    });
});
