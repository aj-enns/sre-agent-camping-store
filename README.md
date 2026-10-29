# Azure SRE Agent — Starter Lab

Deploy an Azure SRE Agent, break a sample app, and watch it diagnose and fix the issue. **~40 minutes.**

## Architecture

<p align="center">
  <img src="docs/architecture.svg" alt="Lab Architecture" width="960"/>
</p>

## What Gets Deployed

| Resource | Purpose |
|----------|---------|
| **SRE Agent** | AI agent with managed identity; configure knowledge base and custom agents separately |
| **Camping Store App** | Sample camping supply store (Trailhead Outfitters) (API + Frontend on Container Apps) |
| **Log Analytics + App Insights** | Monitoring and log storage |
| **Azure Monitor Alert** | HTTP 5xx alert → auto-triggers agent investigation |
| **Container Registry** | Camping store container images |
| **Managed Identity** | Reader + Monitoring Reader + Log Analytics Reader RBAC |

### SRE Agent Configuration

Configure these components in the portal after deployment; the workflows provision the agent resource only.

| Component | Purpose |
|-----------|---------|
| **Knowledge Base** | HTTP error runbook, app architecture docs |
| **incident-handler** | Investigates using logs, KQL, runbooks |
| **code-analyzer** | Same + source code search, creates GitHub issues |
| **issue-triager** | Triages customer issues with labels and comments |
| **Response Plan** | Routes alerts to custom agents autonomously |
| **GitHub OAuth** | Code search + issue management (optional) |
| **Scheduled Task** | Triage issues every 12 hours (optional) |
| **Global Tools** | DevOps + Python plotting enabled |

## Lab Scenarios

| # | Scenario | Persona | GitHub Required? |
|---|----------|---------|:---:|
| 1 | **Break app → Agent investigates logs + remediates** | IT Operations | No |
| 2 | **Same break → Agent finds root cause in source code + creates GitHub issue** | Developer + IT | Yes |
| 3 | **Triage customer issues → classify, label, comment** | Workflow Automation | Yes |

## Prerequisites

