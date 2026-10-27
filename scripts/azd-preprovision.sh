#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/deployment-common.sh"
require_env AZURE_ENV_NAME
AZURE_RESOURCE_GROUP="${AZURE_RESOURCE_GROUP:-rg-${AZURE_ENV_NAME}}"
select_subscription
load_current_images

for name in AZURE_RESOURCE_GROUP API_IMAGE FRONTEND_IMAGE FRONTEND_ORIGIN; do
  azd env set "$name" "${!name}"
done
