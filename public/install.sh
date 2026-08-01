#!/usr/bin/env bash
# IDEA installer for macOS / Linux (S-52).
#   curl -fsSL https://idea-ideallab.vercel.app/install.sh | bash
# Checks for Node.js 20+, installs it via Homebrew if missing (macOS),
# then starts IDEA (npx @ideallab/idea). Nothing else is touched.
set -euo pipefail

node_major() {
  command -v node >/dev/null 2>&1 || { echo 0; return; }
  node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0
}

if [ "$(node_major)" -lt 20 ]; then
  if command -v brew >/dev/null 2>&1; then
    echo "Node.js 20+ was not found. Installing with Homebrew..."
    brew install node
  else
    echo ""
    echo "Node.js 20+ is needed and no supported installer was found."
    echo "Install it from https://nodejs.org (or your package manager),"
    echo "then run:  npx @ideallab/idea"
    exit 1
  fi
fi

echo ""
echo "Starting IDEA — the first run builds once (a few minutes), then your browser opens."
exec npx --yes @ideallab/idea
