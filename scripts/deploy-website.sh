#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/deployment-common.sh"
cd "$SCRIPT_DIR/.."
select_subscription
load_apps

registry_access=$(az_tsv acr show --name "$ACR_NAME" --query publicNetworkAccess)
registry_admin=$(az_tsv acr show --name "$ACR_NAME" --query adminUserEnabled)
registry_anonymous=$(az_tsv acr show --name "$ACR_NAME" --query anonymousPullEnabled)
if [[ "$registry_access" != Enabled || "$registry_admin" != false || "$registry_anonymous" != false ]]; then
  echo "ERROR: Registry must have its public endpoint enabled, with admin and anonymous access disabled." >&2
  exit 1
fi

sha="${GITHUB_SHA:-$(git rev-parse HEAD)}"
tag="${sha}-${GITHUB_RUN_ID:-$(date -u +%Y%m%d%H%M%S)-${RANDOM}}-${GITHUB_RUN_ATTEMPT:-1}"
api_image="$ACR_SERVER/camping-api:$tag"
frontend_image="$ACR_SERVER/camping-frontend:$tag"
az acr login --name "$ACR_NAME"
docker build --pull --build-arg API_VERSION=v1 \
  --build-arg "NUGET_SOURCE=${NUGET_SOURCE:-https://api.nuget.org/v3/index.json}" \
  --tag "$api_image" src/api
docker build --pull --tag "$frontend_image" src/frontend
docker push "$api_image"
docker push "$frontend_image"

api_fqdn=$(az_tsv containerapp show --resource-group "$AZURE_RESOURCE_GROUP" \
  --name "$API_APP" --query properties.configuration.ingress.fqdn)
frontend_fqdn=$(az_tsv containerapp show --resource-group "$AZURE_RESOURCE_GROUP" \
  --name "$FRONTEND_APP" --query properties.configuration.ingress.fqdn)
require_env api_fqdn frontend_fqdn
api_url="https://$api_fqdn"
frontend_url="https://$frontend_fqdn"

wait_ready() {
  local app="$1" revision="$2" ready
  require_env revision
  for ((attempt=0; attempt<60; attempt++)); do
    ready=$(az_tsv containerapp show --resource-group "$AZURE_RESOURCE_GROUP" \
      --name "$app" --query properties.latestReadyRevisionName)
    if [[ "$ready" == "$revision" ]]; then return 0; fi
    sleep 10
  done
  echo "ERROR: $app revision $revision did not become ready within 10 minutes." >&2
  return 1
}

api_revision=$(az_tsv containerapp update --resource-group "$AZURE_RESOURCE_GROUP" \
  --name "$API_APP" --image "$api_image" \
  --set-env-vars "AllowedOrigins__0=$frontend_url" API_VERSION=v1 \
  --query properties.latestRevisionName)
wait_ready "$API_APP" "$api_revision"

frontend_revision=$(az_tsv containerapp update --resource-group "$AZURE_RESOURCE_GROUP" \
  --name "$FRONTEND_APP" --image "$frontend_image" \
  --set-env-vars "REACT_APP_API_BASE_URL=$api_url/api" \
  --query properties.latestRevisionName)
wait_ready "$FRONTEND_APP" "$frontend_revision"

curl_options=(--fail --silent --show-error --retry 12 --retry-all-errors --retry-delay 5 --max-time 30)
curl "${curl_options[@]}" "$api_url/health" | jq -e \
  '.status == "healthy" and .service == "camping-api" and .version == "v1"' > /dev/null
curl "${curl_options[@]}" "$api_url/api/products" | jq -e 'type == "array" and length > 0' > /dev/null
curl "${curl_options[@]}" "$frontend_url/" | grep -q '<div id="root">'
curl "${curl_options[@]}" "$frontend_url/config.js" | grep -Fq "$api_url/api"
{
  printf '## Website deployed\n\nWebsite: %s\n\nAPI: %s\n\nImage tag: `%s`\n' "$frontend_url" "$api_url" "$tag"
} | tee -a "${GITHUB_STEP_SUMMARY:-/dev/null}"
