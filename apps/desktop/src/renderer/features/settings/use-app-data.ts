import type {
  AppSettings,
  IpcResponse,
  KeyStatus,
  KeyStorageInfo,
  ModelOption,
  PickableCapability,
} from '@svs/schema'
import { useCallback, useEffect, useState } from 'react'

import { call, errorText } from '../../lib/svs'

type Models = IpcResponse<'models.list'>

export interface AppData {
  keys: KeyStatus[]
  storage: KeyStorageInfo
  settings: AppSettings
  models: ModelOption[]
  /** 還沒填金鑰、不能用的模型（選單上灰色）。 */
  locked: ModelOption[]
  selected: Partial<Record<PickableCapability, string>>
  /** 開著的專案自己指定的模型；沒開專案是 null。 */
  project: Models['project']
}

export type AppDataState =
  { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; data: AppData }

/** 載入設定頁與引導精靈需要的資料；`reload` 在任何變更之後呼叫。 */
export function useAppData(): { state: AppDataState; reload: () => void } {
  const [state, setState] = useState<AppDataState>({ status: 'loading' })

  const load = useCallback(async (): Promise<void> => {
    try {
      const [keyList, settings, models]: [IpcResponse<'keys.list'>, AppSettings, Models] =
        await Promise.all([
          call('keys.list', {}),
          call('settings.get', {}),
          call('models.list', {}),
        ])
      setState({
        status: 'ready',
        data: {
          keys: keyList.keys,
          storage: keyList.storage,
          settings,
          models: models.models,
          selected: models.selected,
          locked: models.locked,
          project: models.project,
        },
      })
    } catch (error) {
      setState({ status: 'error', message: errorText(error) })
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  // 穩定的函式：設定頁打開時用它重讀（金鑰、專案可能在別的地方改過）
  const reload = useCallback(() => {
    void load()
  }, [load])

  return { state, reload }
}
