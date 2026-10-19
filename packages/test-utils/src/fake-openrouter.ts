import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'

import { CLIP_2S_MP4_BASE64 } from './fixtures/clip-2s'
import { makePng } from './png'

/** 假 OpenRouter 認得的 Key；其他 Key（或沒帶）得到 401，用來測「Key 填錯」。 */
export const FAKE_OPENROUTER_KEY = 'sk-or-v1-fake-valid-key-0000'

const CLIP = Buffer.from(CLIP_2S_MP4_BASE64, 'base64')

export interface RecordedRequest {
  method: string
  path: string
  /** 解析過的 JSON 內容（GET 或不是 JSON 時沒有） */
  body?: unknown
}

export interface FakeOpenRouter {
  /** 原樣當作 OpenRouter 的 `baseUrl`（真的是 https://openrouter.ai/api/v1），例如 http://127.0.0.1:5173 */
  url: string
  /** 到目前為止收到的請求（依序） */
  requests: RecordedRequest[]
  close: () => Promise<void>
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * 依 JSON Schema 組一份剛好合法的內容：enum 取第一個、可以是 null 就給 null、陣列給最少的個數。
 * 拆鏡（「請拆成 N 個鏡頭」）另外照要求的鏡數出，每鏡的畫面描述帶故事的一段字。
 */
function exampleOf(schema: unknown, key: string, hint: { story: string; shots: number }): unknown {
  if (!isRecord(schema)) return null
  const branches = schema.anyOf ?? schema.oneOf
  if (Array.isArray(branches)) {
    if (branches.some((b) => isRecord(b) && b.type === 'null')) return null
    return exampleOf(branches[0], key, hint)
  }
  if (Array.isArray(schema.enum)) return schema.enum[0]
  if ('const' in schema) return schema.const
  switch (schema.type) {
    case 'object': {
      const props = isRecord(schema.properties) ? schema.properties : {}
      return Object.fromEntries(
        Object.entries(props).map(([name, child]) => [name, exampleOf(child, name, hint)]),
      )
    }
    case 'array': {
      const min = typeof schema.minItems === 'number' ? schema.minItems : 1
      const count = key === 'shots' ? hint.shots : min
      return Array.from({ length: count }, (_, i) => {
        const item = exampleOf(schema.items, key, hint)
        return isRecord(item) && typeof item.description === 'string'
          ? { ...item, description: `第 ${String(i + 1)} 鏡：${hint.story}` }
          : item
      })
    }
    case 'string':
      return key === 'title' ? hint.story.slice(0, 16) || '假的標題' : '假的文字'
    case 'integer':
    case 'number':
      return typeof schema.minimum === 'number' ? schema.minimum : 1
    case 'boolean':
      return false
    default:
      return null
  }
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => {
      resolve(Buffer.concat(chunks).toString('utf8'))
    })
    req.on('error', reject)
  })
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(body))
}

/** 最後一則使用者訊息的文字（內容可能是字串，也可能是 content parts）。 */
function lastUserText(body: Record<string, unknown>): string {
  const messages = Array.isArray(body.messages) ? (body.messages as unknown[]) : []
  const last = messages.at(-1)
  if (!isRecord(last)) return ''
  if (typeof last.content === 'string') return last.content
  return Array.isArray(last.content)
    ? last.content
        .map((part) => (isRecord(part) && typeof part.text === 'string' ? part.text : ''))
        .join('\n')
    : ''
}

function chatResponse(body: Record<string, unknown>): unknown {
  const usage = { prompt_tokens: 120, completion_tokens: 80, cost: 0.002 }
  const modalities: unknown = body.modalities
  if (Array.isArray(modalities) && modalities.includes('image')) {
    const png = makePng({ width: 64, height: 36, color: [90, 70, 160] }).toString('base64')
    return {
      choices: [
        {
          finish_reason: 'stop',
          message: {
            role: 'assistant',
            content: '',
            images: [{ type: 'image_url', image_url: { url: `data:image/png;base64,${png}` } }],
          },
        },
      ],
      usage: { ...usage, cost: 0.01 },
    }
  }
  const format = body.response_format
  const schema =
    isRecord(format) && isRecord(format.json_schema) ? format.json_schema.schema : undefined
  if (schema === undefined) {
    return { choices: [{ finish_reason: 'stop', message: { content: '假的回應' } }], usage }
  }
  const text = lastUserText(body)
  const story = (/故事：\s*([\s\S]*?)\s*(?:請拆成|$)/.exec(text)?.[1] ?? '').trim()
  const shots = Number(/請拆成\s*(\d+)\s*個鏡頭/.exec(text)?.[1] ?? '1')
  const content = JSON.stringify(exampleOf(schema, '', { story, shots }))
  return { choices: [{ finish_reason: 'stop', message: { content } }], usage }
}

/**
 * 配樂（Lyria）：音訊一定要串流，整首放在一個 SSE 事件的 `delta.audio.data`（base64），最後一個事件帶 `usage.cost`。
 * 回的不是真音樂（只有 mp3 的開頭標記），只證明這條路接通；沒開串流照真的 API 回 400。
 */
