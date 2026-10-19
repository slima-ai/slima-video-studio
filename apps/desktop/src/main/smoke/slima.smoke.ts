import { expect, it } from 'vitest'

import { MemoryVault } from '../keys/key-vault'
import { createSlimaService, slimaApiUrlFor, slimaLaunchFor } from '../slima/slima-service'

/**
 * Slima 連線冒煙測試（`pnpm smoke:slima`）：用真實 Token 啟動內建的 slima-mcp，列出你的書。只讀取。
 *
 *   SLIMA_API_TOKEN=…  pnpm smoke:slima                                  （連 Slima 正式站）
 *   SVS_SLIMA_API_URL=https://<測試主機> SVS_SLIMA_TEST_HOSTS=<測試主機> SLIMA_API_TOKEN=…  pnpm smoke:slima   （連自己指定的測試環境）
 */
const token = process.env.SLIMA_API_TOKEN

it.skipIf(!token)('真實 Slima：連線並列出書', async () => {
  const log = {
    info: (m: string) => process.stdout.write(`${m}\n`),
    warn: (m: string) => process.stdout.write(`${m}\n`),
  }
  // 連線目標寫在輸出最前面，免得拿 test 的 Token 去連正式站（或反過來）還不知道
  process.stdout.write(
    `連線目標：${slimaApiUrlFor(process.env, false) ?? '預設（Slima 正式站）'}\n`,
  )
  const service = createSlimaService({
    keys: new MemoryVault(),
    broadcast: () => undefined,
    log,
    launch: slimaLaunchFor(process.env, false),
  })
  try {
    const status = await service.connect(token ?? '')
    process.stdout.write(`狀態：${JSON.stringify(status)}\n`)
    expect(status.state).toBe('ready')
    const { books } = await service.books()
    for (const book of books) {
      process.stdout.write(
        `- ${book.title}（${book.kind}・${String(book.words)} 字）${book.token}\n`,
      )
    }
    expect(Array.isArray(books)).toBe(true)
  } finally {
    await service.stop()
  }
})
