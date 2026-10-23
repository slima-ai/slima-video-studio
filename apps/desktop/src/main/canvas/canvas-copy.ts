import {
  AppError,
  CanvasPasteSchema,
  type CanvasAddResult,
  type CanvasGraph,
  type CanvasPaste,
  type CanvasPasteResult,
} from '@svs/schema'

import type { CharacterService } from '../characters/character-service'
import type { OutlineService } from '../outline/outline-service'
import type { ProjectManager } from '../project-manager'
import type { ShotService } from '../shots/shot-service'

export interface CanvasCopierDeps {
  projects: ProjectManager
  shots: Pick<ShotService, 'list' | 'duplicate'>
  outline: Pick<OutlineService, 'get' | 'edit'>
  characters: Pick<CharacterService, 'list' | 'create'>
  /** 現在畫布上的樣子（位置、名字、採用中的版本）。 */
  graph: () => CanvasGraph
}

const invalid = (userMessage: string): AppError =>
  new AppError({ code: 'invalid_request', userMessage })

/** 節點鍵 `prefix:<id>` 的 id（後面還有 `:` 的不算）。 */
const idOf = (key: string, prefix: string): string | undefined => {
  if (!key.startsWith(`${prefix}:`)) return undefined
  const rest = key.slice(prefix.length + 1)
  return rest === '' || rest.includes(':') ? undefined : rest
}

/** 名字不能跟現有的撞：「小明 副本」「小明 副本 2」…。 */
function copyName(name: string, taken: readonly string[]): string {
  const base = `${name} 副本`
  if (!taken.includes(base)) return base
  for (let n = 2; ; n++) {
    const candidate = `${base} ${String(n)}`
    if (!taken.includes(candidate)) return candidate
  }
}

/**
 * 貼上複製的格子（uiux-spec §12.10），依種類各自處理：
 * 鏡頭接在原鏡頭後面（不帶版本）、場連同鏡頭複製到最後、角色與地點複製一份「副本」（不帶定稿圖）、
 * 圖與影片貼成獨立的格子、自由格子原樣複製。呼叫的地方包在一筆歷史裡，整批一步復原。
 */