function sendMusicStream(res: ServerResponse, body: Record<string, unknown>): void {
  if (body.stream !== true) {
    sendJson(res, 400, { error: { code: 400, message: 'Audio output requires streaming.' } })
    return
  }
  const audio = Buffer.concat([Buffer.from('ID3'), Buffer.alloc(64)]).toString('base64')
  const cost = typeof body.model === 'string' && body.model.includes('clip') ? 0.04 : 0.08
  const events = [
    { choices: [{ delta: { role: 'assistant', content: '' } }] },
    { choices: [{ delta: { audio: { data: audio } } }] },
    { choices: [{ delta: {} }], usage: { prompt_tokens: 39, completion_tokens: 4, cost } },
  ]
  res.writeHead(200, { 'content-type': 'text/event-stream' })
  res.end(`${events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join('')}data: [DONE]\n\n`)
}

/** `POST /images`：照請求的 `n` 回幾張 base64 PNG，`usage.cost` 依 quality 給不同價。 */
function imagesResponse(body: Record<string, unknown>): unknown {
  const png = makePng({ width: 64, height: 36, color: [160, 90, 70] }).toString('base64')
  const count = typeof body.n === 'number' && body.n > 0 ? body.n : 1
  const cost = body.quality === 'high' ? 0.145 : 0.042
  return {
    data: Array.from({ length: count }, () => ({ b64_json: png })),
    usage: { cost: cost * count },
  }
}

/**
 * 假的 OpenRouter（只聽本機）：實作 App 用到的那幾條路（含 gpt-image 走的 `POST /images`），讓整條「填 Key → 文字拆鏡 → 圖片 → 影片 → 接片」
 * 真的走網路請求與真的 driver 程式碼，不用真的 Key、不花錢。
 *
 * 只能證明接線與流程對；回應長相是依 OpenRouter 文件與 client 的 Zod schema 寫的，真實 API 是不是這樣，
 * 還是要真的 Key 才驗得到。
 */
export async function startFakeOpenRouter(): Promise<FakeOpenRouter> {
  const requests: RecordedRequest[] = []
  const videoPolls = new Map<string, number>()
  let nextJob = 1

  const server: Server = createServer((req, res) => {
    void (async () => {
      const path = (req.url ?? '/').split('?')[0] ?? '/'
      const method = req.method ?? 'GET'
      const raw = method === 'POST' ? await readBody(req) : ''
      let body: unknown
      try {
        body = raw === '' ? undefined : (JSON.parse(raw) as unknown)
      } catch {
        body = undefined
      }
      requests.push({ method, path, ...(body === undefined ? {} : { body }) })

      if (req.headers.authorization !== `Bearer ${FAKE_OPENROUTER_KEY}`) {
        sendJson(res, 401, { error: { code: 401, message: 'No auth credentials found' } })
        return
      }
      if (method === 'GET' && path === '/key') {
        sendJson(res, 200, { data: { label: 'fake-key' } })
      } else if (method === 'GET' && path === '/credits') {
        sendJson(res, 200, { data: { total_credits: 10, total_usage: 0.5 } })
      } else if (method === 'POST' && path === '/chat/completions') {
        if (isRecord(body) && Array.isArray(body.modalities) && body.modalities.includes('audio')) {
          sendMusicStream(res, body)
          return
        }
        if (isRecord(body) && body.stream === true) {
          sendJson(res, 501, { error: { code: 501, message: '假伺服器不支援串流' } })
          return
        }
        sendJson(res, 200, chatResponse(isRecord(body) ? body : {}))
      } else if (method === 'POST' && path === '/audio/speech') {
        // 不是真的音訊（只有 mp3 的開頭標記），只證明旁白這條路接通；沒給 voice 照真的 API 回 400
        if (!isRecord(body) || typeof body.voice !== 'string' || body.voice === '') {
          sendJson(res, 400, { error: { code: 400, message: 'An explicit voice is required.' } })
          return
        }
        res.writeHead(200, { 'content-type': 'audio/mpeg', 'x-generation-id': 'fake-gen-tts-1' })
        res.end(Buffer.concat([Buffer.from('ID3'), Buffer.alloc(64)]))
      } else if (method === 'GET' && path === '/generation') {
        sendJson(res, 200, { data: { total_cost: 0.0049 } })
      } else if (method === 'POST' && path === '/images') {
        sendJson(res, 200, imagesResponse(isRecord(body) ? body : {}))
      } else if (method === 'POST' && path === '/videos') {
        const id = `fake-video-${String(nextJob++)}`
        sendJson(res, 200, { id, status: 'pending' })
      } else if (method === 'GET' && /^\/videos\/[^/]+$/.test(path)) {
        const id = decodeURIComponent(path.split('/')[2] ?? '')
        // 第一次查還在進行，第二次才完成：順便走到「輪詢」
        const polls = (videoPolls.get(id) ?? 0) + 1
        videoPolls.set(id, polls)
        sendJson(
          res,
          200,
          polls < 2 ? { status: 'in_progress' } : { status: 'completed', usage: { cost: 0.05 } },
        )
      } else if (method === 'GET' && /^\/videos\/[^/]+\/content$/.test(path)) {
        res.writeHead(200, { 'content-type': 'video/mp4', 'content-length': CLIP.length })
        res.end(CLIP)
      } else {
        sendJson(res, 404, { error: { code: 404, message: `假伺服器沒有 ${method} ${path}` } })
      }
    })().catch((error: unknown) => {
      sendJson(res, 500, { error: { code: 500, message: String(error) } })
    })
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  return {
    url: `http://127.0.0.1:${String(port)}`,
    requests,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => {
          resolve()
        })
        server.closeAllConnections()
      }),
  }
}
