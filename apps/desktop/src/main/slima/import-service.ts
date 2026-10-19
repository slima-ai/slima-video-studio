import { createHash } from 'node:crypto'

import { readEntity, suggestUse, type SlimaReader } from '@svs/slima'
import {
  AppError,
  OUTLINE_TEXT_MAX,
  type SlimaFileUse,
  type SlimaImportCheck,
  type SlimaImportItem,
  type SlimaImportRequest,
  type SlimaImportResult,
  type SlimaSkipped,
  type SlimaTree,
} from '@svs/schema'

import { ensureProject } from '../ensure-project'
import type { OutlineService } from '../outline/outline-service'
import type { ProjectManager } from '../project-manager'

export interface SlimaImportDeps {
  reader: Pick<SlimaReader, 'getBook' | 'listFiles' | 'readFile'>
  projects: ProjectManager
  /** 還沒有開啟專案時，匯入會自動建一個，放在這個資料夾。 */
  projectsDir: string
  outline: Pick<OutlineService, 'splitCheck' | 'split'>
  demoMode: () => boolean
  now?: () => Date
}

export interface SlimaImportService {
  tree: (bookToken: string) => Promise<SlimaTree>
  check: (request: SlimaImportRequest) => Promise<SlimaImportCheck>
  import: (request: SlimaImportRequest) => Promise<SlimaImportResult>
}

/** 匯入的場放在這一幕底下（找得到同名的幕就沿用）。 */
export const IMPORT_ACT_TITLE = '從 Slima 匯入'

const invalid = (userMessage: string): AppError =>
  new AppError({ code: 'invalid_request', userMessage })

interface LoadedFile {
  item: SlimaImportItem
  name: string
  content: string
  /** 內容的指紋，之後用來看 Slima 上有沒有改過。 */
  version: string
}

interface PlannedEntity {
  file: LoadedFile
  use: Exclude<SlimaFileUse, 'story'>
  name: string
  description: string
}

interface Plan {
  bookTitle: string
  check: SlimaImportCheck
  storyFiles: LoadedFile[]
  storyText: string
  entities: PlannedEntity[]
}

const fingerprint = (content: string): string =>
  createHash('sha256').update(content).digest('hex').slice(0, 16)

const clip = (text: string, max: number): string => text.trim().slice(0, max)

/** 固定外觀描述會寫進每個生成的 Prompt，只在夠短、像一句描述時才自動帶入。 */
const ANCHOR_MAX = 300

