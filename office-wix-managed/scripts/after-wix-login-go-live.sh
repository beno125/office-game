#!/usr/bin/env bash
# Run AFTER `npx wix login` (or CI=true device flow) succeeds — same terminal, Node ≥ 20.11.
set -euo pipefail
cd "$(dirname "$0")/.."
echo "== whoami (must show your intended account) =="
npx wix whoami

NAME="Office Game Live $(date +%Y%m%d-%H%M)"
echo ""
echo "== headless link: business name: $NAME =="
npx @wix/create-new@latest headless link --business-name "$NAME"

echo ""
echo "== build =="
npm run build

echo ""
echo "== release =="
npx wix release -c "Go live from after-wix-login-go-live.sh" -t minor

echo ""
echo "Done. Commit office-wix-managed/wix.config.json when satisfied."
