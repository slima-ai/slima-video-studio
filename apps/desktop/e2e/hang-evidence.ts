import { execFile } from 'node:child_process'
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { loadavg, platform } from 'node:os'
import { join } from 'node:path'

/** 外部指令最多等這麼久（取證據不能把測試再拖久）。 */
const COMMAND_TIMEOUT_MS = 15_000

function run(file: string, args: string[]): Promise<string> {
  return new Promise((resolve) => {
    execFile(
      file,
      args,
      { timeout: COMMAND_TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024 },
      (error, stdout, stderr) => {
        const failed = error ? `\n（${file} 失敗：${error.message}）` : ''
        resolve(`${stdout}${stderr}${failed}`)
      },
    )
  })
}

interface ProcessRow {
  pid: number
  ppid: number
  line: string
}

/** 把 `ps` 的輸出解成列；第一欄 pid、第二欄 ppid。 */
export function parseProcessTable(text: string): ProcessRow[] {
  const rows: ProcessRow[] = []
  for (const line of text.split('\n')) {
    const match = /^\s*(\d+)\s+(\d+)\s/.exec(line)
    if (match) rows.push({ pid: Number(match[1]), ppid: Number(match[2]), line })
  }
  return rows
}

/** 某個行程自己加上它所有後代（子行程、孫行程…）。 */
export function descendantsOf(rows: ProcessRow[], root: number): ProcessRow[] {
  const found = new Map<number, ProcessRow>()
  const self = rows.find((row) => row.pid === root)
  if (self) found.set(root, self)
  let grew = true
  while (grew) {
    grew = false
    for (const row of rows) {
      if (!found.has(row.pid) && found.has(row.ppid)) {
        found.set(row.pid, row)
        grew = true
      }
    }
  }
  return [...found.values()]
}

export interface HangEvidenceInput {
  /** 證據存放的資料夾（會建立） */
  dir: string
  /** 卡住的 Electron 主行程 pid */
  pid: number | undefined
  /** 這個測試的 userData（讀 logs/main.log） */
  userDataDir: string
  /** false＝不取呼叫堆疊（sample 會掛上偵錯器、拖慢那個行程，每次退出只取一次）。預設 true。 */
  sample?: boolean
}

/**
 * App 關不掉時，在強制結束它**之前**把能抓的都存成檔：完整 main.log、行程樹、開著的檔案與 port、
 * 機器負載，macOS 另外取一次主行程的呼叫堆疊（`sample`）。回傳存下來的檔案路徑。
 * 每一步失敗都只寫進檔案，不丟錯、不擋下一步。
 */
export async function saveHangEvidence(input: HangEvidenceInput): Promise<string[]> {
  const { dir, pid, userDataDir } = input
  mkdirSync(dir, { recursive: true })
  const saved: string[] = []
  const put = (name: string, body: string) => {
    const path = join(dir, name)
    writeFileSync(path, body)
    saved.push(path)
  }

  try {
    const path = join(dir, 'main.log')
    copyFileSync(join(userDataDir, 'logs', 'main.log'), path)
    saved.push(path)
  } catch {
    put('main.log', '（沒有主行程 log）\n')
  }

  put(
    'summary.txt',
    [
      `time: ${new Date().toISOString()}`,
      `platform: ${platform()}`,
      `pid: ${pid === undefined ? '（沒有 pid）' : String(pid)}`,
      `loadavg(1/5/15): ${loadavg()
        .map((n) => n.toFixed(2))
        .join(' ')}`,
      '',
    ].join('\n'),
  )

  const table = await run('ps', ['-axo', 'pid=,ppid=,pgid=,stat=,etime=,%cpu=,%mem=,command='])
  if (pid === undefined) {
    put('processes.txt', '（沒有 pid）\n')
    return saved
  }
  const tree = descendantsOf(parseProcessTable(table), pid)
  put(
    'processes.txt',
    tree.length > 0
      ? `pid ppid pgid stat etime %cpu %mem command\n${tree.map((row) => row.line).join('\n')}\n`
      : `（ps 找不到 pid ${String(pid)}：行程在取證據前就結束了）\n`,
  )

  if (tree.length > 0) {
    const pids = tree.map((row) => String(row.pid)).join(',')
    put('lsof.txt', await run('lsof', ['-nP', '-p', pids]))
    if (platform() === 'darwin' && input.sample !== false) {
      // 主行程的呼叫堆疊（取樣 1 秒）：看它卡在哪一段
      put('sample-main.txt', await run('sample', [String(pid), '1']))
    }
  }
  return saved
}
