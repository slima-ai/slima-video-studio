import { z } from 'zod'

/**
 * 運鏡預設：給使用者選的白話名稱，和實際送給模型的描述。
 * 資料驅動：新增或調整運鏡只要改這份清單，畫面、拆鏡和送出的 Prompt 都會跟著變。
 */
export const CameraMoveSchema = z.object({
  /** 存在鏡頭上的 ID（`shot.cameraMove`）。 */
  id: z.string().regex(/^[a-z][a-z_]*$/),
  /** 給使用者看的中文名稱。 */
  label: z.string().min(1),
  /** 一句白話說明（選單旁邊顯示）。 */
  description: z.string().min(1),
  /** 沒有原生運鏡參數的模型：把這段加進 Prompt（依模型偏好的語言選）。 */
  prompt: z.object({ zh: z.string().min(1), en: z.string().min(1) }),
})
export type CameraMove = z.infer<typeof CameraMoveSchema>

export const CAMERA_MOVES: readonly CameraMove[] = z.array(CameraMoveSchema).parse([
  {
    id: 'static',
    label: '固定',
    description: '鏡頭不動，畫面很穩。',
    prompt: { zh: '鏡頭固定不動', en: 'static camera, locked-off shot' },
  },
  {
    id: 'push_in',
    label: '推近',
    description: '鏡頭慢慢靠近主體。',
    prompt: { zh: '鏡頭緩緩推近主體', en: 'slow push-in toward the subject' },
  },
  {
    id: 'pull_out',
    label: '拉遠',
    description: '鏡頭慢慢往後拉開，看到更大的場景。',
    prompt: { zh: '鏡頭緩緩拉遠，露出更大的場景', en: 'slow pull-out revealing the wider scene' },
  },
  {
    id: 'pan',
    label: '左右搖',
    description: '鏡頭站在原地，向左或向右轉動。',
    prompt: { zh: '鏡頭水平橫搖', en: 'smooth horizontal pan' },
  },
  {
    id: 'tilt',
    label: '上下搖',
    description: '鏡頭站在原地，向上或向下轉動。',
    prompt: { zh: '鏡頭垂直上下搖', en: 'smooth vertical tilt' },
  },
  {
    id: 'orbit',
    label: '環繞',
    description: '鏡頭繞著主體轉。',
    prompt: { zh: '鏡頭環繞主體旋轉', en: 'camera orbiting around the subject' },
  },
  {
    id: 'follow',
    label: '跟拍',
    description: '鏡頭跟著移動的主體一起走。',
    prompt: { zh: '鏡頭跟拍移動中的主體', en: 'tracking shot following the subject' },
  },
  {
    id: 'handheld',
    label: '手持',
    description: '像手持攝影機，有輕微的晃動感。',
    prompt: { zh: '手持攝影，輕微自然晃動', en: 'handheld camera with subtle natural shake' },
  },
  {
    id: 'crane',
    label: '升降',
    description: '鏡頭慢慢升高或降低。',
    prompt: { zh: '鏡頭緩緩升起（升降鏡頭）', en: 'crane shot, camera rising smoothly' },
  },
  {
    id: 'slow_motion',
    label: '慢動作',
    description: '動作變慢，細節看得更清楚。',
    prompt: { zh: '慢動作，動作緩慢流暢', en: 'slow motion' },
  },
])

export const CAMERA_MOVE_IDS = CAMERA_MOVES.map((c) => c.id) as [string, ...string[]]

export const cameraMoveById = (id: string): CameraMove | undefined =>
  CAMERA_MOVES.find((c) => c.id === id)
