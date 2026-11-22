const numberFormat = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 2 });
export function formatIndicator(indicator) {
    if (typeof indicator.value !== 'number' || !Number.isFinite(indicator.value)) {
        return { available: false, value: 'Belum tersedia', unit: '' };
    }
    return {
        available: true,
        value: new Intl.NumberFormat('id-ID', { maximumFractionDigits: Number.isInteger(indicator.precision) ? Math.max(0, Math.min(8, indicator.precision)) : 2 }).format(indicator.value),
        unit: typeof indicator.unit === 'string' ? indicator.unit : '',
    };
}
export function resolvedIndicators(explanations, measurements = []) {
    return topIndicators(explanations).map(item => {
        const measured = measurements.find(value => (item.column && value.column === item.column) || value.feature === item.feature);
        if (!measured)
            return item;
        return { ...measured, ...item, value: Number.isFinite(item.value) ? item.value : measured.value, unit: item.unit ?? measured.unit, data_year: item.data_year ?? measured.data_year, source: item.source ?? measured.source };
    });
}
export function formatContribution(contribution) {
    const digits = Math.abs(contribution) > 0 && Math.abs(contribution) < .01 ? 4 : 2;
    const options = Math.abs(contribution) > 0 && Math.abs(contribution) < .0001 ? { maximumSignificantDigits: 2 } : { maximumFractionDigits: digits };
    return `${contribution > 0 ? '+' : contribution < 0 ? '−' : ''}${new Intl.NumberFormat('id-ID', options).format(Math.abs(contribution))}`;
}
export function predictionReference(rows, year, category) {
    const values = rows.filter(row => row.year === year).map(row => row[category]?.predicted_value).filter(Number.isFinite);
    return { count: values.length, mean: values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null };
}
export function compareWithPeers(rows, year, provinceCode, indicator) {
    if (!Number.isFinite(indicator.value))
        return 'Nilai indikator belum tersedia.';
    const peers = rows.filter(row => row.year === year && row.province_code !== provinceCode)
        .map(row => row.indicators?.find(item => item.column === indicator.column)?.value).filter(Number.isFinite);
    if (!peers.length)
        return 'Belum ada provinsi pembanding pada tahun ini.';
    const lower = peers.filter(value => value < indicator.value).length;
    const higher = peers.filter(value => value > indicator.value).length;
    if (!lower && !higher)
        return 'Sama dengan seluruh provinsi pembanding.';
    const direction = lower >= higher ? 'atas' : 'bawah';
    const percentage = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 0 }).format(100 * Math.max(lower, higher) / peers.length);
    return `Di ${direction} ${percentage}% provinsi lain (${year}).`;
}
export function explainLimeContribution(contribution, target, classLabel) {
    if (contribution === 0)
        return 'Pendekatan lokal LIME tidak menunjukkan pengaruh dari indikator ini.';
    if (target !== 'risk_score')
        return contribution > 0 ? `Dalam pendekatan lokal LIME, kenaikan indikator ini mendukung kelas risiko ${classLabel.toLowerCase()}.` : `Dalam pendekatan lokal LIME, kenaikan indikator ini mengurangi dukungan pada kelas risiko ${classLabel.toLowerCase()}.`;
    return contribution > 0
        ? 'Di sekitar kondisi provinsi ini, LIME mengaitkan kenaikan indikator ini dengan prediksi risiko yang lebih tinggi.'
        : 'Di sekitar kondisi provinsi ini, LIME mengaitkan kenaikan indikator ini dengan prediksi risiko yang lebih rendah.';
}
export function topIndicators(explanations) {
    return (Array.isArray(explanations) ? explanations : [])
        .filter(item => typeof item.feature === 'string' && Number.isFinite(item.contribution))
        .slice()
        .sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution))
        .slice(0, 3);
}
export function explainContribution(contribution, target, classLabel) {
    if (contribution === 0)
        return 'Indikator ini tidak mengubah keluaran model dibanding nilai acuan.';
    if (target === 'risk_score') {
        return contribution > 0
            ? 'Nilai indikator di provinsi ini mendorong skor risiko lebih tinggi dibanding nilai acuan model.'
            : 'Nilai indikator di provinsi ini mendorong skor risiko lebih rendah dibanding nilai acuan model.';
    }
    if (classLabel === 'Belum tersedia')
        return 'Kontribusi ini menjelaskan keluaran model; kelas prediksinya belum tersedia.';
    return contribution > 0
        ? `Nilai indikator di provinsi ini memperkuat prediksi kelas risiko ${classLabel.toLowerCase()} dibanding nilai acuan model.`
        : `Nilai indikator di provinsi ini mengurangi dukungan model pada kelas risiko ${classLabel.toLowerCase()} dibanding nilai acuan model.`;
}
