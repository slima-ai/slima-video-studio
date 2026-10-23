import {
  AppError,
  PICKABLE_CAPABILITIES,
  type AppSettings,
  type AppSettingsPatch,
  type ModelCard,
  type ModelOption,
  type MessageRef,
  type ModelTier,
  type PickableCapability,
  t,
  msg,
} from '@svs/schema'
import { providerName, toModelOption, type ModelRegistry } from '@svs/providers'

import type { KeyVault } from '../keys/key-vault'
import type { SettingsStore } from './settings-store'

export interface ModelListing {
  models: ModelOption[]
  selected: Partial<Record<PickableCapability, string>>
  /** 每個旁白模型目前用的聲音（有選的、或卡上的第一個）。 */
  voices: Record<string, string>
  /** 還沒填金鑰、不能用的模型（選單上灰色）；示範模式沒有。 */
  locked: ModelOption[]
  /** 開著的專案自己指定、而且現在能用的模型；沒開專案是 null。 */
  project: { name: string; models: Partial<Record<PickableCapability, string>> } | null
}

type ModelChoice = Partial<Record<PickableCapability, string>>

/** 目前開著的專案的模型設定（主行程從 ProjectManager 接進來；測試可以給假的）。 */
export interface ProjectModels {
  /** 沒開專案時是 undefined。 */
  current: () => { name: string; models: ModelChoice } | undefined
  /** 整份換掉這個專案的模型設定。 */
  set: (models: ModelChoice) => void
}

export interface SettingsService {
  /** 目前的模型選單與每種用途實際會用的模型。 */
  listModels: () => ModelListing
  /** 驗證後更新設定：選的模型必須存在、可用、而且做得到那個用途。 */
  update: (patch: AppSettingsPatch) => AppSettings
  /** 設定這個專案預設用的模型（逐項合併，null 表示改回跟著 App 設定）。 */
  setProjectModels: (patch: Partial<Record<PickableCapability, string | null>>) => void
  /**
   * 這種用途目前會用哪個模型（管道 id）。先看開著的專案指定的，再看 App 設定，都沒有就用推薦的。
   * 同一個模型兩家都能走時走較便宜的；選的模型下架、又沒有別家可以走，就換成同一組的下一個、
   * 記住（專案的記在專案、App 的記在設定），並留一則通知。
   * 指定 quality 時用那一組（高品質／平衡／經濟）推薦的，那一組沒有能用的才照平常。
   */
  resolveModel: (capability: PickableCapability, quality?: ModelTier) => string | undefined
  /** 這個旁白模型用哪個聲音：設定裡選的（還在卡的 voices 裡才算），否則卡上的第一個；沒有聲音清單回傳 undefined。 */
  resolveVoice: (modelId: string) => string | undefined
  /** 取走還沒說過的模型通知（取完就清掉，只說一次）。 */
  takeNotices: () => string[]
}

const USE_LABEL: Record<PickableCapability, MessageRef> = {
  llm: msg('settings.text'),
  t2i: msg('settings.images'),
  i2v: msg('settings.video'),
  tts: msg('settings.narration'),
  music: msg('settings.music'),
}

/**
 * 設定 + 模型註冊表 + Key 的組合：決定「現在選單裡有哪些模型」與「每種用途用哪一個」。
 * 示範模式只看得到示範模型；一般模式只看得到已填 Key 的供應商的模型。
 * 選單上每個模型只列一次（走最便宜的那個管道）。
 */
