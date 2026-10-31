#!/bin/bash
# 产出回捞 launchd 入口（2026-10-31）：bash 扫 README 写池文件 → node 读池文件发卡。
# node 不碰 ~/Downloads：launchd 下它读那里会撞 TCC 无声卡死（见 output-card-scan.sh 头注释）。
# 失败出声：扫描失败发 TG 报警退 1（写法同 2026-09-17 定时任务统一排查）。
set -u
NEST="$HOME/Projects/cobbler/nest"
NODE="${NODE:-/opt/homebrew/bin/node}"
NOTIFY="$HOME/Downloads/sync-bridge/scripts-bin/cobbler-notify.sh"
POOL="$NEST/data/output-pool.tsv"
tg() { "$NOTIFY" "$1" >/dev/null 2>&1 || echo "⚠ TG 报警发送失败(cobbler-notify 退出码 $?)"; }
if ! "$NEST/output-card-scan.sh" "${COBBLER_OUTPUT_DIR:-$HOME/Downloads/sync-bridge/AI产出}" > "$POOL.tmp"; then
  rc=$?; echo "[cobbler-output] $(date -u +%FT%TZ) scan fail rc=$rc"
  tg "产出回捞 08:20 失败@$(hostname -s)：扫 AI产出 README 退出码 ${rc}；日志 ~/Projects/cobbler/nest/data/output.log"
  exit 1
fi
mv -f "$POOL.tmp" "$POOL"
"$NODE" "$NEST/output-card.js" --pool "$POOL" "$@"
rc=$?
exit $rc
