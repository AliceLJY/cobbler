<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.alice.cobbler-hippo</string>
  <key>ProgramArguments</key>
  <array>
    <string>__NODE__</string>
    <string>__HOME__/Projects/cobbler/nest/hippo-card.js</string>
  </array>
  <key>StartCalendarInterval</key>
  <!-- 只在工作日发（10-17 Alice：周末不想管） -->
  <array>
    <dict><key>Weekday</key><integer>1</integer><key>Hour</key><integer>8</integer><key>Minute</key><integer>0</integer></dict>
    <dict><key>Weekday</key><integer>2</integer><key>Hour</key><integer>8</integer><key>Minute</key><integer>0</integer></dict>
    <dict><key>Weekday</key><integer>3</integer><key>Hour</key><integer>8</integer><key>Minute</key><integer>0</integer></dict>
    <dict><key>Weekday</key><integer>4</integer><key>Hour</key><integer>8</integer><key>Minute</key><integer>0</integer></dict>
    <dict><key>Weekday</key><integer>5</integer><key>Hour</key><integer>8</integer><key>Minute</key><integer>0</integer></dict>
  </array>
  <key>WorkingDirectory</key><string>__HOME__/Projects/cobbler/nest</string>
  <key>StandardOutPath</key><string>__HOME__/Projects/cobbler/nest/data/hippo.log</string>
  <key>StandardErrorPath</key><string>__HOME__/Projects/cobbler/nest/data/hippo.log</string>
  <!-- mini 走 Clash Mi TUN 直连(2026-07-05 实测),不需要代理 env;若将来 TG 发送超时,先查代理模式是否变回端口代理 -->
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>__HOME__/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
  </dict>
</dict>
</plist>
