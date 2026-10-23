import {
  LOCATION_REFERENCE_PURPOSE_LABELS,
  type ConceptView,
  type LocationCardView,
  type LocationGenerateKind,
  type LocationReferenceView,
  t,
} from '@svs/schema'
import { Lock, LockOpen, Plus } from 'lucide-react'
import { useCallback, useEffect, useState, type SyntheticEvent } from 'react'

import { Button } from '../../components/button'
import { assetUrl } from '../../lib/asset'
import { useDataVersion } from '../../lib/data-version'
import { call, errorText } from '../../lib/svs'
import { useLocationImages } from './use-location-images'
import { Page } from '../../components/page'

const FIELD = 'mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm font-normal'
const usd = (n: number): string => `US$${n.toFixed(2)}`

/** 依輪次分組，新的一輪在前。 */
function byRound(concepts: readonly ConceptView[]): { round: number; items: ConceptView[] }[] {
  const rounds = new Map<number, ConceptView[]>()
  for (const concept of concepts) {
    rounds.set(concept.round, [...(rounds.get(concept.round) ?? []), concept])
  }
  return [...rounds.entries()].sort(([a], [b]) => b - a).map(([round, items]) => ({ round, items }))
}

interface CardProps {
  card: LocationCardView
  /** 場景卡有變動（寫描述、挑主圖、鎖定…）。 */
  onChanged: (card: LocationCardView) => void
  /** 要重新讀整份清單（角度生好之後）。 */
  onReload: () => void
}

