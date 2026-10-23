import type { AppView } from '../components/app-layout'

/**
 * 目前在哪一頁。放在 React 樹外面：換介面語言時整棵樹會重新掛上（見 `i18n.tsx`），
 * 樹裡的狀態會歸零，記在這裡才能回到同一頁，不會把使用者從設定頁丟回畫布。
 */
export const viewMemory: { view?: AppView } = {}
