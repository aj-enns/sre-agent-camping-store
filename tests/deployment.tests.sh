#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TEMP="$(mktemp -d)"
trap 'rm -rf "$TEMP"' EXIT
mkdir -p "$TEMP/bin"
export CALL_LOG="$TEMP/calls"
export GITHUB_STEP_SUMMARY="$TEMP/summary"
export AZURE_SUBSCRIPTION_ID=test-subscription AZURE_RESOURCE_GROUP=rg-test
export AZURE_ENV_NAME=test AZURE_LOCATION=eastus2
export WEBSITE_PRINCIPAL_ID=test-principal
export GITHUB_SHA=abcdef123456 GITHUB_RUN_ID=99 GITHUB_RUN_ATTEMPT=1
unset NUGET_SOURCE

cat > "$TEMP/bin/az" <<'SH'
#!/usr/bin/env bash
printf 'az %s\n' "$*" >> "$CALL_LOG"
case "$1 $2" in
  'account set'|'bicep build'|'acr login') exit 0 ;;
  'group exists')
    if [[ "${GROUP_FAIL:-false}" == true ]]; then exit 1; fi
    printf '%s\r\n' "${EXISTING_GROUP:-false}" ;;
  'deployment group')
    if [[ "$3" == list ]]; then
      if [[ "${UNTRACKED:-false}" != true ]]; then echo resources-deployment; fi
    else
      if [[ "${MISSING_OUTPUTS:-false}" == true ]]; then echo null; exit 0; fi
      echo '{"containerAppName":{"value":"api-app"},"frontendAppName":{"value":"frontend-app"},"acrName":{"value":"privateacr"},"acrLoginServer":{"value":"privateacr.azurecr.io"}}'
    fi ;;
  'deployment sub') [[ "${DEPLOY_FAIL:-false}" != true ]] ;;
  'containerapp list')
    if [[ "${APP_LIST_FAIL:-false}" == true ]]; then exit 1; fi
    if [[ "$*" == *'--output json'* ]]; then
      if [[ "${AMBIGUOUS_APPS:-false}" == true ]]; then echo '[]'; exit 0; fi
      echo '[{"name":"api-app","tags":{"azd-service-name":"api"}},{"name":"frontend-app","tags":{"azd-service-name":"frontend"}}]'
      exit 0
    fi
    printf '%s\r\n' "${APP_COUNT-2}" ;;
  'containerapp show')
    if [[ "${SHOW_FAIL:-false}" == true ]]; then exit 1; fi
    case "$*" in
      *containers*) echo "${EXISTING_IMAGE:-privateacr.azurecr.io/camping:previous-sha}" ;;
      *fqdn*)
        if [[ "$*" == *'--name api-app '* ]]; then
          printf 'api.test\r\n'
        else
          printf 'frontend.test\r\n'
        fi ;;
      *latestReadyRevisionName*)
        if [[ "${NOT_READY:-false}" == true ]]; then
          echo old-revision
        elif [[ "$*" == *'--name api-app '* ]]; then
          echo api-revision
        else
          echo frontend-revision
        fi ;;
      *) exit 1 ;;
    esac ;;
  'containerapp update')
    if [[ "$*" == *'--name api-app '* ]]; then echo api-revision; else echo frontend-revision; fi ;;
  'containerapp ingress')
    [[ "$*" == *'--name frontend-app --target-port 8080'* ]] ;;
  'acr show')
    if [[ "$*" == *publicNetworkAccess* ]]; then
      printf '%s\r\n' "${REGISTRY_ACCESS:-Enabled}"
    elif [[ "$*" == *adminUserEnabled* ]]; then
      printf '%s\r\n' "${REGISTRY_ADMIN:-false}"
    else
      printf '%s\r\n' "${REGISTRY_ANONYMOUS:-false}"
    fi ;;
  *) echo "Unexpected az call: $*" >&2; exit 1 ;;
esac
SH

cat > "$TEMP/bin/docker" <<'SH'
#!/usr/bin/env bash
printf 'docker %s\n' "$*" >> "$CALL_LOG"
[[ "${DOCKER_FAIL:-false}" != true ]]
SH

cat > "$TEMP/bin/curl" <<'SH'
#!/usr/bin/env bash
printf 'curl %s\n' "$*" >> "$CALL_LOG"
case "$*" in
  */health) printf '{"status":"healthy","service":"camping-api","version":"%s"}' "${HEALTH_VERSION:-v1}" ;;
  */api/products) echo '[{"id":1}]' ;;
  */config.js) echo 'window.__CONFIG__ = { apiBaseUrl: "/api" };' ;;
  */demo/metrics) echo '{"sessionId":"test-session","orderCount":0}' ;;
  *) echo '<div id="root"></div>' ;;
