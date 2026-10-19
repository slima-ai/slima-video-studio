import { AppError, type DemoSeedResult, type ProjectInfo } from '@svs/schema'
import type { MediaTools } from '@svs/media'
import { renderMockFrame, type MockFrame } from '@svs/providers'

import { createMockVideoRenderer } from '../mock-video'
import type { ProjectLibrary } from '../project-library'
import type { ProjectManager } from '../project-manager'

export interface DemoSeederDeps {
  library: Pick<ProjectLibrary, 'createNew'>
  projects: ProjectManager
  /** 內建的 FFmpeg；有的話示範影片是真的影片檔，沒有就只放圖。 */
  tools?: () => MediaTools | undefined
  /** 用視窗裡的字型畫示範圖（中文才不會變成「??」）；沒有就用點陣字型。 */
  mockFrame?: (frame: MockFrame) => Promise<Uint8Array | undefined>
  now?: () => number
}

/** 一場幾個鏡頭。 */
const SHOTS_PER_SCENE = 10
/** 示範圖與示範影片各做幾張，鏡頭輪流用（不用真的生 250 次）。 */
const IMAGE_COUNT = 6
const VIDEO_COUNT = 2
const PEOPLE = ['阿鐵', '小花', '老陳', '阿珠', '小黑']
const PLACES = ['雨夜的巷口', '頂樓', '老公寓', '便利商店', '河堤']

const invalid = (userMessage: string): AppError =>
  new AppError({ code: 'invalid_request', userMessage })

/**
 * 效能自測用的示範專案（uiux-spec §12.13、M6-12）：開一個新專案，放進 N 個鏡頭
 * （每場 10 鏡）、5 個角色、5 個地點，每一鏡都有採用中的第一張畫面和影片。
 * 圖和影片用幾張示範素材輪流，不呼叫任何模型、不花錢；原本的專案留著，可以從「專案」頁切回去。
 */
export function createDemoSeeder(deps: DemoSeederDeps) {
  const now = deps.now ?? (() => Date.now())
  return {
    async seed(shotCount: number): Promise<DemoSeedResult> {
      const started = now()
      const project: ProjectInfo = deps.library.createNew(`效能測試（${String(shotCount)} 鏡）`)
      const handle = deps.projects.current()
      if (!handle || handle.closed) throw invalid('建立示範專案失敗，請再試一次。')
      const { outline, shots, characters } = handle.repos

      // 示範素材：幾張圖、幾支影片，鏡頭輪流用
      const images: string[] = []
      for (let i = 0; i < IMAGE_COUNT; i++) {
        const frame: MockFrame = {
          kind: 'image',
          title: '效能測試',
          caption: `示範畫面 ${String(i + 1)}`,
          detail: `demo-${String(i + 1)}`,
          hue: (i * 57) % 360,
          width: 640,
          height: 360,
        }
        const bytes =
          (await deps.mockFrame?.(frame)) ?? renderMockFrame(`DEMO ${String(i + 1)}`, 640, 360)
        images.push((await handle.assets.put(bytes, 'image/png', { width: 640, height: 360 })).hash)
      }
      const videos: string[] = []
      const tools = deps.tools?.()
      if (tools) {
        const render = createMockVideoRenderer(tools, deps.mockFrame)
        for (let i = 0; i < VIDEO_COUNT; i++) {
          const clip = await render({
            frame: {
              kind: 'video',
              title: '效能測試',
              caption: `示範影片 ${String(i + 1)}`,
              detail: `demo-video-${String(i + 1)}`,
              hue: (i * 131) % 360,
              width: 640,
              height: 360,
            },
            label: `DEMO VIDEO ${String(i + 1)}`,
            width: 640,
            height: 360,
            durationSec: 3,
            withAudio: false,
          })
          const stored = await handle.assets.put(clip.bytes, 'video/mp4', {
            width: clip.width,
            height: clip.height,
            durationSec: clip.durationSec,
          })
          videos.push(stored.hash)
        }
      }

      for (const name of PEOPLE) characters.create(name)
      const places = PLACES.map((name) => outline.addLocation({ name }))
      const act = outline.addAct({ title: '第 1 幕' })
      const sceneCount = Math.ceil(shotCount / SHOTS_PER_SCENE)
      let made = 0
      for (let s = 0; s < sceneCount; s++) {
        const place = places[s % places.length]
        const scene = outline.addScene(act.id, {
          title: `示範場 ${String(s + 1)}`,
          summary: '效能測試用的場',
          ...(place ? { locationId: place.id } : {}),
        })
        for (let i = 0; i < SHOTS_PER_SCENE && made < shotCount; i++, made++) {
          const who = PEOPLE[made % PEOPLE.length] ?? '阿鐵'
          const shot = shots.create({
            sceneId: scene.id,
            description: `第 ${String(made + 1)} 鏡：${who}在${place?.name ?? '街上'}走過`,
            characters: [{ name: who }],
            durationSec: 3,
            status: 'done',
          })
          const image = images[made % images.length]
          if (image) {
            shots.addTake({
              shotId: shot.id,
              kind: 'first_frame',
              assetHash: image,
              modelId: 'mock/image',
            })
          }
          const video = videos[made % Math.max(1, videos.length)]
          if (video) {
            shots.addTake({
              shotId: shot.id,
              kind: 'video',
              assetHash: video,
              modelId: 'mock/video',
            })
          }
        }
      }
      return { project, shots: made, ms: Math.round(now() - started) }
    },
  }
}

export type DemoSeeder = ReturnType<typeof createDemoSeeder>