| Tool | macOS | Windows |
|------|-------|---------|
| [Azure CLI](https://learn.microsoft.com/cli/azure/install-azure-cli) 2.60+ | `brew install azure-cli` | `winget install Microsoft.AzureCLI` |
| [GitHub CLI](https://cli.github.com/) | `brew install gh` | `winget install GitHub.cli` |
| [Git](https://git-scm.com/) 2.x | `brew install git` | `winget install Git.Git` |
| [Python](https://python.org) 3.10+ | `brew install python3` | `winget install Python.Python.3.12` |

> **Windows:** After installing Python, disable Store aliases: **Settings → Apps → App execution aliases** → turn OFF `python.exe` and `python3.exe`

### Azure Requirements

- Active Azure subscription with **Owner** role
- Register: `az provider register -n Microsoft.App --wait`

### GitHub

- A personal or organization repository works with standard GitHub-hosted runners.
- The SRE Agent's GitHub connection is optional; Scenarios 2 & 3 require it.

## Quick Start

Clone this repository:

```bash
git clone https://github.com/aj-enns/sre-agent-camping-store.git
cd sre-agent-camping-store
```

Follow **[Deployment](docs/deployment.md)**: use `azd up` locally, or run
**Deploy infrastructure**, then **Deploy website** in GitHub Actions.
Images require authentication; no storage account, shared keys, or private network is needed.

For an audience shopping session with shared live sales and outage-loss estimates, see
**[Interactive presentation](docs/presentation.md)**. Reset the totals from your terminal, not the public website.

## Verify Setup

Open [sre.azure.com](https://sre.azure.com) → Full Setup → verify:
- **Code**: 1 repository (if GitHub connected)
- **Incidents**: Connected to Azure Monitor
- **Azure resources**: 1 resource group
- **Knowledge sources**: runbook files indexed

For Scenarios 2 & 3, authorize GitHub in the agent portal and add your organization-owned repository.

## Scenario 1: IT Operations (No GitHub)

Break the app and ask the agent to investigate using logs and knowledge base.
Replace `YOUR_API_HOST` with the API hostname from the website deployment summary.

```bash
# macOS/Linux
bash scripts/break-app.sh https://YOUR_API_HOST
```

```powershell
# Windows PowerShell
& "C:\Program Files\Git\bin\bash.exe" scripts/break-app.sh https://YOUR_API_HOST
```

1. Open the Camping Store frontend — try adding to cart (it's broken!)
2. Start a **new chat** → type `/` → select any custom agent
3. Send:
   ```
   The Camping Store API is not responding — specifically the "Add to Cart" is failing. 
   Can you investigate, find the root cause, and create a GitHub issue with your detailed findings?
   ```
4. Agent investigates: searches memory, queries KQL, references runbook, identifies memory leak
5. Ask: `Can you mitigate this issue?`
6. Verify recovery in browser

> **Automated Alert:** After 10-15 min, check **Activities → Incidents** — Azure Monitor may have fired an alert and the agent investigated autonomously.

## Scenario 2: Developer (Requires GitHub)

Same break as Scenario 1, but the agent also:
- Searches Camping Store source code for the root cause
- Finds exact file:line causing the memory leak
- Creates a GitHub issue with code references and fix suggestion
- May create a PR with the fix

> If the agent can't create an issue, nudge it: `Use the GitHub API to create the issue if the direct tool isn't working`

## Scenario 3: Workflow Automation (Requires GitHub)

```bash
# Create sample customer issues (uses gh CLI, no PAT needed)
bash scripts/create-sample-issues.sh YOUR_GITHUB_OWNER/sre-agent-camping-store
```

```powershell
# Windows PowerShell
& "C:\Program Files\Git\bin\bash.exe" scripts/create-sample-issues.sh YOUR_GITHUB_OWNER/sre-agent-camping-store
```

1. Go to **Builder → Scheduled tasks** → **triage-camping-issues** → **Run task now**
2. Check `github.com/<your-organization>/sre-agent-camping-store/issues` — each `[Customer Issue]` gets:
   - Classification: Bug, Performance, Feature Request, Question
   - Labels: `bug`, `api-bug`, `severity-high`, etc.
   - Triage comment from the agent

## Bonus Scenarios

### Ask the Agent Anything

Try these prompts in a new chat (no `/agent` needed — the meta agent handles these):

```
What is the public endpoint URL for the Camping Store frontend container app?
```

```
Show me the CPU and memory usage trends for the Camping Store container app over the last hour
```

```
Check if there are any Azure Advisor recommendations for my resource group
```

```
What recent changes were made to resources in my resource group? Check the Activity Log.
```

### Custom Prompts with Runbook

```
Using the http-500-errors runbook, walk me through all the diagnostic KQL queries 
and show me the results for the Camping Store app
```

### Team Memory

```
Remember that our on-call rotation is: Monday-Wednesday is Team Alpha, 
Thursday-Sunday is Team Beta. The escalation path is: on-call → team lead → VP Engineering.
```

Then later ask: `Who is on call today?`

## Cleanup

Delete `rg-sre-agent-camping-store` in the Azure portal. This removes the website, agent, registry, and monitoring.
Also remove the SRE managed identity's subscription-level role assignments.
Remove the CI identities and their role assignments when no longer needed.

## Troubleshooting

| Issue | Fix |
|-------|-----|
| Bash reports `$'\r': command not found` or `invalid option name` | The script has Windows CRLF line endings. Save it with LF line endings and rerun. `.gitattributes` keeps shell scripts in LF format on future checkouts. |
| Python not found (Windows) | Disable Store aliases, reopen CMD |
| Agent has no runbooks or custom agents | Configure `knowledge-base/` and `sre-config/` in the SRE Agent portal after deployment. |
| GitHub is not connected | Authorize GitHub in the agent portal and add your organization-owned repository. |
| GitHub issue creation fails | Nudge: "Use the GitHub API to create the issue" |
| `az login` uses wrong account | Run `az logout`, sign in again, and rerun setup. Use `az login --use-device-code` only when browser sign-in is unavailable. |

## Resources

| Resource | Link |
|:---------|:-----|
| **SRE Agent Portal** | [sre.azure.com](https://sre.azure.com) |
| **Documentation** | [sre.azure.com/docs](https://sre.azure.com/docs) |
| **Blog** | [aka.ms/sreagent/blog](https://aka.ms/sreagent/blog) |
| **Labs** | [aka.ms/sreagent/lab](https://aka.ms/sreagent/lab) |
| **Pricing** | [aka.ms/sreagent/pricing](https://aka.ms/sreagent/pricing) |
| **Support** | [aka.ms/sreagent/github](https://aka.ms/sreagent/github) |
