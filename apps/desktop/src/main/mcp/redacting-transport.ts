import type { Transport, TransportSendOptions } from '@modelcontextprotocol/sdk/shared/transport.js'
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js'

import { redactDeep, type Redactor } from './redact'

/**
 * 包住 MCP 的傳輸層：所有送出去的訊息（工具結果、SDK 自己產生的錯誤，例如「找不到工具 xxx」會把輸入原樣帶回）
 * 在離開之前都先過一次遮蔽。比只在工具裡遮蔽可靠：不管哪一層產生的文字都擋得到。
 */
export class RedactingTransport implements Transport {
  onclose?: () => void
  onerror?: (error: Error) => void
  onmessage?: (message: JSONRPCMessage, extra?: unknown) => void

  constructor(
    private readonly inner: Transport,
    private readonly redactor: Redactor,
  ) {}

  async start(): Promise<void> {
    // 內層傳輸的事件轉給 Protocol（server.connect 之後才會設定我們這三個回呼）
    this.inner.onclose = () => {
      this.onclose?.()
    }
    this.inner.onerror = (error) => {
      this.onerror?.(error)
    }
    this.inner.onmessage = (message, extra) => {
      this.onmessage?.(message, extra)
    }
    await this.inner.start()
  }

  send(message: JSONRPCMessage, options?: TransportSendOptions): Promise<void> {
    return this.inner.send(redactDeep(message, this.redactor), options)
  }

  close(): Promise<void> {
    return this.inner.close()
  }
}
