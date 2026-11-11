import {
  AppError,
  type AssetRef,
  type AspectRatio,
  type CardJob,
  type GenerationOutput,
  type GenerationRequest,
  type NodeServices,
  type StillMotion,
  type Trim,
  t,
} from '@svs/schema'

export interface GenerateResult {
  output: GenerationOutput
  /** 供應商回報的實際花費；沒有就不填（引擎會用 ModelCard 價格估算並標記為估算）。 */
  costUsd?: number
  /** 實際處理這個請求的供應商 ID。 */
  provider: string
  jobId: string
}

/**
 * 節點需要的外部能力。由 apps/desktop 組裝後放在引擎 services 的 `studio` 欄位：
 * generate 會走任務佇列（並行與速率限制、退避重試、重開接回），失敗時丟 AppError。
 */
/** 一次生成的執行環境：取消訊號，以及（由節點發起時）是哪個節點執行。 */
export interface GenerateContext {
  signal: AbortSignal
  nodeRunId?: string | undefined
}

export interface StudioServices {
  generate: (request: GenerationRequest, ctx: GenerateContext) => Promise<GenerateResult>
  /**
   * 把多段影片接成一支，存進素材庫。trims 和 videos 一一對應：那一段只用 [inSec, outSec]；
   * 沒給（或那一項是 undefined）就整支，接法和沒有裁切功能之前完全一樣。
   */
  concatVideos: (
    videos: readonly AssetRef[],
    ctx: { signal: AbortSignal },
    trims?: readonly (Trim | undefined)[],
  ) => Promise<AssetRef>
  /**
   * 本機格子（不花錢、不呼叫供應商）：一張圖變成一段指定長度、有運鏡的影片，存進素材庫。
   * 沒有的環境（例如沒有字卡服務的測試）就是 undefined，節點會回白話錯誤。
   */
  stillToVideo?: (
    image: AssetRef,
    options: { durationSec: number; aspectRatio: AspectRatio; motion: StillMotion; fps: number },
    ctx: { signal: AbortSignal },
  ) => Promise<AssetRef>
  /** 本機格子：畫一張字卡或片名卡，再變成指定長度的影片，存進素材庫。 */
  cardToVideo?: (
    job: CardJob,
    options: { durationSec: number; aspectRatio: AspectRatio; fps: number },
    ctx: { signal: AbortSignal },
  ) => Promise<AssetRef>
}

export const STUDIO_SERVICE_KEY = 'studio'

export function getStudio(services: NodeServices): StudioServices {
  const studio = services[STUDIO_SERVICE_KEY] as Partial<StudioServices> | undefined
  if (!studio?.generate || !studio.concatVideos) {
    throw new AppError({
      code: 'internal_error',
      userMessage: t('nodes.theGenerationServiceIsnT'),
    })
  }
  return studio as StudioServices
}
