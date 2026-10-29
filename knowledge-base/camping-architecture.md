# Trailhead Outfitters Application Architecture

## Overview

Trailhead Outfitters is a camping supply retail web store (tents, sleeping bags, stoves, packs and more) deployed on **Azure Container Apps**. It is the monitored application for the SRE Agent lab: the agent investigates and remediates issues with this app.

---

## Infrastructure

| Component | Azure Service | Details |
|-----------|---------------|---------|
| **API** | Azure Container Apps (`ca-camping-*`) | ASP.NET Core (.NET 9), external ingress |
| **Frontend** | Azure Container Apps (`ca-camping-fe-*`) | React + Node.js server; proxies the API and keeps shared presentation metrics in container-local JSON |
| **Container Registry** | Azure Container Registry (Basic) | Public endpoint; images require authentication; admin and anonymous access disabled |
| **Container Environment** | Container Apps Environment | No custom VNet; diagnostic settings route logs to Log Analytics |
| **Logs** | Log Analytics Workspace | Console logs via `ContainerAppConsoleLogs`; no shared workspace keys |
| **Telemetry** | Application Insights | Request metrics, exceptions, dependencies; Entra-authenticated ingestion |
| **Identity** | User-Assigned Managed Identity | Reader + Monitoring Reader + Log Analytics Reader |
| **Alerts** | Azure Monitor | Metric alert for HTTP 5xx |

---

## Application Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Health check (reports `apiVersion`) |
| `/api/products` | GET | List products (optional `category` filter) |
| `/api/products/{id}` | GET | Product detail |
| `/api/products/categories` | GET | List categories |
| `/api/cart/{userId}` | GET | Get a user's cart |
| `/api/cart/{userId}/items` | POST | Add item `{productId, quantity}` (**memory leak trigger**) |
| `/api/cart/{userId}/items/{itemId}` | PUT / DELETE | Update / remove an item |
| `/api/cart/{userId}` | DELETE | Clear the cart |
| `/api/orders` | POST | Checkout (**returns 500 when `API_VERSION=v2`**) |
| `/api/orders/{id}` | GET | Order detail |
| `/api/orders/user/{userId}` | GET | Orders for a user |
| `/api/orders/{id}/cancel` | PUT | Cancel an order |

---

## Fault Injection

### 1. Memory leak via Cart API

Each `POST /api/cart/{userId}/items` call causes `RequestAnalyticsCache` (a singleton) to retain a 10 MB buffer that is never evicted. Rapid repeated calls cause:

- Memory working set to grow continuously
- Container to approach its 1Gi memory limit
- OOM kill, container restart, HTTP 5xx errors
- Azure Monitor alert `alert-http-5xx-sre-lab` fires

Audience `shopper-*` carts contribute to this leak, just like the break script's `demo-user`.
The reserved `presentation-probe` cart alone releases its allocation instead of retaining it, so the
frontend's five-second monitor exercises the same allocation/cart path without accumulating its own leak.

**Trigger:** `bash scripts/break-app.sh https://<app-url>`, or:
```bash
while true; do
  curl -X POST "https://<app-url>/api/cart/demo-user/items" \
    -H "Content-Type: application/json" \
    -d '{"productId":1,"quantity":1}'
  sleep 0.5
done
```

### 2. Bad deployment (payment gateway)

Building the API with `API_VERSION=v2` makes `PaymentGateway` fail, so `POST /api/orders` returns HTTP 500 with code `PAYMENT_ERROR`. Rolling back to the `v1` image fixes it.

---

## Source Code

- **GitHub repository:** [github.com/aj-enns/sre-agent-camping-store](https://github.com/aj-enns/sre-agent-camping-store)
- **Language:** C# (.NET 9) API, TypeScript/React frontend
- **Images:** built locally by `azd` or on a standard GitHub-hosted runner and pushed to authenticated ACR; Container Apps pulls them using managed identity. No storage account or shared keys are used.

### Key Files

| File | Purpose |
|------|---------|
| `src/api/Program.cs` | Startup, dependency injection, `/health`, App Insights |
| `src/api/Controllers/*.cs` | Products, Cart, Orders controllers |
| `src/api/Services/RequestAnalyticsCache.cs` | Source of the memory leak |
| `src/api/Services/PaymentGateway.cs` | Source of the v2 payment failure |
| `src/api/Services/OrderService.cs`, `CartService.cs` | Business logic |
| `src/api/Dockerfile` | API image (`API_VERSION` build arg) |
| `src/frontend/` | React storefront and Node.js server |
| `src/frontend/server/` | JSON receipt ledger, shared metrics, independent cart monitor, loopback-only reset |

---
## Scaling Configuration

| Setting | Value |
|---------|-------|
| Min replicas | 1 |
| Max replicas | 1 (API and frontend) |
| CPU | 0.5 cores |
| Memory | 1 Gi |

Keep the frontend at one replica and do not restart/redeploy it during a presentation.
Its `/app/data/presentation.json` ledger survives an API restart but not frontend container replacement.
API carts remain in memory. Scaling out splits carts and presentation ledgers rather than sharing them.
Public `/demo/metrics` is served by the frontend, not the API; it records sampled cart outages independently.
See [presentation instructions](../docs/presentation.md) for formulas, reset, and limitations.

---

## Monitoring & Alerting

### Log Analytics Queries

**Error logs:**
```kql
ContainerAppConsoleLogs
| where TimeGenerated > ago(1h)
| where Log contains "error" or Log contains "Error" or Log contains "500"
| summarize ErrorCount = count() by bin(TimeGenerated, 5m)
| order by TimeGenerated desc
```

**Container app console output:**
```kql
ContainerAppConsoleLogs
| where TimeGenerated > ago(1h)
| project TimeGenerated, Log, ContainerName
| order by TimeGenerated desc
| take 50
```

### Alert Rules

| Alert | Trigger | Severity |
|-------|---------|----------|
| HTTP 5xx errors | > 5 requests with 5xx status in 5 min | Sev3 |

A single alert keeps things clean — the SRE Agent investigates the root cause (memory leak, OOM, code bug, etc.) regardless of which symptom triggered it.

These alerts flow automatically to the SRE Agent via the managed resource group configuration.

---

## Known Failure Modes

| Failure | Symptoms | Root Cause |
|---------|----------|------------|
| Bad payment gateway release (`API_VERSION=v2`) | HTTP 500 `PAYMENT_ERROR` on `POST /api/orders` | Regression in `PaymentGateway.cs` shipped in the v2 build |
| Memory pressure | Slow responses, OOM restarts | Undersized container (1Gi); `RequestAnalyticsCache` retains 10 MB per cart add |
| High CPU | Request timeouts | Unthrottled request processing under load |

---

## Troubleshooting Quick Reference

1. **Check health:** `curl https://<app-url>/health`
2. **Check logs:** Query `ContainerAppConsoleLogs` in Log Analytics
3. **Check metrics:** Azure Monitor → Container App → Requests, CPU, Memory
4. **Restart:** `az containerapp revision restart -g <rg> -n <app> --revision <rev>`
5. **Preserve demo state:** Keep both apps at one replica; do not restart the frontend to fix an API incident.
