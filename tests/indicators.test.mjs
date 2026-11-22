import test from 'node:test';
import assert from 'node:assert/strict';
import { formatIndicator, formatContribution, topIndicators, resolvedIndicators, predictionReference, compareWithPeers, explainContribution, explainLimeContribution } from '../dist/indicator-utils.mjs';
test('missing indicator values never display an XAI contribution as a measured value', () => {
    for (const value of [null, undefined, '', '1200', NaN, Infinity]) {
        assert.deepEqual(formatIndicator({ value, unit: 'orang', contribution: 2.1 }), {
            available: false, value: 'Belum tersedia', unit: '',
        });
    }
});
test('zero is an available measured value', () => {
    assert.deepEqual(formatIndicator({ value: 0, unit: '%' }), { available: true, value: '0', unit: '%' });
});
test('person counts and rates retain separate units with Indonesian number formatting', () => {
    assert.deepEqual(formatIndicator({ value: 1234567, unit: 'orang' }), { available: true, value: '1.234.567', unit: 'orang' });
    assert.deepEqual(formatIndicator({ value: 7.82, unit: '%' }), { available: true, value: '7,82', unit: '%' });
});
test('indicator ranking uses absolute contribution and does not mutate source data', () => {
    const input = [{ feature: 'A', contribution: .3 }, { feature: 'B', contribution: -2.1 }, { feature: 'C', contribution: 1.5 }, { feature: 'D', contribution: .7 }, { feature: 'Invalid', contribution: null }];
    assert.deepEqual(topIndicators(input).map(f => f.feature), ['B', 'C', 'D']);
    assert.equal(input[0].feature, 'A');
});
test('signed contributions are not presented as percentage-point changes', () => {
    assert.equal(formatContribution(2.1), '+2,1');
    assert.equal(formatContribution(-.16), '−0,16');
    assert.equal(formatContribution(0), '0');
});
test('a positive contribution to the low-risk class does not claim overall risk increased', () => {
    const text = explainContribution(2.1, 'class_output', 'Rendah');
    assert.match(text, /memperkuat prediksi kelas risiko rendah/);
    assert.doesNotMatch(text, /risiko lebih tinggi/);
});
test('risk-score explanations distinguish positive, negative, and neutral local contributions', () => {
    assert.match(explainContribution(2.1, 'risk_score', 'Tinggi'), /skor risiko lebih tinggi/);
    assert.match(explainContribution(-2.1, 'risk_score', 'Tinggi'), /skor risiko lebih rendah/);
    assert.match(explainContribution(0, 'risk_score', 'Tinggi'), /tidak mengubah/);
});
test('small density measurements are displayed with their requested precision', () => {
    assert.equal(formatIndicator({ value: .000083445, precision: 8 }).value, '0,00008345');
});
test('XAI values join to the matching original measurement without converting a missing value to zero', () => {
    const items = resolvedIndicators([{ column: 'IPG', feature: 'IPG', contribution: 2.1, value: null }], [{ column: 'IPG', feature: 'Indeks pembangunan gender', value: 90.39, unit: 'poin', data_year: 2024 }]);
    assert.equal(items[0].value, 90.39);
    assert.equal(items[0].unit, 'poin');
    assert.equal(items[0].contribution, 2.1);
});
test('LIME descriptions refer to a local approximation instead of a SHAP baseline', () => {
    const text = explainLimeContribution(-.3, 'risk_score', 'Tinggi');
    assert.match(text, /LIME/);
    assert.match(text, /lebih rendah/);
    assert.doesNotMatch(text, /nilai acuan/);
});
test('prediction reference uses only finite predictions from the selected year, including zero', () => {
    const rows = [{ year: 2024, sexual: { predicted_value: 0 } }, { year: 2024, sexual: { predicted_value: 6 } }, { year: 2024, sexual: { predicted_value: null } }, { year: 2023, sexual: { predicted_value: 100 } }];
    assert.deepEqual(predictionReference(rows, 2024, 'sexual'), { count: 2, mean: 3 });
    assert.deepEqual(predictionReference(rows, 2025, 'sexual'), { count: 0, mean: null });
});
test('peer comparison excludes self, missing values, other years and ties from strict rankings', () => {
    const row = (code, value, year = 2024) => ({ province_code: code, year, indicators: [{ column: 'IPG', value }] });
    const rows = [row('11', 2), row('12', 1), row('13', 2), row('14', 3), row('15', null), row('16', 100, 2023)];
    assert.equal(compareWithPeers(rows, 2024, '11', { column: 'IPG', value: 2 }), 'Di atas 33% provinsi lain (2024).');
    assert.equal(compareWithPeers([row('11', 0), row('12', 1)], 2024, '11', { column: 'IPG', value: 0 }), 'Di bawah 100% provinsi lain (2024).');
    assert.equal(compareWithPeers([row('11', 2), row('12', 2)], 2024, '11', { column: 'IPG', value: 2 }), 'Sama dengan seluruh provinsi pembanding.');
    assert.match(compareWithPeers([row('11', 2)], 2024, '11', { column: 'IPG', value: 2 }), /Belum ada/);
    assert.match(compareWithPeers(rows, 2024, '11', { column: 'IPG', value: null }), /belum tersedia/);
});
