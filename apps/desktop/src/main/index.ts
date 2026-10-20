import { app, BrowserWindow, dialog, Menu, safeStorage, shell } from 'electron'
import { join } from 'node:path'

import { CSP_VIOLATION_PREFIX } from '../shared/csp'
import { installAssetProtocol, registerAssetScheme } from './asset-protocol'
import { installCrashGuards, runShutdown } from './crash-guard'
import { createKeyTester } from './keys/key-tester'
import { directKeyCrypto, helperKeyCrypto } from './keys/key-crypto'
import { createHelperRunner } from './keys/key-helper-runner'
import { isKeyHelperRun, prepareKeyHelper, runKeyHelper } from './keys/key-helper'
import { createKeyVault } from './keys/key-vault'
import { ProjectManager } from './project-manager'
import { registerAllHandlers } from './ipc/handlers'
import { installIpc } from './ipc/install'
import {
  bridgeCommand,
  createConnector,
  findClaudeInLoginShell,
  runFileDirect,
} from './mcp/connect'
import { createMcpController, type McpController } from './mcp/controller'
import { createIpcRegistry } from './ipc/registry'
import { restoreLastProject } from './last-project'
import { createRecentStore, trackRecentProjects } from './recent-projects'
import { createLogger, type Logger } from './logger'
import { locateTools } from './bundled-tools'
import { type Broadcast, type ProjectRuntime } from './runtime/project-runtime'
import { createSettingsStore } from './settings/settings-store'
import { createSlimaImportService } from './slima/import-service'
import { createSlimaService, slimaLaunchFor, type SlimaService } from './slima/slima-service'
import { appMenuTemplate } from './app-menu'
import { createMockFrameRenderer } from './mock-frame'
import { renderCardWithElectron } from './credits/render-card-electron'
import { createStudioApp } from './studio-app'
import { openrouterBaseUrlOverride, startsOnHome } from './test-overrides'
import { isInternalUrl, isSafeExternalUrl } from './navigation'
import { QUIET_COMMAND_LINE_SWITCHES, quietWindowsEnabled } from './quiet-windows'
import { APP_TITLE, createWindowOptions } from './window'

// 金鑰小幫手：macOS 的鑰匙圈提示會卡住呼叫它的行程，所以讀寫鑰匙圈交給這個另開的行程（見 keys/key-crypto.ts）
const KEY_HELPER = isKeyHelperRun(process.argv)
if (KEY_HELPER) prepareKeyHelper()

// 只有非打包版才允許用環境變數指定 userData（E2E 用）
if (!KEY_HELPER && !app.isPackaged && process.env.SVS_USER_DATA) {
  app.setPath('userData', process.env.SVS_USER_DATA)
}

registerAssetScheme()

function loadRenderer(win: BrowserWindow): string {
  const devUrl = process.env.ELECTRON_RENDERER_URL
  if (!app.isPackaged && devUrl) {
    void win.loadURL(devUrl)
    return devUrl
  }
  const file = join(__dirname, '../renderer/index.html')
  void win.loadFile(file)
  return new URL(`file://${file.replaceAll('\\', '/')}`).href
}

function guardWebContents(win: BrowserWindow, appUrl: () => string, log: Logger): void {
  const { webContents } = win

  // 不開新視窗；http(s) 連結改用系統瀏覽器
  webContents.setWindowOpenHandler(({ url }) => {
    if (isSafeExternalUrl(url)) void shell.openExternal(url)
    else log.warn(`已阻擋開啟視窗：${url}`)
    return { action: 'deny' }
  })

  // 不允許導航到 App 以外的頁面
  webContents.on('will-navigate', (event, url) => {
    if (isInternalUrl(url, appUrl())) return
    event.preventDefault()
    if (isSafeExternalUrl(url)) void shell.openExternal(url)
    else log.warn(`已阻擋導航：${url}`)
  })

  webContents.on('will-attach-webview', (event) => {
    event.preventDefault()
  })

  // renderer 回報的 CSP 違規寫進 log
  webContents.on('console-message', (event) => {
    if (event.message.startsWith(CSP_VIOLATION_PREFIX)) log.error(event.message)
  })
}

