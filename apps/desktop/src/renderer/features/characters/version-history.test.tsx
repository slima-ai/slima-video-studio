import type { CharacterVersion, CharacterView } from '@svs/schema'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { installFakeSvs } from '../../test/fake-svs'
import { VersionHistory } from './version-history'

afterEach(cleanup)

const H = (c: string): string => c.repeat(64)
const character: CharacterView = {
  id: 'c1',
  name: '阿鐵',
  appearance: '短黑髮',
  personality: '',
  outfit: '',
  anchorText: '長白髮',
  anchorStatus: 'draft',
  version: 2,
  createdAt: '2026-10-12T00:00:00.000Z',
  updatedAt: '2026-10-12T00:00:00.000Z',
}
const version = (n: number, over: Partial<CharacterVersion> = {}): CharacterVersion => ({
  id: `p${String(n)}`,
  version: n,
  status: 'locked',
  anchorText: `描述 ${String(n)}`,
  current: false,
  createdAt: '2026-10-12T00:00:00.000Z',
  ...over,
})

describe('VersionHistory', () => {
  it('沒有任何版本時什麼都不顯示', async () => {
    installFakeSvs()
    const { container } = render(
      <VersionHistory character={character} onChanged={() => undefined} />,
    )
    await waitFor(() => {
      expect(container.textContent).toBe('')
    })
  })

  it('列出各版的狀態與目前使用中；舊版要先確認才還原，目前草稿會被換掉的話會先講', async () => {
    const restoreVersion = vi.fn(() => ({ ...character, anchorText: '描述 1' }))
    installFakeSvs({
      'characters.versions': () => ({
        versions: [
          version(2, { status: 'draft', current: true, heroAssetHash: H('h') }),
          version(1),
        ],
      }),
      'characters.restoreVersion': restoreVersion,
    })
    const changed = vi.fn()
    render(<VersionHistory character={character} onChanged={changed} />)

    const current = await screen.findByTestId('character-version-2')
    expect(current.getAttribute('data-current')).toBe('true')
    expect(current.textContent).toContain('草稿')
    expect(current.textContent).toContain('目前使用中')
    expect(screen.getByTestId('character-version-1').textContent).toContain('已鎖定')
    expect(screen.queryByTestId('character-version-restore-2')).toBeNull()

    fireEvent.click(screen.getByTestId('character-version-restore-1'))
    expect(screen.getByText('目前這一版草稿會被換掉。')).toBeTruthy()
    expect(restoreVersion).not.toHaveBeenCalled()
    fireEvent.click(screen.getByTestId('character-version-restore-confirm-1'))
    await waitFor(() => {
      expect(changed).toHaveBeenCalledTimes(1)
    })
    expect(restoreVersion).toHaveBeenCalledWith({ characterId: 'c1', versionId: 'p1' })
  })
})
