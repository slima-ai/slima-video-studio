import {
  AppError,
  t,
  type AspectRatio,
  type BeatKind,
  type CardJob,
  type ShotCard,
  type TrailerSettings,
} from '@svs/schema'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

import { cardSizeFor, textCardHtml, titleCardHtml } from './card-html'

/** 排版或內建字型有改動時加一：舊的字卡指紋就不會再被當成「已經畫過」。 */
export const CARD_LAYOUT_VERSION = 1

/** 內建字型的檔名（Noto Sans TC Bold，OFL；apps/desktop/resources/fonts/）。 */
export const CARD_FONT_FILE = 'NotoSansTC-Bold.otf'

/** 封面圖最大的檔案大小：太大的圖不放進字卡頁面（base64 之後會更大）。 */
const MAX_COVER_BYTES = 20 * 1024 * 1024

/** 把一段 HTML 畫成指定大小的 PNG（正式版用 Electron 離屏視窗；測試給假的）。fontLoaded 是 false 代表內建字型沒載入、退回了系統字型。 */
export type HtmlRenderer = (request: {
  html: string
  width: number
  height: number
  signal?: AbortSignal
}) => Promise<{ png: Uint8Array; fontLoaded?: boolean }>

/** 素材庫：字卡只需要存與找。 */
export interface CardAssets {
  put: (
    content: Uint8Array,
    mime: string,
    meta?: { width?: number; height?: number },
  ) => Promise<{ hash: string; path: string; mime: string; bytes: number; created: boolean }>
  find: (hash: string) => { path: string; mime: string } | undefined
}

export interface CardResult {
  assetHash: string
  /** 輸入的內容指紋：同樣的輸入指紋相同（之後可以當「這格有沒有變」的依據）。 */
  fingerprint: string
  width: number
  height: number
  /** true＝輸入沒變，沿用之前畫好的，這次沒有重畫。 */
  cached: boolean
}

const invalid = (userMessage: string): AppError =>
  new AppError({ code: 'invalid_request', userMessage })

/** 一格鏡頭 ＋ 預告片設定 → 要畫的卡。不是字卡、沒有字、片名卡沒有書名都是白話錯誤。 */
export function cardJobFor(
  shot: { beatKind: BeatKind; card?: ShotCard | undefined },
  settings: TrailerSettings,
): CardJob {
  if (shot.beatKind === 'card') {
    const text = shot.card?.text.trim() ?? ''
    if (text === '') throw invalid(t('trailer.cardNoText'))
    return { kind: 'card', text, subtext: shot.card?.subtext ?? '' }
  }
  if (shot.beatKind === 'title') {
    if (settings.title.trim() === '') throw invalid(t('trailer.titleCardNoName'))
    return {
      kind: 'title',
      title: settings.title,
      author: settings.author,
      endLine: settings.endLine,
      ...(settings.coverAssetHash === undefined ? {} : { coverAssetHash: settings.coverAssetHash }),
    }
  }
  throw invalid(t('trailer.notACardShot'))
}

/** 內建字型的路徑：安裝包在 resources/fonts，開發環境在 apps/desktop/resources/fonts；找不到就是 undefined（用系統字型）。 */
export function cardFontPath(
  where: { resourcesPath: string | undefined; appPath: string },
  exists: (path: string) => boolean = existsSync,
): string | undefined {
  const candidates = [
    ...(where.resourcesPath === undefined
      ? []
      : [join(where.resourcesPath, 'fonts', CARD_FONT_FILE)]),
    join(where.appPath, 'resources', 'fonts', CARD_FONT_FILE),
  ]
  return candidates.find((path) => exists(path))
}

export interface CardServiceDeps {
  render: HtmlRenderer
  assets: CardAssets
  /** 內建字型的 file:// 網址；沒有就用系統字型。 */
  fontUrl?: string
  log?: (message: string) => void
}

export interface CardService {
  /** 畫一張卡存成 PNG 素材。同樣的輸入（內容與大小都一樣）不重畫。 */
  render: (job: CardJob, aspectRatio: AspectRatio, signal?: AbortSignal) => Promise<CardResult>
}

const MIME_OK = new Set(['image/png', 'image/jpeg', 'image/webp'])

export function createCardService(deps: CardServiceDeps): CardService {
  const { render, assets } = deps
  const log = deps.log ?? (() => undefined)
  /** 指紋 → 素材雜湊（這次執行期間）。素材還在才算畫過。 */
  const drawn = new Map<string, string>()

  const coverDataUri = (hash: string): string => {
    const found = assets.find(hash)
    if (!found) throw invalid(t('trailer.coverMissing'))
    if (!MIME_OK.has(found.mime)) throw invalid(t('trailer.coverNotAnImage'))
    let bytes: Buffer
    try {
      if (statSync(found.path).size > MAX_COVER_BYTES) throw invalid(t('trailer.coverTooBig'))
      bytes = readFileSync(found.path)
    } catch (error) {
      if (error instanceof AppError) throw error
      throw invalid(t('trailer.coverMissing'))
    }
    return `data:${found.mime};base64,${bytes.toString('base64')}`
  }

  return {
    async render(job, aspectRatio, signal) {
      const size = cardSizeFor(aspectRatio)
      if (job.kind === 'card' && job.text.trim() === '') throw invalid(t('trailer.cardNoText'))
      if (job.kind === 'title' && job.title.trim() === '')
        throw invalid(t('trailer.titleCardNoName'))
      const fingerprint = createHash('sha256')
        .update(JSON.stringify([CARD_LAYOUT_VERSION, job, size]))
        .digest('hex')
      const before = drawn.get(fingerprint)
      if (before !== undefined && assets.find(before)) {
        return { assetHash: before, fingerprint, ...size, cached: true }
      }

      const fontUrl = deps.fontUrl
      const html =
        job.kind === 'card'
          ? textCardHtml({ ...size, text: job.text, subtext: job.subtext, fontUrl })
          : titleCardHtml({
              ...size,
              title: job.title,
              author: job.author,
              endLine: job.endLine,
              footnote: job.footnote,
              coverDataUri:
                job.coverAssetHash === undefined ? undefined : coverDataUri(job.coverAssetHash),
              fontUrl,
            })
      let rendered: Awaited<ReturnType<HtmlRenderer>>
      try {
        rendered = await render({ html, ...size, ...(signal ? { signal } : {}) })
      } catch (error) {
        if (error instanceof AppError) throw error
        log(`card render failed: ${error instanceof Error ? error.message : String(error)}`)
        throw new AppError({
          code: 'internal_error',
          userMessage: t('trailer.cardRenderFailed'),
          cause: error,
        })
      }
      if (fontUrl !== undefined && rendered.fontLoaded === false) {
        log('card font failed to load; fell back to the system font')
      }
      const put = await assets.put(rendered.png, 'image/png', size)
      drawn.set(fingerprint, put.hash)
      return { assetHash: put.hash, fingerprint, ...size, cached: false }
    },
  }
}