esac
SH

cat > "$TEMP/bin/azd" <<'SH'
#!/usr/bin/env bash
printf 'azd %s\n' "$*" >> "$CALL_LOG"
[[ "$1 $2" == 'env set' ]]
SH

cat > "$TEMP/bin/sleep" <<'SH'
#!/usr/bin/env bash
exit 0
SH

chmod +x "$TEMP/bin/"*
export PATH="$TEMP/bin:$PATH"

run() {
  : > "$CALL_LOG"
  : > "$GITHUB_STEP_SUMMARY"
  bash "$ROOT/scripts/$1" > "$TEMP/output" 2>&1
}

run deploy-infra.sh
grep -q 'resourceGroupName=rg-test' "$CALL_LOG"
grep -q 'deployerPrincipalType=ServicePrincipal' "$CALL_LOG"
grep -q 'apiImage=mcr.microsoft.com/dotnet/samples:aspnetapp' "$CALL_LOG"
! grep -q 'docker\|acr build\|containerapp update' "$CALL_LOG"
grep -q 'Infrastructure deployed' "$GITHUB_STEP_SUMMARY"

export API_IMAGE=stale-image FRONTEND_IMAGE=stale-image FRONTEND_ORIGIN=https://stale.test
run azd-preprovision.sh
grep -q 'azd env set API_IMAGE mcr.microsoft.com/dotnet/samples:aspnetapp' "$CALL_LOG"
grep -q 'azd env set FRONTEND_IMAGE mcr.microsoft.com/azuredocs/containerapps-helloworld:latest' "$CALL_LOG"
grep -q 'azd env set AZURE_RESOURCE_GROUP rg-test' "$CALL_LOG"
! grep -q 'deployment sub create\|docker\|containerapp update\|stale' "$CALL_LOG"

export GROUP_FAIL=true
if run deploy-infra.sh; then echo 'FAIL: group lookup failure ignored'; exit 1; fi
! grep -q 'deployment sub create' "$CALL_LOG"
if run azd-preprovision.sh; then echo 'FAIL: azd group lookup failure ignored'; exit 1; fi
! grep -q 'azd env set' "$CALL_LOG"
unset GROUP_FAIL

export EXISTING_GROUP=true
export APP_COUNT=0 MISSING_OUTPUTS=true
run azd-preprovision.sh
grep -q 'azd env set API_IMAGE mcr.microsoft.com/dotnet/samples:aspnetapp' "$CALL_LOG"
grep -q 'azd env set FRONTEND_IMAGE mcr.microsoft.com/azuredocs/containerapps-helloworld:latest' "$CALL_LOG"
grep -q 'No Container Apps deployed yet' "$TEMP/output"
! grep -q 'deployment group show\|containerapp show' "$CALL_LOG"
run deploy-infra.sh
grep -q 'apiImage=mcr.microsoft.com/dotnet/samples:aspnetapp' "$CALL_LOG"
! grep -q 'deployment group show\|containerapp show' "$CALL_LOG"
unset APP_COUNT MISSING_OUTPUTS

for scenario in APP_LIST_FAIL APP_COUNT; do
  case "$scenario" in
    APP_LIST_FAIL) export "$scenario=true" ;;
    APP_COUNT) export "$scenario=invalid" ;;
  esac
  if run azd-preprovision.sh; then echo "FAIL: $scenario ignored"; exit 1; fi
  ! grep -q 'azd env set' "$CALL_LOG"
  if run deploy-infra.sh; then echo "FAIL: $scenario allowed deployment"; exit 1; fi
  ! grep -q 'deployment sub create' "$CALL_LOG"
  unset "$scenario"
done

export MISSING_OUTPUTS=true
run deploy-infra.sh
grep -q 'apiImage=privateacr.azurecr.io/camping:previous-sha' "$CALL_LOG"
grep -q 'frontendImage=privateacr.azurecr.io/camping:previous-sha' "$CALL_LOG"
run azd-preprovision.sh
grep -q 'azd env set API_IMAGE privateacr.azurecr.io/camping:previous-sha' "$CALL_LOG"
export AMBIGUOUS_APPS=true
if run azd-preprovision.sh; then echo 'FAIL: missing tagged apps accepted'; exit 1; fi
! grep -q 'azd env set' "$CALL_LOG"
if run deploy-infra.sh; then echo 'FAIL: missing tagged apps allowed deployment'; exit 1; fi
! grep -q 'deployment sub create' "$CALL_LOG"
unset MISSING_OUTPUTS AMBIGUOUS_APPS

