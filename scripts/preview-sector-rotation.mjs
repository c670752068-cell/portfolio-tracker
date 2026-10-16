/** Read-only local QA server. Never forward mutations or start production jobs. */
import { createServer } from 'node:http';
import { get } from 'node:https';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { createSectorRotationRoute } from '../deploy/sector-rotation.mjs';

function request(url, headers = {}, timeout = 15_000) {
  return new Promise((resolveResponse, reject) => {
    const req = get(url, { family: 4, headers }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolveResponse({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
      res.on('error', reject);
    });
    req.setTimeout(timeout, () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}
function sendJson(res, status, body) { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(body)); }
const route = createSectorRotationRoute({
  fetchJson: async (...args) => { const res = await request(...args); if (res.status !== 200) throw new Error(`upstream ${res.status}`); return JSON.parse(res.body); },
  sendJson, cacheRoot: resolve('output/sector-rotation-cache'),
});
const root = resolve('dist');
createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://127.0.0.1:4180');
    if (req.method !== 'GET') return sendJson(res, 405, { error: 'Read-only QA server' });
    if (await route(url, req, res)) return;
    if (url.pathname === '/runtime-config.js') { res.writeHead(200, { 'Content-Type': 'text/javascript' }); return res.end('window.__PORTFOLIO_TRACKER_RUNTIME__={apiBaseUrl:window.location.origin,deploymentLabel:"只读验证"};'); }
    if (url.pathname.startsWith('/api/')) {
      const upstream = await request(`https://www.myopenid.top${url.pathname}${url.search}`, { Accept: 'application/json' });
      res.writeHead(upstream.status, { 'Content-Type': upstream.headers['content-type'] || 'application/json', 'Cache-Control': 'no-store' }); return res.end(upstream.body);
    }
    const target = resolve(root, '.' + (url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname)));
    if (!target.startsWith(root + '/')) return sendJson(res, 403, { error: 'Forbidden' });
    const type = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' }[extname(target)] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type }); res.end(await readFile(target));
  } catch { if (!res.headersSent) sendJson(res, 502, { error: { message: '只读预览读取失败' } }); else res.end(); }
}).listen(4180, '127.0.0.1', () => console.log('Read-only preview: http://127.0.0.1:4180'));
