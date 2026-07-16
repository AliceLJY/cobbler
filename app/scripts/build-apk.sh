#!/bin/bash
# EAS 构建 APK,自动重试 GCS 上传抖动(mini 的 Clash 链路白天对 GCS 大 PUT 不稳)
# 策略:代理(NODE_USE_ENV_PROXY)与直连交替,最多 6 次,间隔 20s
set -uo pipefail
DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$DIR"
TOKEN_FILE="${EXPO_TOKEN_FILE:-$HOME/.expo-token}"
if [[ ! -r "$TOKEN_FILE" ]]; then
  echo "Expo token file is missing or unreadable: $TOKEN_FILE" >&2
  exit 1
fi
TOKEN="$(<"$TOKEN_FILE")"
if [[ -z "$TOKEN" ]]; then
  echo "Expo token file is empty: $TOKEN_FILE" >&2
  exit 1
fi
for i in 1 2 3 4 5 6; do
  echo "=== build attempt $i ==="
  if [ $((i % 2)) -eq 1 ]; then
    NODE_USE_ENV_PROXY=1 HTTPS_PROXY=http://127.0.0.1:17890 HTTP_PROXY=http://127.0.0.1:17890 \
      EXPO_TOKEN="$TOKEN" npx eas-cli build -p android --profile preview --non-interactive 2>&1 | tee /tmp/eas-build-last.log | tail -6
    status=${PIPESTATUS[0]}
  else
    env -u HTTP_PROXY -u HTTPS_PROXY -u http_proxy -u https_proxy -u ALL_PROXY -u all_proxy \
      EXPO_TOKEN="$TOKEN" npx eas-cli build -p android --profile preview --non-interactive 2>&1 | tee /tmp/eas-build-last.log | tail -6
    status=${PIPESTATUS[0]}
  fi
  if [[ "$status" -eq 0 ]]; then
    echo "=== done (attempt $i) ==="
    exit 0
  fi
  if ! grep -q "Failed to upload" /tmp/eas-build-last.log; then
    echo "=== build failed (attempt $i, exit $status; not an upload error) ===" >&2
    exit "$status"
  fi
  sleep 20
done
echo "=== all attempts failed ==="
exit 1
