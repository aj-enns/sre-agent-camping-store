import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DemoStore } from './store.mjs';

const send = (res, status, value) => {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(value));
};

async function bodyOf(req) {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (Buffer.byteLength(body) > 65536) throw new Error('Request body exceeds 64 KiB.');
  }
  return body;
}

export function createDemoServer({ store, upstream, root, fetcher = fetch }) {
  const api = new URL(upstream);
  if (!['http:', 'https:'].includes(api.protocol) || api.search || api.hash || api.username || api.password) {
    throw new Error('REACT_APP_API_BASE_URL must be an HTTP(S) API URL without credentials or query parameters.');
  }
  const apiUrl = (path) => `${api.href.replace(/\/$/, '')}${path}`;
  let monitoring = false;
  const probe = async () => {
    if (monitoring) return;
    monitoring = true;
    try {
      const response = await fetcher(apiUrl('/cart/presentation-probe/items'), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productId: 1, quantity: 1 }), signal: AbortSignal.timeout(3500),
      });
      const cart = response.ok ? await response.json() : null;
      const healthy = response.ok && Array.isArray(cart?.items) && cart.items.some((item) => item.productId === 1);
      store.observe(healthy);
      if (healthy) {
        const cleanup = await fetcher(apiUrl('/cart/presentation-probe'), { method: 'DELETE', signal: AbortSignal.timeout(1000) });
        if (!cleanup.ok) console.error(`Cart probe cleanup failed: HTTP ${cleanup.status}`);
      }
    } catch (error) {
      console.error(`Cart availability probe failed: ${error.message}`);
      // Persistence failures must not be hidden as successful health checks.
      try { store.observe(false); } catch (storageError) { console.error(`Demo storage failed: ${storageError.message}`); }
    } finally { monitoring = false; }
  };

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://frontend');
      if (req.method === 'GET' && url.pathname === '/demo/metrics') return send(res, 200, store.snapshot());
      if (req.method === 'GET' && url.pathname === '/health') return send(res, 200, { status: 'healthy' });
      if (req.method === 'GET' && url.pathname === '/config.js') {
        res.writeHead(200, { 'Content-Type': 'application/javascript', 'Cache-Control': 'no-store' });
        return res.end('window.__CONFIG__ = { apiBaseUrl: "/api" };');
      }
      if (url.pathname.startsWith('/api/')) {
        // A fixed upstream prevents visitors from turning this into an open proxy.
        const path = url.pathname.slice(4) + url.search;
        const orderList = /^\/api\/orders\/user\/([^/]+)$/.exec(url.pathname);
        if (req.method === 'GET' && orderList) {
          const userId = decodeURIComponent(orderList[1]);
          return send(res, 200, store.state.orders.filter((order) => order.userId === userId));
        }
        const body = ['GET', 'HEAD'].includes(req.method) ? undefined : await bodyOf(req);
        const checkout = req.method === 'POST' && url.pathname === '/api/orders';
        let key, entry;
        if (checkout) {
          const request = JSON.parse(body);
          key = req.headers['idempotency-key'];
          if (typeof key !== 'string' || !/^[a-zA-Z0-9-]{16,80}$/.test(key) ||
              typeof request.userId !== 'string' || !request.userId.startsWith('shopper-')) {
            return send(res, 400, { message: 'A valid shopper and checkout key are required.' });
          }
          const existing = store.state.requests[key];
          if (existing) {
            if (existing.userId !== request.userId) return send(res, 409, { message: 'Checkout key conflict.' });
            if (existing.status === 'complete') return send(res, 200, existing.receipt);
            return send(res, 409, { message: 'Checkout is pending or its outcome is uncertain. Check your orders before trying again.' });
          }
          entry = store.begin(key, request.userId);
        }
        let response;
        try {
          response = await fetcher(apiUrl(path), {
            method: req.method,
            headers: { 'Content-Type': 'application/json' },
            body, signal: AbortSignal.timeout(15000), redirect: 'error',
          });
        } catch (error) {
          console.error(`API proxy failed: ${error.message}`);
          return send(res, 502, { message: checkout
            ? 'Checkout outcome is uncertain. Check your orders; do not submit another order yet.'
            : 'The store API is unavailable. Please try again.' });
        }
        const text = await response.text();
        if (checkout) {
          if (response.ok) {
            const order = JSON.parse(text);
            store.complete(key, entry.sessionId, order);
          } else {
            store.failed(key, entry.sessionId);
          }
        }
        res.writeHead(response.status, {
          'Content-Type': response.headers.get('content-type') ?? 'application/json', 'Cache-Control': 'no-store',
        });
        return res.end(text);
      }
      if (!['GET', 'HEAD'].includes(req.method)) return send(res, 405, { message: 'Method not allowed.' });
      const file = resolve(root, `.${decodeURIComponent(url.pathname)}`);
      if (file !== root && !file.startsWith(root + sep)) return send(res, 403, { message: 'Forbidden.' });
      const types = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
      try {
        const content = await readFile(url.pathname === '/' ? resolve(root, 'index.html') : file);
        res.writeHead(200, { 'Content-Type': types[extname(file)] ?? (url.pathname === '/' ? 'text/html' : 'application/octet-stream') });
        return res.end(req.method === 'HEAD' ? undefined : content);
      } catch (error) {
        if (error.code !== 'ENOENT' && error.code !== 'EISDIR') throw error;
        return send(res, 404, { message: 'Not found.' });
      }
    } catch (error) {
      console.error(`Frontend request failed: ${error.message}`);
      if (!res.headersSent) send(res, 500, { message: 'The presentation service could not complete this request. Contact the presenter.' });
      else res.destroy();
    }
  });
  return { server, probe };
}

export function createControlServer(store, probe) {
  return http.createServer(async (req, res) => {
    if (req.method !== 'POST' || req.url !== '/reset') return send(res, 404, { message: 'Not found.' });
    if (req.headers['x-demo-control'] !== 'local-reset') return send(res, 403, { message: 'Use the local reset script.' });
    try {
      const sessionId = store.reset();
      await probe();
      send(res, 200, { sessionId, message: 'Presentation totals reset.' });
    } catch (error) {
      console.error(`Reset failed: ${error.message}`);
      send(res, 500, { message: 'Reset failed. Inspect frontend logs.' });
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const store = new DemoStore(process.env.DEMO_DATA_FILE ?? '/app/data/presentation.json');
  const { server, probe } = createDemoServer({
    store, upstream: process.env.REACT_APP_API_BASE_URL ?? 'http://localhost:5000/api',
    root: resolve(process.env.STATIC_ROOT ?? 'build'),
  });
  const control = createControlServer(store, probe);
  server.listen(Number(process.env.PORT ?? 80), '0.0.0.0');
  control.listen(8081, '127.0.0.1');
  const interval = setInterval(probe, 5000);
  await probe();
  const stop = () => { clearInterval(interval); server.close(); control.close(); };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}
