export const CATEGORIES = ['sexual', 'nonsexual'] as const;
export type Category = (typeof CATEGORIES)[number];
export const ISLANDS = ['sumatera', 'java', 'bali-nusa-tenggara', 'kalimantan', 'sulawesi', 'maluku', 'papua'] as const;
export type Island = (typeof ISLANDS)[number];
export const RISKS = ['low', 'moderate', 'high', 'unavailable'] as const;
export type Risk = (typeof RISKS)[number];
export type Method = 'shap' | 'lime';
export interface Metadata {
    data_version: string;
    years: number[];
    categories: {
        id: Category;
        label: string;
    }[];
    islands: string[];
    risk_labels: Record<Risk, string>;
    target_unit: string;
    map_asset: string;
    model_version?: string;
}
export interface ProvinceRisk {
    level: Risk;
    predicted_value: number | null;
    observed_value: number | null;
}
export interface SourceProvince {
    code: string;
    name: string;
}
export interface MapProvince {
    province_code: string;
    province_name: string;
    island: string;
    risk: Record<Category, Risk>;
    boundary_status: 'matched' | 'mapped' | 'missing';
    source_province?: SourceProvince | null;
    source_explanation?: string | null;
    is_training?: boolean;
}
export interface MapResponse {
    data_version: string;
    year: number;
    category: Category;
    provinces: MapProvince[];
}
export interface Indicator {
    column: string;
    feature: string;
    value: number | null;
    raw_value?: number | null;
    precision?: number;
    unit: string | null;
    data_year?: number | null;
    source: string | null;
    description?: string;
    qualifier?: string;
    contribution?: number | null;
}
export interface CategoryDetail {
    level: Risk | null;
    predicted_value: number | null;
    observed_value: number | null;
    explanations: Indicator[];
    lime_explanations: Indicator[];
    lime_fidelity: number | null;
    shap_base_value?: number | null;
    reference_mean: number | null;
    reference_count: number;
}
export interface ProvinceDetail {
    data_version: string;
    province_code: string;
    province_name: string;
    year: number;
    is_training: boolean;
    boundary_status: 'matched' | 'mapped' | 'missing';
    source_province?: SourceProvince | null;
    source_explanation?: string | null;
    risk: Record<Category, Risk>;
    predictions: Record<Category, CategoryDetail | null>;
    indicators: Indicator[];
}
export interface CsvExportResponse {
    href: string;
}
