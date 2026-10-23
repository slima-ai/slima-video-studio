import { outfitOf } from '@svs/db'
import {
  AppError,
  CharacterEditSchema,
  CharacterNameSchema,
  type Character,
  type CharacterEdit,
  type CharacterPack,
  type CharacterVersion,
  type CharacterView,
} from '@svs/schema'

import { ensureProject } from '../ensure-project'
import type { ProjectManager } from '../project-manager'

export interface CharacterServiceDeps {
  projects: ProjectManager
  /** 還沒有開啟專案時，新增角色會自動建一個，放在這個資料夾。 */
  projectsDir: string
  now?: () => Date
  /** 請 AI 整理出固定外觀描述（沒給就不能用 AI 整理）。 */
  suggestAnchor?: (character: Character, outfit: string) => Promise<string>
}

export interface CharacterService {
  list: () => CharacterView[]
  create: (name: string) => CharacterView
  update: (id: string, patch: CharacterEdit) => CharacterView
  remove: (id: string) => void
  /** AI 整理出的固定外觀描述建議（不會存起來）。 */
  suggestAnchor: (id: string) => Promise<string>
  /** 存固定外觀描述；已鎖定的會開下一版草稿。 */
  setAnchor: (id: string, text: string) => CharacterView
  lock: (id: string) => CharacterView
  /** 把一張概念圖挑成主圖（已鎖定的角色會變成下一版草稿）。 */
  pickHero: (id: string, conceptId: string) => CharacterView
  /** 所有版本，新的在前。 */
  versions: (id: string) => CharacterVersion[]
  /** 以某個舊版本的內容開一個新的草稿版本。 */
  restoreVersion: (id: string, versionId: string) => CharacterView
  /** 採用一組三視圖（已鎖定的角色會變成下一版草稿）。 */
  adoptTurnaround: (id: string, turnaroundId: string) => CharacterView
}

export function toCharacterView(character: Character, pack?: CharacterPack): CharacterView {
  return {
    id: character.id,
    name: character.name,
    ...(character.age ? { age: character.age } : {}),
    appearance: character.appearance,
    personality: character.personality,
    avoid: character.avoid,
    outfit: outfitOf(character),
    ...(pack?.heroAssetHash ? { heroAssetHash: pack.heroAssetHash } : {}),
    ...(pack?.turnaround ? { turnaround: pack.turnaround } : {}),
    anchorText: pack?.anchorText ?? '',
    anchorStatus: pack ? pack.status : 'none',
    version: pack?.version ?? 0,
    createdAt: character.createdAt,
    updatedAt: character.updatedAt,
  }
}

/** 角色卡：新增、修改、刪除、列出。角色存在目前專案裡。 */
export function createCharacterService(deps: CharacterServiceDeps): CharacterService {
  const { projects } = deps
  const now = deps.now ?? (() => new Date())

  const repo = () => {
    const handle = projects.current()
    if (!handle) {
      throw new AppError({
        code: 'project_invalid',
        userMessage: '還沒有開啟專案，請先新增一個角色或開始生成。',
      })
    }
    return handle.repos.characters
  }

  /** 重新讀一次，連同目前這一版的固定外觀描述。 */
  const viewOf = (id: string): CharacterView => {
    const characters = repo()
    const character = characters.get(id)
    if (!character) {
      throw new AppError({ code: 'project_invalid', userMessage: `找不到這個角色（${id}）。` })
    }
    return toCharacterView(character, characters.pack(id))
  }

  return {
    list() {
      const characters = projects.current()?.repos.characters
      return characters?.list().map((c) => toCharacterView(c, characters.pack(c.id))) ?? []
    },

    create(name) {
      const checked = CharacterNameSchema.parse(name)
      ensureProject(projects, deps.projectsDir, '我的短片', now())
      return viewOf(repo().create(checked).id)
    },

    update(id, patch) {
      repo().update(id, CharacterEditSchema.parse(patch))
      return viewOf(id)
    },

    remove(id) {
      repo().delete(id)
    },

    async suggestAnchor(id) {
      const view = viewOf(id)
      const character = repo().get(id)
      if (!character || !deps.suggestAnchor) {
        throw new AppError({
          code: 'internal_error',
          userMessage: '目前不能用 AI 整理，請自己寫一段固定外觀描述。',
        })
      }
      return deps.suggestAnchor(character, view.outfit)
    },

    setAnchor(id, text) {
      repo().setAnchor(id, text)
      return viewOf(id)
    },

    lock(id) {
      repo().lock(id)
      return viewOf(id)
    },

    versions(id) {
      const characters = repo()
      const currentId = characters.pack(id)?.id
      return characters
        .packs(id)
        .map((p) => ({
          id: p.id,
          version: p.version,
          status: p.status,
          anchorText: p.anchorText,
          ...(p.heroAssetHash ? { heroAssetHash: p.heroAssetHash } : {}),
          ...(p.turnaround ? { turnaround: p.turnaround } : {}),
          current: p.id === currentId,
          createdAt: p.createdAt,
        }))
        .reverse()
    },

    restoreVersion(id, versionId) {
      repo().restorePack(id, versionId)
      return viewOf(id)
    },

    pickHero(id, conceptId) {
      repo().pickHero(id, conceptId)
      return viewOf(id)
    },

    adoptTurnaround(id, turnaroundId) {
      repo().adoptTurnaround(id, turnaroundId)
      return viewOf(id)
    },
  }
}
