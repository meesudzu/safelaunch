#!/usr/bin/env bash
# Setup Cloudflare Access for SafeLaunch admin console.
# OAuth token (wrangler login) does NOT include access:org scope.
# You need an API Token with these scopes:
#   - access:org:write (create/update Access apps + policies)
#   - account:read    (verify token)
#
# Generate API Token at:
#   https://dash.cloudflare.com/profile/api-tokens
#   → Create Token → Custom Token → add scopes above

set -euo pipefail

ACCOUNT="d6d37dd4a65eea30f2600687beb90345"   # New Dawn
ZONE="36a4f7f0ee36558ac614512c6aa47b32"        # runany.dev
DOMAIN="safelaunch.runany.dev"
APP_NAME="SafeLaunch Admin Console"
APP_PATH="/admin/legal/*"

if [[ -z "${CF_API_TOKEN:-}" ]]; then
  echo "❌ Set CF_API_TOKEN env var first:"
  echo "   export CF_API_TOKEN='your-api-token-here'"
  exit 1
fi

# 1) Create the Access Application (self-hosted, behind the web Worker)
echo "=== 1. Creating Access Application ==="
APP_JSON=$(curl -sS -X POST \
  "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT/access/apps" \
  -H "Authorization: Bearer $CF_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d "$(cat <<JSON
{
  "name": "$APP_NAME",
  "domain": "$DOMAIN",
  "path": "$APP_PATH",
  "type": "self_hosted",
  "session_duration": "24h",
  "app_launcher_url": "https://$DOMAIN/admin/legal",
  "name_id_format": "uuid",
  "custom_deny_url": "https://$DOMAIN"
}
JSON
)")
echo "$APP_JSON" | python3 -m json.tool 2>&1 | head -25

APP_ID=$(echo "$APP_JSON" | python3 -c "import sys, json; d=json.load(sys.stdin); print(d['result']['id']) if d.get('success') else sys.exit(1)" 2>/dev/null || echo "")
if [[ -z "$APP_ID" ]]; then
  echo "❌ Failed to create Access Application — check token scopes and JSON above."
  exit 1
fi
echo "✅ Access App created: $APP_ID"

# 2) Attach an Allow policy: any authenticated @safelaunch.app email
echo ""
echo "=== 2. Creating Allow Policy (@safelaunch.app emails) ==="
POLICY_JSON=$(curl -sS -X POST \
  "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT/access/apps/$APP_ID/policies" \
  -H "Authorization: Bearer $CF_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d "$(cat <<JSON
{
  "name": "Admin Reviewers — @safelaunch.app",
  "decision": "allow",
  "include": [
    { "email_domain": "safelaunch.app" }
  ],
  "exclude": [],
  "require": [
    { "everyone": {} }
  ]
}
JSON
)")
echo "$POLICY_JSON" | python3 -m json.tool 2>&1 | head -20

POLICY_ID=$(echo "$POLICY_JSON" | python3 -c "import sys, json; d=json.load(sys.stdin); print(d['result']['id']) if d.get('success') else sys.exit(1)" 2>/dev/null || echo "")
if [[ -z "$POLICY_ID" ]]; then
  echo "❌ Failed to create policy"
  exit 1
fi
echo "✅ Allow policy attached: $POLICY_ID"

# 3) Print dashboard URL for manual tweaks
echo ""
echo "=== 3. Verify ==="
echo "Zero Trust dashboard: https://dash.cloudflare.com/$ACCOUNT/access/apps"
echo "Worker already trusts the cf-access-authenticated-user-email header"
echo "  (see apps/workers/src/routes/admin.ts:RESOLVED_ACTOR)."
