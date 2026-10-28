import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
loader = importlib.util.spec_from_file_location("live_report", ROOT / "scripts" / "restore-live-report.py")
module = importlib.util.module_from_spec(loader)
loader.loader.exec_module(module)
SPEC = json.loads(module.SPEC_PATH.read_text(encoding="utf-8"))
RESOURCES = {
    "agentName": "new-agent",
    "agentResourceId": "/subscriptions/new-sub/resourceGroups/new-rg/providers/Microsoft.App/agents/new-agent",
    "subscriptionId": "new-sub", "resourceGroup": "new-rg",
    "workspaceName": "new-law", "workspaceResourceId": "/new-workspace",
    "apiContainerApp": "new-api",
}


class FakeAgent:
    endpoint = "https://new-agent.region.azuresre.ai"

    def __init__(self):
        self.calls = []
        self.reports = []
        self.messages = [{"id": "bootstrap", "author": {"role": "SREAgent"}, "isComplete": True, "text": "Describe the report."}]
        self.thread_state = "Idle"
        self.report_saved = False
        self.save_on_post = True
        self.send_error = False
        self.create_error = False

    def request(self, method, path, body=None):
        self.calls.append((method, path, body))
        if method == "POST" and path.endswith("/authoring-thread"):
            if self.create_error:
                raise RuntimeError("Uncertain create failure")
            return {"authoringThreadId": "thread-1"}
        if method == "POST" and path.endswith("/messages"):
            self.messages.insert(0, {"id": "request", "text": body["text"], "author": {"role": "User"}})
            if self.send_error:
                raise RuntimeError("Uncertain send failure")
            if self.save_on_post:
                self.save_report()
            return {"id": "request"}
        if method == "GET" and "/messages?" in path:
            return {"value": self.messages, "state": self.thread_state}
        if method == "GET" and path.endswith("/reports"):
            return self.reports
        if method == "GET" and path.endswith("/reports/report-1"):
            return {"report": self.reports[0], "currentHtml": "<html>Live report</html>" if self.report_saved else ""}
        raise AssertionError(f"Unexpected request: {method} {path}")

    def save_report(self):
        self.report_saved = True
        self.reports = [{"id": "report-1", "name": SPEC["name"], "currentVersionNumber": 1, "authoringThreadId": "thread-1"}]


class ReportTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.state = Path(self.temp.name) / "state.json"
        self.agent = FakeAgent()
        self.now = 0

    def sleep(self, seconds):
        self.now += seconds

    def restore(self, timeout=30):
        with contextlib.redirect_stdout(io.StringIO()):
            return module.restore(self.agent, SPEC, RESOURCES, self.state, "test-caller",
                                  timeout=timeout, sleep=self.sleep, clock=lambda: self.now)

    def posts(self):
        return [call for call in self.agent.calls if call[0] == "POST"]

    def test_existing_report_is_not_changed(self):
        self.agent.save_report()
        self.assertEqual(self.restore()["id"], "report-1")
        self.assertEqual(self.posts(), [])
        self.assertFalse(self.state.exists())

    def test_missing_report_is_authored_and_saved(self):
        self.assertEqual(self.restore()["id"], "report-1")
        self.assertEqual(len(self.posts()), 2)
        self.assertIsNone(self.posts()[0][2])
        message = self.posts()[1][2]
        self.assertEqual(message["role"], "User")
        self.assertEqual(message["userId"], "test-caller")
        self.assertIn("new-api", message["text"])
        self.assertIn("new-law", message["text"])
        self.assertNotIn("5bgvmbkx3ybqi", message["text"])
        self.assertEqual(json.loads(self.state.read_text())["phase"], "complete")

    def test_timeout_preserves_thread_and_does_not_send_twice(self):
        self.agent.save_on_post = False
        with self.assertRaisesRegex(RuntimeError, "No saved report"):
            self.restore(timeout=6)
        self.assertEqual(json.loads(self.state.read_text())["phase"], "submitted")
        first_posts = len(self.posts())
        with self.assertRaisesRegex(RuntimeError, "No saved report"):
            self.restore(timeout=6)
        self.assertEqual(len(self.posts()), first_posts)

    def test_pending_run_can_finish_in_portal_and_then_be_verified(self):
        self.agent.save_on_post = False
        with self.assertRaises(RuntimeError):
            self.restore(timeout=1)
        self.agent.save_report()
        self.assertEqual(self.restore()["id"], "report-1")
        self.assertEqual(len(self.posts()), 2)
        self.assertEqual(json.loads(self.state.read_text())["phase"], "complete")

    def test_stopped_authoring_is_not_reported_as_success(self):
        self.agent.save_on_post = False
        self.agent.messages = []
        def finish(_seconds):
            self.now += 10
            self.agent.messages.insert(0, {"id": "approval", "author": {"role": "SREAgent"}, "isComplete": True, "text": "Approval is required."})
        with contextlib.redirect_stdout(io.StringIO()), self.assertRaisesRegex(RuntimeError, "approve tools"):
            module.restore(self.agent, SPEC, RESOURCES, self.state, "caller",
                           timeout=30, sleep=finish, clock=lambda: self.now)

    def test_uncertain_send_is_reconciled_without_resending(self):
        self.agent.save_on_post = False
        self.agent.send_error = True
        with self.assertRaisesRegex(RuntimeError, "Uncertain send"):
            self.restore()
        self.assertEqual(json.loads(self.state.read_text())["phase"], "sending")
        self.agent.send_error = False
        with self.assertRaisesRegex(RuntimeError, "No saved report"):
            self.restore(timeout=6)
        self.assertEqual(len(self.posts()), 2)

    def test_unknown_send_outcome_requires_manual_inspection(self):
        self.agent.send_error = True
        with self.assertRaises(RuntimeError):
            self.restore()
        self.agent.messages = []
        with self.assertRaisesRegex(RuntimeError, "will not send it again"):
            self.restore()
        self.assertEqual(len(self.posts()), 2)

    def test_uncertain_creation_does_not_create_duplicate_threads(self):
        self.agent.create_error = True
        with self.assertRaises(RuntimeError):
            self.restore()
        with self.assertRaisesRegex(RuntimeError, "uncertain result"):
            self.restore()
        self.assertEqual(len(self.posts()), 1)

    def test_rebuilt_agent_does_not_reuse_the_old_endpoint_thread(self):
        self.state.write_text(json.dumps({
            "endpoint": "https://old-agent.region.azuresre.ai", "reportName": SPEC["name"],
            "threadId": "old-thread", "phase": "submitted",
        }))
        self.restore()
        self.assertTrue(self.posts()[0][1].endswith("/authoring-thread"))

    def test_duplicate_reports_fail_without_mutation(self):
        self.agent.save_report()
        self.agent.reports *= 2
        with self.assertRaisesRegex(RuntimeError, "Multiple reports"):
            self.restore()
        self.assertEqual(self.posts(), [])

    def test_unfinished_foreign_report_is_not_overwritten(self):
        self.agent.reports = [{"name": SPEC["name"], "id": "draft", "authoringThreadId": "someone-else", "currentVersionNumber": None}]
        with self.assertRaisesRegex(RuntimeError, "unfinished report"):
            self.restore()
        self.assertEqual(self.posts(), [])

    def test_empty_html_is_not_success(self):
        self.agent.save_report()
        self.agent.report_saved = False
        with self.assertRaisesRegex(RuntimeError, "unfinished report"):
            self.restore()

    def test_invalid_report_schema_stops_before_writes(self):
        self.agent.reports = {}
        with self.assertRaisesRegex(RuntimeError, "report-list schema"):
            self.restore()
        self.assertEqual(self.posts(), [])

    def test_prompt_has_read_only_scope_and_no_old_environment_ids(self):
        prompt = module.prompt_for(SPEC, RESOURCES, "request")
        self.assertIn("Do not change resources, roles, permissions", prompt)
        self.assertIn("Do not use an LLM on refresh", prompt)
        self.assertIn("ContainerAppConsoleLogs", prompt)
        self.assertNotIn("d631decb", prompt)
        self.assertNotIn("livereport-696eb819", prompt)

    def test_endpoint_validation_refuses_credential_leaks(self):
        for endpoint in ("http://agent.azuresre.ai", "https://example.com", "https://agent.azuresre.ai.evil.test",
                         "https://user:password@agent.azuresre.ai", "https://agent.azuresre.ai/path"):
            with self.subTest(endpoint=endpoint), self.assertRaises(RuntimeError):
                module.AgentClient(endpoint, "secret")
        self.assertIsNone(module.NoRedirect().redirect_request(None, None, 302, "", {}, "https://example.com"))

    def test_failed_service_envelope_is_not_accepted(self):
        client = module.AgentClient(self.agent.endpoint, "secret")
        response = contextlib.nullcontext(io.BytesIO(b'{"isSuccessful":false,"error":"denied"}'))
        with patch.object(client.opener, "open", return_value=response):
            with self.assertRaisesRegex(RuntimeError, "denied"):
                client.request("GET", "/api/test")

    def test_auth_failure_does_not_expose_token(self):
        client = module.AgentClient(self.agent.endpoint, "secret-token")
        error = module.urllib.error.HTTPError(client.endpoint, 403, "Forbidden", {}, None)
        with patch.object(client.opener, "open", side_effect=error):
            with self.assertRaisesRegex(RuntimeError, "HTTP 403") as caught:
                client.request("GET", "/api/test")
        self.assertNotIn("secret-token", str(caught.exception))

    def test_html_response_is_not_mistaken_for_api_success(self):
        client = module.AgentClient(self.agent.endpoint, "secret")
        response = contextlib.nullcontext(io.BytesIO(b"<html>Sign in</html>"))
        with patch.object(client.opener, "open", return_value=response):
            with self.assertRaisesRegex(RuntimeError, "did not return JSON"):
                client.request("GET", "/api/test")

    def test_dynamic_outputs_are_resolved_using_arm(self):
        values = {
            "AZURE_SUBSCRIPTION_ID": "new-sub", "AZURE_RESOURCE_GROUP": "new-rg",
            "SRE_AGENT_NAME": "new-agent", "CONTAINER_APP_NAME": "new-api",
            "LOG_ANALYTICS_WORKSPACE_ID": "/new-workspace",
        }
        with patch.object(module, "cli", side_effect=[self.agent.endpoint, "new-law"]) as cli:
            endpoint, resources = module.deployment_resources(values)
        self.assertEqual(endpoint, self.agent.endpoint)
        self.assertEqual(resources, RESOURCES)
        self.assertIn(RESOURCES["agentResourceId"], cli.call_args_list[0].args[5])

    def test_dry_run_never_authors_or_requests_data_plane_token(self):
        with patch.object(module, "cli", return_value={}) as cli, \
                patch.object(module, "deployment_resources", return_value=(self.agent.endpoint, RESOURCES)), \
                patch.object(module, "restore") as restore, contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(module.main(["--dry-run"]), 0)
        restore.assert_not_called()
        self.assertEqual(cli.call_count, 1)

    def test_transient_windows_state_file_lock_is_retried(self):
        with patch.object(module.os, "replace", side_effect=[PermissionError("locked"), None]) as replace, \
                patch.object(module.time, "sleep") as sleep:
            module.write_state(self.state, {"phase": "sending"})
        self.assertEqual(replace.call_count, 2)
        sleep.assert_called_once()
        self.assertEqual(json.loads(self.state.with_suffix(".tmp").read_text())["phase"], "sending")

    def test_disabled_hook_does_not_require_python_or_azure(self):
        bash = shutil_bash()
        if not bash:
            self.skipTest("Bash is unavailable")
        env = {**os.environ, "RESTORE_LIVE_REPORT": "false"}
        result = subprocess.run([bash, "scripts/azd-postdeploy.sh"], cwd=ROOT, env=env, capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        env["RESTORE_LIVE_REPORT"] = "invalid"
        result = subprocess.run([bash, "scripts/azd-postdeploy.sh"], cwd=ROOT, env=env, capture_output=True, text=True)
        self.assertNotEqual(result.returncode, 0)

    def test_enabled_hook_uses_python_and_propagates_its_failure(self):
        bash = shutil_bash()
        if not bash:
            self.skipTest("Bash is unavailable")
        python = Path(self.temp.name) / "python"
        python.write_text("#!/usr/bin/env bash\nif [[ \"$1\" == '-c' ]]; then exit 0; fi\necho 'RESTORE_HOOK_CALLED'\nexit 7\n")
        python.chmod(0o755)
        env = {
            **os.environ, "RESTORE_LIVE_REPORT": "true",
            "PATH": self.temp.name + os.pathsep + os.environ["PATH"],
        }
        result = subprocess.run([bash, "scripts/azd-postdeploy.sh"], cwd=ROOT, env=env, capture_output=True, text=True)
        self.assertEqual(result.returncode, 7, result.stderr)
        self.assertIn("RESTORE_HOOK_CALLED", result.stdout)


def shutil_bash():
    if os.name == "nt":
        path = Path(os.environ.get("ProgramFiles", r"C:\Program Files")) / "Git" / "bin" / "bash.exe"
        return str(path) if path.exists() else None
    return shutil.which("bash")


if __name__ == "__main__":
    unittest.main()
