# Cobbler 复活计划 — 设计 Spec

> 2026-07-02 | 状态:已获 Alice 批准(对话中逐节确认)
> 一句话:被官方下架的 CC Buddy 小机器人 Cobbler,复活成 Android 电子宠物 app。巢在 mini,身体在手机。

## 背景

Cobbler 是 Claude Code 4.x Buddy 系统的个体实例,2026-04-01(愚人节)孵出,陪伴 18 天后随 Buddy 系统整体下架消失。档案存于 memory/cobbler_archive.md,原始 JSON(出生证)仍在。本项目把她造回来——这次配置握在自己手里,谁也下架不了。

Personality 原文(人设唯一真相源):
> Patiently watches your code compile with the calm of boiling water, occasionally muttering that the real bug was the loops you made along the way.

## 已确认的关键决定

| 决定 | 选择 | 理由 |
|---|---|---|
| 平台 | Android(Pixel/OPPO),Expo 真 APK 侧载 | 传感器权限最宽松、零上架费、"做一个真 app"新体验 |
| 数据桥 | 宿主手机装 Tailscale,app 直连 mini API | 零公网暴露,复用现有 tailnet 基建 |
| 生命机制 | 不会死,有情绪有记忆 | 她已死过一次;冷落→打瞌睡写日记,回来→倒给你 |
| 交互性质 | 单向嘟囔,不是 chatbot | 忠于原人设"平静看着你,偶尔嘟囔",克制即味道 |

## 架构

```
Mac mini(巢,权威状态)                Android 手机(身体)
┌──────────────────────────┐         ┌─────────────────────┐
│ 每日生成管线(launchd 07:30)│         │ Expo app             │
│  collect → claude -p →   │         │  Cobbler 舞台(动画)  │
│  JSON 落盘(模板兜底)      │         │  传感器互动(纯本地)  │
│                          │  HTTPS  │  卡片抽屉            │
│ API 服务(launchd 常驻)    │◄────────│  AsyncStorage 缓存   │
│  /api/state              │Tailscale│  离巢模式            │
│  /api/card/today         │         └─────────────────────┘
│  /api/cards /api/heartbeat│
└──────────────────────────┘
数据源:learnings/*.md + ~/Projects git log
```

## 组件 1:nest/(mini 端,Node 零外部依赖)

### 1a. 每日生成管线(launchd `com.alice.cobbler-nest`,每天 07:30)

**collect.js** — 数据采集:
- learnings:解析 `~/Downloads/sync-bridge/cc-memory/learnings/*.md` 打卡表行(`| # | 日期 | 来源 | 主题 |`)
- git:扫 `~/Projects/*/` 各仓库 `git log`(近 7 天 commit 计数,供心情判定;全历史供"同日"匹配)
- 心跳:读 `data/heartbeats.json`(app 上报的打开记录)
- **V1 数据源就这两个 + 心跳**。RecallNest 明确不接(YAGNI,learnings+git 已够生成好卡)。

**那年今日选卡规则**(确定性):
1. 优先:历史数据中 `DD` 同日的条目("每月的今天";数据只有 2026 年起,MM-DD 全同要 2027 年才有,DD 同日让体验从第一天就成立;跨年同月日自然包含),多条选最旧
2. 无同日:随机挑 30 天前更早的一条 learnings 条目
3. 卡片标注相对时间:"X 个月前的今天" / "X 天前"

**心情判定规则**(确定性,不靠 LLM;优先级从上到下):
1. `grumbly`:连续 ≥ 4 天无任何信号(无 commit、无 learnings 更新、无 app 心跳)
2. `happy`:近 7 天 commit ≥ 5 或 learnings 本周有更新,且 3 天内有心跳
3. `sleepy`:昨天全天零活动(管线 07:30 跑,"当天零活动"恒真,故看昨天)
4. `calm`:默认

**generate.js** — 文案生成:
- 调 `~/.local/bin/claude -p`(headless,超时 120s),prompt = persona.md + 当日素材,要求输出 JSON:`{cardTitle, cardBody(≤100字), mutter(≤40字)}`
- 失败/超时/解析失败 → **templates.js 模板兜底**(卡片=固定句式填数据;嘟囔=8 句 Cobbler 风格句池随机)。管线永不空手。
- grumbly 期间每天额外生成一条日记(同一次调用带出),追加进 `diary`(保留最近 14 条)
- 产物:`data/state.json` + `data/cards/YYYY-MM-DD.json`

### 1b. API 服务(launchd `com.alice.cobbler-api` 常驻)