/** 一張場景卡：固定描述、主場景圖、另外兩個角度，最後鎖定。 */
export function LocationCard({ card, onChanged, onReload }: CardProps) {
  const locked = card.status === 'locked'
  const images = useLocationImages(card.id, onReload)
  const [text, setText] = useState(card.anchorText)
  const [error, setError] = useState<string>()
  const generating = images.state?.generating
  const dirty = text.trim() !== card.anchorText
  // 另外加的參考圖（俯視、縱深感…）；場景卡本來的主圖與兩個角度已經在下面的「主場景圖與其他角度」
  const [extras, setExtras] = useState<LocationReferenceView[]>([])
  const refsVersion = useDataVersion(['locations.changed'])
  useEffect(() => {
    call('locations.references', { locationId: card.id })
      .then((state) => {
        setExtras(state.references.filter((reference) => reference.source === 'added'))
      })
      .catch(() => undefined)
  }, [card.id, refsVersion])

  // 後端的內容變了（別處改了、解除鎖定…）就跟著更新輸入框。在畫面算出來的時候比對，
  // 不用 effect：effect 在掛上時也會跑一次，畫面剛出現就打的字（或按「用故事裡的說明」）會被它蓋回去
  const [synced, setSynced] = useState(card.anchorText)
  if (synced !== card.anchorText) {
    setSynced(card.anchorText)
    setText(card.anchorText)
  }
  // 主圖、鎖定狀態變了，生成的條件和預估也跟著變
  const { mainAssetHash, status } = card
  const { recheck } = images
  useEffect(() => {
    recheck()
  }, [mainAssetHash, status, recheck])

  const run = async (action: () => Promise<LocationCardView>): Promise<void> => {
    setError(undefined)
    try {
      onChanged(await action())
    } catch (e) {
      setError(errorText(e))
    }
  }
  const save = (): Promise<void> =>
    run(() => call('locations.setAnchor', { locationId: card.id, text }))

  // 按鎖定時順便存下還沒存的描述
  const lock = (): Promise<void> =>
    run(async () => {
      if (dirty) await call('locations.setAnchor', { locationId: card.id, text })
      return call('locations.lock', { locationId: card.id })
    })

  const costText = (kind: LocationGenerateKind): string => {
    const check = images.checks[kind]
    if (!check) return ''
    if (!check.ok) return check.issue ?? ''
    return check.demoMode
      ? t('chat.demoModeSampleResultsNothing')
      : check.modelName
        ? t('chat.estimateAbout', { value: usd(check.estimatedUsd), modelName: check.modelName })
        : t('chat.estimateAbout2', { value: usd(check.estimatedUsd) })
  }
  const problem = error ?? images.error ?? images.state?.error
  const concepts = images.state?.concepts ?? []

  return (
    <div className="space-y-4" data-testid="location-card">
      <section className="space-y-3 rounded-md border border-border p-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">{card.name}</h2>
          <span
            data-testid="location-status"
            className={`text-xs ${locked ? 'text-success' : 'text-warning'}`}
          >
            {locked ? t('chat.lockedShotsUseItAutomatically') : t('chat.draftNotLockedSoShots')}
          </span>
        </div>
        {card.description ? (
          <p className="text-sm text-fg-muted">
            {t('chat.fromTheStory', { description: card.description })}
          </p>
        ) : null}
        <label className="block text-sm font-medium">
          {t('chat.fixedLocationDescription')}
          <textarea
            data-testid="location-anchor"
            rows={3}
            value={text}
            disabled={locked}
            placeholder={t('chat.forExampleADampBrick')}
            maxLength={1000}
            onChange={(event) => {
              setText(event.target.value)
            }}
            className={FIELD}
          />
        </label>
        <p className="text-xs text-fg-muted">{t('chat.onceLockedEveryShotSet')}</p>
        <div className="flex flex-wrap items-center gap-2">
          {locked ? (
            <Button
              size="sm"
              data-testid="location-unlock"
              onClick={() => void run(() => call('locations.unlock', { locationId: card.id }))}
            >
              <LockOpen className="size-4" />
              {t('chat.unlockToEdit')}
            </Button>
          ) : (
            <>
              <Button
                size="sm"
                data-testid="location-anchor-save"
                disabled={!dirty}
                onClick={() => void save()}
              >
                {t('chat.saveDescription2')}
              </Button>
              {card.description && text.trim() === '' ? (
                <Button
                  size="sm"
                  variant="ghost"
                  data-testid="location-anchor-fill"
                  onClick={() => {
                    setText(card.description)
                  }}
                >
                  {t('chat.useTheStorySDescription')}
                </Button>
              ) : null}
              <Button
                size="sm"
                variant="primary"
                data-testid="location-lock"
                disabled={text.trim() === '' || !card.mainAssetHash || generating !== undefined}
                onClick={() => void lock()}
              >
                <Lock className="size-4" />
                {t('chat.lock')}
              </Button>
              {text.trim() === '' || !card.mainAssetHash ? (
                <span className="text-xs text-fg-muted" data-testid="location-lock-hint">
                  {t('chat.writeADescriptionAndPick')}
                </span>
              ) : null}
            </>
          )}
        </div>
        {problem ? (
          <p role="alert" className="text-sm text-danger" data-testid="location-error">
            {problem}
          </p>
        ) : null}
      </section>

      <section
        className="space-y-3 rounded-md border border-border p-3"
        data-testid="location-images"
      >
        <h3 className="text-sm font-medium">{t('chat.mainPictureAndOtherAngles')}</h3>
        <div className="grid grid-cols-3 gap-2">
          {(
            [
              ['main', t('chat.mainPicture'), card.mainAssetHash],
              ['reverse', t('chat.reverseAngle'), card.angles.reverse],
              ['wide', t('chat.wideView'), card.angles.wide],
            ] as const
          ).map(([id, label, hash]) => (
            <figure key={id} data-testid={`location-${id}`}>
              <div className="flex aspect-video items-center justify-center overflow-hidden rounded-md border border-border bg-surface-overlay">
                {hash ? (
                  <img src={assetUrl(hash)} alt={label} className="size-full object-cover" />
                ) : (
                  <span className="text-xs text-fg-muted">{t('chat.noneYet')}</span>
                )}
              </div>
              <figcaption className="mt-1 text-center text-xs text-fg-muted">{label}</figcaption>
            </figure>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {generating ? (
            <>
              <span className="text-sm" data-testid="location-progress">
                {t('chat.generatingOfDone', {
                  value: String(generating.done),
                  value2: String(generating.total),
                })}
              </span>
              <Button
                size="sm"
                variant="ghost"
                data-testid="location-cancel"
                onClick={() => void images.cancel()}
              >
                {t('chat.cancel')}
              </Button>
            </>
          ) : (
            <>
              <Button
                size="sm"
                variant="primary"
                data-testid="location-concepts-generate"
                disabled={!images.checks.concepts?.ok}
                onClick={() => void images.generate('concepts')}
              >
                {concepts.length > 0
                  ? t('chat.redoAll4Pictures')
                  : t('chat.generate4LocationConceptPictures')}
              </Button>
              <span className="text-xs text-fg-muted" data-testid="location-concepts-cost">
                {costText('concepts')}
              </span>
            </>
          )}
        </div>
        {!generating && card.mainAssetHash ? (
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              data-testid="location-angles-generate"
              disabled={!images.checks.angles?.ok}
              onClick={() => void images.generate('angles')}
            >
              {card.angles.reverse || card.angles.wide
                ? t('chat.regenerateOtherAngles')
                : t('chat.generateTheOtherTwoAngles')}
            </Button>
            <span className="text-xs text-fg-muted" data-testid="location-angles-cost">
              {costText('angles')}
            </span>
          </div>
        ) : null}

        {extras.length > 0 ? (
          <div data-testid="location-extras">
            <p className="mb-1 text-xs text-fg-muted">
              {t('chat.extraReferencePicturesOnceLocked')}
            </p>
            <div className="grid grid-cols-4 gap-2">
              {extras.map((reference) => {
                const name = LOCATION_REFERENCE_PURPOSE_LABELS[reference.purpose]
                return (
                  <figure key={reference.id} data-testid={`location-extra-${reference.id}`}>
                    <img
                      src={assetUrl(reference.assetHash)}
                      alt={name}
                      className="aspect-video w-full rounded-md border border-border object-cover"
                    />
                    <figcaption className="mt-1 flex items-center justify-between gap-1 text-xs text-fg-muted">
                      <span className="min-w-0 truncate">
                        {name}
                        {reference.label ? `・${reference.label}` : ''}
                      </span>
                      <Button
                        size="sm"
                        variant="ghost"
                        data-testid={`location-extra-remove-${reference.id}`}
                        disabled={locked}
                        title={locked ? t('chat.unlockBeforeRemoving') : undefined}
                        onClick={() => {
                          setError(undefined)
                          call('locations.removeReference', {
                            locationId: card.id,
                            referenceId: reference.id,
                          })
                            .then((state) => {
                              setExtras(state.references.filter((r) => r.source === 'added'))
                            })
                            .catch((e: unknown) => {
                              setError(errorText(e))
                            })
                        }}
                      >
                        {t('chat.remove')}
                      </Button>
                    </figcaption>
                  </figure>
                )
              })}
            </div>
          </div>
        ) : null}

        {byRound(concepts).map(({ round, items }) => (
          <div key={round} data-testid={`location-round-${String(round)}`}>
            <p className="mb-1 text-xs text-fg-muted">
              {t('chat.roundClickOneToUse', { value: String(round) })}
            </p>
            <div className="grid grid-cols-4 gap-2">
              {items.map((concept) => {
                const chosen = concept.assetHash === card.mainAssetHash
                return (
                  <button
                    key={concept.id}
                    type="button"
                    data-testid={`location-concept-${concept.id}`}
                    aria-label={t('chat.useAsMainLocationPicture')}
                    aria-pressed={chosen}
                    disabled={locked || generating !== undefined}
                    onClick={() =>
                      void run(() =>
                        call('locations.pickMain', { locationId: card.id, conceptId: concept.id }),
                      )
                    }
                    className={`overflow-hidden rounded-md border-2 disabled:opacity-60 ${
                      chosen ? 'border-accent' : 'border-transparent hover:border-border'
                    }`}
                  >
                    <img
                      src={assetUrl(concept.assetHash)}
                      alt={t('chat.locationConceptPictures')}
                      className="aspect-video w-full object-cover"
                    />
                  </button>
                )
              })}
            </div>
          </div>
        ))}
      </section>
    </div>
  )
}

/** 場景卡：每個地點一張，固定它的樣子，讓同一個地點的鏡頭前後一致。 */
const LOCATION_EVENTS = ['locations.changed', 'outline.changed'] as const

export function LocationsPage() {
  const [cards, setCards] = useState<LocationCardView[]>([])
  const [loaded, setLoaded] = useState(false)
  const [selectedId, setSelectedId] = useState<string>()
  const [newName, setNewName] = useState('')
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState<string>()

  const reload = useCallback((): void => {
    call('locations.list', {})
      .then(({ locations }) => {
        setCards(locations)
        setLoaded(true)
      })
      .catch((e: unknown) => {
        setError(errorText(e))
      })
  }, [])
  // 別的地方改了地點（大綱、畫布）或場景卡、或復原／重做之後，重新讀
  const version = useDataVersion(LOCATION_EVENTS)
  useEffect(reload, [reload, version])

  const selected = cards.find((c) => c.id === selectedId) ?? cards[0]

  const replace = (next: LocationCardView): void => {
    setCards((current) => current.map((c) => (c.id === next.id ? next : c)))
  }

  const add = async (event: SyntheticEvent): Promise<void> => {
    event.preventDefault()
    const name = newName.trim()
    if (name === '') return
    setAdding(true)
    setError(undefined)
    try {
      const view = await call('outline.edit', { op: 'addLocation' })
      const created = view.locations.at(-1)
      if (!created) return
      await call('outline.edit', {
        op: 'updateLocation',
        locationId: created.id,
        patch: { name },
      })
      setNewName('')
      setSelectedId(created.id)
      reload()
    } catch (e) {
      setError(errorText(e))
    } finally {
      setAdding(false)
    }
  }

  return (
    <Page title={t('chat.locations')} hint={t('chat.oneCardPerLocationIt')} testId="locations-page">
      <div className="grid gap-6 md:grid-cols-[16rem_1fr]">
        <div className="space-y-3">
          <form
            onSubmit={(event) => {
              void add(event)
            }}
            className="flex gap-2"
          >
            <input
              data-testid="location-new-name"
              aria-label={t('chat.newLocationSName')}
              placeholder={t('chat.newLocationSName')}
              value={newName}
              maxLength={100}
              onChange={(event) => {
                setNewName(event.target.value)
              }}
              className="min-w-0 flex-1 rounded-md border border-border bg-surface px-3 py-2 text-sm"
            />
            <Button
              type="submit"
              variant="primary"
              size="icon"
              aria-label={t('chat.addLocation')}
              data-testid="location-add"
              disabled={adding || newName.trim() === ''}
            >
              <Plus className="size-5" />
            </Button>
          </form>
          {error ? (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          ) : null}
          <ul className="space-y-1" aria-label={t('chat.locationList')} data-testid="location-list">
            {cards.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  data-testid={`location-item-${c.name}`}
                  aria-current={c.id === selected?.id ? 'true' : undefined}
                  onClick={() => {
                    setSelectedId(c.id)
                  }}
                  className={`w-full rounded-md px-3 py-2 text-left text-sm ${
                    c.id === selected?.id
                      ? 'bg-surface-overlay font-medium'
                      : 'text-fg-muted hover:bg-surface-overlay'
                  }`}
                >
                  {c.name}
                  {c.status === 'locked' ? (
                    <span className="ml-2 text-xs text-success">{t('chat.locked')}</span>
                  ) : (
                    <span className="ml-2 text-xs text-warning">{t('chat.draft')}</span>
                  )}
                </button>
              </li>
            ))}
          </ul>
          {loaded && cards.length === 0 ? (
            <p className="text-sm text-fg-muted" data-testid="location-empty">
              {t('chat.noLocationsYetTypeA')}
            </p>
          ) : null}
        </div>

        {selected ? (
          <LocationCard key={selected.id} card={selected} onChanged={replace} onReload={reload} />
        ) : null}
      </div>
    </Page>
  )
}
