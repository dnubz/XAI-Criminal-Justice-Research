import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
const root = resolve(import.meta.dirname, '..');
const apiRoot = resolve(root, 'apps/api');
const require = createRequire(import.meta.url);
const manifest = JSON.parse(await readFile(resolve(root, 'data/published/manifest.json'), 'utf8'));
let server, base;
before(async () => {
    process.chdir(tmpdir());
    delete process.env.PUBLISHED_DATA_DIR;
    process.env.CORS_ORIGINS = 'http://127.0.0.1:5173';
    const handler = require(resolve(apiRoot, 'api/index.js'));
    server = createServer((req, res) => {
        Promise.resolve(handler(req, res)).catch(error => {
            res.statusCode = 500;
            res.end(String(error));
        });
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
    server?.closeAllConnections();
    if (server)
        await new Promise(resolve => server.close(resolve));
    process.chdir(root);
});
test('Vercel entry point serves the current bundle and frontend geometry contract', async () => {
    const health = await fetch(`${base}/api/v1/health`).then(r => r.json());
    assert.deepEqual(health, { status: 'ok', data_version: manifest.data_version });
    const response = await fetch(`${base}/api/v1/metadata`, { headers: { Origin: 'http://127.0.0.1:5173' } });
    assert.equal(response.headers.get('access-control-allow-origin'), 'http://127.0.0.1:5173');
    const metadata = await response.json();
    assert.equal(metadata.data_version, manifest.data_version);
    const geometry = JSON.parse(await readFile(resolve(root, 'apps/web/public', metadata.map_asset.slice(1)), 'utf8'));
    assert.equal(geometry.features.length, 38);
    const map = await fetch(`${base}/api/v1/map?year=2024&category=sexual`).then(r => r.json());
    assert.equal(map.data_version, metadata.data_version);
    assert.deepEqual(new Set(map.provinces.map(p => p.province_code)), new Set(geometry.features.map(f => f.properties.KODE_PROV)));
    assert.equal(map.provinces.filter(p => p.risk.sexual === 'unavailable').length, 0);
});
test('published SHAP values survive the function route and Papua reference uses 34 sources', async () => {
    const response = await fetch(`${base}/api/v1/provinces/93?year=2023`);
    assert.equal(response.status, 200);
    const detail = await response.json();
    assert.equal(detail.source_province.code, '91');
    for (const category of ['sexual', 'nonsexual']) {
        const output = detail.predictions[category];
        assert.equal(output.reference_count, 34);
        assert.equal(output.explanations.length, 23);
        assert.equal(output.lime_explanations.length, 23);
        const sum = output.shap_base_value + output.explanations.reduce((total, item) => total + item.contribution, 0);
        assert.ok(Math.abs(sum - output.predicted_value) < 1e-7);
    }
    const fallback = await fetch(`${base}/api/v1/provinces/93?year=2024`).then(r => r.json());
    assert.equal(fallback.year, 2024);
    assert.equal(fallback.source_year, 2023);
    assert.deepEqual(fallback.predictions, detail.predictions);
    assert.deepEqual(fallback.indicators, detail.indicators);
    assert.equal(fallback.predictions.sexual.reference_year, 2023);
});
test('CSV and map agree on filters through the function entry point', async () => {
    const query = 'year=2024&category=sexual&island=java&risk=low';
    const map = await fetch(`${base}/api/v1/map?${query}`).then(r => r.json());
    const response = await fetch(`${base}/api/v1/export.csv?${query}`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('x-data-version'), manifest.data_version);
    const csv = await response.text();
    assert.equal(csv.trim().split(/\r?\n/).length - 1, map.provinces.length);
    assert.ok(Buffer.byteLength(csv) < 4500000);
});
