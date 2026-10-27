#!/usr/bin/env bash
set -euo pipefail

require_env() {
  local name
  for name in "$@"; do
    if [[ -z "${!name:-}" ]]; then
      echo "ERROR: Set $name before deploying." >&2
      return 1
    fi
  done
}

select_subscription() {
  require_env AZURE_SUBSCRIPTION_ID AZURE_RESOURCE_GROUP
  az account set --subscription "$AZURE_SUBSCRIPTION_ID"
}

az_tsv() {
  az "$@" --output tsv | tr -d '\r'
}

load_apps() {
  local outputs
  outputs=$(az deployment group show --resource-group "$AZURE_RESOURCE_GROUP" \
    --name resources-deployment --query properties.outputs --output json)
  API_APP=$(jq -er '.containerAppName.value | select(length > 0)' <<< "$outputs")
  FRONTEND_APP=$(jq -er '.frontendAppName.value | select(length > 0)' <<< "$outputs")
  ACR_NAME=$(jq -er '.acrName.value | select(length > 0)' <<< "$outputs")
  ACR_SERVER=$(jq -er '.acrLoginServer.value | select(length > 0)' <<< "$outputs")
}

load_current_images() {
  API_IMAGE='mcr.microsoft.com/dotnet/samples:aspnetapp'
  FRONTEND_IMAGE='mcr.microsoft.com/azuredocs/containerapps-helloworld:latest'
  FRONTEND_ORIGIN=''
  local deployment_names apps frontend_fqdn group_exists
  group_exists=$(az_tsv group exists --name "$AZURE_RESOURCE_GROUP")
  if [[ "$group_exists" == false ]]; then
    return 0
  fi
  if [[ "$group_exists" != true ]]; then
    echo "ERROR: Could not determine whether resource group $AZURE_RESOURCE_GROUP exists." >&2
    return 1
  fi
  apps=$(az_tsv containerapp list --resource-group "$AZURE_RESOURCE_GROUP" --query 'length(@)')
  if [[ ! "$apps" =~ ^[0-9]+$ ]]; then
    echo "ERROR: Could not determine the Container App count in $AZURE_RESOURCE_GROUP." >&2
    return 1
  fi
  if [[ "$apps" == 0 ]]; then
    echo "No Container Apps deployed yet; using bootstrap images for provisioning." >&2
    return 0
  fi
  deployment_names=$(az_tsv deployment group list --resource-group "$AZURE_RESOURCE_GROUP" \
    --query '[].name')
  if grep -Fxq resources-deployment <<< "$deployment_names"; then
    load_apps
    API_IMAGE=$(az_tsv containerapp show --resource-group "$AZURE_RESOURCE_GROUP" \
      --name "$API_APP" --query 'properties.template.containers[0].image')
    FRONTEND_IMAGE=$(az_tsv containerapp show --resource-group "$AZURE_RESOURCE_GROUP" \
      --name "$FRONTEND_APP" --query 'properties.template.containers[0].image')
    frontend_fqdn=$(az_tsv containerapp show --resource-group "$AZURE_RESOURCE_GROUP" \
      --name "$FRONTEND_APP" --query properties.configuration.ingress.fqdn)
    require_env API_IMAGE FRONTEND_IMAGE frontend_fqdn
    FRONTEND_ORIGIN="https://$frontend_fqdn"
  else
    echo "ERROR: Existing apps have no resources-deployment record. Refusing to overwrite their images." >&2
    return 1
  fi
}
