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
Mac mini(巢)                                   Android 手机(身体)
┌────────────────────────────────────┐          ┌──────────────────────┐
│ 四条定时投喂                       │          │ Expo app              │
│  07:30 个人历史 → app 记忆卡       │  HTTPS   │  宠物舞台(动画)       │
│  08:30 大都会藏品 → Telegram       │◄─────────│  传感器互动(纯本地)   │
│  12:30 本地藏书 → Telegram         │Tailscale │  卡片与日记抽屉       │
│  21:00 知识页 → Telegram           │          │  离巢缓存             │
│                                    │          └──────────────────────┘
│ 两个常驻进程:本地 API + TG 监听器  │
└────────────────────────────────────┘
```

- **nest/** —— mini 上的零依赖 Node 服务。早晨管线扫描学习打卡和本人 git 提交,挑一条“N 个月前的今天”,再调用本机已安装的 Claude CLI 以 Cobbler 的声线写卡片和嘟囔。Claude 故障时有模板兜底;全新安装如果没有可选历史,仍可能没有记忆卡。另有三条可选扭蛋投喂,分别来自大都会 API、本地藏书和本地知识库。心情跟随真实活跃度;冷落她 4 天以上,她开始写小日记。
- **app/** —— Expo Android app。手机放平她睡觉,你走路她跟着颠,摇她她晕;还会保留离巢缓存、安排早上 8 点的本地通知,并能用原生 Android 模块浮成屏上泡泡。

## 巢的快速开始

```sh
cd nest
npm test                 # node:test 测试,无运行时依赖
node generate.js         # 手动跑一轮每日管线
node server.js           # API 起在 127.0.0.1:8790
bash install.sh          # 安装或重载全部六个个人 launchd 服务
tailscale serve --bg --https=10000 http://127.0.0.1:8790   # 在 tailnet 内暴露
```

`install.sh` 是 Alice 的 Mac mini 专用接线,launchd 模板要求仓库位于 `~/Projects/cobbler`。三条 Telegram 投喂和监听器还需要被 git 忽略的 `nest/data/tg.json`;藏书与知识页投喂依赖 Alice 本机的资料库。只运行 API 或 Android app 不需要这些可选条件。

app 通过 `EXPO_PUBLIC_NEST_URL` 读取巢地址。本地检查时进入 `app/` 执行 `npm install` 和 `npm run check`;EAS 预览构建由 `app/scripts/build-apk.sh` 读取本机 Expo token 文件。

## 接入你自己的历史

巢吃两种数据源,都可插拔、都可缺席:

- **git 历史**——人人都有。`nest/collect.js` 扫描 `~/Projects/*/` 下所有仓库,只统计**你本人** author 的提交(身份读自 `git config --global`)。fork 下来跑起巢,你的 Cobbler 第一天就能从你自己的 commit 里挖出"N 个月前的今天"。
- **学习打卡**——我个人的 markdown 打卡表格式(`YYYY-MM.md` 里的 `| # | MM-DD | 来源 | 主题 |` 行)。目录不存在时管线自动跳过。想接自己的日记/笔记,仿照 `nest/lib/parse-learnings.js` 写个解析器,返回 `{date, kind, title, detail}` 就能直接插上。

Cobbler 自身没有账号、托管后端或遥测。原始历史留在 mini 上,但启用生成时,选中的少量来源文本会经本机安装的 Claude CLI 发送给模型;博物馆卡会访问大都会 API,Telegram 投喂会访问 Bot API,EAS 构建会使用 Expo 服务。来源文本会明确标记为不可信数据,Claude 调用关闭工具、浏览器接入和会话持久化;Claude 不可用时走纯模板兜底。

## 状态

- [x] 巢:每日管线 + API + launchd + 惰性自愈(v0.1–0.3)
- [x] 身体:传感器互动(放平/走路/摇晃)、卡片抽屉、离巢缓存(v0.1)
- [x] 每日本地通知(v0.2),触摸玩法——点击烟花/拖拽回弹(v0.3)
- [x] 屏上泡泡——小脸悬浮于任意 app 之上,拖动贴边,点击回家(v0.4,Kotlin 原生模块)
- [x] 知识页扭蛋(v0.5)、Telegram 追问条与监听器(v0.6)
- [x] 大都会藏品扭蛋(v0.7)、本地藏书扭蛋(v0.8)
- [x] 可靠性、CI、依赖与文档维护(v0.8.1;Android app v0.4.1)
- [ ] 泡泡表情随心情、手绘美术、FCM 推送

个人玩具,为一个用户而做,原样分享。与 Anthropic 无关;Cobbler 的性格文本源自已下架的 Buddy 功能,在此留存,作为一种纪念。

## 许可

本仓库目前没有覆盖全仓的开源许可证。`app/LICENSE` 是 Expo 脚手架保留的 Expo 权利声明,不等于 Cobbler 整体已经获得开源授权。