// 目前開啟的專案（App 結束前要關閉資料庫、釋放專案鎖）
let projects: ProjectManager | undefined
let runtime: ProjectRuntime | undefined
let slimaService: SlimaService | undefined
let mcpController: McpController | undefined
let mainLog: Logger | undefined

// 目前只有一個主視窗，其 URL 同時是 IPC 寄件者驗證的依據
let appUrl = ''

function createMainWindow(log: Logger): BrowserWindow {
  const quiet = quietWindowsEnabled(process.env, app.isPackaged)
  const win = new BrowserWindow(
    createWindowOptions(join(__dirname, '../preload/index.js'), { quiet }),
  )
  guardWebContents(win, () => appUrl, log)
  if (quiet) {
    // macOS 會把視窗位置夾回螢幕內（放到螢幕外沒用），所以讓視窗完全透明、不吃滑鼠：看不到、點不到，
    // 但 Chromium 照常繪製（Playwright 的截圖與操作走 DevTools 協定，不受影響）
    win.setOpacity(0)
    win.setIgnoreMouseEvents(true)
  }
  win.once('ready-to-show', () => {
    // 安靜模式用 showInactive：視窗存在、照常繪製，但不會跳到最前面、不搶焦點
    if (quiet) win.showInactive()
    else win.show()
  })
  win.setTitle(APP_TITLE)
  appUrl = loadRenderer(win)
  return win
}

// 安靜模式（自動化測試用）：不出現在 Dock、不變成使用中的 App；視窗被擋住也照常繪製
if (quietWindowsEnabled(process.env, app.isPackaged)) {
  for (const [name, value] of QUIET_COMMAND_LINE_SWITCHES) app.commandLine.appendSwitch(name, value)
  if (process.platform === 'darwin') app.setActivationPolicy('accessory')
}

