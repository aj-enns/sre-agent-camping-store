[CmdletBinding(SupportsShouldProcess, ConfirmImpact = 'High')]
param(
    [string]$ResourceGroup,
    [string]$FrontendApp,
    [string]$Subscription
)

$ErrorActionPreference = 'Stop'
if (!$ResourceGroup -or !$FrontendApp -or !$Subscription) {
    $values = azd env get-values --output json
    if ($LASTEXITCODE -ne 0) { throw 'Select an azd environment, or supply Subscription, ResourceGroup and FrontendApp.' }
    $environment = $values | ConvertFrom-Json
    if (!$ResourceGroup) { $ResourceGroup = $environment.AZURE_RESOURCE_GROUP }
    if (!$FrontendApp) { $FrontendApp = $environment.FRONTEND_APP_NAME }
    if (!$Subscription) { $Subscription = $environment.AZURE_SUBSCRIPTION_ID }
}
if (!$ResourceGroup -or !$FrontendApp -or !$Subscription) { throw 'Subscription, resource group and frontend app are required.' }
if ($PSCmdlet.ShouldProcess("$Subscription/$ResourceGroup/$FrontendApp", 'Clear presentation sales, averages and outage history')) {
    az containerapp exec --subscription $Subscription --resource-group $ResourceGroup `
        --name $FrontendApp --container camping-frontend --command 'node /app/server/reset.mjs'
    if ($LASTEXITCODE -ne 0) { throw 'Reset command failed. Inspect the frontend logs before retrying.' }
}
