#!/usr/bin/env python3
"""Recreate the saved live-report specification through SRE Agent authoring."""

import argparse
import base64
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid

ROOT = Path(__file__).resolve().parent.parent
SPEC_PATH = ROOT / "sre-config" / "reports" / "camping-api-health.json"


def cli(*args):
    executable = shutil.which(args[0])
    if not executable:
        raise RuntimeError(f"{args[0]} is required and was not found on PATH.")
    result = subprocess.run(
        [executable, *args[1:]], cwd=ROOT, capture_output=True,
        text=True, encoding="utf-8", check=False,
    )
    if result.returncode:
        raise RuntimeError(f"{args[0]} failed: {result.stderr.strip()}")
    try:
        return json.loads(result.stdout)
    except json.JSONDecodeError as error:
        raise RuntimeError(f"{args[0]} did not return valid JSON.") from error


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, file, code, message, headers, new_url):
        return None


class AgentClient:
    def __init__(self, endpoint, token):
        parsed = urllib.parse.urlsplit(endpoint)
        if (parsed.scheme != "https" or not parsed.hostname
                or not parsed.hostname.endswith(".azuresre.ai")
                or parsed.username or parsed.password or parsed.query or parsed.fragment
                or parsed.path not in ("", "/") or parsed.port not in (None, 443)):
            raise RuntimeError("The agent endpoint must be an HTTPS azuresre.ai origin.")
        self.endpoint = endpoint.rstrip("/")
        self.token = token
        self.opener = urllib.request.build_opener(NoRedirect())

    def request(self, method, path, body=None):
        request = urllib.request.Request(
            self.endpoint + path,
            data=None if body is None else json.dumps(body).encode("utf-8"),
            headers={"Authorization": f"Bearer {self.token}", "Content-Type": "application/json"},
            method=method,
        )
        try:
            with self.opener.open(request, timeout=60) as response:
                body = response.read()
                data = json.loads(body) if body else None
        except urllib.error.HTTPError as error:
            raise RuntimeError(
                f"SRE Agent {method} {path} returned HTTP {error.code}. "
                "Check agent access and preview API compatibility."
            ) from None
        except (urllib.error.URLError, TimeoutError) as error:
            raise RuntimeError(f"SRE Agent request failed: {error}") from None
        except (ValueError, UnicodeError) as error:
            raise RuntimeError(f"SRE Agent {path} did not return JSON; the preview API may have changed.") from error
        if isinstance(data, dict) and "isSuccessful" in data:
            if not data["isSuccessful"]:
                raise RuntimeError(f"SRE Agent operation failed: {data.get('error', 'No error detail returned')}")
            return data.get("content")
        return data


def prompt_for(spec, resources, request_id):
    return (
        f"Deployment request: {request_id}\n"
        "Recreate this report for the current Camping Store deployment.\n"
        f"Exact report name: {spec['name']}\n"
        f"Current resources:\n{json.dumps(resources, indent=2)}\n"
        "Requirements:\n" + "\n".join(f"- {item}" for item in spec["requirements"])
    )


def write_state(path, state):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(".tmp")
    temporary.write_text(json.dumps(state, indent=2) + "\n", encoding="utf-8")
    for attempt in range(5):
        try:
            os.replace(temporary, path)
            return
        except PermissionError:
            if attempt == 4:
                raise
            time.sleep(0.1 * (attempt + 1))


