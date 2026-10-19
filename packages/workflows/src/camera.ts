import { cameraMoveById, type ModelCard, type VideoRequest } from '@svs/schema'

/** 送出影片請求前，把運鏡換成模型看得懂的形式需要的模型資訊。 */
export type CameraModel = Pick<ModelCard, 'cameraParams' | 'prompt'>

/**
 * 運鏡怎麼送給模型：
 * - 這個模型有對應的原生參數 → 併進請求（cameraParams），Prompt 不動；
 * - 沒有 → 把運鏡的描述加到 Prompt 後面（模型偏好英文就用英文）；
 * - 不是預設清單裡的（自己打的字）→ 原樣加進 Prompt。
 * 沒有指定運鏡就原封不動。
 */
export function resolveCameraMove<R extends Pick<VideoRequest, 'prompt' | 'cameraMove'>>(
  request: R,
  card: CameraModel | undefined,
): R {
  const { cameraMove } = request
  if (!cameraMove) return request
  const params = card?.cameraParams?.[cameraMove]
  if (params) return { ...request, cameraParams: params }
  const preset = cameraMoveById(cameraMove)
  const text = preset ? preset.prompt[card?.prompt?.language === 'en' ? 'en' : 'zh'] : cameraMove
  return { ...request, prompt: `${request.prompt}，${text}` }
}
