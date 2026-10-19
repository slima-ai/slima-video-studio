import type { LlmRequest } from '@svs/schema'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createStudioHarness } from '../shots/test-harness'

// 每個測試都要跑完整的快速開始，電腦忙的時候超過預設的 5 秒
vi.setConfig({ testTimeout: 60_000 })

type Harness = ReturnType<typeof createStudioHarness>
const open: Harness[] = []

const breakdown = (request: LlmRequest): object | undefined =>
  request.system?.includes('分鏡助手')
    ? {
        title: '雨天的貓',
        shots: [
          { description: '阿鐵走進雨裡', size: 'wide', cameraMove: null, characters: [] },
          { description: '雨停了', size: 'wide', cameraMove: null, characters: [] },
        ],
      }
    : undefined

const setup = (): Harness => {
  const harness = createStudioHarness({ mockLlm: breakdown })
  open.push(harness)
  return harness
}
afterEach(() => {
  for (const harness of open.splice(0)) harness.cleanup()
})

describe('FilesService', () => {
  it('沒有專案：就是空的', () => {
    const h = setup()
    expect(h.files.list({})).toEqual({ files: [], exports: [], totalBytes: 0 })
  })

  it('生成完：每個檔案列出大小、位置與用途；成品影片標出來', async () => {
    const h = setup()
    await h.runQuickStart({ shotCount: 2 })
    const snapshot = h.files.list({})

    const images = snapshot.files.filter((f) => f.kind === 'image')
    const videos = snapshot.files.filter((f) => f.kind === 'video')
    expect(images.length).toBeGreaterThanOrEqual(2)
    expect(videos.length).toBeGreaterThanOrEqual(3) // 兩個鏡頭的影片＋接好的成品
    expect(snapshot.totalBytes).toBe(snapshot.files.reduce((n, f) => n + f.bytes, 0))
    expect(snapshot.projectDir).toBeDefined()

    for (const file of snapshot.files) {
      expect(file.path).toContain(file.hash)
      expect(file.usedBy.length).toBeGreaterThan(0)
    }
    const firstFrame = images.find((f) =>
      f.usedBy.some((u) => u.includes('第 1 鏡・第一張畫面 v1')),
    )
    expect(firstFrame?.usedBy[0]).toContain('採用中')
    expect(snapshot.files.some((f) => f.usedBy.includes('接好的成品影片'))).toBe(true)
  })

  it('依種類篩選；重新生成後舊版本仍有用途，沒用途的才算「沒被使用」', async () => {
    const h = setup()
    await h.runQuickStart({ shotCount: 2 })
    expect(h.files.list({ kind: 'image' }).files.every((f) => f.kind === 'image')).toBe(true)
    expect(h.files.list({ kind: 'video' }).files.every((f) => f.kind === 'video')).toBe(true)
    // 剛生成完，每個檔案都有用途
    expect(h.files.list({ unusedOnly: true }).files).toEqual([])

    // 刪掉鏡頭 → 它的版本不見，檔案還在但沒有任何用途
    const second = h.shots.list().shots[1]
    h.shots.remove([second?.id ?? ''])
    const unused = h.files.list({ unusedOnly: true }).files
    expect(unused.length).toBeGreaterThan(0)
    expect(unused.every((f) => f.usedBy.length === 0)).toBe(true)
  })

  it('匯出的成品列在 exports；reveal 只接受素材雜湊或 exports 裡的檔名', async () => {
    const h = setup()
    await h.runQuickStart({ shotCount: 2 })
    const { path } = await h.quickstart.export()
    const snapshot = h.files.list({})
    expect(snapshot.exports.map((e) => e.path)).toEqual([path])
    expect(snapshot.exports[0]?.bytes).toBeGreaterThan(0)

    h.files.reveal({ hash: snapshot.files[0]?.hash ?? '' })
    h.files.reveal({ exportName: snapshot.exports[0]?.name ?? '' })
    expect(h.revealed).toEqual([snapshot.files[0]?.path, path])

    expect(() => {
      h.files.reveal({ exportName: '../project.sqlite' })
    }).toThrow('找不到這個匯出的檔案')
    expect(() => {
      h.files.reveal({ hash: 'a'.repeat(64) })
    }).toThrow('找不到這個檔案')
  })
})
