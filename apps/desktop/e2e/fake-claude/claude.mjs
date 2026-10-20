#!/usr/bin/env node
// 測試用的假 claude：e2e 不花錢、不依賴這台電腦有沒有登入 Claude Code（SVS_CLAUDE_BIN 指到這支，只有非打包版吃）。
// 行為照真的 `claude -p --input-format stream-json` 的樣子（欄位與順序都是實測過的真實事件），
// 而且「建鏡頭」那一則真的用 --mcp-config 給的轉接指令去呼叫 App 的 MCP，證明整條路接得通、畫布真的會變。
import { spawn } from 'node:child_process'
import readline from 'node:readline'

const args = process.argv.slice(2)
const out = (event) => process.stdout.write(`${JSON.stringify(event)}\n`)

if (args[0] === '--version') {
  console.log('2.1.304 (Claude Code)')
  process.exit(0)
}
if (args[0] === 'auth' && args[1] === 'status') {
  console.log(JSON.stringify({ loggedIn: process.env.FAKE_CLAUDE_LOGGED_OUT !== '1', authMethod: 'claude.ai' }))
  process.exit(0)
}

const flag = (name) => {
  const i = args.indexOf(name)
  return i < 0 ? undefined : args[i + 1]
}
const sessionId = flag('--resume') ?? flag('--session-id') ?? 'fake-session'
const mcpConfig = JSON.parse(flag('--mcp-config') ?? '{"mcpServers":{}}')
const bridge = mcpConfig.mcpServers['slima-video-studio']

// 照 App 給的設定啟動 MCP 轉接，講最小的 MCP（JSON-RPC over stdio）
let mcp
let nextId = 1
const pending = new Map()
function startMcp() {
  mcp = spawn(bridge.command, bridge.args, { env: { ...process.env, ...bridge.env }, stdio: ['pipe', 'pipe', 'inherit'] })
  readline.createInterface({ input: mcp.stdout }).on('line', (line) => {
    let message
    try { message = JSON.parse(line) } catch { return }
    const waiter = pending.get(message.id)
    if (waiter) { pending.delete(message.id); waiter(message) }
  })
}
const rpc = (method, params) =>
  new Promise((resolve) => {
    const id = nextId++
    pending.set(id, resolve)
    mcp.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`)
  })
async function callTool(name, input) {
  if (!mcp) {
    startMcp()
    await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'fake-claude', version: '1' } })
    mcp.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`)
  }
  const reply = await rpc('tools/call', { name, arguments: input })
  const content = reply.result?.content ?? []
  return { isError: reply.result?.isError === true || reply.error !== undefined, content }
}

out({
  type: 'system',
  subtype: 'init',
  session_id: sessionId,
  mcp_servers: [{ name: 'slima-video-studio', status: bridge ? 'connected' : 'failed' }],
  tools: [],
  apiKeySource: 'none',
  permissionMode: 'dontAsk',
})

let toolCount = 0
const PREFIX = 'mcp__slima-video-studio__'
async function useTool(name, input) {
  const id = `toolu_fake_${++toolCount}`
  out({ type: 'stream_event', event: { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id, name: PREFIX + name, input: {} } } })
  const result = await callTool(name, input)
  out({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, is_error: result.isError, content: result.content }] } })
}
const say = (text) => {
  for (const piece of text.match(/.{1,4}/gu) ?? []) {
    out({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: piece } } })
  }
}
const finish = (text) => out({ type: 'result', subtype: 'success', is_error: false, result: text, session_id: sessionId, total_cost_usd: 0.01 })

let interruptWaiter
readline.createInterface({ input: process.stdin }).on('line', async (line) => {
  let message
  try { message = JSON.parse(line) } catch { return }
  if (message.type === 'control_request' && message.request?.subtype === 'interrupt') {
    out({ type: 'control_response', response: { subtype: 'success', request_id: message.request_id, response: { still_queued: [] } } })
    if (interruptWaiter) interruptWaiter()
    return
  }
  if (message.type !== 'user') return
  const text = String(message.message?.content ?? '')
  if (text.includes('很久')) {
    // 一個要做很久的工作：等使用者按停止
    out({ type: 'stream_event', event: { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'toolu_slow', name: `${PREFIX}wait_for_generation`, input: {} } } })
    await new Promise((resolve) => { interruptWaiter = resolve })
    interruptWaiter = undefined
    out({ type: 'result', subtype: 'error_during_execution', is_error: true, terminal_reason: 'aborted_streaming', session_id: sessionId })
    return
  }
  if (text.includes('壞掉')) process.exit(1)
  if (text.includes('記得')) {
    say(`我記得：${sessionId === 'fake-session' ? '' : '同一個對話，'}上一句是接續的。`)
    finish('我記得')
    return
  }
  // 預設：建一個專案、加兩個鏡頭，再用一句話回報
  await useTool('create_project', { name: 'Claude 建的短片' })
  await useTool('create_shot', {})
  await useTool('create_shot', {})
  const reply = '已經建好專案「Claude 建的短片」，加了兩個鏡頭。'
  say(reply)
  finish(reply)
})
process.stdin.on('end', () => process.exit(0))
