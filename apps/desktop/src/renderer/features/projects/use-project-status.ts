import { formatDate } from '@svs/schema'
import type { IpcEventName, ProjectStatus } from '@svs/schema'
import { useCallback, useEffect, useRef, useState } from 'react'

import { call } from '../../lib/svs'

/**
 * 這些事件發生，代表專案裡有東西被寫進去了（或換了專案、花了錢）：上方專案列就重新問一次。
 * 不另外輪詢，也不靠哪個頁面自己通知。
 */
const WATCHED: readonly IpcEventName[] = [
  'queue.changed',
  'queue.reset',
  'shots.changed',
  'sound.changed',
  'characters.changed',
  'locations.changed',
  'outline.changed',
  'canvas.changed',
  'canvas.notice',
  'history.changed',
  'quickstart.progress',
]

/** 連續幾個事件擠在一起時，等這麼久再問一次。 */
const DEBOUNCE_MS = 300

/**
 * 目前專案的名字、最後存檔時間、花費。`undefined` 是還沒問到（或問不到）；`null` 是沒有開專案。
 * 問不到不當成錯誤：這一列只是提示，不能因為它擋住別的東西。
 */
export function useProjectStatus(): {
  status: ProjectStatus | null | undefined
  refresh: () => void
} {
  const [status, setStatus] = useState<ProjectStatus | null>()
  // 晚到的回應不能蓋掉比較新的
  const latest = useRef(0)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const load = useCallback((): void => {
    const mine = ++latest.current
    call('project.status', {})
      .then((next) => {
        if (mine === latest.current) setStatus(next)
      })
      .catch(() => undefined)
  }, [])

  const refresh = useCallback((): void => {
    clearTimeout(timer.current)
    timer.current = setTimeout(load, DEBOUNCE_MS)
  }, [load])

  useEffect(() => {
    load()
    const offs = WATCHED.map((event) => window.svs.on(event, refresh))
    return () => {
      for (const off of offs) off()
      clearTimeout(timer.current)
      latest.current++
    }
  }, [load, refresh])

  return { status, refresh: load }
}

/** 「12:03」：存檔時間，用本機時區、24 小時制。 */
export function clockTime(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return formatDate(date, 'time')
}