void app.whenReady().then(() => {
  if (KEY_HELPER) {
    void runKeyHelper()
    return
  }
  // 先放一份沒有「最近的專案」的選單；專案服務準備好之後（下面）會換成帶著最近專案的
  const installMenu = (recent: readonly { name: string; dir: string }[] = []): void => {
    const menu = appMenuTemplate(process.platform, {
      onAction: (action) => {
        // 轉給畫面：選單、專案列的選單、快捷鍵做的是同一批動作
        broadcast('menu.action', action)
      },
      recent,
    })
    Menu.setApplicationMenu(menu ? Menu.buildFromTemplate(menu) : null)
  }
  installMenu()
  const log = createLogger(join(app.getPath('userData'), 'logs'))
  mainLog = log
  installCrashGuards(process, log)
  log.info(`${APP_TITLE} 啟動（${app.getVersion()}，packaged=${String(app.isPackaged)}）`)
  projects = new ProjectManager(app.getVersion())
  installAssetProtocol(projects)

  const registry = createIpcRegistry(log)
  const userData = app.getPath('userData')
  if (!app.isPackaged && process.env.SVS_REAL_VAULT !== '1') {
    log.info(
      '開發模式：服務金鑰只放在記憶體（重開就沒了，也不碰系統鑰匙圈）。要用真的鑰匙圈請設 SVS_REAL_VAULT=1',
    )
  }
  const keys = createKeyVault({
    isPackaged: app.isPackaged,
    env: process.env,
    crypto:
      process.platform === 'darwin'
        ? helperKeyCrypto(
            createHelperRunner({ execPath: process.execPath, appPath: app.getAppPath() }),
          )
        : directKeyCrypto(safeStorage),
    userDataDir: userData,
    ...(process.env.SVS_TEST_VAULT_FILE ? { testVaultFile: process.env.SVS_TEST_VAULT_FILE } : {}),
    warn: (message) => {
      log.warn(message)
    },
  })
  // 測試模式（非打包版才生效）：預設用示範模式、略過第一次使用的引導
  const testMode = !app.isPackaged
  // 測試用：OpenRouter 換成本機的假伺服器（只有非打包版、而且是本機位址才生效）
  const openrouterBaseUrl = openrouterBaseUrlOverride(process.env, app.isPackaged)
  if (testMode && process.env.SVS_OPENROUTER_BASE_URL && openrouterBaseUrl === undefined) {
    log.warn('SVS_OPENROUTER_BASE_URL 不是本機位址，已忽略')
  }
  const settings = createSettingsStore({
    file: join(userData, 'settings.json'),
    initial: {
      ...(testMode && process.env.SVS_PROVIDER_MODE === 'mock' ? { demoMode: true } : {}),
      ...(testMode && process.env.SVS_DISABLE_ONBOARDING === '1' ? { onboardingDone: true } : {}),
    },
    warn: (message) => {
      log.warn(message)
    },
  })
  // 真實模式：啟動時就開始（非同步）把存好的金鑰從鑰匙圈讀進來——鑰匙圈的提示會在這時候出現，
  // 而不是卡在第一次生成的途中；示範模式與沒存金鑰的人完全不會碰鑰匙圈
  if (!settings.get().demoMode) {
    keys.load().catch((error: unknown) => {
      log.warn(`讀取服務金鑰失敗：${error instanceof Error ? error.message : ''}`)
    })
  }
  // installIpc 在 handler 註冊之後才建立，事件先透過這個轉接
  let broadcast: Broadcast = () => undefined
  const relay: Broadcast = (event, payload) => {
    broadcast(event, payload)
  }
  // 內建的 FFmpeg（安裝檔裡就有，使用者不用另外安裝）
  const tools = locateTools()
  const projectsDir =
    process.env.SVS_PROJECTS_DIR && testMode
      ? process.env.SVS_PROJECTS_DIR
      : join(app.getPath('documents'), 'Slima Video Studio')
  const recent = createRecentStore(join(userData, 'recent-projects.json'), log)
  const studio = createStudioApp({
    recent,
    projects,
    keys,
    settings,
    broadcast: relay,
    log,
    tools: () => tools,
    projectsDir,
    // 匯出時的片尾字卡：用 Electron 離屏視窗畫成圖（自編的 FFmpeg 沒有 drawtext）
    renderCreditsCard: renderCardWithElectron,
    reveal: (path) => {
      shell.showItemInFolder(path)
    },
    // 「新專案」的「更改…」選存放的資料夾；「開啟舊專案…」選專案本身的資料夾
    pickFolder: async (purpose) => {
      const options: Electron.OpenDialogOptions =
        purpose === 'save'
          ? { title: '選擇要存放專案的資料夾', properties: ['openDirectory', 'createDirectory'] }
          : {
              title: '選擇要打開的專案（名字以 .svsproj 結尾的資料夾）',
              properties: ['openDirectory'],
            }
      const owner = BrowserWindow.getFocusedWindow()
      const picked = owner
        ? await dialog.showOpenDialog(owner, options)
        : await dialog.showOpenDialog(options)
      return picked.canceled ? undefined : picked.filePaths[0]
    },
    // 畫布「上傳」：選圖片或影片（可以一次選好幾個）
    pickFiles: async () => {
      const options: Electron.OpenDialogOptions = {
        title: '選擇要放到畫布上的圖片或影片',
        properties: ['openFile', 'multiSelections'],
        filters: [
          { name: '圖片或影片', extensions: ['png', 'jpg', 'jpeg', 'webp', 'mp4', 'webm', 'mov'] },
        ],
      }
      const owner = BrowserWindow.getFocusedWindow()
      const picked = owner
        ? await dialog.showOpenDialog(owner, options)
        : await dialog.showOpenDialog(options)
      return picked.canceled ? [] : picked.filePaths
    },
    ...(testMode && process.env.SVS_PROVIDER_MODE === 'mock' ? { pollIntervalMs: 20 } : {}),
    mockFrame: createMockFrameRenderer(),
    ...(testMode && process.env.SVS_MOCK_LATENCY_MS
      ? { mockLatencyMs: Number(process.env.SVS_MOCK_LATENCY_MS) }
      : {}),
    ...(testMode && process.env.SVS_MOCK_REJECT_TEXT
      ? { mockRejectText: process.env.SVS_MOCK_REJECT_TEXT }
      : {}),
    ...(openrouterBaseUrl === undefined ? {} : { openrouterBaseUrl }),
  })
  const {
    settingsService,
    shots,
    characters,
    concepts,
    sound,
    turnarounds,
    locations,
    outline,
    storyboard,
    history,
    quickstart,
    upgrade,
    graph,
    canvas,
    records,
    files,
    library,
  } = studio
  const slima = createSlimaService({
    keys,
    broadcast: relay,
    log,
    launch: slimaLaunchFor(process.env, app.isPackaged),
  })
  const slimaImport = createSlimaImportService({
    reader: slima.reader,
    projects,
    projectsDir,
    outline,
    demoMode: () => settings.get().demoMode,
  })
  restoreLastProject(join(userData, 'last-project.json'), projects, log)
  trackRecentProjects(recent, projects)
  // 「檔案 › 開啟最近的專案」跟著專案開啟、關閉更新（macOS 才有選單）
  const refreshMenu = (): void => {
    installMenu(
      studio.library
        .recent()
        .filter((p) => !p.current && !p.missing)
        .map((p) => ({ name: p.name, dir: p.dir })),
    )
  }
  refreshMenu()
  projects.onChange(refreshMenu)
  const mcp = createMcpController({
    registry,
    settings,
    keys,
    broadcast: relay,
    projects,
    tools: () => tools,
    userDataDir: userData,
    info: { name: APP_TITLE, version: app.getVersion() },
    log,
  })
  mcpController = mcp
  const mcpConnector = createConnector({
    platform: process.platform,
    home: app.getPath('home'),
    appData: process.env.APPDATA,
    // 轉接檔跟 index.js 放在同一個資料夾；用 App 自己的 Electron 當 Node 跑
    bridge: bridgeCommand(process.execPath, join(__dirname, 'mcp-stdio-bridge.js'), userData),
    findClaude: findClaudeInLoginShell,
    runFile: runFileDirect,
  })
  runtime = studio.runtime
  slimaService = slima
  registerAllHandlers(registry, {
    startOnHome: startsOnHome(process.env, app.isPackaged),
    info: {
      name: APP_TITLE,
      version: app.getVersion(),
      platform: process.platform,
      packaged: app.isPackaged,
    },
    projects,
    keys,
    keyTester: createKeyTester({
      keys,
      ...(openrouterBaseUrl === undefined ? {} : { openrouterBaseUrl }),
    }),
    settings,
    settingsService,
    mcp,
    mcpConnector,
    runtime,
    quickstart,
    upgrade,
    slima,
    slimaImport,
    graph,
    canvas,
    records,
    files,
    shots,
    characters,
    concepts,
    sound,
    turnarounds,
    locations,
    outline,
    storyboard,
    history,
    library,
    demo: studio.demo,
  })
  broadcast = installIpc(registry, () => appUrl, log).broadcast
  slima.start()
  // 使用者之前開著「AI 工具連線」，重開 App 後自動接回（預設是關的）
  void mcp.sync()

  createMainWindow(log)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow(log)
  })
})

app.on('before-quit', () => {
  // 一步失敗不擋下一步，也不擋結束（以前丟錯會變成擋住結束的錯誤視窗）
  runShutdown(
    [
      ['中斷 Slima 連線', () => slimaService?.stop()],
      ['停止 AI 工具連線', () => mcpController?.stop()],
      ['停止生成佇列', () => runtime?.dispose()],
      ['關閉專案', () => projects?.close()],
    ],
    mainLog ?? { info: console.log, error: console.error },
  )
})

app.on('will-quit', () => {
  mainLog?.info('結束：視窗都關了')
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
