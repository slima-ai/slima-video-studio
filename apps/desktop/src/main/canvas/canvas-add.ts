import { AppError, ONELINER_DEFAULTS, type CanvasAdd, type CanvasAddResult, t } from '@svs/schema'
import type { CanvasRepository } from '@svs/db'

import type { CharacterService } from '../characters/character-service'
import type { OutlineService } from '../outline/outline-service'
import type { ShotService } from '../shots/shot-service'
import { characterKey, freeKey, locationKey, sceneKey, shotKey } from './projection'

export interface CanvasAdderDeps {
  shots: Pick<ShotService, 'list' | 'create' | 'update'>
  outline: Pick<OutlineService, 'get' | 'edit'>
  characters: Pick<CharacterService, 'list' | 'create'>
  /** 一句話這類自由節點存在畫布自己的表；沒有開啟專案就是 undefined。 */
  freeNodes: () => Pick<CanvasRepository, 'addNode'> | undefined
}

/** 沒有框住任何格子時，新群組的大小。 */
const GROUP_SIZE = { width: 480, height: 300 } as const

const invalid = (userMessage: string): AppError =>
  new AppError({ code: 'invalid_request', userMessage })

/** 節點鍵 `prefix:<id>` 的 id；不是這種鍵就是 undefined。 */
const idOf = (key: string | undefined, prefix: string): string | undefined =>
  key?.startsWith(`${prefix}:`) ? key.slice(prefix.length + 1) : undefined

/** 預設名字不能跟現有的撞：「新角色」「新角色 2」「新角色 3」…。 */
function freshName(base: string, taken: readonly string[]): string {
  if (!taken.includes(base)) return base
  for (let n = 2; ; n++) {
    const name = `${base} ${String(n)}`
    if (!taken.includes(name)) return name
  }
}

/**
 * 從畫布新增場、鏡頭、角色或地點：寫進原本的表（沿用各服務的規則與提示），
 * 從連接點新增時順便把關係接上（角色→鏡頭、地點→場或鏡頭）。
 * 要記進復原歷史，所以由呼叫的地方包在 history.record 裡。
 */
