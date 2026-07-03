# V0.4 屏上泡泡(悬浮 Cobbler)Plan

> 设计已在对话中获批:静态简笔小圆脸悬浮、可拖、点击唤回 app;自写 Kotlin 原生模块;先 Pixel 验证,OPPO(ColorOS 管控)见机行事。表情随心情为第二步。

## 架构:Expo 本地原生模块(不 eject,CNG 自动接入)

```
app/modules/cobbler-bubble/
  expo-module.config.json          # autolinking 声明
  index.ts                         # JS API
  android/
    build.gradle
    src/main/AndroidManifest.xml   # SYSTEM_ALERT_WINDOW + FGS 权限 + service 声明(manifest merger 合并)
    src/main/java/expo/modules/cobblerbubble/
      CobblerBubbleModule.kt       # bridge: canDrawOverlays/requestOverlayPermission/show(mood)/hide/isShowing
      BubbleService.kt             # 前台 Service(specialUse)+ WindowManager + 自绘 BubbleView
```

要点:
- SDK 57 autolinking 默认扫 `<projectRoot>/modules/`,EAS 远程 prebuild 自动接入,repo 不提交 app 级 android/ 目录
- BubbleView 自绘(Canvas 黑圆+白眼,与 app 内简笔同基因),零图片资源;mood 参数留接口
- 拖动:onTouch 更新 LayoutParams + updateViewLayout,松手贴边吸附;位移小+时短=tap → Intent 唤起 MainActivity(NEW_TASK),泡泡保留
- 前台服务:Android 14+ specialUse 子类型声明 + 低优先级常驻通知("Cobbler 在屏上")
- JS 开关:卡片抽屉内一行「屏上泡泡」;无权限时先跳 ACTION_MANAGE_OVERLAY_PERMISSION 设置页
- V1 不做:开机自启(BOOT_COMPLETED+ColorOS 大坑)、app 前台时自动隐藏泡泡、表情随心情

## 验证回路(无本地 Android SDK,以构建轮次为单元)

1. 轮 1:tsc + EAS build 当编译检查 → 她 Pixel 装 → 开权限 → 泡泡出现/拖/点
2. 轮 N:按真机反馈修(预算 2-4 轮)
3. OPPO:Pixel 通过后再试,预期要手动开"显示在其他应用上层"+自启动许可

## 风险

- Kotlin 语法/gradle 配置错误只能在 EAS build 暴露(每轮 15-30min)——写仔细,首轮当 lint
- ColorOS 杀后台:specialUse FGS + 常驻通知是标准自保,但不保证;结果如实报告
