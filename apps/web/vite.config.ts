import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const fixtureDir = fileURLToPath(new URL('./src/fixtures/', import.meta.url));
const devFixtures = {
    name: 'serve-development-fixtures',
    configureServer(server: import('vite').ViteDevServer) {
        server.middlewares.use('/__fixture', (request, response, next) => {
            const filename = request.url?.slice(1);
            if (filename !== 'paper-predictions.json' && filename !== 'province-mapping.json')
                return next();
            response.setHeader('Content-Type', 'application/json; charset=utf-8');
            response.end(readFileSync(`${fixtureDir}/${filename}`));
        });
    },
};
export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, process.cwd(), '');
    if (process.env.VERCEL === '1' && mode === 'production' && !env.VITE_API_BASE_URL?.trim()) {
        throw new Error('Set VITE_API_BASE_URL to the deployed API origin before building on Vercel.');
    }
    const proxy = { '/api': { target: env.API_PROXY_TARGET || 'http://127.0.0.1:3001', changeOrigin: true } };
    return {
        plugins: [react(), ...(mode === 'fixture' ? [devFixtures] : [])],
        server: { host: '127.0.0.1', proxy },
        preview: { host: '127.0.0.1', proxy },
    };
});
