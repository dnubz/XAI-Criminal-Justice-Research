import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import type { DataManifest, PredictionDocument, PredictionRecord, ProvinceMapping, PublishedData, ProvinceDefinition, CategoryOutput } from './schema';
import { CATEGORIES, ISLANDS, RISKS } from './schema';
const safeFileName = (name: unknown): name is string => typeof name === 'string' && name.length > 0 && !isAbsolute(name) && !name.split(/[\\/]/).includes('..');
const finiteOrNull = (value: unknown) => value === null || (typeof value === 'number' && Number.isFinite(value));
const object = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
@Injectable()
export class PublishedDataService {
    private cache?: PublishedData;
    get(): PublishedData {
        if (this.cache)
            return this.cache;
        try {
            const dir = this.dataDirectory();
            const manifest = this.readJson(join(dir, 'manifest.json')) as DataManifest;
            if (!object(manifest) || manifest.schema_version !== 1 || typeof manifest.data_version !== 'string' || !/^[A-Za-z0-9._-]{1,100}$/.test(manifest.data_version))
                throw new Error('Invalid manifest schema/version');
            if (!safeFileName(manifest.predictions_file) || !safeFileName(manifest.province_mapping_file))
                throw new Error('Invalid published-data filename');
            const predictions = this.readJson(join(dir, manifest.predictions_file)) as PredictionDocument;
            const mapping = this.readJson(join(dir, manifest.province_mapping_file)) as ProvinceMapping;
            this.validate(predictions, mapping, manifest);
            this.cache = { manifest, predictions, mapping };
            return this.cache;
        }
        catch (error) {
            const message = error instanceof Error ? error.message : 'unknown published-data error';
            throw new ServiceUnavailableException({ statusCode: 503, error: 'PublishedDataUnavailable', message: `Published dashboard data is unavailable or invalid: ${message}` });
        }
    }
    private dataDirectory() {
        if (process.env.PUBLISHED_DATA_DIR)
            return resolve(process.env.PUBLISHED_DATA_DIR);
        const candidates = [resolve(process.cwd(), 'data/published'), resolve(__dirname, '../../../data/published')];
        return candidates.find((candidate) => {
            try {
                readFileSync(join(candidate, 'manifest.json'));
                return true;
            }
            catch {
                return false;
            }
        }) ?? candidates[0];
    }
    private readJson(path: string): unknown { return JSON.parse(readFileSync(path, 'utf8')); }
    private validate(document: PredictionDocument, mapping: ProvinceMapping, manifest: DataManifest) {
        if (!object(document) || ![1, '1.0.0'].includes(document.schema_version) || document.model_version !== manifest.data_version || !Array.isArray(document.available_years) || !Array.isArray(document.predictions) || !document.predictions.length)
            throw new Error('Prediction document header does not match manifest');
        if (!object(mapping) || ![1, '1.0.0'].includes(mapping.schema_version) || mapping.data_version !== manifest.data_version || !Array.isArray(mapping.provinces) || mapping.provinces.length !== 38 || !object(mapping.source_by_display_code))
            throw new Error('Province mapping does not match schema, version, or expected 38 provinces');
        const years = new Set<number>();
        for (const year of document.available_years) {
            if (!Number.isInteger(year) || years.has(year))
                throw new Error('Available years must be unique integers');
            years.add(year);
        }
        const provinceCodes = new Set<string>();
        for (const province of mapping.provinces as ProvinceDefinition[]) {
            if (!object(province) || !/^\d{2}$/.test(province.province_code) || typeof province.province_name !== 'string' || !ISLANDS.includes(province.island))
                throw new Error('Invalid province definition');
            if (provinceCodes.has(province.province_code))
                throw new Error(`Duplicate province ${province.province_code}`);
            provinceCodes.add(province.province_code);
        }
        const keys = new Set<string>();
        for (const record of document.predictions as PredictionRecord[]) {
            if (!object(record) || !/^\d{2}$/.test(record.province_code) || typeof record.province_name !== 'string' || !Number.isInteger(record.year) || !years.has(record.year) || typeof record.is_training !== 'boolean' || !Array.isArray(record.indicators))
                throw new Error('Invalid prediction record identity');
            const key = `${record.province_code}:${record.year}`;
            if (keys.has(key))
                throw new Error(`Duplicate prediction ${key}`);
            keys.add(key);
            for (const category of CATEGORIES)
                if (record[category] !== null)
                    this.validateCategory(record[category] as CategoryOutput, category);
            for (const indicator of record.indicators) {
                if (!object(indicator) || typeof indicator.column !== 'string' || typeof indicator.feature !== 'string' || !finiteOrNull(indicator.value) || !finiteOrNull(indicator.raw_value) || !Number.isInteger(indicator.data_year) || !Number.isInteger(indicator.precision) || indicator.precision < 0 || (indicator.unit !== null && typeof indicator.unit !== 'string') || (indicator.source !== null && typeof indicator.source !== 'string'))
                    throw new Error(`Invalid indicator in ${key}`);
            }
        }
        for (const [display, source] of Object.entries(mapping.source_by_display_code)) {
            if (!provinceCodes.has(display) || typeof source !== 'string' || !provinceCodes.has(source))
                throw new Error(`Invalid source mapping for ${display}`);
        }
        const papua = document.papua_display_mapping;
        if (!object(papua) || !object(papua.display_to_source_code) || !Array.isArray(papua.historical_years) || typeof papua.display_note !== 'string' || !Array.isArray(papua.unavailable_2024_display_codes) || typeof papua.unavailable_2024_note !== 'string')
            throw new Error('Invalid Papua display mapping metadata');
        if (papua.historical_years.some((year) => !Number.isInteger(year) || !years.has(year)) || papua.unavailable_2024_display_codes.some((code) => !provinceCodes.has(code)))
            throw new Error('Papua mapping references unsupported years or provinces');
        for (const [display, source] of Object.entries(papua.display_to_source_code)) {
            if (!provinceCodes.has(display) || !provinceCodes.has(source) || mapping.source_by_display_code[display] !== source || display === source)
                throw new Error(`Papua mapping mismatch for ${display}`);
        }
        const expectedPapuaAliases = { '93': '91', '94': '91', '95': '91', '96': '92' };
        for (const [display, source] of Object.entries(expectedPapuaAliases)) {
            if (papua.display_to_source_code[display] !== source)
                throw new Error(`Incorrect published Papua source mapping for ${display}`);
        }
        for (const [display, source] of Object.entries(mapping.source_by_display_code)) {
            if (display !== source && papua.display_to_source_code[display] !== source)
                throw new Error(`Province map alias ${display} is missing from published Papua mapping`);
        }
        if (!['91', '92', '93', '94', '95', '96'].every((code) => papua.unavailable_2024_display_codes.includes(code)))
            throw new Error('Papua 2024 availability mapping is incomplete');
        if ([...keys].some((key) => !provinceCodes.has(key.split(':')[0])))
            throw new Error('Prediction references unknown province');
    }
    private validateCategory(value: CategoryOutput, label: string) {
        if (!object(value) || (value.level !== null && !RISKS.slice(0, 3).includes(value.level)) || !finiteOrNull(value.predicted_value) || !finiteOrNull(value.observed_value) || (value.predicted_value === null) !== (value.level === null) || !Array.isArray(value.explanations) || !Array.isArray(value.lime_explanations) || !finiteOrNull(value.shap_base_value) || !finiteOrNull(value.lime_fidelity))
            throw new Error(`Invalid ${label} category output`);
    }
}
