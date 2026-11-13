import { createContext, useContext, type ReactNode } from 'react'

/** 畫面深處（聲音區、聊天面板）要帶使用者去別的頁時用；沒包在 provider 裡就什麼都不做（測試與單獨渲染）。 */
export interface AppNavigation {
  openSettings: () => void
}

const NONE: AppNavigation = {
  openSettings: () => undefined,
}

const AppNavigationContext = createContext<AppNavigation>(NONE)

export function AppNavigationProvider({
  value,
  children,
}: {
  value: AppNavigation
  children: ReactNode
}) {
  return <AppNavigationContext.Provider value={value}>{children}</AppNavigationContext.Provider>
}

export function useAppNavigation(): AppNavigation {
  return useContext(AppNavigationContext)
}
