import type { ShotStep } from '@svs/schema'
import { msg, type MessageRef } from '@svs/schema'

/** 鏡頭生成進行到哪一步（面板上正在做什麼的那一句）。 */
export const STEP_LABEL: Record<ShotStep, MessageRef> = {
  waiting: msg('shots.waitingInTheQueue'),
  prompt: msg('shots.writingThePictureDescription'),
  image: msg('shots.drawingTheFirstFrame'),
  video: msg('shots.generatingTheVideo'),
  done: msg('shots.finishing'),
  failed: msg('shots.failed'),
}