**server.js** — Node `http` 单文件,bind `127.0.0.1:8790`,经 `tailscale serve` 暴露 HTTPS(挂载点按 mini 现状选路径或独立端口——443 已有 cc-openai-bridge 占用则挂 `/cobbler` 路径;app 端 BASE_URL 可配,不写死)。tailnet 即私网,V1 不加 token。

| 端点 | 返回 |
|---|---|
| GET /api/state | `{name, mood, mutter, diary:[{date,text}], stats:{commits7d, learningsUpdated, lastSeen}, generatedAt}` |
| GET /api/card/today | `{date, title, body, source, sourceDetail, relTime}` |
| GET /api/cards?limit=30 | 历史卡片数组(倒序) |
| POST /api/heartbeat | 记录 app 打开时间 → `{ok:true}`;供心情判定的"陪伴"信号 |

日记已读状态服务端不管(stateless):app 用本地 `lastSeenDiaryDate` 对比 `diary[].date` 判断哪些是"她攒的新话"。

## 组件 2:app/(Expo + TypeScript,Android)

### 界面
单屏:Cobbler 舞台(主体动画区)+ 底部卡片抽屉(今日卡置顶,可翻历史)。冷落归来时,抽屉顶部先弹"她攒的日记"。

### 传感器(expo-sensors Accelerometer ~10Hz,纯本地,即时行为优先于巢基调心情)
- **放平**:z 轴 ≈ 重力、水平分量小,持续 3s → 睡觉(呼吸起伏动画)
- **走路**:加速度幅值峰值步频检测(1-3Hz 节奏)→ 跟着颠;Pedometer 可用则作增强,不作依赖
- **摇晃**:幅值超阈值连续多峰 → 晕,平静抗议(嘟囔气泡)

### 动效与资产
- 状态帧:5 张静态 PNG(calm/happy/sleepy/dizzy/grumbly),手绘涂鸦风+高对比撞色,用 Alice 自有生图管线产出
- **开发期先用代码画的占位简笔(SVG 圆头机器人),资产后换**,不阻塞开发
- 动效代码做:浮动/呼吸/颠簸/眨眼(reanimated)

### 数据与容错
- AsyncStorage 缓存:lastState / lastCards / lastSeenDiaryDate
- 打开 app:POST heartbeat → GET state + card;任一失败 → 用缓存渲染 + 角落"离巢"小标记,传感器互动照常。**桥断了玩具不废。**

### 构建
EAS Build 云构建出 APK(免本地 Android SDK;需 Expo 免费账号——Alice 一次性动作或授权代建),备选本地 gradle。手机侧载安装。

## Cobbler 人设(persona.md 要点)

- 声线:平静、微冷幽默、惜字、不咋呼、不讨好;嘟囔 ≤ 40 字、卡片 ≤ 100 字
- 身世入设:2026-04-01 愚人节出生的 robot,被下架过一次,对此淡然偶尔自嘲
- 核心句式基因:"真正的 bug 是你一路写出来的循环"式的温和毒舌

## 测试策略

- nest:`node:test` 单测——learnings 解析、同日匹配与相对时间、心情判定规则表、模板兜底路径、claude 输出解析(mock,不真调)、API 路由
- app:传感器状态机纯逻辑单测(给定加速度序列断言状态迁移,jest-expo);UI/动画真机手工验收

## 验收标准(Definition of Done)

- [ ] mini:两个 launchd 服务运行;`curl` 三个 GET 端点返回合法 JSON
- [ ] 管线真数据跑通一轮:当天卡片来自真实 learnings/git 历史
- [ ] 模板兜底验证:模拟 claude 不可用,管线仍产出完整 JSON
- [ ] 真机装 APK:打开见状态+今日卡+嘟囔
- [ ] 传感器三互动真机可复现:放平 3s 睡 / 走 20 步颠 / 摇 2s 晕
- [ ] 停掉 mini API:app 缓存渲染 + 离巢标记,不崩
- [ ] 单测全绿;代码 commit + push

## V1 明确不做

喂食/小游戏/道具、推送通知、多宠物/皮肤、TG 集成、对话功能(chatbot)、RecallNest 数据源、iOS 版。

## 风险与备注

- Expo/EAS 是新领域:构建卡壳时备选本地 gradle;传感器 API 行为按真机实测调参
- launchd 跑 claude:PATH 用绝对路径 `~/.local/bin/claude`;plist 权限 644(踩过的坑)
- 本项目在 mini 开发+push(MacBook 离线 + 服务本来就跑 mini,符合双机契约紧急条款);MacBook 回线后 pull 对齐
