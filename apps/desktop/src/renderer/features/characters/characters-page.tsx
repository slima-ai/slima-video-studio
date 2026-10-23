import {
  CHARACTER_AVOID_MAX_CHARS,
  type CharacterEdit,
  type CharacterView,
  t,
  msg,
} from '@svs/schema'
import { Plus, Trash2, Users } from 'lucide-react'
import { useEffect, useRef, useState, type SyntheticEvent } from 'react'

import { Button } from '../../components/button'
import { SkeletonCards } from '../../components/skeleton'
import { EmptyState } from '../../components/empty-state'
import { SidePanel } from '../../components/side-panel'
import { useDataVersion } from '../../lib/data-version'
import { call, errorText } from '../../lib/svs'
import { ConceptPicker } from './concept-picker'
import { TurnaroundPicker } from './turnaround-picker'
import { VersionHistory } from './version-history'
import { useEscape } from '../../lib/use-escape'
import { Page } from '../../components/page'

interface Draft {
  name: string
  age: string
  appearance: string
  personality: string
  avoid: string
  outfit: string
}

const draftOf = (c: CharacterView): Draft => ({
  name: c.name,
  age: c.age ?? '',
  appearance: c.appearance,
  personality: c.personality,
  avoid: c.avoid,
  outfit: c.outfit,
})

/** 跟目前存的內容比，只留下有改的欄位。 */
export function diffCharacter(c: CharacterView, draft: Draft): CharacterEdit {
  const edit: CharacterEdit = {}
  if (draft.name.trim() !== c.name) edit.name = draft.name
  if (draft.age.trim() !== (c.age ?? '')) edit.age = draft.age.trim() === '' ? null : draft.age
  if (draft.appearance !== c.appearance) edit.appearance = draft.appearance
  if (draft.personality !== c.personality) edit.personality = draft.personality
  if (draft.avoid !== c.avoid) edit.avoid = draft.avoid
  if (draft.outfit !== c.outfit) edit.outfit = draft.outfit
  return edit
}

const FIELD = 'mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm font-normal'

const STATUS_TEXT = {
  none: msg('chat.notWrittenYet'),
  draft: msg('chat.draftNotLockedSoIt'),
  locked: msg('chat.lockedUsedWordForWord'),
} as const

interface AnchorProps {
  character: CharacterView
  onChanged: (character: CharacterView) => void
}

