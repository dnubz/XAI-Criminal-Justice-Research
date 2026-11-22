import { useEffect, useMemo, useRef } from 'react';
import { AttributionControl, GeoJSON, MapContainer, Marker, ZoomControl, useMap } from 'react-leaflet';
import L, { type Layer, type PathOptions } from 'leaflet';
import type { MapProvince, ProvinceGeometry, Risk } from './types';
const fills: Record<Risk, string> = { low: '#64ad8a', moderate: '#e7bd4f', high: '#dc7568', unavailable: '#bbc7c3' };
const idFor = (code: string) => code.padStart(2, '0');
const islandLabels: [
    L.LatLngExpression,
    string
][] = [
    [[-1, 100.5], 'Sumatera'], [[-8.5, 110.2], 'Jawa'], [[1.5, 114], 'Kalimantan'],
    [[-4.2, 121], 'Sulawesi'], [[-4.5, 128.2], 'Maluku'], [[-6.4, 137], 'Papua'],
    [[-10.1, 120.6], 'Nusa Tenggara'],
];
function BoundsController({ geometry, provinces, island }: {
    geometry: ProvinceGeometry;
    provinces: MapProvince[];
    island: string;
}) {
    const map = useMap();
    useEffect(() => {
        const islandByCode = new Map(provinces.map(item => [idFor(item.province_code), item.island]));
        const bounds = L.geoJSON(geometry, { filter: feature => island === 'all' || islandByCode.get(idFor(String(feature.properties?.KODE_PROV ?? ''))) === island }).getBounds();
        if (bounds.isValid())
            map.fitBounds(bounds, { padding: [24, 24], maxZoom: 5, animate: false });
    }, [geometry, island, map, provinces]);
    useEffect(() => { map.invalidateSize(); }, [map]);
    return null;
}
export function MapView({ geometry, provinces, selected, activeCategory, island, riskFilter, onSelect }: {
    geometry: ProvinceGeometry;
    provinces: MapProvince[];
    selected: string;
    activeCategory: 'sexual' | 'nonsexual';
    island: string;
    riskFilter: Risk | null;
    onSelect: (code: string) => void;
}) {
    const lookup = useMemo(() => new Map(provinces.map(province => [idFor(province.province_code), province])), [provinces]);
    const geoLayer = useRef<L.GeoJSON>(null);
    useEffect(() => {
        geoLayer.current?.eachLayer(layer => {
            const path = layer as L.Path;
            const props = (layer as L.Layer & {
                feature?: {
                    properties?: Record<string, unknown>;
                };
            }).feature?.properties;
            if (!props)
                return;
            const code = idFor(String(props.KODE_PROV ?? ''));
            const entry = lookup.get(code);
            const element = path.getElement() as SVGPathElement | null;
            element?.setAttribute('aria-pressed', String(code === selected));
            element?.setAttribute('aria-label', `${String(props.PROVINSI ?? entry?.province_name ?? code)}, ${riskLabel(entry?.risk[activeCategory] ?? 'unavailable')}`);
            const tip = document.createElement('div');
            const title = document.createElement('strong');
            title.textContent = String(props.PROVINSI ?? entry?.province_name ?? code);
            const riskText = document.createElement('div');
            riskText.textContent = `Risiko: ${riskLabel(entry?.risk[activeCategory] ?? 'unavailable')}`;
            tip.append(title, riskText);
            if (entry?.source_explanation) {
                const note = document.createElement('div');
                note.textContent = entry.source_explanation;
                tip.append(note);
            }
            path.setTooltipContent(tip);
        });
    }, [activeCategory, lookup, provinces, selected]);
    return <MapContainer center={[-2.4, 117.5]} zoom={4} minZoom={3} maxZoom={9} scrollWheelZoom zoomControl={false} attributionControl={false} className="leaflet-map" aria-label="Peta interaktif risiko kekerasan per provinsi">
    <ZoomControl position="topright"/>
    <AttributionControl position="bottomright" prefix="<a href='https://leafletjs.com'>Leaflet</a>"/>
    <GeoJSON ref={geoLayer} data={geometry} attribution="<a href='https://github.com/mashadinoor/Indonesia-Geojson-2026'>Batas provinsi</a>" style={feature => {
            const code = idFor(String(feature?.properties.KODE_PROV ?? ''));
            const entry = lookup.get(code);
            const hidden = (island !== 'all' && island !== entry?.island) || Boolean(riskFilter && entry?.risk[activeCategory] !== riskFilter);
            const selectedFeature = code === selected;
            return { fillColor: fills[entry?.risk[activeCategory] ?? 'unavailable'], fillOpacity: hidden ? 0.13 : entry?.risk[activeCategory] === 'unavailable' ? 0.55 : 0.94, color: selectedFeature ? '#174b3f' : '#ffffff', weight: selectedFeature ? 2.8 : 1.25, opacity: 1 } as PathOptions;
        }} onEachFeature={(feature, layer: Layer) => {
            const code = idFor(String(feature.properties.KODE_PROV));
            const name = String(feature.properties.PROVINSI);
            const entry = lookup.get(code);
            const path = layer as L.Path;
            const tip = document.createElement('div');
            const title = document.createElement('strong');
            title.textContent = name;
            const riskText = document.createElement('div');
            riskText.textContent = `Risiko: ${riskLabel(entry?.risk[activeCategory] ?? 'unavailable')}`;
            tip.append(title, riskText);
            if (entry?.source_explanation) {
                const note = document.createElement('div');
                note.textContent = entry.source_explanation;
                tip.append(note);
            }
            path.bindTooltip(tip, { sticky: true, className: 'map-tooltip' });
            path.on('add', () => {
                const element = path.getElement();
                if (!element)
                    return;
                element.setAttribute('role', 'button');
                element.setAttribute('tabindex', '0');
                element.setAttribute('aria-label', `${name}, ${riskLabel(entry?.risk[activeCategory] ?? 'unavailable')}`);
                element.setAttribute('aria-pressed', String(code === selected));
                (element as SVGPathElement).dataset.province = code;
                element.addEventListener('keydown', event => {
                    if ((event as KeyboardEvent).key === 'Enter' || (event as KeyboardEvent).key === ' ') {
                        event.preventDefault();
                        onSelect(code);
                    }
                });
                path.on('click', () => onSelect(code));
            });
        }}/>
    {islandLabels.map(([position, label]) => <Marker key={label} position={position} interactive={false} keyboard={false} icon={L.divIcon({ className: 'island-label', html: label, iconSize: [140, 16], iconAnchor: [70, 8] })}/>)}
    <BoundsController geometry={geometry} provinces={provinces} island={island}/>
  </MapContainer>;
}
function riskLabel(risk: Risk) { return ({ low: 'Rendah', moderate: 'Sedang', high: 'Tinggi', unavailable: 'Belum tersedia' })[risk]; }