export function createSlimaImportService(deps: SlimaImportDeps): SlimaImportService {
  const { reader, projects, outline } = deps
  const now = deps.now ?? (() => new Date())

  async function load(
    request: SlimaImportRequest,
  ): Promise<{ loaded: LoadedFile[]; skipped: SlimaSkipped[] }> {
    const loaded: LoadedFile[] = []
    const skipped: SlimaSkipped[] = []
    const seen = new Set<string>()
    let failed = 0
    let firstError: AppError | undefined
    for (const item of request.items) {
      if (seen.has(item.path)) continue
      seen.add(item.path)
      try {
        const file = await reader.readFile(request.bookToken, item.path)
        if (file.content.trim() === '') {
          skipped.push({ path: item.path, reason: '檔案是空的' })
          continue
        }
        loaded.push({
          item,
          name: file.name === '' ? (item.path.split('/').at(-1) ?? item.path) : file.name,
          content: file.content,
          version: fingerprint(file.content),
        })
      } catch (error) {
        // Token 失效要直接告訴使用者；其他（檔案不存在、讀取失敗）先略過這個檔案
        if (error instanceof AppError && error.code === 'slima_auth_failed') throw error
        if (error instanceof AppError) firstError ??= error
        failed += 1
        skipped.push({ path: item.path, reason: '讀不到這個檔案' })
      }
    }
    // 每一個檔案都讀不到，多半是整個連線的問題：把原因直接告訴使用者
    if (failed > 0 && failed === seen.size && firstError) throw firstError
    return { loaded, skipped }
  }

  async function prepare(request: SlimaImportRequest): Promise<Plan> {
    if (request.items.length === 0) throw invalid('請先選要匯入的檔案。')
    const book = await reader.getBook(request.bookToken)
    const { loaded, skipped } = await load(request)

    const handle = projects.current()
    const takenCharacters = new Set(handle?.repos.characters.list().map((c) => c.name))
    const takenLocations = new Set(handle?.repos.outline.listLocations().map((l) => l.name))
    const takenScenes = new Set<string>()
    const importAct = handle?.repos.outline.listActs().find((a) => a.title === IMPORT_ACT_TITLE)
    if (handle && importAct) {
      for (const scene of handle.repos.outline.listScenes()) {
        if (scene.actId === importAct.id) takenScenes.add(scene.title)
      }
    }

    const storyFiles = loaded.filter((f) => f.item.use === 'story')
    const entities: PlannedEntity[] = []
    for (const file of loaded) {
      if (file.item.use === 'story') continue
      const entity = readEntity(file.name, file.content)
      const taken = { character: takenCharacters, location: takenLocations, scene: takenScenes }[
        file.item.use
      ]
      const label = { character: '角色', location: '地點', scene: '場' }[file.item.use]
      const limit = { character: 40, location: 100, scene: 200 }[file.item.use]
      const name = clip(entity.name, limit)
      if (name === '') {
        skipped.push({ path: file.item.path, reason: '找不到名稱' })
        continue
      }
      if (taken.has(name)) {
        skipped.push({ path: file.item.path, reason: `已經有同名的${label}「${name}」` })
        continue
      }
      taken.add(name)
      entities.push({ file, use: file.item.use, name, description: entity.description })
    }

    const storyText = storyFiles.map((f) => `# ${f.name}\n\n${f.content.trim()}`).join('\n\n')
    const base = {
      storyFiles: storyFiles.length,
      storyChars: storyText.length,
      characters: entities.filter((e) => e.use === 'character').map((e) => e.name),
      locations: entities.filter((e) => e.use === 'location').map((e) => e.name),
      scenes: entities.filter((e) => e.use === 'scene').map((e) => e.name),
      skipped,
    }

    let check: SlimaImportCheck
    if (storyFiles.length > 0) {
      if (storyText.length > OUTLINE_TEXT_MAX) {
        check = {
          ...base,
          ok: false,
          issue: `選的文字太長了（${String(storyText.length)} 字，上限 ${String(OUTLINE_TEXT_MAX)} 字），請少選幾個章節。`,
          estimatedUsd: 0,
          demoMode: deps.demoMode(),
          replacesOutline: false,
        }
      } else {
        const split = outline.splitCheck(storyText)
        check = {
          ...base,
          ok: split.ok,
          ...(split.issue ? { issue: split.issue } : {}),
          estimatedUsd: split.estimatedUsd,
          ...(split.modelName ? { modelName: split.modelName } : {}),
          demoMode: split.demoMode,
          replacesOutline: split.replacesExisting,
        }
      }
    } else if (entities.length === 0) {
      check = {
        ...base,
        ok: false,
        issue: '沒有可以匯入的內容。',
        estimatedUsd: 0,
        demoMode: deps.demoMode(),
        replacesOutline: false,
      }
    } else {
      check = {
        ...base,
        ok: true,
        estimatedUsd: 0,
        demoMode: deps.demoMode(),
        replacesOutline: false,
      }
    }
    return { bookTitle: book.title, check, storyFiles, storyText, entities }
  }

  return {
    async tree(bookToken) {
      const [book, files] = await Promise.all([
        reader.getBook(bookToken),
        reader.listFiles(bookToken),
      ])
      return {
        book,
        files: files.flatMap((file) => {
          const suggestedUse = suggestUse(file.path)
          return suggestedUse ? [{ ...file, suggestedUse }] : []
        }),
      }
    },

    async check(request) {
      return (await prepare(request)).check
    },

    async import(request) {
      const plan = await prepare(request)
      if (!plan.check.ok) throw invalid(plan.check.issue ?? '現在不能匯入。')

      ensureProject(projects, deps.projectsDir, plan.bookTitle, now())
      let actsFromStory = 0
      let storyActId: string | undefined
      if (plan.storyFiles.length > 0) {
        const result = await outline.split(plan.storyText)
        actsFromStory = result.outline.acts.length
        storyActId = result.outline.acts[0]?.id
      }

      const handle = projects.current()
      if (!handle || handle.closed) throw invalid('專案已經關閉，沒有匯入。')
      const { repos } = handle
      const link = (
        entityType: 'outline' | 'character' | 'location' | 'scene',
        entityId: string,
        file: LoadedFile,
      ): void => {
        repos.slimaLinks.upsert({
          entityType,
          entityId,
          bookToken: request.bookToken,
          path: file.item.path,
          remoteVersion: file.version,
        })
      }

      if (storyActId) for (const file of plan.storyFiles) link('outline', storyActId, file)

      const created = { character: [] as string[], location: [] as string[], scene: [] as string[] }
      const skipped = [...plan.check.skipped]
      // 拆成分場時 AI 可能已經建了同名的角色或地點：以現在實際有的為準，不重複建立
      const takenCharacters = new Set(repos.characters.list().map((c) => c.name))
      const takenLocations = new Set(repos.outline.listLocations().map((l) => l.name))
      let importActId = repos.outline.listActs().find((a) => a.title === IMPORT_ACT_TITLE)?.id
      for (const entity of plan.entities) {
        if (entity.use === 'character') {
          if (takenCharacters.has(entity.name)) {
            skipped.push({
              path: entity.file.item.path,
              reason: `已經有同名的角色「${entity.name}」`,
            })
            continue
          }
          const made = repos.characters.create(entity.name)
          repos.characters.update(made.id, { appearance: clip(entity.description, 2000) })
          link('character', made.id, entity.file)
          created.character.push(entity.name)
        } else if (entity.use === 'location') {
          if (takenLocations.has(entity.name)) {
            skipped.push({
              path: entity.file.item.path,
              reason: `已經有同名的地點「${entity.name}」`,
            })
            continue
          }
          const made = repos.outline.addLocation({
            name: entity.name,
            description: clip(entity.description, 4000),
          })
          const anchor = clip(entity.description, ANCHOR_MAX + 1)
          if (anchor !== '' && anchor.length <= ANCHOR_MAX) {
            repos.locationCards.setAnchor(made.id, anchor)
          }
          link('location', made.id, entity.file)
          created.location.push(entity.name)
        } else {
          importActId ??= repos.outline.addAct({ title: IMPORT_ACT_TITLE }).id
          const made = repos.outline.addScene(importActId, {
            title: entity.name,
            summary: clip(entity.description, 4000),
          })
          link('scene', made.id, entity.file)
          created.scene.push(entity.name)
        }
      }

      return {
        actsFromStory,
        characters: created.character,
        locations: created.location,
        scenes: created.scene,
        skipped,
      }
    },
  }
}
