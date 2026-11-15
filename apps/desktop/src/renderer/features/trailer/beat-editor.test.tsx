import type { ShotView } from '@svs/schema'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { appError, installFakeSvs } from '../../test/fake-svs'
import { choose } from '../../test/select'
import { BeatEditor } from './beat-editor'
import { beat } from './shots.fixture'

afterEach(cleanup)

const status = {
  exists: true,
  settings: { kind: 'story' },
  targetSec: 30,
  scriptSec: 30,
  beatCount: 3,
  matches: true,
  errors: [],
  warnings: [],
} as never

const setup = (shot: ShotView, handlers: Record<string, unknown> = {}) => {
  const update = vi.fn(() => shot)
  const seconds = vi.fn(() => status)
  installFakeSvs({
    'shots.update': update,
    'trailer.setBeatSeconds': seconds,
    ...(handlers as object),
  })
  render(<BeatEditor beat={shot} status={status} />)
  return { update, seconds }
}

const blur = (testId: string, value: string): void => {
  const field = screen.getByTestId(testId)
  fireEvent.change(field, { target: { value } })
  fireEvent.blur(field)
}

describe('BeatEditor：點一格在下面改', () => {
  it('依種類顯示欄位，沒有用的不出現：會動／不動／字卡／片名卡', () => {
    const has = (id: string) => screen.queryByTestId(id) !== null
    setup(beat(2, { dialogue: '一句' }))
    expect([
      has('beat-description'),
      has('beat-action'),
      has('beat-narration'),
      has('beat-camera'),
    ]).toEqual([true, true, true, false])
    cleanup()
    setup(beat(2, { beatKind: 'still' }))
    expect([
      has('beat-description'),
      has('beat-action'),
      has('beat-narration'),
      has('beat-camera'),
    ]).toEqual([true, false, true, true])
    cleanup()
    setup(beat(2, { beatKind: 'card', card: { text: '有些光', subtext: '' } }))
    expect([
      has('beat-card-text'),
      has('beat-card-subtext'),
      has('beat-description'),
      has('beat-narration'),
    ]).toEqual([true, true, false, false])
    expect(screen.queryByText(/入點|出點|原聲|再花一次/)).toBeNull()
    cleanup()
    setup(beat(13, { beatKind: 'title', durationSec: 4 }))
    expect(has('beat-title-note')).toBe(true)
    expect(has('beat-description')).toBe(false)
    expect(has('beat-kind-video')).toBe(false)
  })

  it('旁白旁邊寫「11／12 字」（格長 3 秒 × 4）；超過變警示色，仍然可以存', () => {
    const { update } = setup(beat(2, { durationSec: 3, dialogue: '一二三四五六七八九十一' }))
    expect(screen.getByTestId('beat-narration-count').textContent).toBe('11／12 字')
    expect(screen.getByTestId('beat-narration-count').dataset.over).toBe('false')
    blur('beat-narration', '一二三四五六七八九十一二三')
    expect(screen.getByTestId('beat-narration-count').dataset.over).toBe('true')
    expect(update).toHaveBeenCalledWith({
      shotId: 's2',
      patch: { dialogue: '一二三四五六七八九十一二三' },
    })
  })

  it('字卡的字旁邊寫「8／12 字」；沒改就不存', () => {
    const { update } = setup(
      beat(2, { beatKind: 'card', card: { text: '有些光要有人陪', subtext: '' } }),
    )
    expect(screen.getByTestId('beat-card-text-count').textContent).toBe('7／12 字')
    blur('beat-card-text', '有些光要有人陪')
    expect(update).not.toHaveBeenCalled()
    blur('beat-card-text', '有些光，要有人陪你')
    expect(update).toHaveBeenCalledWith({
      shotId: 's2',
      patch: { card: { text: '有些光，要有人陪你', subtext: '' } },
    })
  })

  it('秒數：[＋][−] 每按一次 0.25 秒；直接打數字也行；最短 0.25、最長 15', async () => {
    const { seconds } = setup(beat(2, { durationSec: 2.5 }))
    fireEvent.click(screen.getByTestId('beat-seconds-plus'))
    expect(seconds).toHaveBeenLastCalledWith({ shotId: 's2', durationSec: 2.75 })
    await waitFor(() => {
      expect(screen.getByTestId<HTMLButtonElement>('beat-seconds-plus').disabled).toBe(false)
    })
    fireEvent.click(screen.getByTestId('beat-seconds-minus'))
    expect(seconds).toHaveBeenLastCalledWith({ shotId: 's2', durationSec: 2.25 })
    await waitFor(() => {
      expect(screen.getByTestId<HTMLButtonElement>('beat-seconds-minus').disabled).toBe(false)
    })
    blur('beat-seconds-input', '4')
    expect(seconds).toHaveBeenLastCalledWith({ shotId: 's2', durationSec: 4 })
    await waitFor(() => {
      expect(screen.getByTestId<HTMLInputElement>('beat-seconds-input').disabled).toBe(false)
    })
    blur('beat-seconds-input', '99')
    expect(seconds).toHaveBeenLastCalledWith({ shotId: 's2', durationSec: 15 })
  })

  it('最短那一格：[−] 按不了；打了不是數字的字，還原成原本的秒數，不送出', () => {
    const { seconds } = setup(beat(2, { durationSec: 0.25 }))
    expect(screen.getByTestId<HTMLButtonElement>('beat-seconds-minus').disabled).toBe(true)
    blur('beat-seconds-input', 'abc')
    expect(seconds).not.toHaveBeenCalled()
    expect(screen.getByTestId<HTMLInputElement>('beat-seconds-input').value).toBe('0.25')
  })

  it('排不下：那句白話原樣顯示，欄位不動', async () => {
    const message = '其他格已經是最短了，這一格最多只能到 4.5 秒。'
    setup(beat(2, { durationSec: 2 }), {
      'trailer.setBeatSeconds': () => {
        throw appError(message)
      },
    })
    fireEvent.click(screen.getByTestId('beat-seconds-plus'))
    expect((await screen.findByTestId('beat-error')).textContent).toBe(message)
    expect(screen.getByTestId<HTMLInputElement>('beat-seconds-input').value).toBe('2')
  })

  it('種類：會動→不動直接存；改成字卡要先有字，字填好離開欄位才一起存', () => {
    const { update } = setup(beat(2))
    fireEvent.click(screen.getByTestId('beat-kind-still'))
    expect(update).toHaveBeenLastCalledWith({ shotId: 's2', patch: { beatKind: 'still' } })
    update.mockClear()
    fireEvent.click(screen.getByTestId('beat-kind-card'))
    expect(update).not.toHaveBeenCalled()
    expect(screen.getByTestId('beat-card-text')).toBeTruthy()
    expect(screen.queryByTestId('beat-description')).toBeNull()
    blur('beat-card-text', '有些光')
    expect(update).toHaveBeenCalledWith({
      shotId: 's2',
      patch: { beatKind: 'card', card: { text: '有些光', subtext: '' } },
    })
  })

  it('改畫面描述、段落：離開欄位才存；段落可以清掉', () => {
    const { update } = setup(beat(2, { segment: 'world' }))
    blur('beat-description', '黑藤爬滿斷橋')
    expect(update).toHaveBeenLastCalledWith({
      shotId: 's2',
      patch: { description: '黑藤爬滿斷橋' },
    })
    choose('beat-segment', 'turn')
    expect(update).toHaveBeenLastCalledWith({ shotId: 's2', patch: { segment: 'turn' } })
    choose('beat-segment', '')
    expect(update).toHaveBeenLastCalledWith({ shotId: 's2', patch: { segment: '' } })
  })
})