def restore(client, spec, resources, state_path, user_id, timeout=600,
            sleep=time.sleep, clock=time.monotonic):
    agent_name = resources["agentName"]
    resource_id = resources["agentResourceId"]
    report_path = f"/api/v1/agents/{urllib.parse.quote(agent_name, safe='')}/reports"
    portal = f"https://sre.azure.com/agents{resource_id}/views"
    identity = {"endpoint": client.endpoint, "reportName": spec["name"]}
    state = json.loads(state_path.read_text(encoding="utf-8")) if state_path.exists() else {}
    if not isinstance(state, dict):
        raise RuntimeError(f"Invalid authoring state in {state_path}; inspect it before retrying.")
    if any(state.get(key) != value for key, value in identity.items()):
        state = {}

    def find_report():
        reports = client.request("GET", report_path)
        if not isinstance(reports, list) or any(
            not isinstance(report, dict) or not report.get("id") or not report.get("name")
            for report in reports
        ):
            raise RuntimeError("Unexpected report-list schema; no report was created.")
        matches = [report for report in reports if report.get("name") == spec["name"]]
        if len(matches) > 1:
            raise RuntimeError("Multiple reports have this name. Resolve the duplicate reports before retrying.")
        return matches[0] if matches else None

    def saved(report):
        if not report:
            return False
        version = report.get("currentVersionNumber")
        if version is None or version == 0:
            return False
        if type(version) is not int or version < 1:
            raise RuntimeError("Unexpected report version; no saved report was verified.")
        detail = client.request("GET", f"{report_path}/{urllib.parse.quote(report['id'], safe='')}")
        if not isinstance(detail, dict) or not isinstance(detail.get("report"), dict):
            raise RuntimeError("Unexpected report-detail schema; no saved report was verified.")
        if detail["report"].get("id") != report["id"] or detail["report"].get("name") != spec["name"]:
            raise RuntimeError("Report metadata changed during verification. Retry after authoring finishes.")
        html = detail.get("currentHtml")
        return isinstance(html, str) and bool(html.strip())

    report = find_report()
    if saved(report):
        if state.get("threadId") == report.get("authoringThreadId") and state.get("phase") != "complete":
            state["phase"] = "complete"
            write_state(state_path, state)
        print(f"Live report already saved; leaving it unchanged: {portal}/liveReports/{report['id']}")
        return report
    if report and report.get("authoringThreadId") != state.get("threadId"):
        raise RuntimeError("An unfinished report already has this name. Complete its authoring thread before retrying.")

    if state.get("phase") == "creating":
        raise RuntimeError(
            f"A previous thread-creation request has an uncertain result. Inspect Live Reports "
            f"before removing {state_path} and retrying; automatic retries could duplicate agent costs."
        )
    if not state.get("threadId") or state.get("phase") == "complete":
        state = {**identity, "phase": "creating", "requestId": str(uuid.uuid4())}
        write_state(state_path, state)
        result = client.request("POST", f"{report_path}/authoring-thread")
        if not isinstance(result, dict) or not result.get("authoringThreadId"):
            raise RuntimeError("Thread creation returned no authoringThreadId. Inspect Live Reports before retrying.")
        state.update(threadId=result["authoringThreadId"], phase="bootstrap")
        write_state(state_path, state)

    thread_id = urllib.parse.quote(state["threadId"], safe="")
    thread_url = f"{portal}/thread/{thread_id}"
    messages_path = f"/api/v1/threads/{thread_id}/messages"
    print(f"Live-report authoring thread: {thread_url}")
    print("Agent units may be consumed. Approve expected read-only tools in the portal if requested.")
    deadline = clock() + timeout
    submitted_at = None
    while clock() < deadline:
        report = find_report()
        if saved(report):
            state["phase"] = "complete"
            write_state(state_path, state)
            print(f"Live report saved: {portal}/liveReports/{report['id']}")
            return report
        messages = client.request("GET", messages_path + "?skip=0&top=100&orderby=timestamp+desc")
        if not isinstance(messages, dict) or not isinstance(messages.get("value"), list) or not messages.get("state"):
            raise RuntimeError(f"Unexpected thread-state schema. Inspect {thread_url} before retrying.")
        items = messages["value"]
        idle = messages["state"] == "Idle"
        marker = f"Deployment request: {state['requestId']}"
        if state["phase"] == "sending":
            if any(marker in (item.get("text") or "") for item in items):
                state["phase"] = "submitted"
                write_state(state_path, state)
            else:
                raise RuntimeError(
                    f"The prior message send has an uncertain result. Inspect {thread_url}; "
                    "the script will not send it again automatically."
                )
        if state["phase"] == "bootstrap" and idle:
            state["phase"] = "sending"
            state["beforeMessageIds"] = [item["id"] for item in items if item.get("id")]
            write_state(state_path, state)
            client.request("POST", messages_path, {
                "text": prompt_for(spec, resources, state["requestId"]),
                "role": "User", "userId": user_id, "displayName": "Deployment automation",
            })
            state["phase"] = "submitted"
            write_state(state_path, state)
            submitted_at = clock()
        elif state["phase"] == "submitted" and idle:
            finished = any(
                item.get("isComplete") and item.get("author", {}).get("role") == "SREAgent"
                and item.get("id") not in state.get("beforeMessageIds", [])
                and marker not in (item.get("text") or "")
                for item in items[:1]
            )
            if finished and (submitted_at is None or clock() - submitted_at >= 10):
                raise RuntimeError(
                    f"The agent stopped before a saved report was verified. Open {thread_url} "
                    "to answer questions, approve tools, or inspect the error, then rerun this script."
                )
        sleep(5)
    raise RuntimeError(
        f"No saved report was verified within {timeout}s. Open {thread_url}, complete any approval "
        "or authoring steps, then rerun; the pending thread will be reused."
    )


