<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.alice.cobbler-output</string>
  <key>ProgramArguments</key>
  <!-- 入口是 bash 脚本不是 node：launchd 下 node 读 ~/Downloads 撞 TCC 无声卡死（10-31 探针：bash glob ok、
       grep 子进程 ok、node 子进程 HANG），所以 output-card.sh 用 bash+grep 扫 README 写池文件，node 只读池文件发卡。 -->
  <array>
    <string>/bin/bash</string>
    <string>__HOME__/Projects/cobbler/nest/output-card.sh</string>
  </array>
  <key>StartCalendarInterval</key>
  <!-- 产出回捞（2026-10-31 立）：工作日 08:20，排在知识扭蛋 08:00 之后；周末不发同 hippo -->
  <array>
    <dict><key>Weekday</key><integer>1</integer><key>Hour</key><integer>8</integer><key>Minute</key><integer>20</integer></dict>
    <dict><key>Weekday</key><integer>2</integer><key>Hour</key><integer>8</integer><key>Minute</key><integer>20</integer></dict>
    <dict><key>Weekday</key><integer>3</integer><key>Hour</key><integer>8</integer><key>Minute</key><integer>20</integer></dict>
    <dict><key>Weekday</key><integer>4</integer><key>Hour</key><integer>8</integer><key>Minute</key><integer>20</integer></dict>
    <dict><key>Weekday</key><integer>5</integer><key>Hour</key><integer>8</integer><key>Minute</key><integer>20</integer></dict>
  </array>
  <key>WorkingDirectory</key><string>__HOME__/Projects/cobbler/nest</string>
  <key>StandardOutPath</key><string>__HOME__/Projects/cobbler/nest/data/output.log</string>
  <key>StandardErrorPath</key><string>__HOME__/Projects/cobbler/nest/data/output.log</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>__HOME__/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
  </dict>
</dict>
</plist>