export function createCanvasCopier(deps: CanvasCopierDeps) {
  const { projects, shots, outline, characters } = deps

  const handleOf = () => {
    const handle = projects.current()
    if (!handle || handle.closed) throw invalid('請先開啟或建立一個專案。')
    return handle
  }

  return {
    paste(request: CanvasPaste): CanvasPasteResult {
      const { keys, dx, dy } = CanvasPasteSchema.parse(request)
      const handle = handleOf()
      const graph = deps.graph()
      const nodeOf = new Map(graph.nodes.map((n) => [n.key, n]))
      const added: CanvasAddResult[] = []
      const skipped: CanvasPasteResult['skipped'] = []
      const moves: { key: string; x: number; y: number }[] = []
      const unique = [...new Set(keys)]

      const sceneIds = unique.flatMap((k) => idOf(k, 'scene') ?? [])
      const shotIds = new Set(unique.flatMap((k) => idOf(k, 'shot') ?? []))
      const shotList = shots.list().shots
      const sceneOfShot = new Map(shotList.map((s) => [s.id, s.sceneId]))

      // 場：連同裡面的鏡頭整場複製到最後
      const view = outline.get()
      for (const sceneId of sceneIds) {
        const scene = view.acts.flatMap((a) => a.scenes).find((s) => s.id === sceneId)
        if (!scene) {
          skipped.push({ name: '場', reason: '找不到這一場，可能已經被刪掉了' })
          continue
        }
        // 選到的場一定在某一幕裡，所以最後一幕一定有
        const lastAct = outline.get().acts.at(-1)
        if (!lastAct) continue
        const known = new Set(outline.get().acts.flatMap((a) => a.scenes.map((s) => s.id)))
        const created = outline
          .edit({ op: 'addScene', actId: lastAct.id })
          .acts.flatMap((a) => a.scenes)
          .find((s) => !known.has(s.id))
        if (!created) throw invalid('複製場失敗，請再試一次。')
        const title = `${scene.title} 副本`
        outline.edit({
          op: 'updateScene',
          sceneId: created.id,
          patch: {
            title,
            summary: scene.summary,
            ...(scene.locationId === undefined ? {} : { locationId: scene.locationId }),
            ...(scene.timeOfDay === undefined ? {} : { timeOfDay: scene.timeOfDay }),
            ...(scene.mood === undefined ? {} : { mood: scene.mood }),
          },
        })
        for (const shot of shotList.filter((s) => s.sceneId === sceneId)) {
          shots.duplicate(shot.id, { sceneId: created.id })
        }
        added.push({ key: `scene:${created.id}`, title })
      }

      for (const key of unique) {
        // 鏡頭：在原鏡頭後面新增一鏡（整場一起複製的就不用再複製一次）
        const shotId = idOf(key, 'shot')
        if (shotId !== undefined) {
          const sceneId = sceneOfShot.get(shotId)
          if (sceneId !== undefined && sceneIds.includes(sceneId)) continue
          const copy = shots.duplicate(shotId)
          added.push({ key: `shot:${copy.id}`, title: `第 ${String(copy.number)} 鏡` })
          continue
        }

        // 圖、影片：貼成獨立的格子（鏡頭也一起複製的就不用）
        const derived = /^shot:([^:]+):(image|video)$/.exec(key)
        if (derived?.[1] !== undefined) {
          if (shotIds.has(derived[1])) continue
          const node = nodeOf.get(key)
          const hash = node?.assetHash
          const found = hash === undefined ? undefined : handle.assets.find(hash)
          if (!node || hash === undefined || !found) {
            skipped.push({
              name: node?.title ?? '圖',
              reason: '這一格還沒有圖或影片，沒有東西可以貼',
            })
            continue
          }
          const video = derived[2] === 'video'
          const shotTitle = nodeOf.get(`shot:${derived[1]}`)?.title ?? ''
          const title = `${shotTitle}的${video ? '影片' : '圖'}`
          const row = handle.repos.canvas.addNode({
            type: video ? 'free_video' : 'free_image',
            params: { assetHash: hash, mime: found.mime, title, source: 'copy' },
            x: Math.round(node.x + dx),
            y: Math.round(node.y + dy),
          })
          added.push({ key: `node:${row.id}`, title })
          continue
        }

        // 角色：複製一份「副本」，帶外觀、個性、服裝，不帶定稿圖
        const characterId = idOf(key, 'character')
        if (characterId !== undefined) {
          const source = handle.repos.characters.get(characterId)
          if (!source) {
            skipped.push({ name: '角色', reason: '找不到這個角色，可能已經被刪掉了' })
            continue
          }
          const name = copyName(
            source.name,
            characters.list().map((c) => c.name),
          )
          const created = characters.create(name)
          handle.repos.characters.update(created.id, {
            appearance: source.appearance,
            personality: source.personality,
            avoid: source.avoid,
            outfit: source.costumes[0]?.description ?? '',
            ...(source.age === undefined ? {} : { age: source.age }),
          })
          const at = nodeOf.get(key)
          if (at) moves.push({ key: `character:${created.id}`, x: at.x + dx, y: at.y + dy })
          added.push({ key: `character:${created.id}`, title: name })
          continue
        }

        // 地點：複製一份「副本」，帶描述，不帶定稿圖
        const locationId = idOf(key, 'location')
        if (locationId !== undefined) {
          const current = outline.get()
          const source = current.locations.find((l) => l.id === locationId)
          if (!source) {
            skipped.push({ name: '地點', reason: '找不到這個地點，可能已經被刪掉了' })
            continue
          }
          const known = new Set(current.locations.map((l) => l.id))
          const created = outline
            .edit({ op: 'addLocation' })
            .locations.find((l) => !known.has(l.id))
          if (!created) throw invalid('複製地點失敗，請再試一次。')
          const name = copyName(
            source.name,
            current.locations.map((l) => l.name),
          )
          outline.edit({
            op: 'updateLocation',
            locationId: created.id,
            patch: { name, description: source.description },
          })
          const at = nodeOf.get(key)
          if (at) moves.push({ key: `location:${created.id}`, x: at.x + dx, y: at.y + dy })
          added.push({ key: `location:${created.id}`, title: name })
          continue
        }

        // 自由格子：原樣複製
        const freeId = idOf(key, 'node')
        if (freeId !== undefined) {
          const row = handle.repos.canvas.listNodes().find((n) => n.id === freeId)
          if (!row) {
            skipped.push({ name: '這一格', reason: '找不到，可能已經被刪掉了' })
            continue
          }
          const copy = handle.repos.canvas.addNode({
            type: row.type,
            params: { ...row.params },
            x: Math.round(row.x + dx),
            y: Math.round(row.y + dy),
          })
          added.push({ key: `node:${copy.id}`, title: nodeOf.get(key)?.title ?? '' })
          continue
        }

        if (idOf(key, 'scene') === undefined && key !== 'cut') {
          skipped.push({ name: nodeOf.get(key)?.title ?? key, reason: '這一格不能複製' })
        } else if (key === 'cut') {
          skipped.push({ name: '剪輯', reason: '剪輯只有一個，不能複製' })
        }
      }
      if (moves.length > 0) {
        handle.repos.canvas.move(
          moves.map((m) => ({ key: m.key, x: Math.round(m.x), y: Math.round(m.y) })),
        )
      }
      return { added, skipped }
    },
  }
}
