import { useEffect, useState } from 'react';
import { money } from './catalog';

type Outage = {
  id: string; startedAt: number; endedAt: number | null; durationSeconds: number;
  estimatedLoss: number | null; rateCentsPerSecond: number | null; endReason: string | null;
};
type Metrics = {
  sessionId: string; status: 'healthy' | 'outage' | 'unknown'; totalSales: number; orderCount: number;
  averagePer10Seconds: number | null; estimatedLoss: number; hasLossBaseline: boolean;
  currentOutage: Outage | null; recentOutages: Outage[]; lastCheckAt: number | null;
};
const duration = (seconds: number) => `${Math.floor(seconds / 60)}m ${Math.floor(seconds % 60)}s`;

export default function DemoPanel() {
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [error, setError] = useState(false);
  const [comparisonMinutes, setComparisonMinutes] = useState(30);
  useEffect(() => {
    let active = true;
    let controller: AbortController | null = null;
    let pending = false;
    const poll = async () => {
      if (pending) return;
      pending = true;
      controller = new AbortController();
      const requestController = controller;
      const timeout = setTimeout(() => requestController.abort(), 4500);
      try {
        const response = await fetch('/demo/metrics', { cache: 'no-store', signal: controller.signal });
        if (!response.ok) throw new Error(`Metrics returned HTTP ${response.status}`);
        const result: Metrics = await response.json();
        if (!['healthy', 'outage', 'unknown'].includes(result.status) || !Array.isArray(result.recentOutages) ||
            typeof result.totalSales !== 'number' || typeof result.orderCount !== 'number') throw new Error('Invalid presentation metrics');
        if (active) { setMetrics(result); setError(false); }
      } catch {
        if (active) setError(true);
      } finally {
        clearTimeout(timeout);
        pending = false;
      }
    };
    poll();
    const timer = setInterval(poll, 5000);
    return () => { active = false; clearInterval(timer); controller?.abort(); };
  }, []);
  const available = metrics && !error;
  const status = !available || metrics.status === 'unknown' ? 'Status unknown' : metrics.status === 'healthy' ? 'Cart available' : 'Cart outage';
  const latest = metrics?.recentOutages[0];
  const hypothetical = latest?.rateCentsPerSecond === null || latest?.rateCentsPerSecond === undefined
    ? null : latest.rateCentsPerSecond * comparisonMinutes * 60 / 100;
  return (
    <section className="demo-panel" aria-label="Shared presentation sales and outage impact">
      <div className="demo-summary">
        <div className="demo-session"><strong>Live demo</strong><span className={`demo-health ${available ? metrics.status : 'unknown'}`}>{status}</span></div>
        <dl className="demo-totals">
          <div><dt>Sales (USD)</dt><dd>{metrics ? money(metrics.totalSales) : '--'}</dd></div>
          <div><dt>Orders</dt><dd>{metrics?.orderCount ?? '--'}</dd></div>
          <div><dt>Avg / 10 sec</dt><dd>{metrics?.averagePer10Seconds == null ? '--' : money(metrics.averagePer10Seconds)}</dd></div>
          <div><dt>Est. loss (USD)</dt><dd>{metrics?.hasLossBaseline ? money(metrics.estimatedLoss) : '--'}</dd></div>
        </dl>
      </div>
      <div className="demo-caption" role="status">
        {error ? 'Live totals unavailable. Last received values shown; retrying automatically.' :
          !metrics ? 'Connecting to the shared presentation...' :
          metrics.currentOutage ? `${status}: ${duration(metrics.currentOutage.durationSeconds)}. ${metrics.currentOutage.estimatedLoss === null ? 'Not enough sales data to estimate loss.' : `Current estimated loss ${money(metrics.currentOutage.estimatedLoss)}.`}` :
          `${status}. Demo revenue, not profit. Totals refresh every 5 seconds.`}
      </div>
      <details className="demo-history">
        <summary>Outage history &amp; comparison</summary>
        <div className="demo-history-body">
          <p>Loss is a linear estimate using the frozen pre-outage sales rate. No baseline means no estimate. It is not measured lost orders or proof of SRE Agent savings.</p>
          {!metrics?.recentOutages.length ? <p>No outages recorded for this presentation.</p> :
            <ul>{metrics.recentOutages.map((outage) => <li key={outage.id}>
              {new Date(outage.startedAt).toLocaleTimeString()} · {duration(outage.durationSeconds)} · {outage.estimatedLoss === null ? 'No sales baseline' : `${money(outage.estimatedLoss)} estimated loss`} · {outage.endedAt === null ? 'In progress' : outage.endReason}
            </li>)}</ul>}
          <label>Hypothetical longer outage <select value={comparisonMinutes} onChange={(event) => setComparisonMinutes(Number(event.target.value))}>
            {[5, 15, 30, 60].map((minutes) => <option key={minutes} value={minutes}>{minutes} minutes</option>)}
          </select></label>
          <p>{hypothetical === null ? 'A sales baseline and an outage are needed for comparison.' :
            `At the latest outage's frozen rate: ${money(hypothetical)} projected loss over ${comparisonMinutes} minutes${latest?.estimatedLoss == null ? '.' : ` versus ${money(latest.estimatedLoss)} estimated so far in the observed outage.`}`}</p>
        </div>
      </details>
    </section>
  );
}
