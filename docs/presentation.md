# Interactive presentation

Everyone sees shared sales, order count, average revenue per 10 seconds, and estimated outage loss
in the sticky panel. Values refresh every 5 seconds. Each browser has its own anonymous cart.
Use fictional shipping details; checkout does not take real payment.

## Deploy once

Run `azd up`, or run **Deploy infrastructure**, then **Deploy website** in Actions.
Both apps must have **one replica**: carts live in the API's memory and the shared JSON ledger lives in the frontend.
Existing local installations need `azd provision` before `azd deploy` to apply the replica limits.
No database, storage account, credentials, or extra Azure service is added.

## Present

1. Reset just before inviting attendees to shop:

   ```powershell
   .\scripts\reset-demo.ps1
   ```

   Confirm the reset. It uses your Azure CLI sign-in and the selected azd environment.
   For an Actions-only installation, supply `-Subscription`, `-ResourceGroup`, and `-FrontendApp`.
   It executes inside the frontend container; there is no public reset API or website login.

2. Share the **frontend URL**. Have attendees add gear and place demo orders.
   Each cart opening prefills one of 30 Canadian cities and alternates Credit card/PayPal.
   Both fields remain editable; no real address or payment information is needed.
3. Run `break-app.sh` against the **API URL**, as shown in the README.
4. Watch the panel freeze the pre-outage rate and accumulate estimated loss. Expand **Outage history & comparison**
   to compare it with a hypothetical 5-, 15-, 30-, or 60-minute outage.
5. After cart functionality recovers, the next successful monitor check closes the outage.

**Audience additions still grow the intentional analytics memory leak**, just like `break-app.sh`.
They can break the API before you run the script. Only the monitor's reserved `presentation-probe`
cart releases its analytics buffer instead of retaining it; it exercises the same allocation and cart-add code
under memory pressure and clears its probe item.
The first rollout needs the updated API image before the updated frontend image.

## Numbers and limits

- Sales are actual successful demo-order receipts observed by the frontend server, not browser-submitted amounts.
  Direct calls to the API's orders endpoint bypass the presentation ledger; attendees must use the website.
- Average per 10 seconds = sales / accumulated healthy monitoring seconds × 10, since reset.
  Idle healthy time is included. No sales or healthy measurement time means no baseline.
- Each outage freezes its own baseline. Loss = frozen revenue rate × observed outage seconds.
  This is **linear estimated revenue loss**, not compound interest, profit, measured abandoned orders, or proven SRE Agent savings.
  No baseline produces no monetary estimate; outage history still records the duration.
- A cart-add probe runs every 5 seconds, with a 3.5-second timeout. Detection and recovery are approximate to that sampling interval.
  A check against `/health` alone would miss cart failures.
- A stale or interrupted monitor reports **unknown**, does not claim recovery, and does not extrapolate loss through an unobserved gap.
  A metrics-fetch failure labels displayed values as stale and retries automatically.
- Receipts and history are saved atomically to `/app/data/presentation.json` in the **frontend container**.
  They survive API restarts. They are **not durable across frontend container replacement, redeployment,
  scale-down, or environment teardown**. Keep the frontend running throughout the presentation.
  Avoid frontend deployments mid-demo; a rolling revision can briefly serve different ledgers.
- Only the latest five outages are shown; the current session's full history remains in JSON.
  Reset clears that session's receipt snapshots, totals, baselines, and outage history.
  It does not empty API carts, free the intentional leak, or recover the API.
  In-flight pre-reset orders are excluded from the new session.
- Checkout keys prevent a retried receipt from being counted twice. An uncertain upstream response remains pending
  rather than silently retrying an order. Ask the presenter to inspect/reset the session before submitting again.
  If the API dies after accepting an order but before its response reaches the frontend, that order cannot be
  confirmed or tallied; this simple demo does not implement a distributed transaction.
- API carts are still in memory and disappear when the API restarts. Previously captured order receipts remain
  available in the website's order history until reset; receipt statuses are snapshots.
- There is no customer authentication. Browser IDs isolate normal attendee sessions, not hostile users.
  Use this only as a public demo, not a real commerce ledger.

## Run locally

Use Node.js 22+ and the API's usual local setup. In one terminal:

```powershell
$env:PORT = '3088'
$env:DEMO_DATA_FILE = '.\data\presentation.json'
$env:REACT_APP_API_BASE_URL = 'http://localhost:5000/api'
Set-Location .\src\frontend
npm run demo-server
```

In another terminal, run `npm --prefix .\src\frontend run dev`.
Vite proxies API and metrics requests to port 3088. The container serves the built website on port 80.
For a local reset, run `node .\src\frontend\server\reset.mjs` while the service is running.
The reset listener binds to loopback port 8081 only; do not expose that port through ingress.

Run `npm --prefix .\src\frontend run test:server` for the JSON ledger and proxy checks.
