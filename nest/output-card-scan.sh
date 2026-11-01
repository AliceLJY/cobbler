#!/bin/bash
# 产出回捞的扫描半截（2026-10-31）：扫 AI产出 各批 README 的状态行，吐 TSV 到 stdout。
# 为什么用 bash 而不是 node：launchd 下 node 读 ~/Downloads 会撞 TCC 无声卡死（10-31 探针实测：
# bash 内建 glob 476 dirs ok、grep 子进程 ok、node 子进程 HANG），/bin/bash 09-17 起有完全磁盘访问。
# 输出列：目录 \t 日期 \t 状态 \t 一句话（没有状态行的批次不输出）。bash 3.2 可跑，无外部依赖除 grep/sed。
# 全角符号一律写成 (:|：) 这种分支，别放进 [...]：launchd 下没有 LANG，C locale 的 grep/sed 把方括号里的
# 全角字符拆成单字节，全角冒号的状态行会整行漏掉（11-01 夜间测试抓到）。
# 用法: output-card-scan.sh [AI产出路径]   退出码 0 = 扫完（0 行也算）/ 2 = 目录不存在
T="${1:-$HOME/Downloads/sync-bridge/AI产出}"
[ -d "$T" ] || { echo "scan: 目录不存在 $T" >&2; exit 2; }
shopt -s nullglob
for d in "$T"/[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]*/; do
  d="${d%/}"; name="${d##*/}"; rd="$d/README.md"
  [ -f "$rd" ] || continue
  line=$(grep -m1 -E '^[[:space:]]*\**状态\**[[:space:]]*(:|：)[[:space:]]*(等Alice|已完成|已放弃|可清|进行中)' "$rd" 2>/dev/null) || continue
  status=$(printf '%s' "$line" | sed -E 's/^[[:space:]]*\**状态\**[[:space:]]*(:|：)[[:space:]]*(等Alice|已完成|已放弃|可清|进行中).*$/\2/')
  note=$(printf '%s' "$line" | sed -E 's/^[[:space:]]*\**状态\**[[:space:]]*(:|：)[[:space:]]*(等Alice|已完成|已放弃|可清|进行中)[[:space:]]*((｜|\|)[[:space:]]*)?//; s/[[:space:]]+$//' | tr '\t' ' ')
  printf '%s\t%s\t%s\t%s\n' "$name" "${name:0:10}" "$status" "$note"
done
exit 0
