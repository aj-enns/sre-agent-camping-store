import { mkdirSync, readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

const fresh = (now) => ({
  version: 1, sessionId: randomUUID(), startedAt: now, healthyMs: 0,
  lastCheckAt: null, status: 'unknown', orders: [], requests: {}, outages: [],
});

export class DemoStore {
  constructor(file, now = Date.now) {
    this.file = file;
    this.now = now;
    mkdirSync(dirname(file), { recursive: true });
    this.state = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : fresh(now());
    if (this.state.version !== 1 || !Array.isArray(this.state.orders) || !Array.isArray(this.state.outages)) {
      throw new Error('Unsupported or invalid demo JSON file. Restore a backup before starting.');
    }
    // A monitor gap is unknown time, not evidence of availability or an outage.
    const active = this.state.outages.find((outage) => outage.endedAt === null);
    if (active) {
      active.endedAt = this.state.lastCheckAt;
      active.endReason = 'monitor interrupted';
    }
    this.state.status = 'unknown';
    this.state.lastCheckAt = null;
    this.save();
  }

  save() {
    const temporary = `${this.file}.tmp`;
    writeFileSync(temporary, JSON.stringify(this.state), { mode: 0o600 });
    for (let attempt = 0; ; attempt++) {
      try { renameSync(temporary, this.file); break; }
      catch (error) {
        if (process.platform !== 'win32' || !['EPERM', 'EACCES', 'EBUSY'].includes(error.code) || attempt >= 4) throw error;
        // Windows file scanning can briefly lock an otherwise atomic replacement.
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25 * (attempt + 1));
      }
    }
  }

  mutate(action) {
    const before = structuredClone(this.state);
    try {
      const result = action(this.state);
      this.save();
      return result;
    } catch (error) {
      this.state = before;
      throw error;
    }
  }

  reset() {
    const previous = this.state;
    this.state = fresh(this.now());
    try { this.save(); } catch (error) { this.state = previous; throw error; }
    return this.state.sessionId;
  }

  begin(key, userId) {
    return this.mutate((state) => {
      if (state.requests[key]) {
        if (state.requests[key].userId !== userId) throw new Error('Checkout key belongs to a different shopper.');
        return state.requests[key];
      }
      if (Object.keys(state.requests).length >= 10000) throw new Error('Presentation is full. Reset before accepting more orders.');
      const entry = { userId, sessionId: state.sessionId, status: 'pending' };
      state.requests[key] = entry;
      return entry;
    });
  }

  complete(key, sessionId, order) {
    if (sessionId !== this.state.sessionId) return false;
    return this.mutate((state) => {
      const entry = state.requests[key];
      if (!entry || entry.status === 'complete') return false;
      if (!Number.isFinite(order.total) || order.total < 0 || !Array.isArray(order.items)) throw new Error('Invalid order receipt from API.');
      // Do not persist addresses or payment details in the public-demo ledger.
      const receipt = {
        id: order.id, userId: entry.userId, total: order.total, status: order.status,
        orderDate: order.orderDate, items: order.items,
      };
      state.orders.push({ ...receipt, revenueCents: Math.round(order.total * 100), recordedAt: this.now() });
      entry.status = 'complete';
      entry.receipt = receipt;
      return true;
    });
  }

  failed(key, sessionId) {
    if (sessionId !== this.state.sessionId) return;
    this.mutate((state) => { delete state.requests[key]; });
  }

  observe(healthy, checkedAt = this.now()) {
    this.mutate((state) => {
      const gap = state.lastCheckAt === null ? 0 : checkedAt - state.lastCheckAt;
      const active = state.outages.find((outage) => outage.endedAt === null);
      if (state.status === 'healthy' && gap > 0 && gap <= 15000) state.healthyMs += gap;
      if (gap > 15000 && active) {
        active.endedAt = state.lastCheckAt;
        active.endReason = 'monitor interrupted';
      }
      if (!healthy && (!active || active.endedAt !== null)) {
        state.outages.push({
          id: randomUUID(), startedAt: checkedAt, endedAt: null,
          rateCentsPerSecond: this.rate(), endReason: null,
        });
      } else if (healthy && active && active.endedAt === null) {
        active.endedAt = checkedAt;
        active.endReason = 'cart recovered';
      }
      state.status = healthy ? 'healthy' : 'outage';
      state.lastCheckAt = checkedAt;
    });
  }

  rate() {
    const revenue = this.state.orders.reduce((sum, order) => sum + order.revenueCents, 0);
    return revenue > 0 && this.state.healthyMs > 0 ? revenue / (this.state.healthyMs / 1000) : null;
  }

  snapshot() {
    const state = this.state;
    const now = this.now();
    const stale = state.lastCheckAt === null || now - state.lastCheckAt > 15000;
    const outages = state.outages.map((outage) => {
      const end = outage.endedAt ?? (stale ? state.lastCheckAt : now);
      const durationSeconds = Math.max(0, (end - outage.startedAt) / 1000);
      return {
        ...outage, durationSeconds,
        estimatedLoss: outage.rateCentsPerSecond === null ? null : outage.rateCentsPerSecond * durationSeconds / 100,
      };
    });
    const currentOutage = outages.find((outage) => outage.endedAt === null) ?? null;
    const rate = currentOutage ? currentOutage.rateCentsPerSecond : this.rate();
    return {
      sessionId: state.sessionId, startedAt: state.startedAt, updatedAt: now, lastCheckAt: state.lastCheckAt,
      status: stale ? 'unknown' : state.status,
      totalSales: state.orders.reduce((sum, order) => sum + order.revenueCents, 0) / 100,
      orderCount: state.orders.length, averagePer10Seconds: rate === null ? null : rate / 10,
      estimatedLoss: outages.reduce((sum, outage) => sum + (outage.estimatedLoss ?? 0), 0),
      hasLossBaseline: outages.some((outage) => outage.estimatedLoss !== null),
      currentOutage, recentOutages: outages.slice(-5).reverse(),
    };
  }
}
