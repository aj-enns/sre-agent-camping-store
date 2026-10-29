import json
import sys


def resources_in(value):
    if isinstance(value, dict):
        if "type" in value and "apiVersion" in value:
            yield value
        for child in value.values():
            yield from resources_in(child)
    elif isinstance(value, list):
        for child in value:
            yield from resources_in(child)


template = json.load(sys.stdin)
resources = list(resources_in(template))


def resource(resource_type):
    return next(item for item in resources if item["type"] == resource_type)


registry = resource("Microsoft.ContainerRegistry/registries")
assert registry["sku"]["name"] == "Basic", "Use the simplest registry tier"
assert registry["properties"]["adminUserEnabled"] is False, "Registry admin must be disabled"
assert registry["properties"]["publicNetworkAccess"] == "Enabled", "Standard hosted runners need the public endpoint"
assert registry["properties"]["anonymousPullEnabled"] is False, "Images must require authentication"
assert not any(item["type"].startswith(("Microsoft.Network/", "GitHub.Network/")) for item in resources)

apps = [item for item in resources if item["type"] == "Microsoft.App/containerApps"]
assert len(apps) == 2, "Deploy the API and frontend"
assert {app["tags"]["azd-service-name"] for app in apps} == {"api", "frontend"}
for app in apps:
    assert app["properties"]["template"]["scale"]["minReplicas"] == 1
    assert app["properties"]["template"]["scale"]["maxReplicas"] == 1, "The in-memory API carts and frontend JSON ledger require one replica"
    assert app["identity"]["type"] == "UserAssigned", "Apps must use managed identity"
    configuration = app["properties"]["configuration"]
    assert configuration["activeRevisionsMode"] == "Single", "Traffic must switch to the new revision"
    for registry_entry in configuration["registries"]:
        assert "identity" in registry_entry, "Use managed identity for image pulls"
        assert "passwordSecretRef" not in registry_entry, "No registry passwords"
    assert "dependsOn" not in app["properties"], "Dependencies belong on the resource"

environment = resource("Microsoft.App/managedEnvironments")
assert "vnetConfiguration" not in environment["properties"], "No custom network is needed"
assert environment["properties"]["appLogsConfiguration"]["destination"] == "azure-monitor"
diagnostics = resource("Microsoft.Insights/diagnosticSettings")
assert diagnostics["properties"]["logAnalyticsDestinationType"] == "Dedicated"
assert {item["category"] for item in diagnostics["properties"]["logs"]} == {
    "ContainerAppConsoleLogs",
    "ContainerAppSystemLogs",
}
workspace = resource("Microsoft.OperationalInsights/workspaces")
assert workspace["properties"]["features"]["disableLocalAuth"] is True
insights = resource("Microsoft.Insights/components")
assert insights["properties"]["DisableLocalAuth"] is True
serialized = json.dumps(template).lower()
for forbidden in ("listkeys(", "listcredentials(", "sharedkey", "passwordsecretref"):
    assert forbidden not in serialized, f"Shared-key authentication is forbidden: {forbidden}"
assert not any(item["type"] == "Microsoft.Storage/storageAccounts" for item in resources)

print("PASS: ACR Basic requires authentication; no networking, storage accounts, or shared keys")
