import { describe, expect, it } from 'vitest'

import { describeHistoryNote } from './history-note'

const AI = 'Claude 這一輪的改動'
const undo = (label: string, details: string[] = []) => ({
  direction: 'undo' as const,
  label,
  details,
})
const redo = (label: string, details: string[] = []) => ({
  direction: 'redo' as const,
  label,
  details,
})

describe('describeHistoryNote：使用者在兩句話之間按過復原／重做 → 給 Claude 的 App 附註', () => {
  it('沒按過：什麼都不附', () => {
    expect(describeHistoryNote([])).toBeUndefined()
  })

  it('復原了 Claude 那一輪：寫出撤回了什麼（歷史的名稱，含那一輪的各個編輯），並說是使用者的決定、不要改回去', () => {
    const note = describeHistoryNote([undo(AI, ['修改鏡頭的景別'])])
    expect(note).toContain('App 附註')
    expect(note).toContain('撤回了：Claude 這一輪的改動（修改鏡頭的景別）')
    expect(note).toContain('這是使用者的決定，不要把它改回去')
    expect(note).toContain('不確定就先問他')
  })

  it('復原好幾步：都列出來，順序照按的順序', () => {
    const note = describeHistoryNote([undo('新增鏡頭'), undo(AI, ['刪除鏡頭'])])
    expect(note).toContain('撤回了：新增鏡頭；Claude 這一輪的改動（刪除鏡頭）')
  })

  it('復原後又重做同一步：寫清楚最後的狀態跟之前一樣，沒有說「撤回」', () => {
    const note = describeHistoryNote([undo(AI, ['修改鏡頭']), redo(AI, ['修改鏡頭'])])
    expect(note).toContain('按了復原又重做，最後的狀態跟之前一樣，沒有變')
    expect(note).not.toContain('撤回了')
  })

  it('復原兩步、重做一步：重做的是最近被復原的那一步，所以還有一步是退掉的', () => {
    const note = describeHistoryNote([undo('A步'), undo('B步'), redo('B步')])
    expect(note).toContain('撤回了：A步')
    expect(note).not.toContain('B步')
  })

  it('只重做（這段時間之前就被復原的步驟又被套回來）：說重新套用了什麼', () => {
    const note = describeHistoryNote([redo(AI, ['修改鏡頭的景別'])])
    expect(note).toContain('重新套用了：Claude 這一輪的改動（修改鏡頭的景別）')
    expect(note).not.toContain('撤回了')
  })

  it('又有撤回又有重新套用：兩邊都寫', () => {
    const note = describeHistoryNote([redo('X步'), undo('Y步')])
    expect(note).toContain('撤回了：Y步')
    expect(note).toContain('重新套用了：X步')
  })
})
