#!/usr/bin/env bash
set -euo pipefail

ACCOUNT_ID="${CF_ACCOUNT_ID:-${CLOUDFLARE_ACCOUNT_ID:-}}"
API_TOKEN="${CF_API_TOKEN:-${CLOUDFLARE_API_TOKEN:-}}"
APP_DOMAIN="${CF_ACCESS_ADMIN_DOMAIN:-safelaunch.runany.dev}"
ADMIN_EMAIL_DOMAIN="${CF_ACCESS_ADMIN_EMAIL_DOMAIN:-safelaunch.app}"
APP_NAME="${CF_ACCESS_ADMIN_APP_NAME:-SafeLaunch Admin}"
DRY_RUN="${DRY_RUN:-false}"

if [[ -z "$ACCOUNT_ID" || -z "$API_TOKEN" ]]; then
  cat >&2 <<'EOF'
Missing required environment.

Set:
  CF_ACCOUNT_ID or CLOUDFLARE_ACCOUNT_ID
  CF_API_TOKEN or CLOUDFLARE_API_TOKEN

Optional:
  CF_ACCESS_ADMIN_DOMAIN=safelaunch.runany.dev
  CF_ACCESS_ADMIN_EMAIL_DOMAIN=safelaunch.app
  CF_ACCESS_ADMIN_APP_NAME="SafeLaunch Admin"
  DRY_RUN=true
EOF
  exit 1
fi

application_payload="$(mktemp)"
policy_payload="$(mktemp)"
response_file="$(mktemp)"
trap 'rm -f "$application_payload" "$policy_payload" "$response_file"' EXIT

cat >"$application_payload" <<EOF
{
  "name": "$APP_NAME",
  "domain": "$APP_DOMAIN/admin/*",
  "type": "self_hosted",
  "session_duration": "24h",
  "allowed_idps": [],
  "auto_redirect_to_identity": false,
  "enable_binding_cookie": true
}
EOF

cat >"$policy_payload" <<EOF
{
  "name": "Allow $ADMIN_EMAIL_DOMAIN admins",
  "decision": "allow",
  "include": [
    {
      "email_domain": {
        "domain": "$ADMIN_EMAIL_DOMAIN"
      }
    }
  ]
}
EOF

if [[ "$DRY_RUN" == "true" ]]; then
  echo "Access application payload:"
  cat "$application_payload"
  echo
  echo "Access policy payload:"
  cat "$policy_payload"
  exit 0
fi

api() {
  local method="$1"
  local path="$2"
  local body="${3:-}"

  if [[ -n "$body" ]]; then
    curl -fsS -X "$method" "https://api.cloudflare.com/client/v4$path" \
      -H "authorization: Bearer $API_TOKEN" \
      -H "content-type: application/json" \
      --data @"$body"
  else
    curl -fsS -X "$method" "https://api.cloudflare.com/client/v4$path" \
      -H "authorization: Bearer $API_TOKEN"
  fi
}

existing_app_id="$(api GET "/accounts/$ACCOUNT_ID/access/apps?name=$(node -e 'process.stdout.write(encodeURIComponent(process.argv[1]))' "$APP_NAME")" | node -e '
const fs = require("node:fs");
const response = JSON.parse(fs.readFileSync(0, "utf8"));
const app = response.result?.find((candidate) => candidate.name === process.argv[1]);
process.stdout.write(app?.id ?? "");
' "$APP_NAME")"

if [[ -n "$existing_app_id" ]]; then
  api PUT "/accounts/$ACCOUNT_ID/access/apps/$existing_app_id" "$application_payload" >"$response_file"
else
  api POST "/accounts/$ACCOUNT_ID/access/apps" "$application_payload" >"$response_file"
fi

app_id="$(node -e '
const fs = require("node:fs");
const response = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
if (!response.success || !response.result?.id) {
  console.error(JSON.stringify(response, null, 2));
  process.exit(1);
}
process.stdout.write(response.result.id);
' "$response_file")"

policy_response="$(api GET "/accounts/$ACCOUNT_ID/access/apps/$app_id/policies")"
existing_policy_id="$(printf '%s' "$policy_response" | node -e '
const fs = require("node:fs");
const response = JSON.parse(fs.readFileSync(0, "utf8"));
const policy = response.result?.find((candidate) => candidate.name === process.argv[1]);
process.stdout.write(policy?.id ?? "");
' "Allow $ADMIN_EMAIL_DOMAIN admins")"

if [[ -n "$existing_policy_id" ]]; then
  api PUT "/accounts/$ACCOUNT_ID/access/apps/$app_id/policies/$existing_policy_id" "$policy_payload" >/dev/null
else
  api POST "/accounts/$ACCOUNT_ID/access/apps/$app_id/policies" "$policy_payload" >/dev/null
fi

echo "Configured Cloudflare Access app $app_id for https://$APP_DOMAIN/admin/*"
echo "Verify: curl -sSIL https://$APP_DOMAIN/admin/legal"
