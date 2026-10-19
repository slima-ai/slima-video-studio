import { app, safeStorage } from 'electron'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { HelperRequestSchema, type HelperResponse } from './key-crypto'
import { KEY_HELPER_FLAG } from './key-helper-flag'

/** 這個行程只是金鑰小幫手（做完一件事就結束），不開視窗、不碰使用者資料。 */

export const isKeyHelperRun = (argv: readonly string[]): boolean => argv.includes(KEY_HELPER_FLAG)

/** 在 `app.whenReady()` 之前呼叫：不要跟主程式共用使用者資料夾，也不要出現在 Dock。 */
export function prepareKeyHelper(): void {
  const dir = mkdtempSync(join(tmpdir(), 'svs-key-helper-'))
  app.setPath('userData', dir)
  // 這個暫存的使用者資料夾只為了不跟主程式搶資料；行程真的結束時刪掉（只刪我們自己建的那一個）。
  // 要等到 exit：Chromium 收尾時還會在裡面寫東西
  process.on('exit', () => {
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch {
      // 刪不掉就留著，系統會定期清暫存
    }
  })
  if (process.platform === 'darwin') app.dock?.hide()
}

function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = []
    process.stdin.on('data', (chunk: Buffer) => chunks.push(chunk))
    process.stdin.on('end', () => {
      resolve(Buffer.concat(chunks).toString('utf8'))
    })
  })
}

function handle(raw: string): HelperResponse {
  const parsed = HelperRequestSchema.safeParse(JSON.parse(raw))
  if (!parsed.success) return { ok: false, reason: 'failed' }
  if (!safeStorage.isEncryptionAvailable()) return { ok: false, reason: 'unavailable' }
  const request = parsed.data
  if (request.op === 'encrypt') {
    return { ok: true, cipher: safeStorage.encryptString(request.plain).toString('base64') }
  }
  return {
    ok: true,
    plains: request.ciphers.map((cipher) => {
      try {
        return safeStorage.decryptString(Buffer.from(cipher, 'base64'))
      } catch {
        return null
      }
    }),
  }
}

/** `app.whenReady()` 之後呼叫：讀一則請求、做事、把結果寫到 stdout、結束。 */
export async function runKeyHelper(): Promise<void> {
  let response: HelperResponse
  try {
    response = handle(await readStdin())
  } catch {
    response = { ok: false, reason: 'failed' }
  }
  process.stdout.write(JSON.stringify(response), () => {
    app.exit(0)
  })
}
