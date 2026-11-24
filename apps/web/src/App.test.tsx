import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFileSync } from 'node:fs';
import geometryText from '../public/data/provinces.geojson?raw';
import App from './App';
import type { ProvinceGeometry } from './types';
vi.mock('./api', async () => {
    const actual = await vi.importActual<typeof import('./api')>('./api');
    return { ...actual,
        getMetadata: vi.fn(), getGeometry: vi.fn(), getMap: vi.fn(), getProvince: vi.fn(), getCsv: vi.fn(),
    };
});
vi.mock('./MapView', () => ({
    MapView: ({ provinces, onSelect }: {
        provinces: {
            province_code: string;
            province_name: string;
        }[];
        onSelect: (code: string) => void;
    }) => <div aria-label="interactive map">{provinces.map(row => <button key={row.province_code} aria-label={`Peta ${row.province_name}`} onClick={() => onSelect(row.province_code)}/>)}</div>,
}));
const geometry = JSON.parse(geometryText) as ProvinceGeometry;
const predictionFixture = JSON.parse(readFileSync('./src/fixtures/paper-predictions.json', 'utf8'));
const mappingFixture = JSON.parse(readFileSync('./src/fixtures/province-mapping.json', 'utf8'));
describe('dashboard interactions', () => {
    beforeEach(async () => {
        vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(JSON.stringify(String(url).includes('province-mapping') ? mappingFixture : predictionFixture), { status: 200 })));
        const api = await import('./api');
        vi.mocked(api.getMetadata).mockResolvedValue(await api.fixtureMetadata());
        vi.mocked(api.getGeometry).mockResolvedValue(geometry);
        vi.mocked(api.getMap).mockImplementation((year, category, geo) => api.fixtureMap(year, category, geo));
        vi.mocked(api.getProvince).mockImplementation((code, year, geo) => api.fixtureDetail(code, year, geo));
        vi.mocked(api.getCsv).mockResolvedValue(new Blob(['test'], { type: 'text/csv' }));
    });
    afterEach(() => { cleanup(); vi.clearAllMocks(); vi.unstubAllGlobals(); });
    it('searches and selects a province, then changes category and explanation method', async () => {
        const user = userEvent.setup();
        render(<App />);
        expect(await screen.findByRole('heading', { name: 'Jawa Barat' })).toBeTruthy();
        await user.selectOptions(screen.getByRole('combobox', { name: 'Pilih tahun' }), '2023');
        await user.type(screen.getByRole('textbox', { name: 'Cari provinsi' }), 'Papua Tengah');
        await user.click(await screen.findByRole('option', { name: /Papua Tengah/ }));
        expect(await screen.findByRole('heading', { name: 'Papua Tengah' })).toBeTruthy();
        expect(screen.getByText(/PAPUA/)).toBeTruthy();
        await user.click(screen.getByRole('button', { name: 'Nonseksual' }));
        expect(screen.getByText('Di balik prediksi')).toBeTruthy();
        await user.selectOptions(screen.getByRole('combobox', { name: 'Metode penjelasan' }), 'lime');
        expect(await screen.findByText(/Kecocokan LIME/)).toBeTruthy();
    }, 20000);
    it('labels 2023 Papua values and reference year when 2024 is selected', async () => {
        const user = userEvent.setup();
        render(<App />);
        await screen.findByRole('heading', { name: 'Jawa Barat' });
        await user.selectOptions(screen.getByRole('combobox', { name: 'Pilih tahun' }), '2023');
        await user.selectOptions(screen.getByRole('combobox', { name: 'Pilih tahun' }), '2024');
        await user.click(screen.getByRole('button', { name: 'Peta Papua Tengah' }));
        expect(await screen.findByRole('heading', { name: 'Papua Tengah' })).toBeTruthy();
        expect(await screen.findByText('Data 2023')).toBeTruthy();
        expect(screen.getByText(/Data 2023 ditampilkan untuk pilihan tahun 2024/)).toBeTruthy();
        expect(screen.getByText(/Rata-rata menggunakan data yang tersedia pada 2023/)).toBeTruthy();
        expect(screen.getByText('Papua memakai data 2023')).toBeTruthy();
        expect(screen.getByRole('combobox', { name: 'Pilih tahun' })).toHaveProperty('value', '2024');
        await user.click(screen.getByRole('button', { name: /Tinggi/ }));
        expect(screen.getByRole('button', { name: /Tinggi/ }).getAttribute('aria-pressed')).toBe('true');
        await user.click(screen.getByRole('button', { name: 'Nonseksual' }));
        expect(screen.getByRole('button', { name: 'Nonseksual' }).getAttribute('aria-pressed')).toBe('true');
    });
    it('surfaces API failures to the user', async () => {
        const api = await import('./api');
        vi.mocked(api.getMap).mockRejectedValueOnce(new Error('Server API merespons 503.'));
        render(<App />);
        expect((await screen.findByRole('alert')).textContent).toMatch(/Peta gagal dimuat/);
    });
});
