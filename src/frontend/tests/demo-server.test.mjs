import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { once } from 'node:events';
import { DemoStore } from '../server/store.mjs';
import { createDemoServer, createControlServer } from '../server/index.mjs';

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'camping-demo-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  let time = 0;
  const file = join(directory, 'presentation.json');
  const store = new DemoStore(file, () => time);
  return { store, file, setTime: (value) => { time = value; } };
}
const receipt = (total = 100) => ({
  id: 1, total, status: 'Placed', orderDate: '2026-10-29T12:00:00Z',
  shippingAddress: 'Do not persist this', paymentMethod: 'card',
  items: [{ id: 1, productId: 1, quantity: 1, product: { id: 1, name: 'Tent', price: total } }],
});
function sale(store, key = 'order-00000000001', total = 100) {
  const entry = store.begin(key, 'shopper-one');
  store.complete(key, entry.sessionId, receipt(total));
}

test('real order revenue, healthy-time baseline and frozen linear loss', (t) => {
  const { store, setTime } = fixture(t);
  store.observe(true);
  sale(store);
  assert.equal(store.snapshot().averagePer10Seconds, null);
  setTime(10000); store.observe(true);
  assert.equal(store.snapshot().averagePer10Seconds, 100);
  setTime(15000); store.observe(false);
  assert.ok(Math.abs(store.snapshot().averagePer10Seconds - 100 / 1.5) < 0.001);
  setTime(20000); store.observe(false);
  const frozen = store.snapshot().averagePer10Seconds;
  sale(store, 'order-00000000002', 50);
  assert.equal(store.snapshot().averagePer10Seconds, frozen);
  setTime(25000); store.observe(true);
  const state = store.snapshot();
  assert.equal(state.totalSales, 150);
  assert.equal(state.orderCount, 2);
  assert.equal(state.recentOutages[0].durationSeconds, 10);
  assert.ok(Math.abs(state.estimatedLoss - 100 / 1.5) < 0.001);
  setTime(35000); store.observe(true);
  assert.equal(store.snapshot().estimatedLoss, state.estimatedLoss);
});

test('multiple outages sum estimates, empty baseline remains unknown, money uses cents', (t) => {
  const { store, setTime } = fixture(t);
  store.observe(false);
  setTime(5000); store.observe(true);
  assert.equal(store.snapshot().recentOutages[0].estimatedLoss, null);
  sale(store, 'order-00000000001', 10.01);
  sale(store, 'order-00000000002', 20.02);
  setTime(10000); store.observe(true);
  assert.equal(store.snapshot().totalSales, 30.03);
  setTime(15000); store.observe(false);
  setTime(20000); store.observe(true);
  setTime(25000); store.observe(false);
  setTime(30000); store.observe(true);
  const summary = store.snapshot();
  assert.equal(summary.recentOutages.length, 3);
  assert.equal(summary.estimatedLoss, summary.recentOutages.reduce((sum, item) => sum + (item.estimatedLoss ?? 0), 0));
});

test('stale monitor does not claim health or keep inflating losses', (t) => {
  const { store, setTime } = fixture(t);
  store.observe(true);
  sale(store);
  setTime(5000); store.observe(false);
  setTime(10000); store.observe(false);
  setTime(100000);
  assert.equal(store.snapshot().status, 'unknown');
  assert.equal(store.snapshot().currentOutage.durationSeconds, 5);
  store.observe(true);
  assert.equal(store.snapshot().recentOutages[0].endReason, 'monitor interrupted');
});

test('JSON reload preserves sales and history but never assumes health during monitor absence', (t) => {
  const { store, file, setTime } = fixture(t);
  store.observe(true);
  sale(store);
  setTime(5000); store.observe(false);
  const restored = new DemoStore(file, () => 20000);
  assert.equal(restored.snapshot().totalSales, 100);
  assert.equal(restored.snapshot().status, 'unknown');
  assert.equal(restored.snapshot().recentOutages[0].endReason, 'monitor interrupted');
  const persisted = readFileSync(file, 'utf8');
  assert.ok(!persisted.includes('Do not persist this'));
  assert.ok(!persisted.includes('paymentMethod'));
});

test('reset clears totals and in-flight old-session receipts do not enter the new session', (t) => {
  const { store } = fixture(t);
  sale(store);
  const pending = store.begin('pending-000000001', 'shopper-one');
  const old = store.snapshot().sessionId;
  store.reset();
  assert.notEqual(store.snapshot().sessionId, old);
  assert.equal(store.complete('pending-000000001', pending.sessionId, receipt()), false);
  assert.equal(store.snapshot().totalSales, 0);
  assert.equal(store.snapshot().orderCount, 0);
  assert.deepEqual(store.snapshot().recentOutages, []);
});

test('receipts are deduplicated and invalid JSON is never silently discarded', (t) => {
  const { store, file } = fixture(t);
  sale(store);
  sale(store);
  assert.equal(store.snapshot().orderCount, 1);
  writeFileSync(file, '{broken');
  assert.throws(() => new DemoStore(file));
});

