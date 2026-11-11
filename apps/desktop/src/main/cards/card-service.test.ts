import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { TrailerSettingsSchema } from '@svs/schema'
import { afterEach, describe, expect, it } from 'vitest'

import {
  cardFontPath,
  cardJobFor,
  createCardService,
  type CardAssets,
  type HtmlRenderer,
} from './card-service'

const dirs: string[] = []
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})
const tmp = (): string => {
  const d = mkdtempSync(join(tmpdir(), 'svs-cards-'))
  dirs.push(d)
  return d
}

// 最小的 PNG（1×1）
const PNG = Uint8Array.from(
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
    'base64',
  ),
)

function setup(options: { fontUrl?: string } = {}) {
  const dir = tmp()
  const files = new Map<string, { path: string; mime: string }>()
  const calls: { html: string; width: number; height: number }[] = []
  const logs: string[] = []
  const put = (bytes: Uint8Array, mime: string): { hash: string; path: string } => {
    const hash = createHash('sha256').update(bytes).digest('hex')
    const path = join(dir, `${hash}.png`)
    writeFileSync(path, bytes)
    files.set(hash, { path, mime })
    return { hash, path }
  }
  const assets: CardAssets = {
    put: (bytes, mime) =>
      Promise.resolve({ ...put(bytes, mime), mime, bytes: bytes.length, created: true }),
    find: (hash) => files.get(hash),
  }
  let counter = 0
  const render: HtmlRenderer = (req) => {
    calls.push({ html: req.html, width: req.width, height: req.height })
    counter++
    // 每次畫出來的 PNG 不同（尾巴多一個位元組），測試才分得出「重畫」與「沿用」
    return Promise.resolve({ png: Uint8Array.from([...PNG, counter]) })
  }
  const service = createCardService({
    render,
    assets,
    ...(options.fontUrl === undefined ? {} : { fontUrl: options.fontUrl }),
    log: (message) => logs.push(message),
  })
  return { service, calls, logs, put, assets }
}

const settings = TrailerSettingsSchema.parse({
  title: '黑藤裂谷',
  author: '某作者',
  endLine: '12 月 1 日上市',
})

describe('cardJobFor：這一格要畫什麼', () => {
  it('字卡：用鏡頭的 card；片名卡：用預告片設定的書名、作者、片尾那一行與封面', () => {
    expect(
      cardJobFor({ beatKind: 'card', card: { text: '他回來了', subtext: '第一章' } }, settings),
    ).toEqual({ kind: 'card', text: '他回來了', subtext: '第一章' })
    const withCover = TrailerSettingsSchema.parse({ ...settings, coverAssetHash: 'a'.repeat(64) })
    expect(cardJobFor({ beatKind: 'title' }, withCover)).toEqual({
      kind: 'title',
      title: '黑藤裂谷',
      author: '某作者',
      endLine: '12 月 1 日上市',
      coverAssetHash: 'a'.repeat(64),
    })
  })

  it('不是字卡的格子、沒有字的字卡、沒有書名的片名卡：白話錯誤', () => {
    expect(() => cardJobFor({ beatKind: 'video' }, settings)).toThrow('不是字卡')
    expect(() => cardJobFor({ beatKind: 'card' }, settings)).toThrow('字卡還沒有字')
    expect(() =>
      cardJobFor({ beatKind: 'title' }, TrailerSettingsSchema.parse({ author: 'x' })),
    ).toThrow('書名')
  })
})