export function createCanvasAdder(deps: CanvasAdderDeps): {
  add: (request: CanvasAdd) => CanvasAddResult
} {
  const { shots, outline, characters, freeNodes } = deps

  const lastSceneId = (): string | undefined =>
    outline
      .get()
      .acts.flatMap((a) => a.scenes)
      .at(-1)?.id

  /** 新增一個場：還沒有幕就先建一幕。 */
  const addScene = (locationId?: string): { id: string; title: string } => {
    let view = outline.get()
    const known = new Set(view.acts.flatMap((a) => a.scenes.map((s) => s.id)))
    // 還沒有幕：新增一幕時就會附一個場，直接用它（不然會多出一個空的場）
    if (view.acts.length === 0) view = outline.edit({ op: 'addAct' })
    else {
      const act = view.acts.at(-1)
      if (!act) throw invalid(t('canvas.couldnTAddTheScene'))
      view = outline.edit({ op: 'addScene', actId: act.id })
    }
    const created = view.acts.flatMap((a) => a.scenes).find((s) => !known.has(s.id))
    if (!created) throw invalid(t('canvas.couldnTAddTheScene'))
    if (locationId !== undefined) {
      outline.edit({ op: 'updateScene', sceneId: created.id, patch: { locationId } })
    }
    return { id: created.id, title: created.title }
  }

  const addLocation = (): { id: string; title: string } => {
    const known = new Set(outline.get().locations.map((l) => l.id))
    const view = outline.edit({ op: 'addLocation' })
    const created = view.locations.find((l) => !known.has(l.id))
    if (!created) throw invalid(t('canvas.couldnTAddTheLocation'))
    return { id: created.id, title: created.name }
  }

  const addCharacter = (): { id: string; title: string } => {
    const name = freshName(
      t('canvas.newCharacter'),
      characters.list().map((c) => c.name),
    )
    const created = characters.create(name)
    return { id: created.id, title: created.name }
  }

  return {
    add(request) {
      const { kind, from } = request
      const unsupported = (): AppError => invalid(t('canvas.thisDotCanTTake'))
      const fromId = (prefix: string): string | undefined => idOf(from?.key, prefix)

      if (kind === 'oneliner') {
        if (from) throw unsupported()
        const repo = freeNodes()
        if (!repo) throw invalid(t('canvas.openOrCreateAProject'))
        const row = repo.addNode({
          type: 'oneliner',
          params: { ...ONELINER_DEFAULTS },
          x: request.x ?? 60,
          y: request.y ?? 60,
        })
        return { key: freeKey(row.id), title: t('canvas.oneLiner') }
      }

      if (kind === 'note' || kind === 'group') {
        if (from) throw unsupported()
        const repo = freeNodes()
        if (!repo) throw invalid(t('canvas.openOrCreateAProject'))
        const params =
          kind === 'note'
            ? { text: '' }
            : {
                title: t('canvas.group'),
                color: 'slate',
                width: request.width ?? GROUP_SIZE.width,
                height: request.height ?? GROUP_SIZE.height,
              }
        const row = repo.addNode({ type: kind, params, x: request.x ?? 60, y: request.y ?? 60 })
        return {
          key: freeKey(row.id),
          title: kind === 'note' ? t('canvas.note') : t('canvas.group'),
        }
      }

      // 先確認接得起來再動資料，免得失敗時留下一個孤零零的新節點
      if (from) {
        const ok =
          (kind === 'scene' && from.side === 'out' && from.port === 'loc-out') ||
          (kind === 'shot' &&
            from.side === 'out' &&
            (from.port === 'char-out' || from.port === 'loc-out')) ||
          (kind === 'character' && from.side === 'in' && from.port === 'shot-ref-char') ||
          (kind === 'location' &&
            from.side === 'in' &&
            (from.port === 'shot-ref-loc' || from.port === 'scene-loc'))
        if (!ok) throw unsupported()
      }
      const character = characters.list().find((c) => c.id === fromId('character'))
      const targetShot = shots.list().shots.find((s) => s.id === fromId('shot'))
      if (from?.port === 'char-out' && !character)
        throw invalid(t('canvas.couldnTFindThisCharacter'))
      if ((from?.port === 'shot-ref-char' || from?.port === 'shot-ref-loc') && !targetShot) {
        throw invalid(t('canvas.couldnTFindThisShot'))
      }
      if (from?.port === 'loc-out' && fromId('location') === undefined) throw unsupported()
      if (from?.port === 'scene-loc' && fromId('scene') === undefined) throw unsupported()

      if (kind === 'scene') {
        const scene = addScene(fromId('location'))
        return { key: sceneKey(scene.id), title: scene.title }
      }

      if (kind === 'shot') {
        const sceneId = idOf(request.sceneKey, 'scene') ?? lastSceneId()
        const shot = shots.create({ ...(sceneId === undefined ? {} : { sceneId }) })
        if (from?.port === 'char-out' && character) {
          shots.update(shot.id, { characters: [character.name] })
        } else if (from?.port === 'loc-out') {
          const locationId = fromId('location')
          if (locationId !== undefined) shots.update(shot.id, { locationId })
        }
        return { key: shotKey(shot.id), title: t('canvas.shot', { value: String(shot.number) }) }
      }

      if (kind === 'character') {
        const created = addCharacter()
        if (targetShot) {
          shots.update(targetShot.id, { characters: [...targetShot.characters, created.title] })
        }
        return { key: characterKey(created.id), title: created.title }
      }

      const location = addLocation()
      if (targetShot) {
        shots.update(targetShot.id, { locationId: location.id })
      } else if (from?.port === 'scene-loc') {
        const sceneId = fromId('scene')
        if (sceneId !== undefined) {
          outline.edit({ op: 'updateScene', sceneId, patch: { locationId: location.id } })
        }
      }
      return { key: locationKey(location.id), title: location.title }
    },
  }
}
