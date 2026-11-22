export { CATEGORIES, ISLANDS, RISKS } from '@xai/contracts';
export type { Category, Island, Risk } from '@xai/contracts';
import type { Island, Risk } from '@xai/contracts';
export interface DataManifest {
    schema_version: number;
    data_version: string;
    predictions_file: string;
    province_mapping_file: string;
}
export interface PredictionDocument {
    schema_version: number | string;
    data_version?: string;
    model_version: string;
    available_years: number[];
    papua_display_mapping: PapuaDisplayMapping;
    predictions: PredictionRecord[];
    [key: string]: unknown;
}
export interface PapuaDisplayMapping {
    historical_years: number[];
    display_to_source_code: Record<string, string>;
    display_note: string;
    unavailable_2024_display_codes: string[];
    unavailable_2024_note: string;
}
export interface PredictionRecord {
    province_code: string;
    province_name: string;
    year: number;
    is_training: boolean;
    indicators: Indicator[];
    sexual: CategoryOutput | null;
    nonsexual: CategoryOutput | null;
    [key: string]: unknown;
}
export interface Indicator {
    column: string;
    feature: string;
    value: number | null;
    raw_value: number | null;
    unit: string | null;
    precision: number;
    data_year: number;
    source: string | null;
    [key: string]: unknown;
}
export interface CategoryOutput {
    level: Risk | null;
    predicted_value: number | null;
    observed_value: number | null;
    explanations: Indicator[];
    lime_explanations: Indicator[];
    shap_base_value: number | null;
    lime_fidelity: number | null;
    [key: string]: unknown;
}
export interface ProvinceMapping {
    schema_version: number | string;
    data_version: string;
    provinces: ProvinceDefinition[];
    source_by_display_code: Record<string, string>;
}
export interface ProvinceDefinition {
    province_code: string;
    province_name: string;
    island: Island;
}
export interface PublishedData {
    manifest: DataManifest;
    predictions: PredictionDocument;
    mapping: ProvinceMapping;
}
export interface Filters {
    island: Island | 'all';
    risk: Risk | 'all';
}
