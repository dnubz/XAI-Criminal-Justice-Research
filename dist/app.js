import { formatIndicator, formatContribution, resolvedIndicators, predictionReference, compareWithPeers } from './indicator-utils.mjs';
const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const LEVELS = {
    low: { label: 'Rendah', color: '#62ac87' },
    moderate: { label: 'Sedang', color: '#e4bd51' },
    high: { label: 'Tinggi', color: '#dc7567' },
    unavailable: { label: 'Belum tersedia', color: '#b8c5c3' },
};
const CATEGORIES = { sexual: 'Kekerasan seksual', nonsexual: 'Kekerasan nonseksual' };
const state = { category: 'sexual', risk: null, island: 'all', selected: '32', query: '', year: null, explanationMethod: 'shap' };
const layers = new Map();
let dataset, geo, map, regions;
const escapeHTML = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
function islandFor(code) {
    const n = Number(code);
    return n < 30 ? 'Sumatera' : n < 40 ? 'Jawa' : n < 60 ? 'Bali & Nusa Tenggara' : n < 70 ? 'Kalimantan' : n < 80 ? 'Sulawesi' : n < 90 ? 'Maluku' : 'Papua';
}
const record = code => dataset.predictions.find(row => row.province_code === String(code) && row.year === state.year);
const prediction = (code, category = state.category) => record(code)?.[category] ?? null;
const level = (code, category = state.category) => prediction(code, category)?.level ?? 'unavailable';
const mapLevel = (code, category = state.category) => record(code)?.boundary_status === 'unverified' ? 'unavailable' : level(code, category);
let fullMapZoom = 2, fullMapBounds;
function badge(value) {
    const item = LEVELS[value] ?? LEVELS.unavailable;
    return `<span class="risk-badge badge-${escapeHTML(value)}"><span class="risk-dot ${escapeHTML(value)}"></span>${item.label}</span>`;
}
function tooltip(feature) {
    const code = feature.properties.KODE_PROV;
    return `<div class="tip-heading">${escapeHTML(feature.properties.PROVINSI)}</div><div class="tip-label">Prediksi ${state.year}${record(code)?.is_training ? ' · Data pelatihan' : ''}</div>${Object.entries(CATEGORIES).map(([key, title]) => `<div class="tip-row"><span>${title.replace('Kekerasan ', '')}</span>${badge(level(code, key))}</div>`).join('')}${record(code)?.boundary_status === 'unverified' ? '<p class="tip-label">Batas wilayah sumber belum dikonfirmasi.</p>' : ''}`;
}
function visible(feature) {
    const code = feature.properties.KODE_PROV;
    return (state.island === 'all' || islandFor(code) === state.island) && (!state.risk || mapLevel(code) === state.risk);
}
function style(feature) {
    const code = feature.properties.KODE_PROV, shown = visible(feature), selected = code === state.selected;
    return { fillColor: shown ? LEVELS[mapLevel(code)].color : '#e0e8e5', fillOpacity: shown ? .97 : .36, color: selected ? '#164b40' : '#f6faf7', weight: selected ? 2.5 : 1.2, opacity: shown ? 1 : .6 };
}
function selectProvince(code, { zoom = false } = {}) {
    state.selected = String(code);
    renderDetail();
    refreshMap();
    if (zoom && map && layers.has(state.selected)) {
        map.fitBounds(layers.get(state.selected).getBounds(), { padding: [75, 75], maxZoom: 7, animate: !matchMedia('(prefers-reduced-motion: reduce)').matches });
    }
    $('#live-status').textContent = `${$('#province-name').textContent} dipilih. ${CATEGORIES[state.category]}: ${LEVELS[level(code)].label}.`;
}
function renderIndicator(item, maxContribution) {
    const raw = formatIndicator(item);
    const hasContribution = Number.isFinite(item.contribution);
    const direction = item.contribution > 0 ? 'increase' : item.contribution < 0 ? 'decrease' : 'neutral';
    const effect = state.explanationMethod === 'lime' ? 'Bobot lokal' : item.contribution > 0 ? 'Menaikkan' : item.contribution < 0 ? 'Menurunkan' : 'Netral';
    const width = maxContribution > 0 ? Math.min(100, Math.abs(item.contribution) / maxContribution * 100) : 0;
    return `<article class="indicator-card ${direction}">
    <h4 title="${escapeHTML(item.description ?? item.feature)}">${escapeHTML(item.feature)}</h4>
    <div class="indicator-reading"><p class="indicator-value ${raw.available ? '' : 'missing-value'}"><strong>${escapeHTML(raw.value)}</strong>${raw.unit ? `<span>${escapeHTML(raw.unit)}</span>` : ''}</p>
    ${hasContribution ? `<div class="contribution-line"><span>${effect}</span><strong>${escapeHTML(formatContribution(item.contribution))}</strong></div>` : ''}</div>
    ${item.qualifier ? `<p class="indicator-qualifier">${escapeHTML(item.qualifier)}</p>` : ''}
    <p class="indicator-peer">${escapeHTML(compareWithPeers(dataset.predictions, state.year, state.selected, item))}</p>
    ${hasContribution ? `<div class="contribution-track" role="img" aria-label="${state.explanationMethod.toUpperCase()}: ${escapeHTML(formatContribution(item.contribution))}. Panjang batang relatif terhadap kontribusi terbesar."><span style="width:${width.toFixed(2)}%"></span></div>` : ''}
  </article>`;
}
function renderComparison(output) {
    const reference = predictionReference(dataset.predictions, state.year, state.category);
    if (!Number.isFinite(output?.predicted_value) || reference.mean === null)
        return '';
    const difference = output.predicted_value - reference.mean;
    const format = value => escapeHTML(formatIndicator({ value }).value);
    return `<div class="comparison-card"><div class="comparison-values"><div><span>Rata-rata ${reference.count} provinsi</span><strong>${format(reference.mean)}</strong></div><span class="comparison-arrow" aria-hidden="true">→</span><div><span>Perkiraan provinsi ini</span><strong>${format(output.predicted_value)}</strong></div></div><p class="comparison-unit">${escapeHTML(dataset.target_unit ?? 'Nilai prediksi')}</p>${Number.isFinite(output.observed_value) ? `<p class="observed-value">Angka tercatat: <strong>${format(output.observed_value)}</strong></p>` : ''}</div><p class="comparison-description">${Math.abs(difference) < .005 ? 'Perkiraan provinsi ini hampir sama dengan rata-rata.' : `Perkiraan provinsi ini <strong>${format(Math.abs(difference))} lebih ${difference > 0 ? 'tinggi' : 'rendah'}</strong> dari rata-rata.`} Rata-rata memakai provinsi yang memiliki data pada ${state.year}.</p>`;
}
function renderDetail() {
    const feature = geo.features.find(f => f.properties.KODE_PROV === state.selected);
    if (!feature)
        return;
    $('#province-name').textContent = feature.properties.PROVINSI;
    const current = record(state.selected);
    $('#province-meta').textContent = islandFor(state.selected) + (current?.is_training ? ' · Data pelatihan' : '') + (current?.boundary_status === 'unverified' ? ' · Batas wilayah sumber belum dikonfirmasi' : '');
    $('#detail-year').textContent = state.year;
    $('#prediction-cards').innerHTML = Object.entries(CATEGORIES).map(([key, title]) => `<div class="prediction-row ${key === state.category ? 'active' : ''}"><span>${title}</span>${badge(level(state.selected, key))}</div>`).join('');
    const output = prediction(state.selected);
    const measurements = (current?.indicators ?? []).filter(item => !dataset.model_feature_columns || dataset.model_feature_columns.includes(item.column));
    const hasShap = Boolean(output?.explanations?.length), hasLime = Boolean(output?.lime_explanations?.length);
    const methodSelect = $('#explanation-method');
    methodSelect.hidden = !hasShap && !hasLime;
    methodSelect.querySelector('[value="shap"]').disabled = !hasShap;
    methodSelect.querySelector('[value="lime"]').disabled = !hasLime;
    if (state.explanationMethod === 'lime' && !hasLime)
        state.explanationMethod = 'shap';
    if (state.explanationMethod === 'shap' && !hasShap && hasLime)
        state.explanationMethod = 'lime';
    methodSelect.value = state.explanationMethod;
    const explanations = state.explanationMethod === 'lime' ? output?.lime_explanations : output?.explanations;
    const items = resolvedIndicators(explanations, measurements);
    const shown = items.length ? items : measurements.slice(0, 3);
    const maxContribution = Math.max(0, ...(explanations ?? []).map(item => Math.abs(item.contribution)).filter(Number.isFinite));
    $('#indicator-heading').textContent = 'Di balik prediksi';
    $('#explanation-subtitle').textContent = items.length ? `${shown.length} faktor terbesar · ${CATEGORIES[state.category].toLowerCase()}${state.explanationMethod === 'lime' && Number.isFinite(output?.lime_fidelity) ? ` · R² lokal ${formatIndicator({ value: output.lime_fidelity }).value}` : ''}` : `Data ${state.year}`;
    $('#prediction-comparison').innerHTML = renderComparison(output);
    $('#explanation-chart').classList.toggle('unranked', !items.length);
    $('#explanation-chart').innerHTML = shown.length
        ? shown.map(item => renderIndicator(item, maxContribution)).join('')
        : '<p class="empty-explanation">Data indikator belum tersedia untuk provinsi dan tahun ini.</p>';
    const keys = new Set(shown.map(item => item.column ?? item.feature));
    const other = measurements.filter(item => !keys.has(item.column ?? item.feature)).map(item => ({ ...item, ...explanations?.find(explanation => explanation.column === item.column) }));
    $('#other-indicators').innerHTML = `${measurements.length && !items.length ? '<p class="xai-status">Kontribusi XAI belum tersedia untuk prediksi ini.</p>' : ''}${other.length ? `<details class="all-indicators"><summary>${other.length} faktor lainnya</summary>${other.map(item => renderIndicator(item, maxContribution)).join('')}</details>` : ''}`;
    $('#explanation-note').textContent = !items.length ? '' : state.explanationMethod === 'lime'
        ? 'LIME memperkirakan hubungan di sekitar kondisi provinsi ini. Bobot +/− adalah koefisien lokal per input yang distandardisasi, bukan tambahan korban terhadap rata-rata. R² lokal menunjukkan kecocokan pendekatan; nilai rendah berarti penjelasan kurang mewakili model.'
        : 'Nilai + menambah dan − mengurangi perkiraan korban per 100.000 penduduk terhadap rata-rata. Seluruh faktor bersama-sama menjelaskan selisihnya; tiga terbesar ditampilkan di atas. Ini menunjukkan kaitan dalam model, bukan sebab akibat.';
    $('#feature-definitions').innerHTML = measurements.length ? `<details class="feature-definitions"><summary>Arti indikator</summary><dl>${measurements.map(item => `<dt>${escapeHTML(item.feature)}</dt><dd>${escapeHTML(item.description ?? item.feature)}</dd>`).join('')}</dl></details>` : '';
}
function refreshMap() {
    if (!regions)
        return;
    regions.setStyle(style);
    layers.forEach((layer, code) => {
        layer.setTooltipContent(tooltip(geo.features.find(f => f.properties.KODE_PROV === code)));
        const element = layer.getElement();
        element.setAttribute('aria-label', `Lihat ${geo.features.find(f => f.properties.KODE_PROV === code).properties.PROVINSI}, risiko ${LEVELS[level(code)].label.toLowerCase()}`);
        element.setAttribute('aria-pressed', String(code === state.selected));
    });
    layers.get(state.selected)?.bringToFront();
}
function renderSummary() {
    const matching = geo.features.filter(f => state.island === 'all' || islandFor(f.properties.KODE_PROV) === state.island);
    for (const key of Object.keys(LEVELS))
        $(`#${key}-count`).textContent = matching.filter(f => mapLevel(f.properties.KODE_PROV) === key).length;
    $$('[data-risk]').forEach(button => {
        const active = button.dataset.risk === state.risk;
        button.classList.toggle('selected', active);
        button.setAttribute('aria-pressed', String(active));
    });
    $('#clear-filters').hidden = !state.risk && state.island === 'all';
    $('#map-category').textContent = CATEGORIES[state.category];
    const displayed = geo.features.filter(visible);
    const mapped = displayed.filter(f => mapLevel(f.properties.KODE_PROV) !== 'unavailable');
    $('#map-context').textContent = `${mapped.length} dari ${displayed.length} provinsi terpetakan`;
}
function filteredFeatures() {
    const query = state.query.trim().toLocaleLowerCase('id');
    return geo.features.filter(f => visible(f) && f.properties.PROVINSI.toLocaleLowerCase('id').includes(query));
}
function update() { renderSummary(); refreshMap(); renderDetail(); }
function renderSearch() {
    const box = $('#search-results');
    if (!state.query.trim()) {
        box.hidden = true;
        return;
    }
    const matches = geo.features.filter(f => f.properties.PROVINSI.toLocaleLowerCase('id').includes(state.query.trim().toLocaleLowerCase('id')));
    box.innerHTML = matches.length ? matches.map(f => `<button data-province="${f.properties.KODE_PROV}"><span>${escapeHTML(f.properties.PROVINSI)}</span><small>${islandFor(f.properties.KODE_PROV)}</small></button>`).join('') : '<p class="search-empty">Provinsi tidak ditemukan.</p>';
    box.hidden = false;
    $$('#search-results button').forEach(button => button.addEventListener('click', () => {
        state.query = '';
        $('#search').value = '';
        box.hidden = true;
        state.risk = null;
        state.island = 'all';
        $('#island').value = 'all';
        selectProvince(button.dataset.province, { zoom: true });
        renderSummary();
    }));
}
function fitRegion() {
    if (!map || $('#map-stage').hidden)
        return;
    const subset = geo.features.filter(f => state.island === 'all' || islandFor(f.properties.KODE_PROV) === state.island);
    map.invalidateSize();
    map.fitBounds(L.geoJSON({ type: 'FeatureCollection', features: subset }).getBounds(), { paddingTopLeft: [20, 80], paddingBottomRight: [20, 48], maxZoom: Math.min(fullMapZoom + 5, 12), animate: false });
}
function updateZoomState() {
    const element = $('#map');
    element.dataset.zoom = map.getZoom().toFixed(3);
    element.dataset.minZoom = map.getMinZoom().toFixed(3);
    element.dataset.maxZoom = map.getMaxZoom().toFixed(3);
    element.dataset.wheelZoom = String(map.scrollWheelZoom.enabled());
    element.dataset.touchZoom = String(map.touchZoom.enabled());
    $('#zoom-out').disabled = map.getZoom() <= map.getMinZoom() + .001;
    $('#zoom-in').disabled = map.getZoom() >= map.getMaxZoom() - .001;
}
function updateZoomLimits() {
    if (!map || !fullMapBounds)
        return;
    map.invalidateSize();
    const size = map.getSize();
    if (!size.x || !size.y)
        return;
    map.setMinZoom(0);
    map.setMaxZoom(12);
    fullMapZoom = map.getBoundsZoom(fullMapBounds, false, L.point(40, 128));
    map.setMinZoom(fullMapZoom);
    map.setMaxZoom(Math.min(fullMapZoom + 5, 12));
    map.setMaxBounds(fullMapBounds.pad(.18));
    fitRegion();
    updateZoomState();
}
function exportCSV() {
    const quote = value => '"' + String(value ?? '').replace(/"/g, '""') + '"';
    const rows = [['province_code', 'province_name', 'prediction_year', 'category', 'risk_level', 'predicted_value', 'observed_value', 'indicator', 'indicator_column', 'indicator_value', 'unit', 'indicator_year', 'source', 'shap_contribution', 'lime_weight', 'explanation_target', 'is_training', 'boundary_status', 'model_version']];
    for (const feature of filteredFeatures()) {
        for (const category of Object.keys(CATEGORIES)) {
            const output = prediction(feature.properties.KODE_PROV, category);
            const current = record(feature.properties.KODE_PROV);
            const indicators = (current?.indicators ?? []).filter(item => !dataset.model_feature_columns || dataset.model_feature_columns.includes(item.column));
            for (const indicator of indicators.length ? indicators : [null]) {
                const match = item => (indicator?.column && item.column === indicator.column) || item.feature === indicator?.feature;
                const shapValue = output?.explanations?.find(match)?.contribution;
                const limeValue = output?.lime_explanations?.find(match)?.contribution;
                rows.push([feature.properties.KODE_PROV, feature.properties.PROVINSI, state.year, category, level(feature.properties.KODE_PROV, category), output?.predicted_value, output?.observed_value, indicator?.feature, indicator?.column, typeof indicator?.value === 'number' && Number.isFinite(indicator.value) ? indicator.value : '', indicator?.unit, indicator?.data_year, indicator?.source, shapValue, limeValue, output?.explanation_target ?? '', current?.is_training, current?.boundary_status ?? (current ? 'matched' : 'missing'), dataset.model_version]);
            }
        }
    }
    const url = URL.createObjectURL(new Blob(['\uFEFF' + rows.map(row => row.map(quote).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `peta-risiko-${dataset.is_demo ? 'ilustrasi-' : ''}${state.year}.csv`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    $('#live-status').textContent = 'Data provinsi dan indikator diunduh sebagai CSV.';
}
function validate(data, geometry) {
    if (!Array.isArray(geometry.features) || !geometry.features.length)
        throw new Error('Batas provinsi tidak valid.');
    if (typeof data.is_demo !== 'boolean' || !Array.isArray(data.predictions))
        throw new Error('Format predictions.json tidak valid.');
    const seen = new Set();
    for (const row of data.predictions) {
        if (!Number.isInteger(row.year) || typeof row.province_code !== 'string')
            throw new Error('Kode provinsi harus string dan tahun harus angka.');
        const key = row.province_code + ':' + row.year;
        if (seen.has(key))
            throw new Error('Ada prediksi ganda untuk provinsi dan tahun.');
        seen.add(key);
        for (const category of Object.keys(CATEGORIES)) {
            const output = row[category];
            if (output != null && !Object.hasOwn(LEVELS, output.level))
                throw new Error('Kelas risiko tidak dikenal.');
            if (output?.explanation_target != null && !['risk_score', 'class_output'].includes(output.explanation_target))
                throw new Error('Target penjelasan XAI tidak dikenal.');
        }
        if (!geometry.features.some(f => f.properties.KODE_PROV === row.province_code))
            throw new Error('Kode prediksi tidak cocok dengan batas provinsi.');
    }
    if (data.explanation_target != null && !['risk_score', 'class_output'].includes(data.explanation_target))
        throw new Error('Target penjelasan XAI tidak dikenal.');
}
async function init() {
    try {
        const responses = await Promise.all([fetch('data/provinces.geojson'), fetch('data/predictions.json')]);
        if (responses.some(response => !response.ok))
            throw new Error('Berkas data gagal dimuat.');
        [geo, dataset] = await Promise.all(responses.map(response => response.json()));
        validate(dataset, geo);
        const years = [...new Set(dataset.predictions.map(row => row.year))].sort((a, b) => b - a);
        if (!years.length)
            throw new Error('Belum ada tahun prediksi tersedia.');
        state.year = years[0];
        $('#year').innerHTML = years.map(year => `<option value="${year}">${year}</option>`).join('');
        $('#coverage-label').textContent = `Indonesia · ${geo.features.length} provinsi`;
        if (!geo.features.some(f => f.properties.KODE_PROV === state.selected))
            state.selected = geo.features[0].properties.KODE_PROV;
        map = L.map('map', { zoomControl: false, scrollWheelZoom: true, touchZoom: true, dragging: true, bounceAtZoomLimits: false, maxBoundsViscosity: 1, wheelPxPerZoomLevel: 120, minZoom: 0, maxZoom: 12, zoomSnap: .1, zoomDelta: .5, attributionControl: true });
        map.attributionControl.setPrefix('<a href="https://leafletjs.com">Leaflet</a>');
        map.attributionControl.addAttribution('<a href="https://github.com/mashadinoor/Indonesia-Geojson-2026">Batas provinsi</a>');
        regions = L.geoJSON(geo, { style, onEachFeature: (feature, layer) => {
                const code = feature.properties.KODE_PROV;
                layers.set(code, layer);
                layer.bindTooltip(tooltip(feature), { sticky: true, direction: 'top', offset: [0, -14] });
                layer.on({
                    mouseover: () => { layers.forEach(other => { if (other !== layer)
                        other.closeTooltip(); }); layer.setStyle({ weight: 2.5, color: '#164b40', fillOpacity: 1 }); layer.bringToFront(); },
                    mouseout: () => { layer.setStyle(style(feature)); layers.get(state.selected)?.bringToFront(); },
                    click: () => { selectProvince(code); layer.closeTooltip(); },
                    add: () => {
                        const element = layer.getElement();
                        element.setAttribute('role', 'button');
                        element.setAttribute('tabindex', '0');
                        element.dataset.province = code;
                        element.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            selectProvince(code);
                        } });
                    },
                });
            } }).addTo(map);
        const islandLabels = L.layerGroup().addTo(map);
        [[[-1, 100.5], 'Sumatera'], [[-8.9, 110], 'Jawa'], [[1.3, 114], 'Kalimantan'], [[-4, 121], 'Sulawesi'], [[-4.3, 128.5], 'Maluku'], [[-6.7, 137], 'Papua'], [[-10.6, 120], 'Nusa Tenggara']].forEach(([position, label]) => {
            L.marker(position, { interactive: false, keyboard: false, icon: L.divIcon({ className: 'island-label', html: label, iconSize: [140, 16], iconAnchor: [70, 8] }) }).addTo(islandLabels);
        });
        fullMapBounds = regions.getBounds();
        updateZoomLimits();
        map.on('zoomstart dragstart resize', () => layers.forEach(layer => layer.closeTooltip()));
        map.on('zoomend', () => {
            if (map.getZoom() <= map.getMinZoom() + .001)
                map.fitBounds(fullMapBounds, { paddingTopLeft: [20, 80], paddingBottomRight: [20, 48], animate: false });
            updateZoomState();
        });
        new ResizeObserver(updateZoomLimits).observe($('#map'));
        $('#zoom-in').addEventListener('click', () => map.zoomIn());
        $('#zoom-out').addEventListener('click', () => map.zoomOut());
        $('#reset-map').addEventListener('click', () => { state.island = 'all'; $('#island').value = 'all'; update(); fitRegion(); });
        $$('[data-category]').forEach(button => button.addEventListener('click', () => {
            state.category = button.dataset.category;
            $$('[data-category]').forEach(item => { item.classList.toggle('selected', item === button); item.setAttribute('aria-pressed', String(item === button)); });
            update();
        }));
        $$('[data-risk]').forEach(button => button.addEventListener('click', () => { state.risk = state.risk === button.dataset.risk ? null : button.dataset.risk; update(); }));
        $('#island').addEventListener('change', event => { state.island = event.target.value; update(); fitRegion(); });
        $('#year').addEventListener('change', event => { state.year = Number(event.target.value); update(); });
        $('#explanation-method').addEventListener('change', event => { state.explanationMethod = event.target.value; renderDetail(); });
        $('#clear-filters').addEventListener('click', () => { state.risk = null; state.island = 'all'; $('#island').value = 'all'; update(); fitRegion(); });
        $('#search').addEventListener('input', event => { state.query = event.target.value; renderSearch(); });
        $('#search').addEventListener('keydown', event => {
            if (event.key === 'Escape')
                $('#search-results').hidden = true;
            if (event.key === 'ArrowDown') {
                event.preventDefault();
                $('#search-results button')?.focus();
            }
            if (event.key === 'Enter')
                $('#search-results button')?.click();
        });
        $('#search-results').addEventListener('keydown', event => {
            const buttons = $$('#search-results button'), index = buttons.indexOf(document.activeElement);
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                event.preventDefault();
                buttons[(index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length]?.focus();
            }
            if (event.key === 'Escape') {
                $('#search-results').hidden = true;
                $('#search').focus();
            }
        });
        document.addEventListener('click', event => { if (!event.target.closest('.search-wrap'))
            $('#search-results').hidden = true; });
        $('#download').addEventListener('click', exportCSV);
        update();
    }
    catch (error) {
        $('#map-error').hidden = false;
        $('#map-error').textContent = `Data belum dapat dimuat. ${error.message} Periksa berkas data dan jalankan situs melalui server HTTP.`;
        $('#live-status').textContent = 'Data gagal dimuat.';
        console.error(error);
    }
}
init();
