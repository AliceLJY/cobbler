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
  <dict><key>Hour</key><integer>21</integer><key>Minute</key><integer>0</integer></dict>
  <key>WorkingDirectory</key><string>__HOME__/Projects/cobbler/nest</string>
  <key>StandardOutPath</key><string>__HOME__/Projects/cobbler/nest/data/hippo.log</string>
  <key>StandardErrorPath</key><string>__HOME__/Projects/cobbler/nest/data/hippo.log</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>__HOME__/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
    <key>NODE_USE_ENV_PROXY</key><string>1</string>
    <key>HTTPS_PROXY</key><string>http://127.0.0.1:7890</string>
  </dict>
</dict>
</plist>
