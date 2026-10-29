# Deployment

Use **azd locally** or **two GitHub Actions workflows**. Both deploy the same infrastructure.

| Setting | This installation |
|---|---|
| Subscription | `ME-MngEnvMCAP987131-ajenns-2` |
| Subscription ID | `d631decb-4103-4955-b58c-09669a14f7b6` |
| Resource group | `rg-sre-agent-camping-store` |
| Region | `eastus2` |

The website and API are public. ACR Basic has a public endpoint, but **images require authentication**.
Admin credentials and anonymous pulls are disabled. Apps pull with managed identity; GitHub signs in with OIDC.
No storage account, shared keys, client secrets, private endpoints, VNet, NAT Gateway, or special runners.
Images are pushed only to your ACR. Build copies also exist on your machine or temporarily on the GitHub runner, outside your subscription.
Azure resources and any billable runner usage incur charges.

## Deploy locally with azd

Install [azd](https://learn.microsoft.com/azure/developer/azure-developer-cli/install-azd),
[Azure CLI](https://learn.microsoft.com/cli/azure/install-azure-cli), Docker, and jq.
Start Docker with Linux containers. Run from the repository root.
On Windows, use native PowerShell 7 and install Git for Windows in its default location.
The Windows hook explicitly uses Git Bash, not WSL Bash. On macOS/Linux, use Bash.
Your Azure account needs subscription **Owner** and access to SRE Agent in `eastus2`.

```bash
az login
azd auth login
az account set --subscription d631decb-4103-4955-b58c-09669a14f7b6
az extension add --name containerapp --upgrade --yes
azd env new sre-agent-camping-store
azd env set AZURE_SUBSCRIPTION_ID d631decb-4103-4955-b58c-09669a14f7b6
azd env set AZURE_RESOURCE_GROUP rg-sre-agent-camping-store
azd env set AZURE_LOCATION eastus2
azd up
```

Select an existing environment with `azd env select sre-agent-camping-store` instead of `env new`.
Open `FRONTEND_APP_URL` from `azd env get-values`.

If your network requires a NuGet proxy, run `azd env set NUGET_SOURCE YOUR_FEED_URL` before `azd up`.
This local setting is ignored by Git. Other builds default to NuGet.org.
Use a feed URL without embedded credentials; TLS validation remains enabled.

| Command | Does |
|---|---|
| `azd provision` | Infrastructure only; preserves deployed images |
| `azd deploy` | Builds, pushes, and deploys the API and frontend |
| `azd up` | Both |

The pre-provision hook reads live image references, so infrastructure reruns do not restore sample images.
If first provision fails before creating any apps, reruns safely reuse the bootstrap images.
Keep the same environment name and resource group when switching between azd and Actions.
Do not run local azd while an Actions deployment is running; GitHub's deployment lock does not cover local commands.

## Deploy with GitHub Actions

A personal repository works. Both workflows use `ubuntu-latest`.
Publish these files to `main` before configuring deployments.

### One-time Azure connection

Create two [Entra app registrations and service principals](https://learn.microsoft.com/entra/identity-platform/howto-create-service-principal-portal):
`camping-store-infra` and `camping-store-website`. Do not create client secrets.

For each app, add a **GitHub Actions federated credential**:

| Field | Value |
|---|---|
| Owner / repository | Your repository, e.g. `aj-enns/sre-agent-camping-store` |
| Entity type / environment | Environment / `lab` |
| Issuer | `https://token.actions.githubusercontent.com` |
| Subject | `repo:aj-enns/sre-agent-camping-store:environment:lab` (adjust for a fork) |
| Audience | `api://AzureADTokenExchange` |

In subscription IAM, give the **infrastructure service principal**:
**Contributor** and **Role Based Access Control Administrator**.
Subscription scope is required to create the resource group and SRE Agent subscription roles.
The infrastructure template grants the website principal `AcrPush` on ACR,
Reader and Container Apps Contributor on the resource group, and Managed Identity Operator on the app identity.

### Repository configuration

Create **Settings > Environments > lab**. Restrict deployments to `main`; enable approvals where supported.
Add these **environment variables** under `lab` (not secrets):

| Variable | Value |
|---|---|
| `AZURE_SUBSCRIPTION_ID` | `d631decb-4103-4955-b58c-09669a14f7b6` |
| `AZURE_TENANT_ID` | Your directory's tenant ID |
| `INFRA_AZURE_CLIENT_ID` | Infrastructure app's application/client ID |
| `WEBSITE_AZURE_CLIENT_ID` | Website app's application/client ID |
| `WEBSITE_PRINCIPAL_ID` | Website **enterprise application's object ID**, not its client ID or app-registration object ID |

Defaults are `AZURE_ENV_NAME=sre-agent-camping-store`, `AZURE_RESOURCE_GROUP=rg-sre-agent-camping-store`,
and `AZURE_LOCATION=eastus2`. Set these variables too if using different values.

### Run the workflows

1. **Actions > Deploy infrastructure > Run workflow**, using `main`.
2. **Actions > Deploy website > Run workflow**, using `main`.
3. Open the website URL in the run summary.

First provision uses Microsoft sample images; the store is ready after website deployment.
The website workflow builds both images, uses unique commit/run tags, deploys API before frontend,
waits for ready revisions, and checks endpoints.
Both apps run one replica for the [shared presentation ledger](presentation.md).
The frontend now serves the site and proxies API requests; its container-local JSON survives API restarts,
not frontend redeployments. Deploy outside a presentation session.

Later pushes to `infra/**` deploy infrastructure; pushes to `src/**` deploy the website.
Both workflows share a lock. A push changing both can queue in either order; use the manual order above for first installation.
Neither workflow runs from pull requests.

## Configure the lab

Deployment creates the SRE Agent resource, not its runbooks, custom agents, or GitHub connection.
In [SRE Agent](https://sre.azure.com), configure `knowledge-base/` and `sre-config/`; authorize GitHub if needed.
For Actions installations, give your portal user **SRE Agent Administrator** on the agent in Azure IAM.

After an azd deployment, the optional interactive helper is:

```bash
bash scripts/post-provision.sh --skip-build
```

Always use `--skip-build` here; azd already deployed the website.
`scripts/setup.sh` remains an interactive full-lab alternative and calls that helper after `azd up`.

### Restore the live report after rebuilding

The saved specification is `sre-config/reports/camping-api-health.json`.
To recreate **Camping Store – API Health Overview** after an azd deployment:

```powershell
azd env set RESTORE_LIVE_REPORT true
azd up
```

Install Python 3 first. The opt-in post-deploy hook runs after `azd up` or `azd deploy`.
It reads the new agent endpoint, API name, and workspace from the selected deployment.
An existing saved report is left unchanged.

The script uses preview data-plane endpoints to start report authoring, not a report-import API.
Recreation consumes agent units; layout may differ. It requests read-only monitoring tools and never
changes permissions or approves tools for you. Open the printed authoring-thread link if approval
or clarification is needed. A pending, failed, or timed-out run exits nonzero; rerunning reuses the pending thread.
Completion means a saved report with nonempty HTML was verified, not that every query was successfully executed.

To run it separately, including after a GitHub Actions deployment once the selected azd environment
has current outputs (`azd env refresh`):

```powershell
python .\scripts\restore-live-report.py
```

Use `--dry-run` to print the resolved specification without authoring.
The deployment identity needs SRE Agent read/write access and the agent needs access to its monitoring workspace.
The website workflow does **not** run this step or receive extra SRE permissions.
Disable the hook with `azd env set RESTORE_LIVE_REPORT false`.
Keep `.azure/` for resumable authoring state; it contains no access tokens.
This recreates the report definition, not deleted telemetry, past incidents, or the original report URL.

## Troubleshooting

| Failure | Check |
|---|---|
| Docker Linux engine pipe not found | Start Docker Desktop and wait for `docker info` to succeed |
| Hook cannot find `C:/.../azd-preprovision-*.sh` | Use native PowerShell on Windows; the Windows hook needs PowerShell 7 and Git for Windows |
| OIDC sign-in denied | Federated subject matches your repository and environment `lab` |
| Frontend logs show `listen EACCES` on port 80 | The non-root Node frontend requires port 8080. Use the updated infrastructure and frontend image; run `azd up` to apply both. |
| Registry push/pull denied | Deployer has `AcrPush` or Owner; app identity has `AcrPull`; allow role propagation |
| Subscription deployment denied | Infrastructure identity has Contributor and RBAC Administrator at subscription scope |
| Agent unavailable | Register `Microsoft.App`; confirm subscription access to SRE Agent in `eastus2` |
| API Docker restore fails with TLS errors | Set `NUGET_SOURCE` to your approved proxy feed; do not disable certificate checks |
| `ManagedEnvironmentProvisioningError` while initializing `ManagedCluster` | Check the environment's deployment errors, Activity Log, and regional quota. Retry if Azure reports a transient failure; only recreate a failed environment after checking its workloads. Keep the rest of the resource group. |

Failures stop deployment; there is no automatic two-service rollback.
For Actions, rerun **Deploy website**. For azd, rerun `azd deploy`.
