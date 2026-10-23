import { aiTurnUndoLabel, isAiTurnLabel, setLocale } from '@svs/schema'
import { afterEach, describe, expect, it } from 'vitest'

import { addLabel, outlineLabel, shotEditLabel } from './history/history-service'
import { isPlaceholderName } from './outline/outline-service'
import { isNewShotDescription, newShotDescription } from './shots/defaults'

afterEach(() => {
  setLocale('zh-TW')
})

describe('主行程給人看的名字：跟著介面語言', () => {
  it('復原清單的名稱：繁中照舊、英文是英文；改鏡頭欄位時英文欄位名小寫', () => {
    expect(outlineLabel({ op: 'addScene', actId: 'a' })).toBe('新增一個場')
    expect(addLabel('shot')).toBe('新增鏡頭')
    expect(shotEditLabel({ size: 'wide' })).toBe('修改鏡頭的景別')
    setLocale('en')
    expect(outlineLabel({ op: 'addScene', actId: 'a' })).toBe('Add a scene')
    expect(addLabel('shot')).toBe('Add a shot')
    expect(shotEditLabel({ size: 'wide' })).toBe('Edit shot’s shot size')
    expect(shotEditLabel({ description: 'x', size: 'wide' })).toBe('Edit shot')
  })

  it('預設名稱換過語言也認得：新的鏡頭、新的場與第 N 幕都算「還沒寫內容」；Claude 那一輪的名字兩種語言都認', () => {
    expect(isNewShotDescription(newShotDescription())).toBe(true)
    setLocale('en')
    expect(newShotDescription()).toBe('New shot')
    expect(isNewShotDescription('新的鏡頭')).toBe(true)
    expect(isNewShotDescription('New shot')).toBe(true)
    expect(isNewShotDescription('A cat walks')).toBe(false)
    for (const name of [
      '第 2 幕',
      'Act 2',
      '新的場',
      'New scene',
      '新的地點 3',
      'New location 3',
    ]) {
      expect(isPlaceholderName(name), name).toBe(true)
    }
    expect(isPlaceholderName('Old warehouse')).toBe(false)
    const english = aiTurnUndoLabel()
    setLocale('zh-TW')
    expect(isAiTurnLabel(english)).toBe(true)
    expect(isAiTurnLabel(aiTurnUndoLabel())).toBe(true)
    expect(isAiTurnLabel('新增鏡頭')).toBe(false)
  })
})
