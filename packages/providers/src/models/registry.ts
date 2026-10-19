import {
  AppError,
  comparablePrice,
  estimateCostUsd,
  modelKeyOf,
  type Capability,
  type ModelCard,
  type ModelTier,
  type UsageEstimate,
} from '@svs/schema'

export interface AvailabilityQuery {
  /** 使用者已經填了 Key 的供應商。 */
  configuredProviders: ReadonlySet<string>
  /** 示範模式：額外列出不需要 Key 的假模型（provider 為 mock）。 */
  demoMode?: boolean
  capability?: Capability
}

export type GroupedModels = Record<ModelTier, ModelCard[]>

const TIER_ORDER: readonly ModelTier[] = ['premium', 'balanced', 'budget']

/** 模型註冊表：查詢、依已填的 Key 過濾、分組、估算花費。 */
export class ModelRegistry {
  private readonly byId = new Map<string, ModelCard>()

  constructor(
    cards: readonly ModelCard[],
    private readonly now: () => Date = () => new Date(),
  ) {
    for (const card of cards) this.byId.set(card.id, card)
  }

  all(): ModelCard[] {
    return [...this.byId.values()]
  }

  get(id: string): ModelCard | undefined {
    return this.byId.get(id)
  }

  /** 已下架（status 為 sunset，或已過預定下架日）。 */
  isSunset(card: ModelCard): boolean {
    if (card.status === 'sunset') return true
    return card.sunsetDate !== undefined && card.sunsetDate <= this.now().toISOString().slice(0, 10)
  }

  /** 選單裡可以選的模型：沒下架、有對應的 Key（或示範模式的假模型）、有該能力。推薦的排前面。 */
  available(query: AvailabilityQuery): ModelCard[] {
    return this.all()
      .filter((card) => {
        if (this.isSunset(card)) return false
        if (query.capability && !card.capabilities.includes(query.capability)) return false
        if (card.provider === 'mock') return query.demoMode === true
        return !card.needsKey || query.configuredProviders.has(card.provider)
      })
      .sort(
        (a, b) =>
          Number(b.recommended) - Number(a.recommended) ||
          a.displayName.localeCompare(b.displayName),
      )
  }

  /** 同一個模型的所有管道（依模型檔裡的順序，包含這張自己）。 */
  channelsOf(card: ModelCard): ModelCard[] {
    const key = modelKeyOf(card)
    return this.all().filter((c) => modelKeyOf(c) === key)
  }

  /**
   * 這個模型現在要走哪個管道：能用的管道裡最便宜的（同一個計價單位才比）。
   * 一樣價錢就用傳進來的這個管道（使用者選的），它不能用才照模型檔的順序。
   * 都不能用（下架、沒填 Key、做不到這件事）就是 undefined。
   */
  bestChannel(card: ModelCard, query: AvailabilityQuery): ModelCard | undefined {
    const usable = new Set(this.available(query).map((c) => c.id))
    let best: ModelCard | undefined
    const channels = this.channelsOf(card)
    for (const channel of [card, ...channels.filter((c) => c.id !== card.id)]) {
      if (!usable.has(channel.id)) continue
      if (!best) {
        best = channel
        continue
      }
      const prices = comparablePrice(channel.pricing, best.pricing)
      if (prices && prices[0] < prices[1]) best = channel
    }
    return best
  }

  /** 選單用：每個模型只列一次（走最便宜的那個管道），順序同 available。 */
  availableModels(query: AvailabilityQuery): ModelCard[] {
    const seen = new Set<string>()
    const result: ModelCard[] = []
    for (const card of this.available(query)) {
      const key = modelKeyOf(card)
      if (seen.has(key)) continue
      seen.add(key)
      const best = this.bestChannel(card, query)
      if (best) result.push(best)
    }
    return result
  }

  /**
   * 模型下架了、又沒有別的管道可以走：換成同一組（高品質／平衡／經濟）裡的下一個，推薦的優先；
   * 同一組沒有就照預設的順序找。
   */
  replacementFor(
    card: ModelCard,
    query: AvailabilityQuery & { capability: Capability },
  ): ModelCard | undefined {
    const key = modelKeyOf(card)
    const others = this.availableModels(query).filter((c) => modelKeyOf(c) !== key)
    const sameTier = others.filter((c) => c.tier === card.tier)
    return sameTier.find((c) => c.recommended) ?? sameTier[0] ?? this.defaultFor(query)
  }

  /**
   * 還沒解鎖的模型：沒下架、不是示範模型，但每個管道的供應商都還沒填 Key。每個模型列一次
   * （模型檔裡第一個沒下架的管道），附上填哪幾家的 Key 就能用。
   */
  lockedModels(query: AvailabilityQuery): { card: ModelCard; providers: string[] }[] {
    const usable = new Set(this.availableModels(query).map((c) => modelKeyOf(c)))
    const seen = new Set<string>()
    const result: { card: ModelCard; providers: string[] }[] = []
    for (const card of this.all()) {
      const key = modelKeyOf(card)
      if (card.provider === 'mock' || usable.has(key) || seen.has(key)) continue
      if (query.capability && !card.capabilities.includes(query.capability)) continue
      const open = this.channelsOf(card).filter((c) => !this.isSunset(c))
      const [first] = open
      if (!first) continue
      seen.add(key)
      result.push({ card: first, providers: open.map((c) => c.provider) })
    }
    return result
  }

  /** 依 tier 分成 高品質 / 平衡 / 經濟實惠 三組（每個模型只列一次）。 */
  grouped(query: AvailabilityQuery): GroupedModels {
    const groups: GroupedModels = { premium: [], balanced: [], budget: [] }
    for (const card of this.availableModels(query)) groups[card.tier].push(card)
    return groups
  }

  /** 預設選項：優先「平衡」裡推薦的，再依序往高品質、經濟實惠找。 */
  defaultFor(query: AvailabilityQuery & { capability: Capability }): ModelCard | undefined {
    const groups = this.grouped(query)
    const order: ModelTier[] = ['balanced', ...TIER_ORDER.filter((t) => t !== 'balanced')]
    for (const tier of order) {
      const pick = groups[tier].find((c) => c.recommended) ?? groups[tier][0]
      if (pick) return pick
    }
    return undefined
  }

  estimate(id: string, usage: UsageEstimate): number {
    const card = this.byId.get(id)
    if (!card) {
      throw new AppError({ code: 'invalid_request', userMessage: `找不到模型（${id}）。` })
    }
    return estimateCostUsd(card, usage)
  }
}
