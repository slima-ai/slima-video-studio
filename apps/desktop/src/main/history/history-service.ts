import { StructureHistory, type HistoryGroup, type ProjectHandle } from '@svs/db'
import {
  type CanvasAddKind,
  type HistoryResult,
  type HistoryState,
  type OutlineOp,
  type ShotEdit,
} from '@svs/schema'

import type { ProjectManager } from '../project-manager'
import { isAiCall } from './ai-origin'
import type { Broadcast } from '../runtime/project-runtime'

export interface HistoryServiceDeps {
  projects: ProjectManager
  broadcast: Broadcast
}

/** 使用者自己按的一次復原或重做（給 Claude 的「App 附註」用）。 */
export interface UserHistoryOp {
  direction: 'undo' | 'redo'
  /** 那一步的名稱（Claude 一輪是「Claude 這一輪的改動」）。 */
  label: string
  /** Claude 一輪裡各個編輯的名稱（「修改鏡頭的景別」…）；使用者自己的一步沒有。 */
  details: string[]
}

export interface HistoryService {
  /** 執行一個大綱或分鏡表的編輯，並記進歷史（之後可以復原）。沒有開啟專案時只是執行。 */
  record: <T>(label: string, run: () => T) => T
  /**
   * 會在背景跑一段時間的動作（一句話生成）：現在開始記，呼叫回傳的函式時把整段記成一筆。
   * 還沒有專案時（動作會自己建專案），結束時把整個專案的內容記成這一筆。
   */
  begin: (label: string) => () => void
  /** 做了無法復原的大動作（AI 重新拆場、重新生成整支影片…）之後清空，免得舊紀錄對不上現在的資料。 */
  /**
   * Claude 對話的一輪：從現在到呼叫回傳的函式之間，**AI 工具（MCP）做的改動**併成一步復原；
   * 使用者自己的操作照舊各自一步、排在後面。這一輪的那一步還在最上面、而且還沒收尾時，復原會被擋下
   * （`blocked: 'ai_running'`），免得退到一半 Claude 又接著改。
   */
  beginAiTurn: (label: string) => () => void
  clear: () => void
  /**
   * 取走（並清掉）使用者自己按過的復原與重做：目前這個專案、從上次取走之後。
   * Claude 對話送下一句話時拿來告訴它「使用者按過復原」（不然它以為自己的改動不見了、會自己改回去）。
   */
  takeUserOps: () => UserHistoryOp[]
  state: () => HistoryState
  undo: () => HistoryResult
  redo: () => HistoryResult
}

const NO_HISTORY: HistoryState = { canUndo: false, canRedo: false }

/** 大綱編輯的名稱：「已復原：刪除這個場」這種提示用。 */
const OUTLINE_LABELS: Record<OutlineOp['op'], string> = {
  addAct: '新增一幕',
  updateAct: '修改這一幕',
  deleteAct: '刪除這一幕',
  moveAct: '調整幕的順序',
  addScene: '新增一個場',
  updateScene: '修改這個場',
  deleteScene: '刪除這個場',
  moveScene: '調整場的順序',
  addLocation: '新增地點',
  updateLocation: '修改地點',
  deleteLocation: '刪除地點',
}
export const outlineLabel = (op: OutlineOp): string => OUTLINE_LABELS[op.op]

/** 從畫布新增節點的名稱。 */
const ADD_LABELS: Record<CanvasAddKind, string> = {
  scene: '新增一個場',
  shot: '新增鏡頭',
  character: '新增角色',
  location: '新增地點',
  oneliner: '新增一句話',
  note: '新增便條',
  group: '新增群組',
}
export const addLabel = (kind: CanvasAddKind): string => ADD_LABELS[kind]

/** 修改鏡頭欄位的名稱：只改一個欄位時指出是哪一個。 */
const SHOT_FIELD_LABELS: Record<string, string> = {
  description: '畫面描述',
  action: '動作',
  prompt: 'Prompt',
  size: '景別',
  angle: '角度',
  cameraMove: '運鏡',
  durationSec: '秒數',
  dialogue: '台詞',
  characters: '出場角色',
  sceneId: '所屬的場',
  locationId: '地點',
  lighting: '光線',
  timeOfDay: '時段',
  mood: '氣氛',
  inCut: '放進成品',
}
export function shotEditLabel(edit: ShotEdit): string {
  const keys = Object.keys(edit)
  const only = keys.length === 1 ? keys[0] : undefined
  const field = only === undefined ? undefined : SHOT_FIELD_LABELS[only]
  return field ? `修改鏡頭的${field}` : '修改鏡頭'
}

