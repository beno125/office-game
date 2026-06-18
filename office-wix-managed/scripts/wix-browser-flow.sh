#!/usr/bin/env bash
# Run in macOS Terminal.app or iTerm (full TTY) — NOT from a stripped automation shell.
# Wix opens users.wix.com (or similar) and may ask you to confirm a code shown in the terminal.
set -euo pipefail
cd "$(dirname "$0")/.."
echo "Project: $(pwd)"
echo ""
echo "1) Log in (browser / device code if prompted):"
npx wix whoami 2>/dev/null && echo "(already logged in — run 'npx wix logout' first if you want a fresh browser login)" || true
echo ""
read -r -p "Run 'wix login' now? [y/N] " ans
if [[ "${ans:-}" =~ ^[yY]$ ]]; then
  npx wix login
fi
echo ""
echo "2) Link this folder to a Wix headless site (interactive prompts + browser if needed):"
read -r -p "Run 'npm create @wix/new@latest -- headless link'? [y/N] " ans2
if [[ "${ans2:-}" =~ ^[yY]$ ]]; then
  npm create @wix/new@latest -- headless link
fi
echo ""
echo "Done. Verify: npx wix whoami"
npx wix whoami