export function createSettingsService(deps: {
  store: SettingsStore
  registry: ModelRegistry
  keys: KeyVault
  /** 有新的模型通知時（例如自動換掉下架的模型）叫一聲，讓畫面來取。 */
  onNotice?: () => void
  /** 開著的專案的模型設定；沒給就只看 App 設定。 */
  project?: ProjectModels
}): SettingsService {
  const { store, registry, keys } = deps

  const queryFor = (capability?: PickableCapability) => ({
    configuredProviders: new Set(keys.providers()),
    demoMode: store.get().demoMode,
    ...(capability ? { capability } : {}),
  })

  const availableFor = (capability?: PickableCapability): ModelCard[] => {
    const { demoMode } = store.get()
    return registry
      .availableModels(queryFor(capability))
      .filter((card) => (card.provider === 'mock') === demoMode)
  }

  /** 留一則只說一次的通知（例如選的模型下架、自動換掉了）。 */
  const notify = (text: string): void => {
    store.setNotices([...store.get().modelNotices, text])
    deps.onNotice?.()
  }

  /**
   * 選的模型（chosenId）現在走哪個管道。下架又沒別家可走就換同組下一個，交給 remember 記住並通知；
   * 不能用（沒選、Key 被刪、示範模式切換）回傳 undefined。
   */
  const usable = (
    capability: PickableCapability,
    chosenId: string | undefined,
    remember: (gone: ModelCard, next: ModelCard) => void,
  ): string | undefined => {
    const { demoMode } = store.get()
    const chosen = chosenId === undefined ? undefined : registry.get(chosenId)
    if (!chosen || (chosen.provider === 'mock') !== demoMode) return undefined
    const query = queryFor(capability)
    const best = registry.bestChannel(chosen, query)
    if (best) return best.id
    if (!registry.isSunset(chosen)) return undefined
    const next = registry.replacementFor(chosen, { ...query, capability })
    if (!next || (next.provider === 'mock') !== demoMode) return undefined
    remember(chosen, next)
    return next.id
  }

  /** 這個專案指定的模型（能用的話）；專案的模型下架就改寫專案設定。 */
  const projectModel = (capability: PickableCapability): string | undefined => {
    const project = deps.project?.current()
    if (!project) return undefined
    return usable(capability, project.models[capability], (gone, next) => {
      deps.project?.set({ ...project.models, [capability]: next.id })
      notify(
        t('settings.wasRetiredInThisProject', {
          displayName: gone.displayName,
          value: t(USE_LABEL[capability]),
          displayName2: next.displayName,
        }),
      )
    })
  }

  /** App 設定選的模型；沒選或不能用就用推薦的。 */
  const appModel = (capability: PickableCapability): string | undefined => {
    const chosen = usable(capability, store.get().models[capability], (gone, next) => {
      store.update({ models: { [capability]: next.id } })
      notify(
        t('settings.wasRetiredNowUsesYou', {
          displayName: gone.displayName,
          value: t(USE_LABEL[capability]),
          displayName2: next.displayName,
        }),
      )
    })
    if (chosen) return chosen
    const cards = availableFor(capability)
    const groups = (['balanced', 'premium', 'budget'] as const).flatMap((tier) =>
      cards.filter((c) => c.tier === tier),
    )
    return (groups.find((c) => c.recommended) ?? groups[0])?.id
  }

  /** 換的模型要存在、而且做得到那個用途。 */
  const checkChoice = (choice: Partial<Record<PickableCapability, string | null>>): void => {
    for (const [capability, id] of Object.entries(choice) as [
      PickableCapability,
      string | null,
    ][]) {
      if (id === null) continue
      const card = registry.get(id)
      if (!card?.capabilities.includes(capability)) {
        throw new AppError({
          code: 'invalid_request',
          userMessage: t('settings.thisModelCanTBe'),
        })
      }
    }
  }

  const resolveModel = (
    capability: PickableCapability,
    quality?: ModelTier,
  ): string | undefined => {
    // 指定等級（生成鈕旁的「高品質／平衡／經濟」）：那一組裡推薦的；那一組沒有能用的就照平常
    if (quality) {
      const tier = availableFor(capability).filter((c) => c.tier === quality)
      const pick = tier.find((c) => c.recommended) ?? tier[0]
      if (pick) return pick.id
    }
    return projectModel(capability) ?? appModel(capability)
  }

  const resolveVoice = (modelId: string): string | undefined => {
    const voices = registry.get(modelId)?.voices ?? []
    const chosen = store.get().audio.voices[modelId]
    return voices.find((v) => v.id === chosen)?.id ?? voices[0]?.id
  }

  /** 選的聲音要在該模型卡的 voices 清單裡（OpenRouter 沒有聲音清單，只有實測過的才列）。 */
  const checkVoices = (voices: Record<string, string | null> | undefined): void => {
    for (const [modelId, voice] of Object.entries(voices ?? {})) {
      if (voice === null) continue
      if (!registry.get(modelId)?.voices.some((v) => v.id === voice)) {
        throw new AppError({
          code: 'invalid_request',
          userMessage: t('settings.thisVoiceCanTBe'),
        })
      }
    }
  }

  return {
    resolveModel,
    resolveVoice,
    takeNotices: () => {
      const notices = store.get().modelNotices
      if (notices.length > 0) store.setNotices([])
      return notices
    },
    listModels: () => {
      const selected: ModelChoice = {}
      const projectChoice: ModelChoice = {}
      for (const capability of PICKABLE_CAPABILITIES) {
        const id = appModel(capability)
        if (id) selected[capability] = id
        const own = projectModel(capability)
        if (own) projectChoice[capability] = own
      }
      const current = deps.project?.current()
      const models = availableFor()
      const locked = store.get().demoMode
        ? []
        : registry.lockedModels(queryFor()).map(({ card, providers }) => ({
            ...toModelOption(card, registry.channelsOf(card)),
            needsKey: providers.map(providerName).join(` ${t('settings.or')} `),
          }))
      const voices: Record<string, string> = {}
      for (const card of models) {
        const voice = resolveVoice(card.id)
        if (voice) voices[card.id] = voice
      }
      return {
        models: models.map((card) => toModelOption(card, registry.channelsOf(card))),
        selected,
        voices,
        locked,
        project: current ? { name: current.name, models: projectChoice } : null,
      }
    },
    update: (patch) => {
      checkChoice(patch.models ?? {})
      checkVoices(patch.audio?.voices)
      if (patch.budget && patch.budget.perRunLimitUsd <= 0) {
        throw new AppError({
          code: 'invalid_request',
          userMessage: t('settings.thePerRunSpendingLimit'),
        })
      }
      return store.update(patch)
    },
    setProjectModels: (patch) => {
      const project = deps.project?.current()
      if (!project) {
        throw new AppError({
          code: 'project_not_found',
          userMessage: t('settings.openOrCreateAProject'),
        })
      }
      checkChoice(patch)
      const next: ModelChoice = {}
      for (const capability of PICKABLE_CAPABILITIES) {
        // 沒提到的照舊；null 表示改回跟著 App 設定
        const id = capability in patch ? patch[capability] : project.models[capability]
        if (id) next[capability] = id
      }
      deps.project?.set(next)
    },
  }
}
