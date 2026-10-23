import type { ProjectHandle } from '@svs/db'
import { AppError, type UpgradeCheck, type UpgradeResult, t } from '@svs/schema'

import type { ProjectManager } from '../project-manager'
import type { ShotService } from '../shots/shot-service'
import { createDraftCharacters, newCharacterNamesOf } from './draft-characters'

export { pickHeroFrame } from './draft-characters'

export interface UpgradeServiceDeps {
  projects: ProjectManager
  shots: Pick<ShotService, 'assignScene'>
  /** 快速開始的狀態：生成還在進行就不能升級；有標題就拿來當第一幕的名字。 */
  quickstartState: () => { status: string; title?: string | undefined } | null
}

export interface UpgradeService {
  check: () => UpgradeCheck
  upgrade: () => UpgradeResult
}

const invalid = (userMessage: string): AppError =>
  new AppError({ code: 'invalid_request', userMessage })

/**
 * 把快速開始的結果升級成專案：一幕一場放進全部鏡頭，替出場的角色建草稿角色卡並從畫面挑主圖。
 * 只重新整理資料，不會重新生成任何東西——已經生成的畫面和影片全部保留。
 */
export function createUpgradeService(deps: UpgradeServiceDeps): UpgradeService {
  const { projects, shots: shotService } = deps

  const actTitleOf = (handle: ProjectHandle): string => {
    const title = deps.quickstartState()?.title?.trim()
    if (title) return title
    return handle.repos.projects.get().name
  }

  const check = (): UpgradeCheck => {
    const handle = projects.current()
    const base = { shotCount: 0, newCharacters: [], actTitle: '' }
    if (!handle || handle.closed) {
      return { ...base, ok: false, issue: t('services.makeAFilmWithQuick') }
    }
    const list = handle.repos.shots.list()
    const actTitle = actTitleOf(handle)
    const info = { shotCount: list.length, newCharacters: newCharacterNamesOf(handle), actTitle }
    if (list.length === 0) {
      return { ...info, ok: false, issue: t('services.thereAreNoShotsTo') }
    }
    if (deps.quickstartState()?.status === 'running') {
      return { ...info, ok: false, issue: t('services.theFilmIsStillBeing') }
    }
    if (handle.repos.outline.listActs().length > 0) {
      return { ...info, ok: false, issue: t('services.thisProjectAlreadyHasAn') }
    }
    return { ...info, ok: true }
  }

  return {
    check,

    upgrade() {
      const checked = check()
      if (!checked.ok) throw invalid(checked.issue ?? t('services.canTUpgradeRightNow'))
      const handle = projects.current()
      if (!handle) throw invalid(t('services.openOrCreateAProject'))
      const { outline, shots } = handle.repos

      const list = shots.list()
      const act = outline.addAct({ title: checked.actTitle })
      const scene = outline.addScene(act.id, { title: t('services.scene1') })

      const created = createDraftCharacters(handle)

      shotService.assignScene(
        list.map((shot) => shot.id),
        scene.id,
      )
      return { actTitle: act.title, shotCount: list.length, characters: created }
    },
  }
}
