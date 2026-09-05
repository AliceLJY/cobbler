#!/bin/bash
set -euo pipefail
NODE_BIN="$(command -v node)"
DIR="$(cd "$(dirname "$0")" && pwd)"
mkdir -p "$DIR/data"
# 本机可选变量（不入仓）：~/.config/cobbler/env，一行一个 KEY=VALUE，例如
#   COBBLER_HIPPO_DIR=/path/to/your/knowledge-vault
# 识别的键见 OPTIONAL_VARS；存在则写进每个 plist 的 EnvironmentVariables，重跑本脚本不丢。
COBBLER_ENV_FILE="${COBBLER_ENV_FILE:-$HOME/.config/cobbler/env}"
OPTIONAL_VARS=(COBBLER_HIPPO_DIR COBBLER_EBOOKS_DIR COBBLER_CLAUDE_BIN COBBLER_CLAUDE_MODEL COBBLER_PORT COBBLER_HOST)
if [ -f "$COBBLER_ENV_FILE" ]; then
  set -a; . "$COBBLER_ENV_FILE"; set +a
fi
for name in com.alice.cobbler-nest com.alice.cobbler-api com.alice.cobbler-hippo com.alice.cobbler-hippo-listen com.alice.cobbler-book; do
  sed -e "s|__HOME__|$HOME|g" -e "s|__NODE__|$NODE_BIN|g" \
    "$DIR/launchd/$name.plist.tpl" > "$HOME/Library/LaunchAgents/$name.plist"
  chmod 644 "$HOME/Library/LaunchAgents/$name.plist"
  for var in "${OPTIONAL_VARS[@]}"; do
    val="${!var:-}"
    [ -n "$val" ] && plutil -replace "EnvironmentVariables.$var" -string "$val" "$HOME/Library/LaunchAgents/$name.plist"
  done
  launchctl bootout "gui/$(id -u)/$name" 2>/dev/null || true
  sleep 3
  launchctl bootstrap "gui/$(id -u)" "$HOME/Library/LaunchAgents/$name.plist"
done
echo "已装载。tailscale serve 暴露(10000 端口,443/8443 已有主):"
echo "  tailscale serve --bg --https=10000 http://127.0.0.1:8790"
echo "验收:curl -s http://127.0.0.1:8790/api/state | head -c 200"
