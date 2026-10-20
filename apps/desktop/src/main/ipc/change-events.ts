import type { IpcChannel } from '@svs/schema'

import type { HandlerContext, IpcRegistry } from './registry'

/** 角色、地點、大綱的變更事件（畫面收到就重新讀，畫布與表單頁才會同步）。 */
export type DataEvent = 'characters.changed' | 'locations.changed' | 'outline.changed'

const ALL: readonly DataEvent[] = ['characters.changed', 'locations.changed', 'outline.changed']
const CHARACTERS: readonly DataEvent[] = ['characters.changed']
const LOCATIONS: readonly DataEvent[] = ['locations.changed']

/**
 * 哪些 channel 做完之後要發哪些變更事件。畫布、快速開始、匯入、復原／重做會同時動到角色、
 * 地點與大綱，三個都發；地點的名字存在大綱，改大綱也要通知地點頁。
 */
export const CHANGE_EVENTS: Partial<Record<IpcChannel, readonly DataEvent[]>> = {
  'characters.create': CHARACTERS,
  'characters.update': CHARACTERS,
  'characters.delete': ALL,
  'characters.setAnchor': CHARACTERS,
  'characters.lock': CHARACTERS,
  'characters.pickHero': CHARACTERS,
  'characters.adoptTurnaround': CHARACTERS,
  'characters.reslice': CHARACTERS,
  'characters.restoreVersion': CHARACTERS,
  'locations.setAnchor': LOCATIONS,
  'locations.pickMain': LOCATIONS,
  'locations.lock': LOCATIONS,
  'locations.unlock': LOCATIONS,
  'outline.edit': ['outline.changed', 'locations.changed'],
  'outline.split': ALL,
  'storyboard.splitScene': ['outline.changed'],
  'shots.assignScene': ALL,
  'canvas.add': ALL,
  'canvas.remove': ALL,
  'canvas.rename': ALL,
  'canvas.paste': ALL,
  'canvas.link': ALL,
  'canvas.unlink': ALL,
  'quickstart.run': ALL,
  'quickstart.upgrade': ALL,
  'slima.import': ALL,
  'project.create': ALL,
  'project.open': ALL,
  'project.createNew': ALL,
  'project.close': ALL,
  'project.saveAs': ALL,
  'dev.seedDemo': ALL,
  'history.undo': ALL,
  'history.redo': ALL,
}

/**
 * 包一層 registry：表上的 channel 成功做完之後，發對應的變更事件（失敗的不發）。
 * 事件只送給發出請求的視窗（App 只有一個視窗）。
 */
export function withChangeEvents(registry: IpcRegistry): IpcRegistry {
  return {
    ...registry,
    registerHandler(channel, impl) {
      const events = CHANGE_EVENTS[channel]
      if (!events) {
        registry.registerHandler(channel, impl)
        return
      }
      const wrapped = async (payload: Parameters<typeof impl>[0], ctx: HandlerContext) => {
        const result = await impl(payload, ctx)
        for (const event of events) ctx.emit(event, {})
        return result
      }
      registry.registerHandler(channel, wrapped)
    },
  }
}
