import type { ShotStep } from '@svs/schema'

/** 鏡頭生成進行到哪一步（面板上「正在…」的文字）。 */
export const STEP_LABEL: Record<ShotStep, string> = {
  waiting: '排隊中',
  prompt: '寫畫面描述',
  image: '畫第一張圖',
  video: '生成影片',
  done: '完成',
  failed: '失敗',
}
