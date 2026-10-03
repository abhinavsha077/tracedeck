#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/dist"
mkdir -p "$OUT"
rm -f "$OUT/tracedeck-extension.zip"
(cd "$ROOT/apps/extension" && zip -qr "$OUT/tracedeck-extension.zip" .)
echo "$OUT/tracedeck-extension.zip"
