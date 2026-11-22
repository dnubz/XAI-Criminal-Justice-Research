import { useCallback, useEffect, useMemo, useState } from 'react';
import { Activity, ChevronDown, Download, Info, MapPin, Search, ShieldAlert, X } from 'lucide-react';
import { getCsv, getGeometry, getMap, getMetadata, getProvince } from './api';
import { MapView } from './MapView';
import type { Category, Indicator, MapProvince, Metadata, Method, ProvinceDetail, ProvinceGeometry, Risk } from './types';
const categories: {
    id: Category;
    label: string;
}[] = [
    { id: 'sexual', label: 'Kekerasan seksual' },
    { id: 'nonsexual', label: 'Kekerasan nonseksual' },
];
const risks: Risk[] = ['low', 'moderate', 'high', 'unavailable'];
const riskNames: Record<Risk, string> = { low: 'Rendah', moderate: 'Sedang', high: 'Tinggi', unavailable: 'Belum tersedia' };
const displayNumber = (value: number | null | undefined, digits = 2) => Number.isFinite(value) ? new Intl.NumberFormat('id-ID', { maximumFractionDigits: digits, minimumFractionDigits: 0 }).format(value!) : '—';
const formatValue = (item: Indicator) => item.value == null ? 'Data tidak tersedia' : displayNumber(item.value, 4);
export default function App() {
    const [metadata, setMetadata] = useState<Metadata | null>(null);
    const [geometry, setGeometry] = useState<ProvinceGeometry | null>(null);
    const [mapData, setMapData] = useState<MapProvince[]>([]);
    const [detail, setDetail] = useState<ProvinceDetail | null>(null);
    const [year, setYear] = useState<number | null>(null);
    const [category, setCategory] = useState<Category>('sexual');
    const [method, setMethod] = useState<Method>('shap');
    const [selected, setSelected] = useState('32');
    const [island, setIsland] = useState('all');
    const [riskFilter, setRiskFilter] = useState<Risk | null>(null);
    const [query, setQuery] = useState('');
    const [showSuggestions, setShowSuggestions] = useState(false);
    const [bootLoading, setBootLoading] = useState(true);
    const [mapLoading, setMapLoading] = useState(false);
    const [detailLoading, setDetailLoading] = useState(false);
    const [bootError, setBootError] = useState<string | null>(null);
    const [mapError, setMapError] = useState<string | null>(null);
    const [detailError, setDetailError] = useState<string | null>(null);
    const [exportError, setExportError] = useState<string | null>(null);
    const error = bootError ?? mapError ?? detailError;
    useEffect(() => {
        let current = true;
        getMetadata().then(async (meta) => [meta, await getGeometry(meta.map_asset)] as const).then(([meta, geo]) => {
            if (!current)
                return;
            setMetadata(meta);
            setGeometry(geo);
            setYear(meta.years.length ? Math.max(...meta.years) : null);
            if (geo.features.length !== 38)
                throw new Error('Aset batas harus berisi 38 provinsi.');
        }).catch(reason => current && setBootError(errorMessage(reason))).finally(() => current && setBootLoading(false));
        return () => { current = false; };
    }, []);
    useEffect(() => {
        if (year == null || !geometry)
            return;
        let current = true;
        setMapLoading(true);
        setMapError(null);
        getMap(year, category, geometry).then(data => { if (current) {
            setMapData(data.provinces);
            setMapError(null);
        } })
            .catch(reason => { if (current)
            setMapError(`Peta gagal dimuat. ${errorMessage(reason)}`); })
            .finally(() => current && setMapLoading(false));
        return () => { current = false; };
    }, [year, category, geometry]);
    useEffect(() => {
        if (year == null || !geometry)
            return;
        let current = true;
        setDetailLoading(true);
        setDetailError(null);
        getProvince(selected, year, geometry).then(data => { if (current) {
            setDetail(data);
            setDetailError(null);
        } })
            .catch(reason => { if (current) {
            setDetail(null);
            setDetailError(`Detail provinsi gagal dimuat. ${errorMessage(reason)}`);
        } })
            .finally(() => current && setDetailLoading(false));
        return () => { current = false; };
    }, [selected, year, geometry]);
    const filteredMap = useMemo(() => mapData.filter(row => (island === 'all' || row.island === island) && (!riskFilter || row.risk[category] === riskFilter)), [mapData, island, riskFilter, category]);
    const counts = useMemo(() => risks.reduce((acc, risk) => {
        acc[risk] = mapData.filter(row => island === 'all' || row.island === island).filter(row => row.risk[category] === risk).length;
        return acc;
    }, {} as Record<Risk, number>), [mapData, island, category]);
    const suggestions = useMemo(() => {
        const needle = query.trim().toLocaleLowerCase('id');
        if (!needle || !mapData.length)
            return [];
        return mapData.filter(row => row.province_name.toLocaleLowerCase('id').includes(needle)).slice(0, 8);
    }, [query, mapData]);
    const chooseProvince = useCallback((code: string) => {
        setSelected(code);
        setQuery('');
        setShowSuggestions(false);
    }, []);
    async function downloadCsv() {
        if (year == null)
            return;
        setExportError(null);
        try {
            if (!geometry)
                throw new Error('Batas provinsi belum tersedia.');
            const blob = await getCsv(year, category, island, riskFilter, geometry);
            const anchor = document.createElement('a');
            anchor.href = URL.createObjectURL(blob);
            anchor.download = `peta-risiko-${year}-${category}.csv`;
            anchor.click();
            setTimeout(() => URL.revokeObjectURL(anchor.href), 1000);
        }
        catch (reason) {
            setExportError(errorMessage(reason));
        }
    }
    const clearFilters = () => { setIsland('all'); setRiskFilter(null); };
    const feature = detail?.predictions[category];
    const explanationItems = method === 'shap' ? feature?.explanations ?? [] : feature?.lime_explanations ?? [];
    const ranked = [...explanationItems].filter(item => item.contribution != null).sort((a, b) => Math.abs(b.contribution ?? 0) - Math.abs(a.contribution ?? 0));
    const topFactors = ranked.slice(0, 3);
    const maxContribution = Math.max(0, ...ranked.map(item => Math.abs(item.contribution ?? 0)));
    const remaining = (detail?.indicators ?? []).filter(item => !topFactors.some(top => top.column === item.column)).map(item => ({ ...item, contribution: explanationItems.find(x => x.column === item.column)?.contribution ?? null }));
    return <div className="app-shell">
    <header className="topbar">
      <a className="brand" href="#main" aria-label="RuangAman, ke halaman utama">
        <img className="brand-logo" src="/brand/ruangaman-mark.png" alt="" width="64" height="64" />
        <span><strong>RuangAman</strong><small>Mengurai faktor di balik angka kekerasan</small></span>
      </a>
      <button className="download-button" onClick={downloadCsv} disabled={year == null || bootLoading}>
        <Download size={17} aria-hidden="true"/><span>Unduh data</span>
      </button>
    </header>

    <main id="main">
      {error && <div className="global-error" role="alert"><ShieldAlert size={18}/><span>{error}</span><button onClick={() => location.reload()} aria-label="Coba lagi"><Activity size={16}/> Muat ulang</button></div>}
      {exportError && <div className="export-error" role="alert">Unduhan gagal: {exportError} <button onClick={() => setExportError(null)} aria-label="Tutup pesan"><X size={14}/></button></div>}
      <section className="workspace" aria-label="Peta dan detail provinsi">
        <div className="map-card">
          <div className="toolbar">
            <div className="category-tabs" role="group" aria-label="Kategori kekerasan">
              {categories.map(item => <button key={item.id} className={category === item.id ? 'active' : ''} aria-pressed={category === item.id} onClick={() => setCategory(item.id)}>{item.id === 'sexual' ? 'Seksual' : 'Nonseksual'}</button>)}
            </div>
            <div className="search-area">
              <Search size={17} aria-hidden="true"/>
              <input aria-label="Cari provinsi" placeholder="Cari provinsi" value={query} onChange={event => { setQuery(event.target.value); setShowSuggestions(true); }} onFocus={() => setShowSuggestions(true)} onKeyDown={event => {
            if (event.key === 'Escape')
                setShowSuggestions(false);
            if (event.key === 'Enter' && suggestions.length) {
                event.preventDefault();
                chooseProvince(suggestions[0].province_code);
            }
        }}/>
              {showSuggestions && query && <div className="suggestions" role="listbox" aria-label="Hasil pencarian provinsi">
                {suggestions.length ? suggestions.map(item => <button key={item.province_code} role="option" aria-selected={item.province_code === selected} onMouseDown={event => event.preventDefault()} onClick={() => chooseProvince(item.province_code)}><span>{item.province_name}</span><small>{item.island}</small></button>) : <p>Tidak ada provinsi yang cocok.</p>}
              </div>}
            </div>
            <label className="select-wrap"><span className="sr-only">Filter pulau</span><select value={island} onChange={event => setIsland(event.target.value)} aria-label="Pilih pulau">
              <option value="all">Semua pulau</option>{(metadata?.islands ?? []).map(item => <option key={item} value={item}>{item}</option>)}
            </select><ChevronDown size={15} aria-hidden="true"/></label>
            <label className="year-wrap"><span>Tahun</span><span className="select-wrap"><select value={year ?? ''} onChange={event => setYear(Number(event.target.value))} aria-label="Pilih tahun" disabled={!metadata}>{[...(metadata?.years ?? [])].sort((a, b) => b - a).map(item => <option key={item} value={item}>{item}</option>)}</select><ChevronDown size={15} aria-hidden="true"/></span></label>
          </div>

          <div className="map-canvas">
            <div className="map-caption"><strong>{categories.find(item => item.id === category)?.label}</strong><span>{filteredMap.filter(row => row.risk[category] !== 'unavailable').length} dari {filteredMap.length} provinsi terpetakan</span></div>
            {geometry ? <MapView geometry={geometry} provinces={mapData} selected={selected} activeCategory={category} island={island} riskFilter={riskFilter} onSelect={chooseProvince}/> : <MapPlaceholder label={bootLoading ? 'Memuat peta dan batas provinsi…' : 'Peta belum dapat dimuat.'}/>}
            <div className="map-loading" aria-live="polite" hidden={!mapLoading}><span className="spinner"/> Memuat data peta…</div>
            <div className="map-hint"><MapPin size={14}/> Pilih provinsi pada peta untuk melihat detail</div>
          </div>
          <div className="map-legend"><span className="legend-heading">Tingkat risiko</span>{risks.map(risk => <button key={risk} className={`legend-item ${riskFilter === risk ? 'selected' : ''}`} onClick={() => setRiskFilter(current => current === risk ? null : risk)} aria-pressed={riskFilter === risk}><i className={`risk-dot ${risk}`}/><span>{riskNames[risk]}</span><small>{counts[risk] ?? 0}</small></button>)}{(island !== 'all' || riskFilter) && <button className="clear-button" onClick={clearFilters}>Hapus filter</button>}</div>
        </div>

        <aside className="detail-card" aria-label="Detail provinsi" aria-busy={detailLoading}>
          <div className="detail-kicker"><span>Detail provinsi</span>{detailLoading ? <span className="detail-loading"><i className="spinner"/> Memuat detail…</span> : <MapPin size={16} aria-hidden="true"/>}</div>
          {detailLoading && !detail ? <div className="skeleton" aria-label="Memuat detail provinsi"><i /><i /><i /></div> : detail ? <>
            <h1>{detail.province_name}</h1>
            <p className="province-meta">{mapData.find(row => row.province_code === selected)?.island ?? 'Indonesia'}{detail.is_training ? ' · Data pelatihan' : ''}</p>
            {detail.source_province && <div className="source-note"><Info size={16}/><span>Data historis dari <strong>{detail.source_province.name}</strong> (kode {detail.source_province.code}). {detail.source_explanation}</span></div>}
            {detail.boundary_status === 'missing' && <div className="missing-note" role="status"><Info size={17}/><span>{detail.source_explanation ?? `Data prediksi untuk ${detail.province_name} pada ${year} belum tersedia.`}</span></div>}
            <section className="risk-section" aria-labelledby="risk-heading"><div className="section-title"><h2 id="risk-heading">Prediksi risiko</h2><span className="year-badge">{year}</span></div>
              {categories.map(item => <button key={item.id} className={`risk-row ${category === item.id ? 'current' : ''}`} onClick={() => setCategory(item.id)}><span>{item.label}</span><RiskBadge level={detail.risk[item.id]}/></button>)}
            </section>
            <section className="xai-section" aria-labelledby="xai-heading">
              <div className="xai-title"><div><h2 id="xai-heading">Di balik prediksi</h2><p>{topFactors.length ? `3 faktor terbesar · ${categories.find(item => item.id === category)?.label.toLocaleLowerCase('id')}` : 'Penjelasan belum tersedia'}</p></div>
                <label className="method-select"><span className="sr-only">Metode penjelasan</span><select value={method} onChange={event => setMethod(event.target.value as Method)} disabled={!feature || (!feature.explanations.length && !feature.lime_explanations.length)}><option value="shap">SHAP</option><option value="lime">LIME</option></select><ChevronDown size={14} aria-hidden="true"/></label>
              </div>
              {feature ? <>
                <Comparison predicted={feature.predicted_value} observed={feature.observed_value} mean={feature.reference_mean} count={feature.reference_count} unit={metadata?.target_unit ?? 'Korban per 100.000 penduduk'} year={year!}/>
                {topFactors.length ? <div className="factor-list">{topFactors.map(item => <Factor key={item.column} item={item} method={method} max={maxContribution}/>)}</div> : <div className="empty-state">Belum ada penjelasan faktor untuk kategori dan tahun ini.</div>}
                {method === 'lime' && Number.isFinite(feature.lime_fidelity) && <p className="fidelity">Kecocokan LIME (R² lokal): <strong>{displayNumber(feature.lime_fidelity, 3)}</strong></p>}
                <p className="method-note">{method === 'shap' ? 'Nilai SHAP menunjukkan kontribusi model terhadap selisih dari rata-rata tahun yang sama. Ini bukan hubungan sebab-akibat.' : 'LIME memperkirakan model di sekitar kondisi provinsi ini. Bobot lokal bukan perubahan jumlah korban. R² menunjukkan kecocokan penjelasan dengan model.'}</p>
                {remaining.length > 0 && <details className="other-factors"><summary>{remaining.length} faktor lainnya</summary><div className="factor-list">{remaining.map(item => <Factor key={item.column} item={item} method={method} max={maxContribution}/>)}</div></details>}
              </> : <div className="empty-state">{detail.boundary_status === 'missing' ? 'Prediksi dan penjelasan tidak tersedia.' : 'Data prediksi untuk tahun ini belum tersedia.'}</div>}
            </section>
          </> : <div className="empty-state">Pilih provinsi pada peta untuk melihat informasinya.</div>}
        </aside>
      </section>
    </main>
    <div className="sr-only" role="status" aria-live="polite">{mapLoading ? 'Memuat peta' : detailLoading ? 'Memuat detail provinsi' : ''}</div>
  </div>;
}
function RiskBadge({ level }: {
    level: Risk;
}) { return <span className={`risk-badge ${level}`}><i className={`risk-dot ${level}`}/>{riskNames[level]}</span>; }
function Comparison({ predicted, observed, mean, count, unit, year }: {
    predicted: number | null;
    observed: number | null;
    mean: number | null;
    count: number;
    unit: string;
    year: number;
}) {
    if (predicted == null || mean == null)
        return <div className="empty-state">Perbandingan prediksi belum tersedia.</div>;
    const difference = predicted - mean;
    return <><div className="comparison-card"><div className="comparison-values"><div><span>Rata-rata {count} provinsi</span><strong>{displayNumber(mean)}</strong></div><span className="arrow" aria-hidden="true">→</span><div><span>Perkiraan provinsi ini</span><strong>{displayNumber(predicted)}</strong></div></div><p className="comparison-unit">{unit}</p>{observed != null && <p className="observed">Angka tercatat: <strong>{displayNumber(observed)}</strong></p>}</div><p className="comparison-caption">Perkiraan provinsi ini {Math.abs(difference) < 0.005 ? 'hampir sama' : <><strong>{displayNumber(Math.abs(difference))} lebih {difference > 0 ? 'tinggi' : 'rendah'}</strong></>} dari rata-rata. Rata-rata menggunakan data yang tersedia pada {year}.</p></>;
}
function Factor({ item, method, max }: {
    item: Indicator;
    method: Method;
    max: number;
}) {
    const amount = item.contribution ?? 0;
    const percentage = max ? Math.min(100, Math.abs(amount) / max * 100) : 0;
    const positive = amount > 0;
    return <article className={`factor ${positive ? 'up' : 'down'}`}>
    <h3 title={item.description}>{item.feature}</h3>
    <div className="factor-value"><strong>{formatValue(item)}</strong>{item.unit && <span>{item.unit}</span>}{item.value == null && <span className="missing-label">Nilai kosong</span>}<span className="factor-contribution">{method === 'lime' ? 'Bobot lokal' : positive ? 'Menaikkan' : 'Menurunkan'} <b>{item.contribution == null ? '—' : displayNumber(amount, 3)}</b></span></div>
    {item.qualifier && <p className="qualifier">{item.qualifier}</p>}
    <div className="factor-track" role="img" aria-label={`Besaran kontribusi ${displayNumber(Math.abs(amount), 3)} dibanding faktor terbesar`}><span style={{ width: `${percentage}%` }}/></div>
  </article>;
}
function MapPlaceholder({ label }: {
    label: string;
}) { return <div className="map-placeholder"><span className="spinner"/>{label}</div>; }
function errorMessage(reason: unknown) { return reason instanceof Error ? reason.message : 'Terjadi kesalahan yang tidak diketahui.'; }
