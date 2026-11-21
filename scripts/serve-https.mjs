import { createServer as httpsServer } from 'node:https';
import { createServer as httpServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, sep, extname } from 'node:path';
const root = resolve('dist');
const testOnly = process.argv.includes('--http-test');
const portFlag = process.argv.indexOf('--port');
const port = Number(portFlag >= 0 ? process.argv[portFlag + 1] : testOnly ? 4173 : 8443);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid port.');
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.wasm': 'application/wasm', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.webp': 'image/webp', '.woff2': 'font/woff2' };
const headers = {
  'X-Content-Type-Options': 'nosniff',
  'Permissions-Policy': 'microphone=(self), camera=(), speaker-selection=(self)',
  // Pinned Emscripten bindings use new Function for named wrappers, in addition to WASM.
  'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-eval'; worker-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
};
async function handler(request, response) {
  try {
    if (!['GET', 'HEAD'].includes(request.method)) { response.writeHead(405, { ...headers, Allow: 'GET, HEAD' }).end(); return; }
    const pathname = decodeURIComponent(new URL(request.url, 'https://localhost').pathname);
    const file = resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
    if (!file.startsWith(root + sep) || !(await stat(file)).isFile()) { response.writeHead(404, headers).end('Not found'); return; }
    const bytes = await readFile(file);
    response.writeHead(200, { ...headers, 'Content-Type': extname(file) === '.onnx' ? 'application/octet-stream' : types[extname(file)] ?? 'text/plain; charset=utf-8', 'Content-Length': bytes.length, 'Cache-Control': pathname.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache' });
    response.end(request.method === 'HEAD' ? undefined : bytes);
  } catch { response.writeHead(404, headers).end('Not found'); }
}
let server;
if (testOnly) server = httpServer(handler);
else {
  try {
    const cert = await readFile(process.env.SONICBRIDGE_CERT ?? '.certs/sonicbridge.pem');
    const key = await readFile(process.env.SONICBRIDGE_KEY ?? '.certs/sonicbridge-key.pem');
    server = httpsServer({ cert, key }, handler);
  } catch { throw new Error('Trusted test certificate missing. Follow HTTPS.md; no certificates or trust settings are created automatically.'); }
}
server.listen(port, testOnly ? '127.0.0.1' : '0.0.0.0', () => console.log(`${testOnly ? 'LOCALHOST TEST ONLY http' : 'HTTPS'}://localhost:${port} serving ${root}. No upload or network payload endpoints.`));

