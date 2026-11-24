import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { spawn } from 'node:child_process';
import { cp, mkdtemp, mkdir, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
const root = resolve(import.meta.dirname, '..');
let temp;
let server;
let base;
function parseCsv(line) {
    const values = [];
    let value = '';
    let quoted = false;
    for (let index = 0; index < line.length; index += 1) {
        const char = line[index];
        if (char === '"' && quoted && line[index + 1] === '"') {
            value += '"';
            index += 1;
        }
        else if (char === '"')
            quoted = !quoted;
        else if (char === ',' && !quoted) {
            values.push(value);
            value = '';
        }
        else
            value += char;
    }
    values.push(value);
    return values;
}
function category(predicted, level = 'low') {
    return { level, predicted_value: predicted, observed_value: null, explanations: [{ column: 'x', contribution: 0.1 }], lime_explanations: [{ column: 'x', contribution: 0.2 }], shap_base_value: predicted - 0.1, shap_additivity_error: 0, lime_fidelity: 0.6, lime_local_prediction: predicted, lime_intercept: predicted, shap_reference_year: 2024, shap_reference_count: 2, shap_reference_kind: 'same_year_province_prediction_mean' };
}
function record(code, name, year, sexual, nonsexual) {
    return { province_code: code, province_name: name, year, is_training: year < 2024, indicators: [{ column: 'indicator_x', feature: 'Indicator X', value: null, raw_value: null, unit: null, precision: 2, data_year: year, source: 'source.csv' }], sexual, nonsexual };
}
before(async () => {
    temp = await mkdtemp(join(tmpdir(), 'xai-api-test-'));
    const published = join(temp, 'published');
    await mkdir(published);
    const papuaAndAceh = [
        { province_code: '11', province_name: 'Aceh', island: 'sumatera' },
        { province_code: '91', province_name: 'Papua', island: 'papua' },
        { province_code: '92', province_name: 'Papua Barat', island: 'papua' },
        { province_code: '93', province_name: 'Papua Selatan', island: 'papua' },
        { province_code: '94', province_name: 'Papua Tengah', island: 'papua' },
        { province_code: '95', province_name: 'Papua Pegunungan', island: 'papua' },
        { province_code: '96', province_name: 'Papua Barat Daya', island: 'papua' },
    ];
    const regions = [
        ['sumatera', ['12', '13', '14', '15', '16', '17', '18', '19', '21']], ['java', ['31', '32', '33', '34', '35', '36']],
        ['bali-nusa-tenggara', ['51', '52', '53']], ['kalimantan', ['61', '62', '63', '64', '65']],
        ['sulawesi', ['71', '72', '73', '74', '75', '76']], ['maluku', ['81', '82']],
    ];
    const provinces = [...papuaAndAceh, ...regions.flatMap(([island, codes]) => codes.map((code) => ({ province_code: code, province_name: `Provinsi ${code}`, island })))];
    const mapping = {
        schema_version: '1.0.0', data_version: 'test-v1',
        provinces,
        source_by_display_code: Object.fromEntries(provinces.map((province) => [province.province_code, province.province_code])),
    };
    Object.assign(mapping.source_by_display_code, { '93': '91', '94': '91', '95': '91', '96': '92' });
    const predictions = {
        schema_version: '1.0.0', data_version: '1.0.0', model_version: 'test-v1', available_years: [2023, 2024], training_years: [2023], model_name: 'fixture',
        source_file: 'fixture.csv', source_sha256: 'fixture-hash', target_unit: 'rate',
        papua_display_mapping: { historical_years: [2023], display_to_source_code: { '93': '91', '94': '91', '95': '91', '96': '92' }, display_note: 'Memakai data Papua sebelum pemekaran 2022.', unavailable_2024_display_codes: ['91', '92', '93', '94', '95', '96'], unavailable_2024_note: 'Data 2024 tidak tersedia karena pemekaran Papua membuat data tidak sebanding dengan tahun sebelumnya.' },
        predictions: [
            record('11', 'Aceh', 2024, category(2, 'high'), category(4, 'moderate')),
            record('91', 'Papua', 2023, category(1), category(3)), record('92', 'Papua Barat', 2023, category(3, 'moderate'), category(5, 'high')),
            record('11', 'Aceh', 2023, category(1), category(2)),
        ],
    };
    await writeFile(join(published, 'manifest.json'), JSON.stringify({ schema_version: 1, data_version: 'test-v1', predictions_file: 'predictions.test-v1.json', province_mapping_file: 'province-mapping.test-v1.json' }));
    await writeFile(join(published, 'predictions.test-v1.json'), JSON.stringify(predictions));
    await writeFile(join(published, 'province-mapping.test-v1.json'), JSON.stringify(mapping));
    const port = 32000 + Math.floor(Math.random() * 12000);
    server = spawn(process.execPath, [join(root, 'dist', 'src', 'main.js')], { cwd: root, env: { ...process.env, PUBLISHED_DATA_DIR: published, PORT: String(port), CORS_ORIGINS: 'http://localhost:3000' }, stdio: 'ignore' });
    base = `http://127.0.0.1:${port}/api/v1`;
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
        try {
            if ((await fetch(`${base}/health`)).ok)
                return;
        }
        catch { }
        await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error('Nest API did not start');
});
after(async () => {
    server?.kill();
    if (temp)
        await rm(temp, { recursive: true, force: true });
});
test('validates query parameters and reports invalid requests as 400', async () => {
    for (const url of ['/map?year=20x4', '/map?year=2025', '/map?year=2024&category=other', '/map?year=2024&island=atlantis', '/export.csv?year=2024&risk=extreme', '/provinces/11?year=2024&category=sexual']) {
        const response = await fetch(`${base}${url}`);
        assert.equal(response.status, 400, url);
    }
});
test('distinguishes malformed and unknown province codes', async () => {
    assert.equal((await fetch(`${base}/provinces/no?year=2024`)).status, 400);
    assert.equal((await fetch(`${base}/provinces/99?year=2024`)).status, 404);
});
test('uses labeled 2023 observations for all six Papua provinces in the 2024 view', async () => {
    for (const code of ['91', '92', '93', '94', '95', '96']) {
        const response = await fetch(`${base}/provinces/${code}?year=2024`);
        assert.equal(response.status, 200, code);
        const body = await response.json();
        const historical = await fetch(`${base}/provinces/${code}?year=2023`).then(r => r.json());
        assert.equal(body.observation_available, true, code);
        assert.equal(body.year, 2024);
        assert.equal(body.source_year, 2023);
        assert.equal(body.is_training, true);
        assert.deepEqual(body.predictions, historical.predictions);
        assert.deepEqual(body.indicators, historical.indicators);
        assert.deepEqual(body.source_province, historical.source_province);
        assert.match(body.source_explanation, /Data 2023 ditampilkan.*2024/);
        assert.equal(body.predictions.sexual.reference_year, 2023);
        assert.equal(body.predictions.sexual.reference_count, 3);
    }
});
test('maps historical Papua display provinces to source observations', async () => {
    const response = await fetch(`${base}/provinces/93?year=2023`);
    const body = await response.json();
    assert.equal(body.source_province.code, '91');
    assert.equal(body.predictions.sexual.predicted_value, 1);
    assert.equal(body.predictions.sexual.observed_value, null);
    assert.equal(body.indicators[0].value, null);
});
test('reference means use unique source observations and ignore request filters', async () => {
    const all = await fetch(`${base}/provinces/93?year=2023`).then((r) => r.json());
    const filtered = await fetch(`${base}/map?year=2023&category=sexual&island=papua&risk=low`).then((r) => r.json());
    assert.equal(all.predictions.sexual.reference_count, 3);
    assert.ok(Math.abs(all.predictions.sexual.reference_mean - (5 / 3)) < 1e-12);
    assert.equal(filtered.provinces.length, 4);
});
test('CSV rows follow the selected category and map filters and keep missing values blank', async () => {
    const query = 'year=2024&category=sexual&island=papua&risk=low';
    const map = await fetch(`${base}/map?${query}`).then((r) => r.json());
    const response = await fetch(`${base}/export.csv?${query}`);
    const csv = await response.text();
    assert.equal(response.headers.get('x-data-version'), 'test-v1');
    assert.match(csv, /sexual/);
    assert.match(csv, /Papua/);
    assert.equal(map.provinces.length, 4);
    const csvCodes = csv.replace(/^\uFEFF/, '').trim().split(/\r?\n/).slice(1).map((line) => parseCsv(line)[0]);
    assert.deepEqual(csvCodes, map.provinces.map((province) => province.province_code));
    assert.deepEqual(map.provinces.map((province) => province.province_code), ['91', '93', '94', '95']);
    assert.match(csv, /,,/);
    const parsed = csv.replace(/^\uFEFF/, '').trim().split(/\r?\n/).map(parseCsv);
    const headers = parsed.shift();
    for (const row of parsed) {
        const item = Object.fromEntries(headers.map((key, i) => [key, row[i]]));
        assert.equal(item.year, '2024');
        assert.equal(item.source_year, '2023');
        assert.equal(item.reference_year, '2023');
        assert.equal(item.source_province_code, '91');
        assert.equal(item.predicted_value, '1');
    }
});
test('health is no-store; public responses carry a version and cache policy', async () => {
    const health = await fetch(`${base}/health`);
    assert.equal(health.headers.get('cache-control'), 'no-store');
    const metadata = await fetch(`${base}/metadata`);
    assert.equal((await metadata.json()).data_version, 'test-v1');
    assert.match(metadata.headers.get('cache-control') ?? '', /s-maxage/);
    const allowed = await fetch(`${base}/metadata`, { headers: { Origin: 'http://localhost:3000' } });
    assert.equal(allowed.headers.get('access-control-allow-origin'), 'http://localhost:3000');
    const denied = await fetch(`${base}/metadata`, { headers: { Origin: 'https://not-approved.example' } });
    assert.equal(denied.headers.get('access-control-allow-origin'), null);
});
test('production asset copy includes only the versioned published bundle paths', async () => {
    const scratch = await mkdtemp(join(tmpdir(), 'xai-vercel-assets-'));
    try {
        const api = join(scratch, 'apps', 'api');
        const data = join(scratch, 'data', 'published');
        await mkdir(api, { recursive: true });
        await mkdir(data, { recursive: true });
        await writeFile(join(data, 'manifest.json'), JSON.stringify({ schema_version: 1, data_version: 'asset-v2', predictions_file: 'predictions.asset-v2.json', province_mapping_file: 'mapping.asset-v2.json' }));
        await writeFile(join(data, 'predictions.asset-v2.json'), '{"schema_version":"1.0.0","model_version":"asset-v2"}');
        await writeFile(join(data, 'mapping.asset-v2.json'), '{"schema_version":"1.0.0","data_version":"asset-v2","provinces":[]}');
        await writeFile(join(data, 'model.joblib'), 'must not be deployed');
        await mkdir(join(api, 'scripts'));
        await cp(join(root, 'scripts', 'copy-published-data.mjs'), join(api, 'scripts', 'copy-published-data.mjs'));
        const copy = spawn(process.execPath, [join(api, 'scripts', 'copy-published-data.mjs')], { cwd: scratch, env: { ...process.env, NODE_ENV: 'production' }, stdio: 'pipe' });
        const exit = await new Promise((resolve, reject) => {
            copy.on('error', reject);
            copy.on('exit', resolve);
        });
        assert.equal(exit, 0);
        assert.equal(JSON.parse(await readFile(join(api, 'data', 'published', 'manifest.json'), 'utf8')).data_version, 'asset-v2');
        await assert.rejects(readFile(join(api, 'data', 'published', 'model.joblib')));
    }
    finally {
        await rm(scratch, { recursive: true, force: true });
    }
});
test('rejects a published bundle whose prediction version does not match its manifest', async () => {
    const scratch = await mkdtemp(join(tmpdir(), 'xai-invalid-published-'));
    let invalidServer;
    try {
        await mkdir(scratch, { recursive: true });
        await writeFile(join(scratch, 'manifest.json'), JSON.stringify({ schema_version: 1, data_version: 'expected-v1', predictions_file: 'predictions.json', province_mapping_file: 'mapping.json' }));
        await writeFile(join(scratch, 'predictions.json'), JSON.stringify({ schema_version: '1.0.0', model_version: 'stale-v0', available_years: [2024], predictions: [] }));
        await writeFile(join(scratch, 'mapping.json'), JSON.stringify({ schema_version: '1.0.0', data_version: 'expected-v1', provinces: [], source_by_display_code: {} }));
        const port = 44000 + Math.floor(Math.random() * 10000);
        invalidServer = spawn(process.execPath, [join(root, 'dist', 'src', 'main.js')], { cwd: root, env: { ...process.env, PUBLISHED_DATA_DIR: scratch, PORT: String(port) }, stdio: 'ignore' });
        const invalidBase = `http://127.0.0.1:${port}/api/v1`;
        const deadline = Date.now() + 8000;
        let health;
        while (Date.now() < deadline) {
            try {
                health = await fetch(`${invalidBase}/health`);
                break;
            }
            catch {
                await new Promise((resolve) => setTimeout(resolve, 100));
            }
        }
        assert.equal(health?.status, 200);
        assert.equal((await health.json()).status, 'degraded');
        assert.equal((await fetch(`${invalidBase}/metadata`)).status, 503);
    }
    finally {
        invalidServer?.kill();
        await rm(scratch, { recursive: true, force: true });
    }
});
test('loads the real versioned published bundle from the function package', async () => {
    const bundle = join(root, 'data', 'published');
    const manifest = JSON.parse(await readFile(join(bundle, 'manifest.json'), 'utf8'));
    const data = JSON.parse(await readFile(join(bundle, manifest.predictions_file), 'utf8'));
    const mapping = JSON.parse(await readFile(join(bundle, manifest.province_mapping_file), 'utf8'));
    const port = 44000 + Math.floor(Math.random() * 10000);
    const env = { ...process.env, PORT: String(port), NODE_ENV: 'test' };
    delete env.PUBLISHED_DATA_DIR;
    const publishedServer = spawn(process.execPath, [join(root, 'dist', 'src', 'main.js')], { cwd: root, env, stdio: 'ignore' });
    try {
        const publishedBase = `http://127.0.0.1:${port}/api/v1`;
        const deadline = Date.now() + 10000;
        let health;
        while (Date.now() < deadline) {
            try {
                health = await fetch(`${publishedBase}/health`);
                break;
            }
            catch {
                await new Promise((resolve) => setTimeout(resolve, 100));
            }
        }
        assert.equal(health?.status, 200);
        assert.deepEqual(await health.json(), { status: 'ok', data_version: manifest.data_version });
        const metadata = await fetch(`${publishedBase}/metadata`).then((response) => response.json());
        assert.equal(metadata.data_version, manifest.data_version);
        assert.equal(metadata.model_version, data.model_version);
        const map2023 = await fetch(`${publishedBase}/map?year=2023&category=sexual`).then((response) => response.json());
        assert.equal(map2023.provinces.length, 38);
        const papua = await fetch(`${publishedBase}/provinces/93?year=2023`).then((response) => response.json());
        assert.equal(papua.source_province.code, '91');
        assert.equal(papua.source_explanation, data.papua_display_mapping.display_note);
        const sourcePapua = data.predictions.find((row) => row.province_code === '91' && row.year === 2023);
        assert.deepEqual(papua.predictions.sexual.explanations, sourcePapua.sexual.explanations);
        assert.deepEqual(papua.predictions.sexual.lime_explanations, sourcePapua.sexual.lime_explanations);
        assert.equal(papua.predictions.sexual.lime_fidelity, sourcePapua.sexual.lime_fidelity);
        const sourceRecords = data.predictions.filter((row) => row.year === 2023);
        const expectedValues = new Map(sourceRecords.filter((row) => Number.isFinite(row.sexual.predicted_value)).map((row) => [row.province_code, row.sexual.predicted_value]));
        const expectedMean = [...expectedValues.values()].reduce((sum, value) => sum + value, 0) / expectedValues.size;
        assert.equal(papua.predictions.sexual.reference_count, expectedValues.size);
        assert.ok(Math.abs(papua.predictions.sexual.reference_mean - expectedMean) < 1e-12);
        const map2024 = await fetch(`${publishedBase}/map?year=2024&category=sexual`).then((response) => response.json());
        const historicalPapua = map2024.provinces.filter((province) => ['91', '92', '93', '94', '95', '96'].includes(province.province_code));
        assert.equal(historicalPapua.length, 6);
        assert.ok(historicalPapua.every((province) => province.source_year === 2023 && province.risk.sexual !== 'unavailable'));
        for (const province of historicalPapua) {
            const detail = await fetch(`${publishedBase}/provinces/${province.province_code}?year=2024`).then(r => r.json());
            const source = data.predictions.find(row => row.province_code === mapping.source_by_display_code[province.province_code] && row.year === 2023);
            for (const category of ['sexual', 'nonsexual']) {
                assert.equal(detail.predictions[category].predicted_value, source[category].predicted_value);
                assert.deepEqual(detail.predictions[category].explanations, source[category].explanations);
                assert.deepEqual(detail.predictions[category].lime_explanations, source[category].lime_explanations);
                assert.equal(detail.predictions[category].reference_count, 34);
                assert.equal(detail.predictions[category].reference_year, 2023);
            }
        }
        const java = await fetch(`${publishedBase}/provinces/32?year=2024`).then(r => r.json());
        assert.equal(java.source_year, 2024);
        assert.equal(java.predictions.sexual.reference_count, 32);
        assert.equal(mapping.provinces.length, 38);
        assert.equal(Object.keys(mapping.source_by_display_code).length, 38);
        assert.equal(await (await fetch(`${publishedBase}/map?year=2024`)).text().then((body) => body.includes('"features"')), false);
    }
    finally {
        publishedServer.kill();
    }
});