run deploy-infra.sh
grep -q 'apiImage=privateacr.azurecr.io/camping:previous-sha' "$CALL_LOG"
grep -q 'frontendImage=privateacr.azurecr.io/camping:previous-sha' "$CALL_LOG"
grep -q 'frontendOrigin=https://frontend.test' "$CALL_LOG"

run azd-preprovision.sh
grep -q 'azd env set API_IMAGE privateacr.azurecr.io/camping:previous-sha' "$CALL_LOG"
grep -q 'azd env set FRONTEND_IMAGE privateacr.azurecr.io/camping:previous-sha' "$CALL_LOG"
grep -q 'azd env set FRONTEND_ORIGIN https://frontend.test' "$CALL_LOG"

export SHOW_FAIL=true
if run azd-preprovision.sh; then echo 'FAIL: unreadable deployment accepted'; exit 1; fi
! grep -q 'azd env set' "$CALL_LOG"
unset SHOW_FAIL

export UNTRACKED=true
if run deploy-infra.sh; then echo 'FAIL: untracked apps overwritten'; exit 1; fi
! grep -q 'deployment sub create' "$CALL_LOG"
if run azd-preprovision.sh; then echo 'FAIL: azd accepted untracked apps'; exit 1; fi
! grep -q 'azd env set' "$CALL_LOG"
unset UNTRACKED EXISTING_GROUP

export DEPLOY_FAIL=true
if run deploy-infra.sh; then echo 'FAIL: infrastructure failure hidden'; exit 1; fi
[[ ! -s "$GITHUB_STEP_SUMMARY" ]]
unset DEPLOY_FAIL

run deploy-website.sh
grep -q 'docker build --pull --build-arg API_VERSION=v1' "$CALL_LOG"
grep -q -- '--build-arg NUGET_SOURCE=https://api.nuget.org/v3/index.json' "$CALL_LOG"
grep -q 'camping-api:abcdef123456-99-1' "$CALL_LOG"
grep -q 'camping-frontend:abcdef123456-99-1' "$CALL_LOG"
grep -q 'AllowedOrigins__0=https://frontend.test' "$CALL_LOG"
grep -q 'containerapp ingress update.*--name frontend-app --target-port 8080' "$CALL_LOG"
grep -q 'REACT_APP_API_BASE_URL=https://api.test/api' "$CALL_LOG"
[[ $(grep -c -- '--min-replicas 1 --max-replicas 1' "$CALL_LOG") == 2 ]]
[[ $(grep -n 'containerapp update' "$CALL_LOG" | head -1) == *'--name api-app '* ]]
grep -q 'Website deployed' "$GITHUB_STEP_SUMMARY"

export NUGET_SOURCE=https://packages.test/nuget/v3/index.json
run deploy-website.sh
grep -q -- '--build-arg NUGET_SOURCE=https://packages.test/nuget/v3/index.json' "$CALL_LOG"
unset NUGET_SOURCE

for scenario in DOCKER_FAIL REGISTRY_ACCESS REGISTRY_ADMIN REGISTRY_ANONYMOUS NOT_READY HEALTH_VERSION SHOW_FAIL; do
  case "$scenario" in
    DOCKER_FAIL|NOT_READY|REGISTRY_ADMIN|REGISTRY_ANONYMOUS|SHOW_FAIL) export "$scenario=true" ;;
    REGISTRY_ACCESS) export "$scenario=Disabled" ;;
    HEALTH_VERSION) export "$scenario=v2" ;;
  esac
  if run deploy-website.sh; then echo "FAIL: $scenario reported success"; exit 1; fi
  [[ ! -s "$GITHUB_STEP_SUMMARY" ]]
  if [[ "$scenario" != NOT_READY && "$scenario" != HEALTH_VERSION ]]; then
    ! grep -q 'containerapp update' "$CALL_LOG"
  fi
  unset "$scenario"
done

unset AZURE_SUBSCRIPTION_ID
if run deploy-website.sh; then echo 'FAIL: missing subscription accepted'; exit 1; fi
grep -q 'Set AZURE_SUBSCRIPTION_ID' "$TEMP/output"

echo 'PASS: deployment isolation, azd image preservation, authenticated registry, Windows output, tags, and failures'