test('a failed atomic write restores in-memory state and never claims reset succeeded', (t) => {
  const { store } = fixture(t);
  sale(store);
  const before = store.snapshot().sessionId;
  store.save = () => { throw new Error('Disk is full'); };
  assert.throws(() => store.reset(), /Disk is full/);
  assert.equal(store.snapshot().sessionId, before);
  assert.equal(store.snapshot().totalSales, 100);
  assert.throws(() => store.begin('new-order-00000001', 'shopper-two'), /Disk is full/);
  assert.equal(store.state.requests['new-order-00000001'], undefined);
});

async function serve(t, options = {}) {
  const state = fixture(t);
  const { server, probe } = createDemoServer({
    store: state.store, root: resolve('build'), upstream: 'http://api.invalid/api',
    ...options,
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); return new Promise((resolve) => server.close(resolve)); });
  return { ...state, probe, server, base: `http://127.0.0.1:${server.address().port}` };
}
const checkout = (base, key = 'order-00000000001') => fetch(`${base}/api/orders`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key },
  body: JSON.stringify({ userId: 'shopper-one', shippingAddress: 'Demo address', paymentMethod: 'card' }),
});

test('shared metrics, API-backed checkout, replay and order history work without the API afterwards', async (t) => {
  let calls = 0;
  const { base } = await serve(t, { fetcher: async () => { calls++; return Response.json(receipt(), { status: 201 }); } });
  assert.equal((await checkout(base)).status, 201);
  assert.equal((await checkout(base)).status, 200);
  assert.equal(calls, 1);
  const a = await (await fetch(`${base}/demo/metrics`)).json();
  const b = await (await fetch(`${base}/demo/metrics`)).json();
  assert.equal(a.totalSales, b.totalSales);
  assert.equal(a.totalSales, 100);
  const history = await (await fetch(`${base}/api/orders/user/shopper-one`)).json();
  assert.equal(history.length, 1);
  assert.equal(history[0].total, 100);
  assert.equal(calls, 1);
  assert.equal((await fetch(`${base}/reset`, { method: 'POST' })).status, 405);
  const config = await (await fetch(`${base}/config.js`)).text();
  assert.ok(config.includes('apiBaseUrl: "/api"'));
});

test('pending/uncertain checkout is never automatically duplicated or tallied', async (t) => {
  let calls = 0;
  const { base } = await serve(t, { fetcher: async () => { calls++; throw new Error('API restarted'); } });
  assert.equal((await checkout(base)).status, 502);
  assert.equal((await checkout(base)).status, 409);
  assert.equal(calls, 1);
  assert.equal((await (await fetch(`${base}/demo/metrics`)).json()).orderCount, 0);
});

test('definite API checkout failures do not count as sales and can be retried', async (t) => {
  let calls = 0;
  const { base } = await serve(t, { fetcher: async () => {
    calls++;
    return calls === 1 ? Response.json({ message: 'Payment failed' }, { status: 500 }) : Response.json(receipt());
  } });
  assert.equal((await checkout(base)).status, 500);
  assert.equal((await checkout(base)).status, 200);
  assert.equal((await (await fetch(`${base}/demo/metrics`)).json()).orderCount, 1);
});

test('independent probe exercises POST cart, clears probe, detects failures and recovery', async (t) => {
  let healthy = true;
  const calls = [];
  const { probe, store, setTime } = await serve(t, { fetcher: async (url, init) => {
    calls.push({ url, method: init.method });
    if (!healthy) return Response.json({ message: 'Out of memory' }, { status: 500 });
    return Response.json(init.method === 'POST' ? { items: [{ productId: 1 }] } : {});
  } });
  await probe();
  assert.equal(store.snapshot().status, 'healthy');
  assert.ok(calls[0].url.endsWith('/api/cart/presentation-probe/items'));
  assert.equal(calls[0].method, 'POST');
  assert.equal(calls[1].method, 'DELETE');
  healthy = false; setTime(5000); await probe();
  assert.equal(store.snapshot().status, 'outage');
  healthy = true; setTime(10000); await probe();
  assert.equal(store.snapshot().status, 'healthy');
  assert.equal(store.snapshot().recentOutages[0].durationSeconds, 5);
});

test('local control resets state without exposing reset on the public server', async (t) => {
  const { store } = fixture(t);
  sale(store);
  const control = createControlServer(store, async () => {});
  control.listen(0, '127.0.0.1');
  await once(control, 'listening');
  t.after(() => { control.closeAllConnections(); return new Promise((resolve) => control.close(resolve)); });
  const url = `http://127.0.0.1:${control.address().port}/reset`;
  assert.equal((await fetch(url, { method: 'POST' })).status, 403);
  const result = await fetch(url, { method: 'POST', headers: { 'X-Demo-Control': 'local-reset' } });
  assert.equal(result.status, 200);
  assert.equal(store.snapshot().totalSales, 0);
});
