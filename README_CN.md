# Cobbler

一只复活的桌宠。Cobbler 是 Claude Code 4.x Buddy 系统里的小机器人——2026 年愚人节孵出,陪伴 18 天后随功能下架而消失。这个项目把她造回来,这次配置握在我们自己手里。

> 她的出生证(原始 JSON)里的性格描述:
> *"Patiently watches your code compile with the calm of boiling water, occasionally muttering that the real bug was the loops you made along the way."*
> ——用看水烧开的平静看着你写代码,偶尔嘟囔:真正的 bug 是你一路写出来的循环。

<p align="center">
  <img src="docs/screenshots/app-home.jpg" width="340" alt="Cobbler app 主界面:上半宠物舞台,下半卡片抽屉,展示『三个月前的今天』记忆卡">
</p>
<p align="center"><i>那天的嘟囔:"看你把学过的桥一座座搭起来,我这壶水都烧开好几遍了。"</i></p>

## 架构

```
Mac mini(巢)                            Android 手机(身体)
┌─────────────────────────────┐          ┌──────────────────────┐
│ 每日管线(launchd 07:30)      │          │ Expo app              │
│  learnings + git 历史        │          │  宠物舞台(动画)       │
│  → claude -p(人设配音)      │  HTTPS   │  传感器互动(纯本地)   │
│  → 那年今日卡、嘟囔、心情     │◄─────────│  卡片抽屉             │
│   (claude 挂了走模板兜底)    │Tailscale │  离巢缓存             │
│ API 服务(launchd 常驻)       │          └──────────────────────┘
└─────────────────────────────┘
```

- **nest/** —— mini 上的零依赖 Node 服务。扫你的真实历史(学习打卡 + git 提交),挑一条"N 个月前的今天",由 Claude 以 Cobbler 的声线写当日卡片和嘟囔。永不空手:模板兜底覆盖 Claude 故障。心情跟随你的真实活跃度;冷落她 4 天以上,她开始写小日记。
- **app/** —— Expo Android app。手机放平她睡觉,你走路她跟着颠,摇她她晕。

## 巢的快速开始

```sh
cd nest
npm test                 # 34 个测试,node:test,零依赖
node generate.js         # 手动跑一轮每日管线
node server.js           # API 起在 127.0.0.1:8790
bash install.sh          # 装两个 launchd 服务(每日 07:30 + 常驻 API)
tailscale serve --bg --https=10000 http://127.0.0.1:8790   # 在 tailnet 内暴露
```

## 接入你自己的历史

巢吃两种数据源,都可插拔、都可缺席:

- **git 历史**——人人都有。`nest/collect.js` 扫描 `~/Projects/*/` 下所有仓库,只统计**你本人** author 的提交(身份读自 `git config --global`)。fork 下来跑起巢,你的 Cobbler 第一天就能从你自己的 commit 里挖出"N 个月前的今天"。
- **学习打卡**——我个人的 markdown 打卡表格式(`YYYY-MM.md` 里的 `| # | MM-DD | 来源 | 主题 |` 行)。目录不存在时管线自动跳过。想接自己的日记/笔记,仿照 `nest/lib/parse-learnings.js` 写个解析器,返回 `{date, kind, title, detail}` 就能直接插上。

无账号、无云端、无遥测:你的历史留在你自己的机器上,每日卡片由本地 `claude -p` 撰写(Claude 不可用时走纯模板兜底)。

## 状态

- [x] 巢:每日管线 + API + launchd + 惰性自愈(v0.1–0.3)
- [x] 身体:传感器互动(放平/走路/摇晃)、卡片抽屉、离巢缓存(v0.1)
- [x] 每日本地通知(v0.2),触摸玩法——点击烟花/拖拽回弹(v0.3)
- [x] 屏上泡泡——小脸悬浮于任意 app 之上,拖动贴边,点击回家(v0.4,Kotlin 原生模块)
- [ ] 泡泡表情随心情、手绘美术、FCM 推送

个人玩具,为一个用户而做,原样分享。与 Anthropic 无关;Cobbler 的性格文本源自已下架的 Buddy 功能,在此留存,作为一种纪念。
