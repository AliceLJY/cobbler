#!/bin/bash
set -euo pipefail
NODE_BIN="$(command -v node)"
DIR="$(cd "$(dirname "$0")" && pwd)"
mkdir -p "$DIR/data"
for name in com.alice.cobbler-nest com.alice.cobbler-api com.alice.cobbler-hippo com.alice.cobbler-hippo-listen com.alice.cobbler-museum com.alice.cobbler-book; do
  sed -e "s|__HOME__|$HOME|g" -e "s|__NODE__|$NODE_BIN|g" \
    "$DIR/launchd/$name.plist.tpl" > "$HOME/Library/LaunchAgents/$name.plist"
  chmod 644 "$HOME/Library/LaunchAgents/$name.plist"
  launchctl bootout "gui/$(id -u)/$name" 2>/dev/null || true
  sleep 3
  launchctl bootstrap "gui/$(id -u)" "$HOME/Library/LaunchAgents/$name.plist"
done
echo "已装载。tailscale serve 暴露(10000 端口,443/8443 已有主):"
echo "  tailscale serve --bg --https=10000 http://127.0.0.1:8790"
echo "验收:curl -s http://127.0.0.1:8790/api/state | head -c 200"
