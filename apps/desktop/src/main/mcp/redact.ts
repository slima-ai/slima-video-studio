/**
 * 最後一道保險：工具的回傳文字裡如果出現任何一把服務金鑰或連線 token（不管是哪個欄位帶出來的），
 * 一律換成 [已遮蔽]。正常情況不會用到——工具是白名單、回傳值過 Zod；這是萬一哪天有欄位漏了的備援。
 */
export interface Redactor {
  redact: (text: string) => string
}

const MIN_SECRET_LENGTH = 8

export function createRedactor(secrets: () => readonly (string | undefined)[]): Redactor {
  return {
    redact: (text) => {
      let out = text
      for (const secret of secrets()) {
        if (secret && secret.length >= MIN_SECRET_LENGTH) out = out.split(secret).join('[redacted]')
      }
      return out
    },
  }
}

/** 遞迴遮蔽物件裡所有的字串值（陣列與巢狀物件都處理）；不改動原物件。 */
export function redactDeep<T>(value: T, redactor: Redactor): T {
  if (typeof value === 'string') return redactor.redact(value) as T
  if (Array.isArray(value)) return value.map((item: unknown) => redactDeep(item, redactor)) as T
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, redactDeep(item, redactor)]),
    ) as T
  }
  return value
}