/** 固定外觀描述：寫一段精簡的外觀，鎖定後每個有這個角色的鏡頭都會原封不動帶入。 */
function AnchorEditor({ character, onChanged }: AnchorProps) {
  const [text, setText] = useState(character.anchorText)
  const [busy, setBusy] = useState<'suggest' | 'save' | 'lock'>()
  const [error, setError] = useState<string>()
  const dirty = text.trim() !== character.anchorText
  const hasLooks = character.appearance.trim() !== '' || character.outfit.trim() !== ''
  const canLock = text.trim() !== '' && (dirty || character.anchorStatus !== 'locked')

  const run = async (kind: 'suggest' | 'save' | 'lock'): Promise<void> => {
    setBusy(kind)
    setError(undefined)
    try {
      if (kind === 'suggest') {
        const { text: suggestion } = await call('characters.suggestAnchor', {
          characterId: character.id,
        })
        setText(suggestion)
        return
      }
      let latest = character
      if (dirty) {
        latest = await call('characters.setAnchor', { characterId: character.id, text })
      }
      if (kind === 'lock') {
        latest = await call('characters.lock', { characterId: character.id })
      }
      onChanged(latest)
      setText(latest.anchorText)
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(undefined)
    }
  }

  return (
    <div
      className="space-y-2 rounded-md border border-border p-3"
      data-testid="character-anchor-section"
    >
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-medium">{t('chat.fixedAppearance')}</h3>
        <span
          className="text-xs text-fg-muted"
          data-testid="character-anchor-status"
          data-status={character.anchorStatus}
        >
          {character.version > 0 ? t('chat.version', { value: String(character.version) }) : ''}
          {t(STATUS_TEXT[character.anchorStatus])}
        </span>
      </div>
      <p className="text-xs text-fg-muted">{t('chat.onceLockedEveryShotThis')}</p>
      <textarea
        data-testid="character-anchor"
        aria-label={t('chat.fixedAppearance')}
        rows={3}
        value={text}
        maxLength={1000}
        onChange={(event) => {
          setText(event.target.value)
        }}
        className={FIELD}
      />
      {character.anchorStatus === 'draft' && character.version > 1 ? (
        <p className="text-xs text-warning" data-testid="character-anchor-relock">
          {t('chat.theLookOrOutfitChanged')}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          data-testid="character-anchor-suggest"
          disabled={busy !== undefined || !hasLooks}
          title={hasLooks ? undefined : t('chat.writeTheLookOrOutfit')}
          onClick={() => void run('suggest')}
        >
          {busy === 'suggest' ? t('chat.aiIsWritingIt') : t('chat.askAiToWriteIt')}
        </Button>
        <Button
          size="sm"
          data-testid="character-anchor-save"
          disabled={busy !== undefined || !dirty}
          onClick={() => void run('save')}
        >
          {t('chat.saveDescription')}
        </Button>
        <Button
          size="sm"
          variant="primary"
          data-testid="character-anchor-lock"
          disabled={busy !== undefined || !canLock}
          onClick={() => void run('lock')}
        >
          {t('chat.lock')}
        </Button>
      </div>
    </div>
  )
}

interface CardProps {
  character: CharacterView
  onSaved: (character: CharacterView) => void
  /** 沒給就不顯示「刪除角色」。 */
  onDeleted?: (id: string) => void
}

/** 一張角色卡：名字、年齡、外觀、個性、服裝。 */
function CharacterCard({ character, onSaved, onDeleted }: CardProps) {
  const [draft, setDraft] = useState<Draft>(() => draftOf(character))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  useEscape(confirmingDelete, () => {
    setConfirmingDelete(false)
  })
  const edit = diffCharacter(character, draft)
  const dirty = Object.keys(edit).length > 0
  const set = (patch: Partial<Draft>): void => {
    setDraft((current) => ({ ...current, ...patch }))
  }

  const save = async (): Promise<void> => {
    setBusy(true)
    setError(undefined)
    try {
      onSaved(await call('characters.update', { characterId: character.id, patch: edit }))
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }

  const remove = async (): Promise<void> => {
    setBusy(true)
    setError(undefined)
    try {
      await call('characters.delete', { characterId: character.id })
      onDeleted?.(character.id)
    } catch (e) {
      setError(errorText(e))
      setBusy(false)
    }
  }

  return (
    <section
      aria-label={t('chat.character', { name: character.name })}
      data-testid="character-card"
      className="space-y-3 rounded-lg border border-border bg-surface-raised shadow-card p-5"
    >
      <div className="grid grid-cols-3 gap-3">
        <label className="col-span-2 block text-sm font-medium">
          {t('chat.name')}
          <input
            data-testid="character-name"
            value={draft.name}
            maxLength={40}
            onChange={(event) => {
              set({ name: event.target.value })
            }}
            className={FIELD}
          />
        </label>
        <label className="block text-sm font-medium">
          {t('chat.ageOptional')}
          <input
            data-testid="character-age"
            value={draft.age}
            maxLength={40}
            onChange={(event) => {
              set({ age: event.target.value })
            }}
            className={FIELD}
          />
        </label>
      </div>
      <label className="block text-sm font-medium">
        {t('chat.lookHairEyesBuildFeatures')}
        <textarea
          data-testid="character-appearance"
          rows={3}
          value={draft.appearance}
          onChange={(event) => {
            set({ appearance: event.target.value })
          }}
          className={FIELD}
        />
      </label>
      <label className="block text-sm font-medium">
        {t('chat.personality')}
        <textarea
          data-testid="character-personality"
          rows={2}
          value={draft.personality}
          onChange={(event) => {
            set({ personality: event.target.value })
          }}
          className={FIELD}
        />
      </label>
      <label className="block text-sm font-medium">
        {t('chat.featuresToAvoidInVideo')}
        <textarea
          data-testid="character-avoid"
          rows={2}
          value={draft.avoid}
          maxLength={CHARACTER_AVOID_MAX_CHARS}
          placeholder={t('chat.forExampleLittleBunMouth')}
          onChange={(event) => {
            set({ avoid: event.target.value })
          }}
          className={FIELD}
        />
        <span className="mt-1 block text-xs font-normal text-fg-muted">
          {t('chat.whenMakingVideoShotsWith')}
        </span>
      </label>
      <label className="block text-sm font-medium">
        {t('chat.outfit')}
        <textarea
          data-testid="character-outfit"
          rows={2}
          value={draft.outfit}
          onChange={(event) => {
            set({ outfit: event.target.value })
          }}
          className={FIELD}
        />
      </label>

      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}

      <div className="flex items-center gap-2">
        <Button
          variant="primary"
          data-testid="character-save"
          disabled={!dirty || busy || draft.name.trim() === ''}
          onClick={() => void save()}
        >
          {t('chat.save')}
        </Button>
        {dirty ? <span className="text-sm text-fg-muted">{t('chat.notSavedYet')}</span> : null}
        <div className="flex-1" />
        {!onDeleted ? null : confirmingDelete ? (
          <>
            <span className="text-sm">{t('chat.delete', { name: character.name })}</span>
            <Button
              size="sm"
              data-testid="character-delete-confirm"
              disabled={busy}
              onClick={() => void remove()}
            >
              {t('chat.yesDelete')}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setConfirmingDelete(false)
              }}
            >
              {t('chat.keep')}
            </Button>
          </>
        ) : (
          <Button
            size="sm"
            variant="ghost"
            data-testid="character-delete"
            disabled={busy}
            onClick={() => {
              setConfirmingDelete(true)
            }}
          >
            <Trash2 className="size-4" />
            {t('chat.deleteCharacter')}
          </Button>
        )}
      </div>
    </section>
  )
}

