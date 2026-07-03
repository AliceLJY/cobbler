# Cobbler App(Android/Expo)Implementation Plan(结构契约版)

> nest 已完成并验收。本 plan 为结构+契约级(个人玩具项目,UI 代码实现时直写,不在 plan 重复)。
> 纯逻辑模块(传感器状态机)仍走 TDD。

**Goal:** Expo Android app——Cobbler 的身体:传感器互动(纯本地)+ 巢数据渲染(状态/嘟囔/卡片)+ 离巢缓存。

**Tech Stack:** Expo SDK(blank-typescript)、expo-sensors、AsyncStorage、reanimated(Expo 内置)。构建:EAS Build 云构建 APK(需 Expo 账号,到该步停下与 Alice 确认)。

## Global Constraints

- BASE_URL 可配,默认 `https://your-nest.your-tailnet.ts.net:10000`(app 内设置项可改,兼容 IP 直连 `https://100.x.y.z:10000`)
- 传感器单位:expo-sensors Accelerometer 返回 g(1g=9.8m/s²),阈值全用 g,实机调参
- 行为优先级:dizzy > sleeping > bouncing > idle(idle 时显示巢基调心情)
- 离巢容错:任何 API 失败 → AsyncStorage 缓存渲染 + "离巢"角标;传感器互动照常
- 占位资产先行(代码画的简笔 Cobbler:黑色圆身+白点眼,忠于"robot 黑色实心"想象),生图资产后换

## File Structure

```
app/
  App.tsx                    # 组装:Stage + Drawer + 数据加载
  lib/
    config.ts                # BASE_URL 常量 + AsyncStorage 读写
    api.ts                   # fetchState/fetchTodayCard/fetchCards/postHeartbeat(带超时)+ 缓存回退
    pet-machine.ts           # 传感器状态机(纯函数,可测)
  hooks/
    useAccelerometer.ts      # expo-sensors 订阅 → pet-machine 驱动
    useNestData.ts           # 启动加载:heartbeat + state + cards,失败回缓存
  components/
    CobblerFigure.tsx        # 简笔 Cobbler(SVG/View 圆形),按 pose 换表情/姿态
    CobblerStage.tsx         # 舞台:动画(呼吸/颠/晃/Z字睡)+ 嘟囔气泡
    CardDrawer.tsx           # 底部抽屉:今日卡置顶 + 历史卡 + 新日记提示
    OfflineBadge.tsx         # 离巢角标
  __tests__/pet-machine.test.ts
```

## pet-machine 契约(TDD 核心)

```ts
type Pose = 'idle' | 'sleeping' | 'bouncing' | 'dizzy';
type Sample = { x: number; y: number; z: number; t: number };  // g / ms
createPetMachine(now?: () => number): { feed(s: Sample): Pose }
```

规则(g 单位,实机调参的初始值):
- sleeping:|z|∈[0.85,1.15] 且 |x|<0.12 且 |y|<0.12 持续 ≥3000ms
- dizzy:幅值偏离 ||a|-1|>0.6 的峰在 1200ms 窗口内 ≥3 次 → 进入,保持 4000ms 后可退出
- bouncing:幅值峰(||a|-1|∈[0.18,0.6])间隔 250-1000ms 连续 ≥4 个 → 进入;无新峰 2000ms 退出
- 其余 idle;优先级 dizzy > sleeping > bouncing

## Tasks

1. `npx create-expo-app app --template blank-typescript`;装 expo-sensors、async-storage;commit
2. pet-machine.ts TDD(喂合成加速度序列断言四态迁移;jest-expo 或 node 直测——纯函数无 RN 依赖,用 node:test 直接测,避免 jest 配置负担);commit
3. lib/config.ts + api.ts(超时 5s、失败回缓存、写缓存);commit
4. CobblerFigure + CobblerStage(简笔+呼吸/颠/晃动画+嘟囔气泡)+ OfflineBadge;commit
5. CardDrawer(今日卡+历史+日记节)+ useNestData;commit
6. App.tsx 组装 + Android 真机前的本地冒烟(`npx expo start` 本机 web/模拟器不可用时以 lint+tsc 为准);commit
7. **停点**:EAS Build 需 Expo 账号 → 问 Alice(自建或授权代建);拿到后 `eas build -p android --profile preview` 出 APK
8. 真机验收(spec §7 传感器三互动 + 离巢模式)→ 调参 → 资产替换(生图管线)可后置为 V1.1

## 风险

- mini 上无 Android SDK:本地 gradle 兜底路线需要装 SDK(重),优先 EAS
- 传感器阈值纸上谈兵:第 8 步真机调参是必经环节,预期来回 1-2 轮
- Clash fake-ip 对 ts.net 域名的污染在手机端不存在(手机不跑 Clash),但 app 内提供 IP 直连配置作后路
