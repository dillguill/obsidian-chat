#!/bin/bash
# Dev-install the built plugin into the Obsidian vault.
# Usage: bash plugin/install.sh
set -euo pipefail

VAULT="${OBSIDIAN_VAULT:-$HOME/Library/Mobile Documents/iCloud~md~obsidian/Documents/Dillon}"
SRC="$(cd "$(dirname "$0")" && pwd)"
DEST="$VAULT/.obsidian/plugins/obsidian-chat"

echo "Source: $SRC"
echo "Vault:  $VAULT"

# Build the production bundle if main.js is missing or stale.
if [ ! -f "$SRC/main.js" ]; then
  (cd "$SRC" && node esbuild.config.mjs production)
fi

mkdir -p "$DEST"
cp "$SRC/main.js" "$DEST/main.js"
cp "$SRC/manifest.json" "$DEST/manifest.json"
cp "$SRC/styles.css" "$DEST/styles.css"
echo "Copied to $DEST"

# Register the plugin as enabled.
PY="import json,os
p=os.path.join('$VAULT','.obsidian','community-plugins.json')
d=[]
if os.path.exists(p):
    d=json.load(open(p))
if 'obsidian-chat' not in d:
    d.append('obsidian-chat')
    json.dump(d, open(p,'w'), indent=1)
print('enabled plugins:', d)"
python3 -c "$PY"

echo "Done. Restart Obsidian (or toggle the plugin) to load it."
