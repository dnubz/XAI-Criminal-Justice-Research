import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { resolve, extname, sep } from 'node:path';
const root = fileURLToPath(new URL('../', import.meta.url));
const web = resolve(root, 'apps/web/dist');
process.env.PUBLISHED_DATA_DIR ??= resolve(root, 'apps/api/data/published');
const handler = createRequire(import.meta.url)(resolve(root, 'apps/api/api/index.js'));
const mime = { '.png': 'image/png', '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.geojson': 'application/geo+json', '.txt': 'text/plain; charset=utf-8' };
const server = createServer(async (req, res) => {
    try {
        const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
        if (pathname.startsWith('/api/'))
            return await handler(req, res);
        const file = resolve(web, `.${pathname === '/' ? '/index.html' : pathname}`);
        if (!file.startsWith(web + sep)) {
            res.writeHead(403);
            res.end('Forbidden');
            return;
        }
        let data;
        try {
            data = await readFile(file);
        }
        catch {
            res.writeHead(404);
            res.end('Not found');
            return;
        }
        res.writeHead(200, { 'Content-Type': mime[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
        res.end(data);
    }
    catch (error) {
        if (!res.headersSent)
            res.writeHead(500);
        res.end('Preview failed; check the terminal output.');
        console.error(error);
    }
});
server.listen(Number(process.env.PREVIEW_PORT || 4317), '127.0.0.1', () => {
    console.log(`Combined production preview: http://127.0.0.1:${server.address().port}`);
});
