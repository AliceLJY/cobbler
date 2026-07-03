import { requireNativeModule } from 'expo-modules-core';

export type CobblerBubbleApi = {
  canDrawOverlays(): boolean;
  requestOverlayPermission(): void;
  show(mood: string | null): boolean;
  hide(): void;
  isShowing(): boolean;
};

// Expo Go / iOS 下模块不存在,优雅降级为 null(UI 层据此隐藏开关)
let native: CobblerBubbleApi | null = null;
try {
  native = requireNativeModule<CobblerBubbleApi>('CobblerBubble');
} catch {
  native = null;
}

export default native;