describe('字卡服務', () => {
  it('畫一張文字卡：存成 PNG 素材、回傳雜湊與大小；大小跟著專案比例', async () => {
    const { service, calls, assets } = setup()
    const wide = await service.render({ kind: 'card', text: '他回來了' }, '16:9')
    expect(wide).toMatchObject({ width: 1280, height: 720, cached: false })
    expect(assets.find(wide.assetHash)?.mime).toBe('image/png')
    expect(calls[0]).toMatchObject({ width: 1280, height: 720 })
    const tall = await service.render({ kind: 'card', text: '他回來了' }, '9:16')
    expect(tall).toMatchObject({ width: 720, height: 1280 })
    expect(tall.assetHash).not.toBe(wide.assetHash)
  })

  it('同樣的輸入第二次不重畫（沿用，cached 是 true）；改一個字就重畫', async () => {
    const { service, calls } = setup()
    const first = await service.render({ kind: 'card', text: '他回來了' }, '16:9')
    const second = await service.render({ kind: 'card', text: '他回來了' }, '16:9')
    expect(calls).toHaveLength(1)
    expect(second).toMatchObject({
      cached: true,
      assetHash: first.assetHash,
      fingerprint: first.fingerprint,
    })
    const third = await service.render({ kind: 'card', text: '他回來了！' }, '16:9')
    expect(calls).toHaveLength(2)
    expect(third.fingerprint).not.toBe(first.fingerprint)
    // 比例不同也是不同的輸入
    await service.render({ kind: 'card', text: '他回來了' }, '9:16')
    expect(calls).toHaveLength(3)
  })

  it('素材被刪掉了：就算輸入一樣也重畫', async () => {
    const { service, calls, assets } = setup()
    const first = await service.render({ kind: 'card', text: '他回來了' }, '16:9')
    ;(assets as { find: CardAssets['find'] }).find = () => undefined
    const again = await service.render({ kind: 'card', text: '他回來了' }, '16:9')
    expect(calls).toHaveLength(2)
    expect(again.cached).toBe(false)
    expect(first.assetHash).toBeDefined()
  })

  it('片名卡：封面原圖變成 data: 圖放進頁面；封面換了指紋就變', async () => {
    const { service, calls, put } = setup()
    const a = put(PNG, 'image/png')
    const b = put(Uint8Array.from([...PNG, 9]), 'image/png')
    const first = await service.render(
      {
        kind: 'title',
        title: '黑藤裂谷',
        author: '某作者',
        endLine: '12 月 1 日上市',
        coverAssetHash: a.hash,
      },
      '16:9',
    )
    expect(calls[0]?.html).toContain('src="data:image/png;base64,')
    expect(calls[0]?.html).toContain('黑藤裂谷')
    const second = await service.render(
      {
        kind: 'title',
        title: '黑藤裂谷',
        author: '某作者',
        endLine: '12 月 1 日上市',
        coverAssetHash: b.hash,
      },
      '16:9',
    )
    expect(second.fingerprint).not.toBe(first.fingerprint)
  })

  it('封面素材不存在：白話錯誤，沒有去畫', async () => {
    const { service, calls } = setup()
    await expect(
      service.render({ kind: 'title', title: '黑藤裂谷', coverAssetHash: 'f'.repeat(64) }, '16:9'),
    ).rejects.toMatchObject({
      code: 'invalid_request',
      userMessage: '找不到封面圖，請重新選一張封面。',
    })
    expect(calls).toHaveLength(0)
  })

  it('封面不是圖片：拒絕', async () => {
    const { service, put } = setup()
    const text = put(Uint8Array.from(Buffer.from('hello')), 'text/plain')
    await expect(
      service.render({ kind: 'title', title: '黑藤裂谷', coverAssetHash: text.hash }, '16:9'),
    ).rejects.toMatchObject({ code: 'invalid_request' })
  })

  it('文字進到頁面前已經跳脫（使用者、模型或 Claude 寫的字不會變成標籤）', async () => {
    const { service, calls } = setup()
    await service.render({ kind: 'card', text: '<script>alert(1)</script>' }, '16:9')
    expect(calls[0]?.html).not.toContain('<script>alert')
    expect(calls[0]?.html).toContain('&#60;script&#62;')
  })

  it('有字型就用 file:// 網址載入；畫的人回報字型沒載入就在 log 記一筆（退回系統字型，仍然畫出來）', async () => {
    const dir = tmp()
    const logs: string[] = []
    const service = createCardService({
      render: (req) => {
        expect(req.html).toContain('file:///fonts/NotoSansTC-Bold.otf')
        return Promise.resolve({ png: PNG, fontLoaded: false })
      },
      assets: {
        put: (bytes, mime) =>
          Promise.resolve({
            hash: 'a'.repeat(64),
            path: join(dir, 'x.png'),
            mime,
            bytes: bytes.length,
            created: true,
          }),
        find: () => undefined,
      },
      fontUrl: 'file:///fonts/NotoSansTC-Bold.otf',
      log: (message) => logs.push(message),
    })
    const done = await service.render({ kind: 'card', text: '他回來了' }, '16:9')
    expect(done.assetHash).toBe('a'.repeat(64))
    expect(logs.some((l) => l.includes('font'))).toBe(true)
  })

  it('畫圖的一方失敗：白話錯誤，不外洩原始訊息', async () => {
    const service = createCardService({
      render: () => Promise.reject(new Error('GPU process crashed: secret detail')),
      assets: { put: () => Promise.reject(new Error('no')), find: () => undefined },
    })
    const error = await service
      .render({ kind: 'card', text: '他回來了' }, '16:9')
      .catch((e: unknown) => e)
    expect(error).toMatchObject({ code: 'internal_error' })
    expect((error as { userMessage: string }).userMessage).not.toContain('secret')
  })

  it('字卡沒有字：拒絕', async () => {
    const { service } = setup()
    await expect(service.render({ kind: 'card', text: '   ' }, '16:9')).rejects.toMatchObject({
      code: 'invalid_request',
    })
  })
})

describe('cardFontPath：內建字型在哪', () => {
  const exists =
    (...paths: string[]) =>
    (p: string) =>
      paths.includes(p)
  it('安裝包：resources/fonts；開發環境：apps/desktop/resources/fonts；都沒有就是 undefined', () => {
    const packaged = join('/App/Resources', 'fonts', 'NotoSansTC-Bold.otf')
    const dev = join('/repo/apps/desktop', 'resources', 'fonts', 'NotoSansTC-Bold.otf')
    expect(
      cardFontPath(
        { resourcesPath: '/App/Resources', appPath: '/repo/apps/desktop' },
        exists(packaged),
      ),
    ).toBe(packaged)
    expect(
      cardFontPath(
        { resourcesPath: '/Electron/Resources', appPath: '/repo/apps/desktop' },
        exists(dev),
      ),
    ).toBe(dev)
    expect(
      cardFontPath({ resourcesPath: undefined, appPath: '/nowhere' }, exists()),
    ).toBeUndefined()
  })
})