/**
 * 一個角色的完整內容：角色卡（名字、外觀、服裝…）、固定外觀描述、概念圖、三視圖、版本紀錄。
 * 角色頁的右側面板和畫布的浮動面板共用；`onDeleted` 沒給就不顯示「刪除角色」（畫布上用 Delete 刪）。
 */
export function CharacterDetail({
  character,
  onChanged,
  onDeleted,
}: {
  character: CharacterView
  onChanged: (character: CharacterView) => void
  onDeleted?: (id: string) => void
}) {
  return (
    <>
      <CharacterCard
        // 換角色或存檔後，草稿跟著重設
        key={`${character.id}-${character.updatedAt}`}
        character={character}
        onSaved={onChanged}
        {...(onDeleted ? { onDeleted } : {})}
      />
      <AnchorEditor
        // 版本或描述被改掉（例如還原舊版本）時，輸入框跟著重設
        key={`${character.id}-${String(character.version)}-${character.anchorStatus}-${character.anchorText}`}
        character={character}
        onChanged={onChanged}
      />
      <ConceptPicker key={`concepts-${character.id}`} character={character} onChanged={onChanged} />
      <TurnaroundPicker
        key={`turnarounds-${character.id}`}
        character={character}
        onChanged={onChanged}
      />
      <VersionHistory
        key={`versions-${character.id}`}
        character={character}
        onChanged={onChanged}
      />
    </>
  )
}

const CHARACTER_EVENTS = ['characters.changed'] as const

