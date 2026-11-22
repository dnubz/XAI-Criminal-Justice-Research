import type { FeatureCollection, Geometry } from 'geojson';
export type { Category, Risk, Method, Metadata, ProvinceRisk, SourceProvince, MapProvince, MapResponse, Indicator, CategoryDetail, ProvinceDetail, CsvExportResponse } from '@xai/contracts';
export interface ProvinceProperties {
    KODE_PROV: string;
    PROVINSI: string;
    [key: string]: unknown;
}
export type ProvinceGeometry = FeatureCollection<Geometry, ProvinceProperties>;
