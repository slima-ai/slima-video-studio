import { PICKABLE_CAPABILITIES, type ModelOption, type PickableCapability, t } from '@svs/schema'
import { FolderCog } from 'lucide-react'
import { useState } from 'react'

import { ListSelect, type ListOption } from '../../components/list-select'
import { SettingCard } from '../../components/setting-card'
import { call, errorText } from '../../lib/svs'
import { LABELS, toOptions } from './models-section'

/** 選單第一個選項：不指定，跟著上面「使用的模型」。 */
const FOLLOW = 'follow-app'

export interface ProjectModelsSectionProps {
  /** 開著的專案：名稱與它自己指定的模型。 */
  project: { name: string; models: Partial<Record<PickableCapability, string>> }
  models: ModelOption[]
  /** App 設定每種用途會用的模型（「跟著預設」時用的就是它）。 */
  selected: Partial<Record<PickableCapability, string>>
  locked?: ModelOption[]
  onChanged: () => void
}

/**
 * 這個專案預設用什麼：文字、圖片、影片各一列，第一個選項是「跟著預設（X）」。
 * 只影響開著的這個專案；其他專案照上面的設定。
 */
export function ProjectModelsSection({
  project,
  models,
  selected,
  locked = [],
  onChanged,
}: ProjectModelsSectionProps) {
  const [error, setError] = useState<string | undefined>()

  const choose = (capability: PickableCapability, value: string): void => {
    setError(undefined)
    call('models.setProject', { models: { [capability]: value === FOLLOW ? null : value } })
      .then(onChanged)
      .catch((e: unknown) => {
        setError(errorText(e))
      })
  }

  return (
    <div className="contents" data-testid="project-models-section">
      <SettingCard
        icon={FolderCog}
        title={t('settings.defaultsForThisProject')}
        className="md:col-span-2"
        summary={t('settings.appliesOnlyToJobsYou', { name: project.name })}
        body={
          <div className="divide-y divide-border">
            {PICKABLE_CAPABILITIES.map((capability) => {
              const candidates = models.filter((m) => m.capabilities.includes(capability))
              const appName = candidates.find((m) => m.id === selected[capability])?.displayName
              const follow: ListOption = {
                value: FOLLOW,
                label: t('settings.useDefault', {
                  value: appName ?? t('settings.noModelAvailable'),
                }),
                content: (
                  <span className="min-w-0 truncate">
                    {t('settings.useDefault2')}
                    <span className="text-fg-muted">
                      （{appName ?? t('settings.noModelAvailable')}）
                    </span>
                  </span>
                ),
              }
              const greyed = locked.filter((m) => m.capabilities.includes(capability))
              return (
                <div
                  key={capability}
                  className="grid grid-cols-[4rem_minmax(0,1fr)] items-center gap-3 py-2 first:pt-0 last:pb-0"
                >
                  <label className="text-sm font-medium" htmlFor={`project-model-${capability}`}>
                    {t(LABELS[capability].title)}
                  </label>
                  <ListSelect
                    id={`project-model-${capability}`}
                    testId={`project-model-${capability}`}
                    value={project.models[capability] ?? FOLLOW}
                    options={[follow, ...toOptions(candidates, greyed)]}
                    onChange={(value) => {
                      choose(capability, value)
                    }}
                  />
                </div>
              )
            })}
          </div>
        }
      />
      {error ? (
        <p role="alert" className="text-sm text-danger md:col-span-2">
          {error}
        </p>
      ) : null}
    </div>
  )
}