/** 角色頁：左邊角色清單與新增，右邊是選到的角色卡。 */
export function CharactersPage() {
  const [characters, setCharacters] = useState<CharacterView[]>([])
  const [loaded, setLoaded] = useState(false)
  const [selectedId, setSelectedId] = useState<string>()
  const [newName, setNewName] = useState('')
  const [adding, setAdding] = useState(false)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string>()
  const alive = useRef(true)
  const nameInput = useRef<HTMLInputElement>(null)

  // 別的地方（畫布、浮動面板）改了角色、或復原／重做之後，重新讀清單
  const version = useDataVersion(CHARACTER_EVENTS)
  useEffect(() => {
    alive.current = true
    call('characters.list', {})
      .then(({ characters: list }) => {
        if (!alive.current) return
        setCharacters(list)
        setLoaded(true)
      })
      .catch((e: unknown) => {
        if (!alive.current) return
        setError(errorText(e))
        setLoaded(true)
      })
    return () => {
      alive.current = false
    }
  }, [version])

  const empty = loaded && characters.length === 0
  // 從空狀態按「建立第一個角色」之後，名字輸入框出現並直接可以打字
  useEffect(() => {
    if (creating) nameInput.current?.focus()
  }, [creating])

  const selected = characters.find((c) => c.id === selectedId)
  const replace = (saved: CharacterView): void => {
    setCharacters((current) => current.map((c) => (c.id === saved.id ? saved : c)))
  }

  const add = async (event: SyntheticEvent): Promise<void> => {
    event.preventDefault()
    if (newName.trim() === '') return
    setAdding(true)
    setError(undefined)
    try {
      const created = await call('characters.create', { name: newName })
      setCharacters((current) => [...current, created])
      setSelectedId(created.id)
      setNewName('')
      setCreating(false)
    } catch (e) {
      setError(errorText(e))
    } finally {
      setAdding(false)
    }
  }

  return (
    <Page
      title={t('chat.characters')}
      hint={t('chat.writeDownACharacterS')}
      testId="characters-page"
    >
      <div>
        {empty && !creating ? (
          <EmptyState
            testId="character-empty"
            icon={Users}
            className="py-16"
            message={t('chat.noCharactersYetCreateOne')}
            action={
              <Button
                variant="primary"
                data-testid="character-empty-create"
                onClick={() => {
                  setCreating(true)
                }}
              >
                {t('chat.createYourFirstCharacter')}
              </Button>
            }
          />
        ) : !loaded ? (
          <div className="max-w-md">
            <SkeletonCards count={2} testId="characters-loading" />
          </div>
        ) : (
          <div className={`max-w-md space-y-3 ${empty ? 'mx-auto py-10' : ''}`}>
            <form
              onSubmit={(event) => {
                void add(event)
              }}
              className="flex gap-2"
            >
              <input
                ref={nameInput}
                data-testid="character-new-name"
                aria-label={t('chat.newCharacterSName')}
                placeholder={t('chat.forExampleMina')}
                value={newName}
                maxLength={40}
                onChange={(event) => {
                  setNewName(event.target.value)
                }}
                className="min-w-0 flex-1 rounded-md border border-border bg-surface px-3 py-2 text-sm"
              />
              <Button
                type="submit"
                variant="primary"
                aria-label={t('chat.addCharacter')}
                data-testid="character-add"
                disabled={adding || newName.trim() === ''}
              >
                <Plus className="size-4" />
                {t('chat.add')}
              </Button>
            </form>
            {error ? (
              <p role="alert" className="text-sm text-danger">
                {error}
              </p>
            ) : null}
            <ul
              className="space-y-1"
              aria-label={t('chat.characterList')}
              data-testid="character-list"
            >
              {characters.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    data-testid={`character-item-${c.name}`}
                    aria-current={c.id === selectedId ? 'true' : undefined}
                    onClick={() => {
                      setSelectedId(c.id)
                    }}
                    className={`relative w-full rounded-md px-3 py-2 text-left text-sm transition-colors duration-200 ${
                      c.id === selectedId
                        ? 'bg-surface-overlay font-medium before:absolute before:left-0 before:top-2 before:h-5 before:w-[3px] before:rounded-r before:bg-accent'
                        : 'text-fg-muted hover:bg-surface-overlay'
                    }`}
                  >
                    {c.name}
                    {c.anchorStatus === 'locked' ? (
                      <span
                        className="ml-2 text-xs text-success"
                        data-testid={`character-item-lock-${c.name}`}
                      >
                        {t('chat.lockedV', { value: String(c.version) })}
                      </span>
                    ) : c.anchorStatus === 'draft' ? (
                      <span className="ml-2 text-xs text-warning">{t('chat.draft')}</span>
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        <SidePanel
          open={selected !== undefined}
          width="wide"
          onClose={() => {
            setSelectedId(undefined)
          }}
        >
          {selected ? (
            <div className="space-y-4 p-6" data-testid="character-panel">
              <div className="sticky top-0 z-10 -mx-6 -mt-6 flex items-center justify-between bg-surface-raised/90 px-6 py-4 backdrop-blur-md">
                <h2 className="text-lg font-semibold">{selected.name}</h2>
                <Button
                  size="sm"
                  variant="ghost"
                  data-testid="character-panel-close"
                  onClick={() => {
                    setSelectedId(undefined)
                  }}
                >
                  {t('chat.close')}
                </Button>
              </div>
              <CharacterDetail
                character={selected}
                onChanged={replace}
                onDeleted={(id) => {
                  setCharacters((current) => current.filter((c) => c.id !== id))
                  setSelectedId(undefined)
                  // 刪光了就回到置中的空狀態
                  setCreating(false)
                }}
              />
            </div>
          ) : null}
        </SidePanel>
      </div>
    </Page>
  )
}