/**
 * 大綱與分鏡表的復原／重做。每個專案一份歷史，換專案就是另一份；
 * 狀態與「復原／重做過」都用 history.changed 事件通知畫面。
 */
export function createHistoryService(deps: HistoryServiceDeps): HistoryService {
  const { projects, broadcast } = deps
  const histories = new WeakMap<ProjectHandle, StructureHistory>()
  /** 每個專案目前開著的 Claude 一輪（一次最多一個）。 */
  const turns = new WeakMap<ProjectHandle, HistoryGroup>()
  /** 每個專案：使用者自己按過、還沒告訴 Claude 的復原與重做。 */
  const userOps = new WeakMap<ProjectHandle, UserHistoryOp[]>()
  /** 每復原或重做一次加一，畫面看到它變了就重新載入資料。 */
  let revision = 0

  const historyOf = (handle: ProjectHandle): StructureHistory => {
    const existing = histories.get(handle)
    if (existing) return existing
    const created = new StructureHistory(handle.db, handle.projectId)
    histories.set(handle, created)
    return created
  }
  const live = (): StructureHistory | undefined => {
    const handle = projects.current()
    return handle && !handle.closed ? historyOf(handle) : undefined
  }
  const state = (): HistoryState => live()?.state() ?? NO_HISTORY
  const announce = (): void => {
    broadcast('history.changed', { ...state(), revision })
  }

  projects.onChange(() => {
    announce()
  })

  const apply = (direction: 'undo' | 'redo'): HistoryResult => {
    const history = live()
    if (!history) return { applied: false, state: NO_HISTORY }
    const handle = projects.current()
    const turn = handle ? turns.get(handle) : undefined
    if (direction === 'undo' && turn && history.groupIsOnTop(turn)) {
      return { applied: false, state: history.state(), blocked: 'ai_running' }
    }
    try {
      const entry = direction === 'undo' ? history.undo() : history.redo()
      if (!entry) return { applied: false, state: history.state() }
      revision++
      // 真的動到東西才算（整步都因為後來又被改過而略過的，對專案沒有影響，不用告訴 Claude）
      if (handle && entry.applied > 0) {
        const ops = userOps.get(handle) ?? []
        ops.push({ direction, label: entry.label, details: entry.details ?? [] })
        userOps.set(handle, ops)
      }
      const skipped = entry.skipped === 0 ? undefined : entry.applied === 0 ? 'all' : 'some'
      return {
        applied: true,
        label: entry.label,
        state: history.state(),
        ...(skipped === undefined ? {} : { skipped }),
      }
    } finally {
      // 失敗時這筆紀錄已經作廢，也要讓畫面更新按鈕狀態
      announce()
    }
  }

  return {
    record: (label, run) => {
      const history = live()
      if (history) {
        const handle = projects.current()
        const turn = handle && isAiCall() ? turns.get(handle) : undefined
        const result = history.record(label, run, turn)
        announce()
        return result
      }
      // 還沒有專案：動作本身會自動建一個空專案，所以動作之前一定是空的
      const result = run()
      live()?.recordCreation(label)
      announce()
      return result
    },
    begin: (label) => {
      const handle = projects.current()
      if (!handle || handle.closed) {
        let done = false
        return () => {
          if (done) return
          done = true
          live()?.recordCreation(label)
          announce()
        }
      }
      const finish = historyOf(handle).begin(label)
      return () => {
        // 生成到一半換了專案：那個專案已經關掉，不記
        if (handle.closed) return
        finish()
        announce()
      }
    },
    beginAiTurn: (label) => {
      const handle = projects.current()
      if (!handle || handle.closed) return () => undefined
      const history = historyOf(handle)
      const group = history.openGroup(label)
      turns.set(handle, group)
      return () => {
        if (group.closed) return
        history.closeGroup(group)
        if (turns.get(handle) === group) turns.delete(handle)
        announce()
      }
    },
    clear: () => {
      live()?.clear()
      announce()
    },
    takeUserOps: () => {
      const handle = projects.current()
      if (!handle) return []
      const ops = userOps.get(handle) ?? []
      userOps.delete(handle)
      return ops
    },
    state,
    undo: () => apply('undo'),
    redo: () => apply('redo'),
  }
}
