import {
  CanvasGraphSchema,
  type CanvasAiChanged,
  type CanvasGraph,
  type CanvasNode,
} from '@svs/schema'

import type { HandlerContext, IpcRegistry } from '../ipc/registry'
import type { McpCaller } from './bridge'

/** 一個節點的指紋：內容變了才會不一樣（位置、自動排版、步驟展開不算）。 */
interface NodeMark {
  fingerprint: string
  title: string
  kind: CanvasNode['kind']
}

export type CanvasMarks = ReadonlyMap<string, NodeMark>

/**
 * 不算「AI 改了這一格的內容」的欄位：
 * - 位置與版面：自動排版會因為別的節點出現而挪動；
 * - 場的編號（`sceneNo`）與標題裡的「第 N 鏡」「第 N 場」編號（見 `withoutNumbers`）：順序變了、內容沒變；
 * - 狀態與失敗原因（`status`、`error`）：它們是跟著上游變的——AI 改了描述、生了首幀，下游的影片格會從
 *   「還沒生成」變成「排隊中」「需要重跑」，但它自己沒有新的內容，不該標「AI 剛改」。
 *   有新結果的格子靠結果本身（縮圖、版本、模型、花費）看得出來，AI 叫的背景生成做完也另外通知（shot-service）。
 */
const IGNORED_FIELDS: ReadonlySet<string> = new Set([
  'x',
  'y',
  'width',
  'height',
  'auto',
  'expanded',
  'status',
  'error',
  // 場的編號（跟著順序變）
  'sceneNo',
])

/**
 * 標題裡的編號（「第 3 鏡」「第 2 場」）不算內容：刪掉第 3 鏡之後，原本的第 4 鏡往前變成第 3 鏡，
 * 它的標題跟著變，但內容沒有被改（只是順序變了）。比對時把編號蓋掉；名稱本身（場名、角色名）有改才算改。
 */
export const withoutNumbers = (title: string): string => title.replace(/第 \d+ (鏡|場)/g, '第 # $1')

export function marksOf(graph: Pick<CanvasGraph, 'nodes'>): CanvasMarks {
  const marks = new Map<string, NodeMark>()
  for (const node of graph.nodes) {
    const content = Object.entries(node)
      .filter(([field]) => !IGNORED_FIELDS.has(field))
      .map(([field, value]) => [field, field === 'title' ? withoutNumbers(node.title) : value])
    marks.set(node.key, {
      fingerprint: JSON.stringify(content),
      title: node.title,
      kind: node.kind,
    })
  }
  return marks
}

export type AiChanges = Pick<CanvasAiChanged, 'changed' | 'added' | 'removed'>

export function diffMarks(before: CanvasMarks, after: CanvasMarks): AiChanges {
  const changed: string[] = []
  const added: string[] = []
  const removed: AiChanges['removed'] = []
  for (const [key, mark] of after) {
    const old = before.get(key)
    if (!old) added.push(key)
    else if (old.fingerprint !== mark.fingerprint) changed.push(key)
  }
  for (const [key, mark] of before) {
    if (!after.has(key)) removed.push({ key, title: mark.title, kind: mark.kind })
  }
  return { changed, added, removed }
}

/** 不會改畫布的通道（只讀的），不用前後各取一次畫布。 */
const READ_ONLY: ReadonlySet<string> = new Set([
  'project.list',
  'project.current',
  'models.list',
  'outline.get',
  'outline.splitCheck',
  'storyboard.splitCheck',
  'shots.list',
  'characters.list',
  'characters.suggestAnchor',
  'characters.concepts',
  'characters.conceptCheck',
  'queue.list',
  'shots.batchCheck',
  'sound.get',
  'sound.analyze',
  'history.state',
])

/** 換專案時前後是兩個不同的畫布，比較沒有意義。 */
const isProjectSwitch = (channel: string): boolean => channel.startsWith('project.')

/** 現在開著的專案的畫布（取不到就是 undefined：沒有開專案、或讀失敗）。 */
export function createCanvasMarker(registry: Pick<IpcRegistry, 'dispatch'>) {
  const ctx: HandlerContext = { emit: () => undefined }
  return async (): Promise<CanvasMarks | undefined> => {
    try {
      const result = await registry.dispatch({ channel: 'canvas.get', payload: {} }, ctx)
      if (!result.ok) return undefined
      const graph = CanvasGraphSchema.safeParse(result.data)
      return graph.success ? marksOf(graph.data) : undefined
    } catch {
      return undefined
    }
  }
}

/**
 * 包一層 MCP 呼叫器：走這裡進來的呼叫都是 AI 工具做的。會改畫布的呼叫做完（不管成功或失敗，
 * 失敗前可能已經改了一部分）就比較前後的畫布，有變動就發 `canvas.aiChanged`，
 * 畫面才知道「剛剛是 AI 改的、改了哪裡」。這個事件只給畫面用，不是 MCP 介面。
 */
export function withAiChangeNotice(
  caller: McpCaller,
  deps: {
    marks: () => Promise<CanvasMarks | undefined>
    emit: HandlerContext['emit']
    now?: () => Date
  },
): McpCaller {
  const now = deps.now ?? (() => new Date())
  return {
    call: async (channel, payload) => {
      if (READ_ONLY.has(channel) || isProjectSwitch(channel)) return caller.call(channel, payload)
      const before = await deps.marks()
      try {
        return await caller.call(channel, payload)
      } finally {
        const after = before ? await deps.marks() : undefined
        if (before && after) {
          const diff = diffMarks(before, after)
          if (diff.changed.length + diff.added.length + diff.removed.length > 0) {
            deps.emit('canvas.aiChanged', { at: now().toISOString(), channel, ...diff })
          }
        }
      }
    },
  }
}
