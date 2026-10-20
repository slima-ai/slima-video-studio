import { randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'

import {
  AI_TURN_UNDO_LABEL,
  AppError,
  CHAT_BUDGET_DEFAULT_USD,
  type AppSettings,
  type ChatConversation,
  type ChatEvent,
  type ChatPanelMessage,
  type ChatPrereq,
  type ChatStep,
} from '@svs/schema'

import type { Logger } from '../logger'
import type { BridgeCommand } from '../mcp/connect'
import { buildClaudeArgs, CHAT_SYSTEM_PROMPT, claudeEnv } from './claude-args'
import {
  appendRecords,
  deleteConversationFile,
  readConversations,
  writeConversation,
  type StoredConversationInfo,
} from './chat-store'
import type { ClaudeCheck } from './claude-check'
import { startClaudeProcess, type ClaudeProcess, type SpawnClaude } from './claude-process'
import type { StreamSignal } from './stream-events'
import { toolDoingLabel, toolLabel } from './tool-labels'

export interface ChatServiceDeps {
  settings: { get: () => Pick<AppSettings, 'experiments' | 'mcp'> }
  /** 打包版（實驗功能預設關）。 */
  packaged: boolean
  /** 我們的 MCP 轉接指令（不含 token）。 */
  bridge: BridgeCommand
  /** claude 行程的工作資料夾（我們自己的，不是使用者的程式專案）。 */
  workDir: string
  /** 有沒有裝 Claude Code、版本、登入。 */
  check: () => Promise<ClaudeCheck>
  spawn: SpawnClaude
  broadcast: (name: 'chat.event', payload: ChatEvent) => void
  log: Pick<Logger, 'info' | 'warn' | 'error'>
  /** 傳給 claude 的環境變數來源（會再過濾成只有跑起來需要的幾個）。 */
  env?: Readonly<Record<string, string | undefined>>
  now?: () => Date
  newId?: () => string
  /** Claude 自己的 token 用量上限（美金，一個行程）。 */
  maxBudgetUsd?: number
  /** 文字一路長出來時，最多每幾毫秒推一次畫面（0＝每個字都推，測試用）。 */
  emitThrottleMs?: number
  /** 按了停止、對方這麼久還沒結束這一輪，就改用 SIGINT。 */
  interruptGraceMs?: number
  /** 對話閒置這麼久（毫秒）就把它的 claude 行程關掉；下次講話再用 --resume 接上。 */
  idleMs?: number
  /** 復原紀錄：Claude 一輪裡改的全部東西合成一步，按一次復原就退回這一輪開始之前。沒給就一個工具呼叫一步。 */
  history?: { beginAiTurn: (label: string) => () => void }
  /** 目前開著的專案：對話紀錄存在它的 `chat/`。沒給就只放記憶體。 */
  project?: {
    dir: () => string | undefined
    /** 專案開啟、關閉或換掉時通知；回傳取消訂閱。 */
    onChange: (listener: () => void) => () => void
  }
}

export interface ChatService {
  status: () => Promise<ChatPrereq>
  list: () => { conversations: ChatConversation[] }
  create: () => ChatConversation
  rename: (conversationId: string, title: string) => ChatConversation
  messages: (conversationId: string) => { messages: ChatPanelMessage[] }
  send: (conversationId: string, text: string) => Promise<void>
  stop: (conversationId: string) => void
  /** 關閉所有 claude 行程（App 結束時）。 */
  dispose: () => void
}

/** 預設的對話標題；使用者講第一句話之後，標題換成那句話的開頭。 */
export const DEFAULT_CHAT_TITLE = '新對話'
const TITLE_FROM_TEXT_MAX = 20
const CHECK_TTL_MS = 60_000
/** 閒置多久關掉行程：十個對話就是十個常駐的 claude，沒在用的不該一直佔著。 */
/** 一輪的復原名稱（復原按鈕旁、「已復原：…」的提示會用）。 */
export const CHAT_UNDO_LABEL = AI_TURN_UNDO_LABEL
const DEFAULT_IDLE_MS = 10 * 60_000
/** 改開新對話時帶過去的舊內容最多這麼多字（取最後面的）。 */
const SEED_MAX_CHARS = 6000

interface Turn {
  /** 使用者這一則的原文（找不到舊對話要改開新的時，要重送）。 */
  userText: string
  /** 這一輪的復原紀錄收尾（把這一輪的改動記成一步）。 */
  endHistory?: (() => void) | undefined
  /** 已經因為找不到 Claude 那邊的紀錄而改開過新對話了（一輪只做一次）。 */
  fellBack?: boolean
  assistant: ChatPanelMessage
  steps: Map<string, ChatStep>
  emitTimer?: NodeJS.Timeout | undefined
  interruptTimer?: NodeJS.Timeout | undefined
}

interface Conversation {
  info: ChatConversation
  messages: ChatPanelMessage[]
  /** Claude 那邊已經有這個 session（之後要用 --resume 接，不能再用 --session-id）。 */
  started: boolean
  proc?: ClaudeProcess | undefined
  turn?: Turn | undefined
  /** 這個對話屬於哪個專案資料夾（紀錄存在那裡）；沒開專案時建的對話沒有，只放記憶體。 */
  dir?: string | undefined
  /** Claude 那邊的 session id（init 回報的）。 */
  claudeSession?: string | undefined
  /** 這個對話是在哪個專案資料夾建的。 */
  origin?: string | undefined
  /** 下次接續要另外分出新的 session（對話是從別的專案複製來的）。 */
  fork?: boolean | undefined
  /** 這個行程是用 --resume 起的、而且還沒收到 init（找不到舊紀錄時會在這之前就退出）。 */
  resumeWithoutInit?: boolean | undefined
  claudePath?: string | undefined
  /** 上一輪是因為用量／步數到上限停的：下一則要換新行程（新的用量額度）才接得下去。 */
  recycle?: boolean | undefined
  idleTimer?: NodeJS.Timeout | undefined
}

const invalid = (userMessage: string): AppError =>
  new AppError({ code: 'invalid_request', userMessage })

const NEED_LOGIN = '還沒登入 Claude。請先在終端機執行 claude 並登入，再回來試一次。'
const NO_MCP = '連不上 App 的「AI 工具連線」。請到設定確認它是開著的，再送一次。'
const LOST = '和 Claude 的連線中斷了。再送一則訊息，會接著上次的對話繼續。'

export function createChatService(deps: ChatServiceDeps): ChatService {
  const now = deps.now ?? (() => new Date())
  const newId = deps.newId ?? randomUUID
  const throttleMs = deps.emitThrottleMs ?? 60
  const graceMs = deps.interruptGraceMs ?? 4000
  const idleMs = deps.idleMs ?? DEFAULT_IDLE_MS
  const conversations = new Map<string, Conversation>()
  let cached: { at: number; value: ClaudeCheck } | undefined

  const enabled = (): boolean => deps.settings.get().experiments.claudeChat ?? !deps.packaged

  const runCheck = async (fresh: boolean): Promise<ClaudeCheck> => {
    if (!fresh && cached && Date.now() - cached.at < CHECK_TTL_MS) return cached.value
    const value = await deps.check()
    cached = { at: Date.now(), value }
    return value
  }

  const prereqOf = (check: ClaudeCheck): ChatPrereq => {
    if (check.state === 'not_installed') return { state: 'not_installed' }
    if (check.state === 'too_old') {
      return { state: 'too_old', version: check.version, minVersion: check.minVersion }
    }
    if (check.state === 'not_logged_in') return { state: 'not_logged_in', version: check.version }
    return { state: 'ready', version: check.version }
  }

  const emitConversation = (conv: Conversation): void => {
    deps.broadcast('chat.event', { type: 'conversation', conversation: { ...conv.info } })
  }
  const emitMessage = (conv: Conversation, message: ChatPanelMessage): void => {
    deps.broadcast('chat.event', {
      type: 'message',
      conversationId: conv.info.id,
      message: { ...message, steps: message.steps.map((s) => ({ ...s })) },
    })
  }

  /** 文字一路長出來：畫面不需要每個字都重畫，隔一小段時間推一次最新的整則訊息。 */
  const scheduleEmit = (conv: Conversation, turn: Turn): void => {
    if (throttleMs <= 0) {
      emitMessage(conv, turn.assistant)
      return
    }
    if (turn.emitTimer) return
    turn.emitTimer = setTimeout(() => {
      turn.emitTimer = undefined
      emitMessage(conv, turn.assistant)
    }, throttleMs)
  }

  const get = (conversationId: string): Conversation => {
    loadFromDisk()
    const conv = conversations.get(conversationId)
    if (!conv) throw invalid('找不到這個對話。')
    return conv
  }

  const touch = (conv: Conversation): void => {
    conv.info.updatedAt = now().toISOString()
  }

  // ---- 紀錄（專案資料夾的 chat/）。存不了只記一筆警告，不影響對話本身 ----
  const currentDir = (): string | undefined => deps.project?.dir()
  const storedInfo = (conv: Conversation): StoredConversationInfo => ({
    id: conv.info.id,
    title: conv.info.title,
    createdAt: conv.info.createdAt,
    updatedAt: conv.info.updatedAt,
    claudeSession: conv.claudeSession,
    origin: conv.origin,
  })
  const persist = (conv: Conversation, messages: readonly ChatPanelMessage[] = []): void => {
    if (!conv.dir) return
    try {
      appendRecords(conv.dir, conv.info.id, [
        { t: 'conv', info: storedInfo(conv) },
        ...messages.map((message) => ({ t: 'msg' as const, message })),
      ])
    } catch (error) {
      deps.log.warn(`存不了對話紀錄：${String(error)}`)
    }
  }
  const loadedDirs = new Set<string>()
  /** 把目前專案 chat/ 底下還沒在記憶體裡的對話讀進來（每個專案資料夾讀一次）。 */
  const loadFromDisk = (): void => {
    const dir = currentDir()
    if (!dir || loadedDirs.has(dir)) return
    loadedDirs.add(dir)
    for (const stored of readConversations(dir, (m) => {
      deps.log.warn(m)
    })) {
      if (conversations.has(stored.info.id)) continue
      conversations.set(stored.info.id, {
        info: {
          id: stored.info.id,
          title: stored.info.title,
          createdAt: stored.info.createdAt,
          updatedAt: stored.info.updatedAt,
          running: false,
        },
        messages: stored.messages,
        started: stored.info.claudeSession !== undefined,
        dir,
        claudeSession: stored.info.claudeSession,
        origin: stored.info.origin ?? dir,
        // 紀錄是在別的專案資料夾建的＝這個專案是另存出來的複本：接續時另外分一個新的 session，不跟原本的共用
        fork: stored.info.origin !== undefined && stored.info.origin !== dir,
      })
    }
  }

  const clearIdle = (conv: Conversation): void => {
    if (conv.idleTimer) clearTimeout(conv.idleTimer)
    conv.idleTimer = undefined
  }

  /** 這個對話沒在做事了：開始倒數，閒置夠久就關掉行程（下次講話用 --resume 接回同一個對話）。 */
  const armIdle = (conv: Conversation): void => {
    clearIdle(conv)
    if (idleMs <= 0 || !conv.proc) return
    conv.idleTimer = setTimeout(() => {
      conv.idleTimer = undefined
      if (conv.turn || !conv.proc) return
      deps.log.info('Claude 對話閒置太久，關掉行程（下次講話會接回同一個對話）')
      conv.proc.close()
    }, idleMs)
    conv.idleTimer.unref()
  }

  /** 這一輪結束（成功、被停止、出錯）：整理最後的樣子、推給畫面。 */
  const finishTurn = (
    conv: Conversation,
    outcome: {
      state: 'done' | 'stopped' | 'error'
      error?: string
      text?: string
      resumable?: boolean
    },
  ): void => {
    const { turn } = conv
    if (!turn) return
    conv.turn = undefined
    if (turn.emitTimer) clearTimeout(turn.emitTimer)
    if (turn.interruptTimer) clearTimeout(turn.interruptTimer)
    const message = turn.assistant
    // 這一輪的改動合成一步復原（做到一半被停止、出錯、行程當掉也一樣：已經做的改動一步就能退）
    turn.endHistory?.()
    if (outcome.text !== undefined && message.text.trim() === '') message.text = outcome.text
    message.steps = message.steps.map((step) =>
      step.status === 'running'
        ? { ...step, status: 'error', label: toolLabel(step.tool), summary: '沒有做完' }
        : step,
    )
    message.state = outcome.state
    if (outcome.error !== undefined) message.error = outcome.error
    if (outcome.resumable === true) message.resumable = true
    conv.recycle = outcome.resumable === true
    conv.info.running = false
    touch(conv)
    emitMessage(conv, message)
    emitConversation(conv)
    persist(conv, [message])
    armIdle(conv)
  }

  const onSignal = (conv: Conversation, proc: ClaudeProcess, signal: StreamSignal): void => {
    if (conv.proc !== proc) return
    const turn = conv.turn
    switch (signal.kind) {
      case 'init':
        // Claude 那邊的 session 已經開了：之後要接續一律用 --resume
        conv.started = true
        conv.resumeWithoutInit = false
        if (signal.sessionId !== '' && signal.sessionId !== conv.claudeSession) {
          conv.claudeSession = signal.sessionId
          // 分出新 session 之後，這個對話就屬於這個專案了
          conv.origin = conv.dir
          conv.fork = false
          persist(conv)
        }
        if (!signal.mcpConnected && turn) {
          finishTurn(conv, { state: 'error', error: NO_MCP })
          proc.close()
        }
        return
      case 'auth_failed':
        if (turn) finishTurn(conv, { state: 'error', error: NEED_LOGIN })
        proc.close()
        return
      case 'text':
        if (!turn) return
        turn.assistant.text += signal.delta
        scheduleEmit(conv, turn)
        return
      case 'tool_start': {
        if (!turn || turn.steps.has(signal.id)) return
        const step: ChatStep = {
          id: signal.id,
          tool: signal.tool,
          label: toolDoingLabel(signal.tool),
          status: 'running',
        }
        turn.steps.set(signal.id, step)
        turn.assistant.steps = [...turn.assistant.steps, step]
        emitMessage(conv, turn.assistant)
        return
      }
      case 'tool_result': {
        const step = turn?.steps.get(signal.id)
        if (!turn || !step) return
        const done: ChatStep = {
          ...step,
          label: toolLabel(step.tool),
          status: signal.ok ? 'done' : 'error',
          ...(signal.summary === '' ? {} : { summary: signal.summary }),
        }
        turn.steps.set(signal.id, done)
        turn.assistant.steps = turn.assistant.steps.map((s) => (s.id === signal.id ? done : s))
        emitMessage(conv, turn.assistant)
        return
      }
      case 'result':
        if (!turn) return
        if (signal.ok) finishTurn(conv, { state: 'done', text: signal.text })
        else if (signal.interrupted) finishTurn(conv, { state: 'stopped' })
        else {
          finishTurn(conv, {
            state: 'error',
            error: signal.error ?? LOST,
            ...(signal.resumable === true ? { resumable: true } : {}),
          })
        }
        return
    }
  }

  const onExit = (
    conv: Conversation,
    proc: ClaudeProcess,
    info: { code: number | null; signal: string | null; stderr: string },
  ): void => {
    if (conv.proc !== proc) return
    conv.proc = undefined
    clearIdle(conv)
    if (
      conv.turn &&
      !conv.turn.fellBack &&
      conv.resumeWithoutInit === true &&
      /No conversation found/i.test(info.stderr)
    ) {
      // Claude 那邊找不到這個對話的紀錄（被清掉、換了電腦）：改開新的，把我們存的對話內容帶過去當背景
      deps.log.warn('Claude 找不到這個對話的舊紀錄，改開新的並帶上我們存的內容')
      conv.turn.fellBack = true
      conv.started = false
      conv.fork = false
      conv.claudeSession = newId()
      conv.resumeWithoutInit = false
      try {
        if (conv.claudePath === undefined) throw new Error('沒有 claude 路徑')
        ensureProcess(conv, conv.claudePath).send(seedText(conv, conv.turn.userText))
        return
      } catch (error) {
        deps.log.error(`改開新對話失敗：${String(error)}`)
      }
    }
    if (conv.turn) {
      // 行程自己當掉或被中斷後退出：說明一聲；stderr 只進紀錄，不給使用者看
      deps.log.warn(
        `Claude 對話行程結束：code=${String(info.code)} signal=${String(info.signal)} ${info.stderr.slice(-300)}`,
      )
      finishTurn(conv, { state: 'error', error: LOST })
    }
  }

  const ensureProcess = (conv: Conversation, claudePath: string): ClaudeProcess => {
    // 上一輪因為用量到上限停下來：舊行程的額度用完了，關掉換新的（--resume 接回同一個對話）
    if (conv.recycle && conv.proc) {
      const old = conv.proc
      conv.proc = undefined
      old.close()
    }
    conv.recycle = false
    if (conv.proc && !conv.proc.exited) return conv.proc
    mkdirSync(deps.workDir, { recursive: true })
    conv.resumeWithoutInit = conv.started
    const args = buildClaudeArgs({
      sessionId: conv.claudeSession ?? conv.info.id,
      resume: conv.started,
      fork: conv.fork === true,
      bridge: deps.bridge,
      systemPrompt: CHAT_SYSTEM_PROMPT,
      maxBudgetUsd:
        deps.settings.get().experiments.claudeBudgetUsd ??
        deps.maxBudgetUsd ??
        CHAT_BUDGET_DEFAULT_USD,
    })
    const proc: ClaudeProcess = startClaudeProcess({
      spawn: deps.spawn,
      file: claudePath,
      args,
      cwd: deps.workDir,
      env: claudeEnv(deps.env ?? process.env),
      onSignal: (signal) => {
        onSignal(conv, proc, signal)
      },
      onExit: (info) => {
        onExit(conv, proc, info)
      },
    })
    conv.proc = proc
    return proc
  }

  /** 找不到 Claude 那邊的舊紀錄、要改開新對話時，把我們存的對話內容帶過去當背景（只取最後一段）。 */
  const seedText = (conv: Conversation, text: string): string => {
    const earlier = conv.messages.slice(0, -2).filter((m) => m.text.trim() !== '')
    const lines = earlier.map((m) => `${m.role === 'user' ? '使用者' : 'Claude'}：${m.text.trim()}`)
    let body = lines.join('\n')
    if (body.length > SEED_MAX_CHARS) body = `…${body.slice(-SEED_MAX_CHARS)}`
    return [
      '（我們之前在這個專案裡聊過；下面是之前的對話內容，只當背景參考，不要重做已經做過的事。）',
      body,
      '（以上是之前的內容。）',
      '',
      `現在使用者說：${text}`,
    ].join('\n')
  }

  // 專案換了：Claude 剛建了新專案、切過去時，正在做的對話跟著搬過去（不然這段對話會在畫面上消失）；
  // 然後通知畫面重讀對話清單
  const unsubscribeProject = deps.project?.onChange(() => {
    const dir = currentDir()
    // 這一輪做到一半換了專案（Claude 建了新專案）：舊專案那邊收尾，新專案從現在開始記這一輪
    for (const conv of conversations.values()) {
      const { turn } = conv
      if (!turn?.endHistory) continue
      turn.endHistory()
      turn.endHistory = deps.history?.beginAiTurn(CHAT_UNDO_LABEL)
    }
    if (dir) {
      for (const conv of conversations.values()) {
        if (!conv.turn || conv.dir === dir) continue
        const from = conv.dir
        conv.dir = dir
        conv.origin = dir
        try {
          writeConversation(dir, {
            info: storedInfo(conv),
            messages: conv.messages.filter((m) => m.state !== 'streaming'),
          })
          if (from) deleteConversationFile(from, conv.info.id)
        } catch (error) {
          deps.log.warn(`搬對話紀錄失敗：${String(error)}`)
        }
      }
    }
    // 別的專案的對話（沒在做事的）從記憶體拿掉、行程關掉：紀錄都在它們自己專案的 chat/，回去時再讀。
    // 不拿掉的話，另存出來的複本裡同一個 id 的對話會被舊的那份擋住
    for (const [id, conv] of conversations) {
      if (conv.turn || conv.dir === undefined || conv.dir === dir) continue
      clearIdle(conv)
      conv.proc?.close()
      conversations.delete(id)
    }
    loadedDirs.clear()
    deps.broadcast('chat.event', { type: 'reset' })
  })

  return {
    async status() {
      if (!enabled()) return { state: 'disabled' }
      if (!deps.settings.get().mcp.enabled) return { state: 'mcp_off' }
      return prereqOf(await runCheck(true))
    },

    list() {
      loadFromDisk()
      const dir = currentDir()
      return {
        conversations: [...conversations.values()]
          // 目前專案的對話；正在做事的對話（例如 Claude 剛建了新專案、切過去了）不論屬於哪個專案都留著
          .filter((c) => c.dir === dir || c.info.running)
          .map((c) => ({ ...c.info }))
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
      }
    },

    create() {
      const at = now().toISOString()
      const conv: Conversation = {
        info: {
          id: newId(),
          title: DEFAULT_CHAT_TITLE,
          createdAt: at,
          updatedAt: at,
          running: false,
        },
        messages: [],
        started: false,
        dir: currentDir(),
        origin: currentDir(),
      }
      conversations.set(conv.info.id, conv)
      // 還沒說話的對話不存檔：第一則訊息送出去才開始存（不然每個專案都會留一個空檔）
      emitConversation(conv)
      return { ...conv.info }
    },

    rename(conversationId, title) {
      const conv = get(conversationId)
      conv.info.title = title
      touch(conv)
      persist(conv)
      emitConversation(conv)
      return { ...conv.info }
    },

    messages(conversationId) {
      return { messages: get(conversationId).messages.map((m) => ({ ...m })) }
    },

    async send(conversationId, text) {
      const conv = get(conversationId)
      if (!enabled()) throw invalid('Claude 對話是實驗功能，現在沒有打開。到設定可以打開它。')
      if (!deps.settings.get().mcp.enabled) throw invalid(NO_MCP)
      if (conv.turn) throw invalid('Claude 還在做上一則，等它做完，或先按停止。')
      clearIdle(conv)
      conv.turn = {
        assistant: {
          id: newId(),
          role: 'assistant',
          text: '',
          steps: [],
          at: now().toISOString(),
          state: 'streaming',
        },
        steps: new Map(),
        userText: text,
      }
      // 先佔住這一輪（上面），再檢查：檢查要花一點時間，期間不能再送第二則
      const turn = conv.turn
      const check = await runCheck(false).catch((): ClaudeCheck => ({ state: 'not_installed' }))
      if (check.state !== 'ready') {
        conv.turn = undefined
        const prereq = prereqOf(check)
        throw invalid(
          prereq.state === 'not_installed'
            ? '找不到 Claude Code。這個功能需要你電腦上的 Claude Code。'
            : prereq.state === 'too_old'
              ? `Claude Code 的版本太舊（${prereq.version}），請更新到 ${prereq.minVersion} 以上。`
              : NEED_LOGIN,
        )
      }
      const user: ChatPanelMessage = {
        id: newId(),
        role: 'user',
        text,
        steps: [],
        at: now().toISOString(),
      }
      conv.claudePath = check.path
      conv.messages.push(user, turn.assistant)
      if (conv.info.title === DEFAULT_CHAT_TITLE) {
        const oneLine = text.replace(/\s+/g, ' ').trim()
        conv.info.title =
          oneLine.length > TITLE_FROM_TEXT_MAX
            ? `${oneLine.slice(0, TITLE_FROM_TEXT_MAX)}…`
            : oneLine
      }
      conv.info.running = true
      touch(conv)
      emitMessage(conv, user)
      emitMessage(conv, turn.assistant)
      emitConversation(conv)
      persist(conv, [user])
      // 檢查通過、要開始做事了：從現在開始把這一輪的改動記成一步
      turn.endHistory = deps.history?.beginAiTurn(CHAT_UNDO_LABEL)
      try {
        ensureProcess(conv, check.path).send(text)
      } catch (error) {
        deps.log.error(`啟動 Claude 對話行程失敗：${String(error)}`)
        finishTurn(conv, {
          state: 'error',
          error: 'Claude 沒辦法啟動，請確認 Claude Code 能正常使用。',
        })
      }
    },

    stop(conversationId) {
      const conv = get(conversationId)
      const { turn, proc } = conv
      if (!turn || !proc) return
      proc.interrupt()
      // 對方沒在時限內結束這一輪：改用 SIGINT（行程會退出，下一則用 --resume 開新的）
      turn.interruptTimer ??= setTimeout(() => {
        if (conv.turn === turn) proc.forceInterrupt()
      }, graceMs)
    },

    dispose() {
      unsubscribeProject?.()
      for (const conv of conversations.values()) {
        clearIdle(conv)
        if (conv.turn) {
          if (conv.turn.emitTimer) clearTimeout(conv.turn.emitTimer)
          if (conv.turn.interruptTimer) clearTimeout(conv.turn.interruptTimer)
        }
        conv.proc?.close()
      }
    },
  }
}