def deployment_resources(values):
    if not isinstance(values, dict):
        raise RuntimeError("The selected azd environment did not return a settings object.")
    required = ("AZURE_SUBSCRIPTION_ID", "AZURE_RESOURCE_GROUP", "SRE_AGENT_NAME",
                "CONTAINER_APP_NAME", "LOG_ANALYTICS_WORKSPACE_ID")
    missing = [key for key in required if not values.get(key)]
    if missing:
        raise RuntimeError(f"Missing deployment outputs: {', '.join(missing)}. Provision and deploy first.")
    subscription, group, agent = (values[key] for key in required[:3])
    resource_id = f"/subscriptions/{subscription}/resourceGroups/{group}/providers/Microsoft.App/agents/{agent}"
    endpoint = cli("az", "rest", "--method", "GET", "--url",
                   f"https://management.azure.com{resource_id}?api-version=2025-05-01-preview",
                   "--query", "properties.agentEndpoint", "--output", "json")
    workspace = cli("az", "resource", "show", "--ids", values["LOG_ANALYTICS_WORKSPACE_ID"],
                    "--api-version", "2023-09-01", "--query", "name", "--output", "json")
    if not isinstance(endpoint, str) or not endpoint or not isinstance(workspace, str) or not workspace:
        raise RuntimeError("Azure did not return the current agent endpoint and workspace name.")
    return endpoint, {
        "subscriptionId": subscription, "resourceGroup": group,
        "agentName": agent, "agentResourceId": resource_id,
        "apiContainerApp": values["CONTAINER_APP_NAME"], "workspaceName": workspace,
        "workspaceResourceId": values["LOG_ANALYTICS_WORKSPACE_ID"],
    }


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true", help="Print the resolved specification; do not contact the agent.")
    parser.add_argument("--timeout", type=int, default=600, help="Maximum authoring wait in seconds (default: 600).")
    args = parser.parse_args(argv)
    if args.timeout < 1:
        parser.error("--timeout must be positive")
    try:
        values = cli("azd", "env", "get-values", "--output", "json")
        spec = json.loads(SPEC_PATH.read_text(encoding="utf-8"))
        endpoint, resources = deployment_resources(values)
        if args.dry_run:
            print(prompt_for(spec, resources, "DRY-RUN"))
            return 0
        token = cli("az", "account", "get-access-token", "--subscription", resources["subscriptionId"],
                    "--resource", "https://azuresre.dev", "--query", "accessToken", "--output", "json")
        if not isinstance(token, str) or not token:
            raise RuntimeError("Azure CLI did not return an SRE Agent token.")
        client = AgentClient(endpoint, token)
        payload = token.split(".")[1]
        claims = json.loads(base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4)))
        user_id = claims.get("oid")
        if not user_id:
            raise RuntimeError("The Azure token has no caller object ID.")
        state_key = uuid.uuid5(uuid.NAMESPACE_URL, resources["agentResourceId"]).hex
        state_path = ROOT / ".azure" / f"live-report-{state_key}.json"
        restore(client, spec, resources, state_path, user_id, timeout=args.timeout)
        return 0
    except (RuntimeError, OSError, ValueError, IndexError) as error:
        print(f"ERROR: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
