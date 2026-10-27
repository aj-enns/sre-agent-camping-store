#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/deployment-common.sh"
cd "$SCRIPT_DIR/.."
require_env AZURE_ENV_NAME AZURE_LOCATION WEBSITE_PRINCIPAL_ID
select_subscription
load_current_images

parameters=(
  "environmentName=$AZURE_ENV_NAME"
  "location=$AZURE_LOCATION"
  "resourceGroupName=$AZURE_RESOURCE_GROUP"
  "websitePrincipalId=$WEBSITE_PRINCIPAL_ID"
  "deployerPrincipalType=ServicePrincipal"
  "apiImage=$API_IMAGE"
  "frontendImage=$FRONTEND_IMAGE"
  "frontendOrigin=$FRONTEND_ORIGIN"
)

az bicep build --file infra/main.bicep --stdout > /dev/null
az deployment sub create --name "camping-store-${AZURE_ENV_NAME}" \
  --location "$AZURE_LOCATION" --template-file infra/main.bicep \
  --parameters "${parameters[@]}" --output none

{
  printf '## Infrastructure deployed\n\nResource group: `%s`\n\n' "$AZURE_RESOURCE_GROUP"
  printf 'Run **Deploy website** next.\n'
} | tee -a "${GITHUB_STEP_SUMMARY:-/dev/null}"
