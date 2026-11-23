import { copyFile, mkdir, readFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const packageRoot = fileURLToPath(new URL('../', import.meta.url));
const repoData = resolve(packageRoot, '../../data/published');
const bundleData = resolve(packageRoot, 'data/published');
const manifestPath = resolve(repoData, 'manifest.json');
await mkdir(resolve(packageRoot, 'public'), { recursive: true });
let manifest;
try {
    manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
}
catch (error) {
    throw new Error(`Required published bundle is missing: ${manifestPath}`, { cause: error });
}
if (manifest.schema_version !== 1 || typeof manifest.data_version !== 'string') {
    throw new Error(`Unsupported published data manifest at ${manifestPath}`);
}
for (const name of [manifest.predictions_file, manifest.province_mapping_file]) {
    if (typeof name !== 'string' || name.length === 0 || name.includes('..') || name.includes('/') || name.includes('\\')) {
        throw new Error(`Unsafe published data file in manifest: ${String(name)}`);
    }
    await readFile(resolve(repoData, name));
}
if (bundleData !== resolve(packageRoot, 'data/published') || bundleData === repoData) {
    throw new Error('Refusing to replace data outside this API package.');
}
await rm(bundleData, { recursive: true, force: true });
await mkdir(bundleData, { recursive: true });
for (const name of ['manifest.json', manifest.predictions_file, manifest.province_mapping_file]) {
    await copyFile(resolve(repoData, name), resolve(bundleData, name));
}
console.log(`Bundled published data ${manifest.data_version} into ${bundleData}`);
