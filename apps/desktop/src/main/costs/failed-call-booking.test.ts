import { afterEach, describe, expect, it, vi } from 'vitest'

import { createStudioHarness } from '../shots/test-harness'

// 花了錢的真呼叫，後面失敗（格式不對重試後還是不對）：那幾次的錢都要記帳，
// 專案還開著記專案帳本、專案已關掉記 App 層帳本。假文字模型每次回 US$0.37 但回的不是 JSON。
const COST = 0.37
const harnesses: ReturnType<typeof createStudioHarness>[] = []
afterEach(() => {
  for (const h of harnesses.splice(0)) h.cleanup()
})
const setup = () => {
  const h = createStudioHarness({ mockLlm: () => '這不是 JSON', mockCostUsd: () => COST })
  harnesses.push(h)
  return h
}
const projectTotal = (h: ReturnType<typeof setup>): number => {
  const handle = h.projects.current()
  return handle ? handle.repos.costs.totalUsd(handle.projectId) : 0
}

describe('花了錢但失敗的文字呼叫：兩次嘗試都記帳（格式不對會自動重試一次）', () => {
  it('拆分鏡（大綱的場）：記在專案帳本上，兩筆', async () => {
    const h = setup()
    h.outline.edit({ op: 'addAct' })
    const view = h.outline.edit({ op: 'addScene', actId: h.outline.get().acts[0]?.id ?? '' })
    const scene = view.acts[0]?.scenes[0]
    if (!scene) throw new Error('沒有場')
    await expect(h.storyboard.splitScene(scene.id)).rejects.toBeDefined()
    expect(projectTotal(h)).toBeCloseTo(2 * COST, 9)
    expect(h.ledger.totalUsd()).toBe(0)
  })

  it('大綱拆場（貼一段故事）：記帳，兩筆', async () => {
    const h = setup()
    await expect(h.outline.split('黑藤爬滿了斷橋。她一個人守著最後一盞燈。')).rejects.toBeDefined()
    expect(projectTotal(h)).toBeCloseTo(2 * COST, 9)
    expect(h.ledger.totalUsd()).toBe(0)
  })

  it('AI 整理固定外觀：記帳，兩筆', async () => {
    const h = setup()
    const hero = h.characters.create('阿鐵')
    h.characters.update(hero.id, { appearance: '瘦高、右眼有疤' })
    await expect(h.characters.suggestAnchor(hero.id)).rejects.toBeDefined()
    expect(projectTotal(h)).toBeCloseTo(2 * COST, 9)
  })
})

/** 任務做完、結果回到呼叫端的那一瞬間專案被關掉（任務佇列的 wait 一回來就關）。 */
function closeRightAfterJob(h: ReturnType<typeof createStudioHarness>): void {
  const queue = h.runtime.queue()
  if (!queue) throw new Error('應該有佇列')
  const wait = queue.wait.bind(queue)
  vi.spyOn(queue, 'wait').mockImplementation(async (id) => {
    const job = await wait(id)
    h.projects.close()
    return job
  })
}

describe('聲音：呼叫回來有金額，但專案在那一瞬間被關掉', () => {
  it('旁白：花的錢記在 App 層帳本（不是消失）', async () => {
    const h = createStudioHarness({ mockCostUsd: () => 0.05 })
    harnesses.push(h)
    await h.runQuickStart()
    const first = h.shots.list().shots[0]
    if (!first) throw new Error('應該有鏡頭')
    h.shots.update(first.id, { dialogue: '黑藤爬滿了斷橋。' })
    const before = h.ledger.totalUsd()
    closeRightAfterJob(h)
    await expect(h.sound.generateNarration({ shotId: first.id })).rejects.toThrow('專案')
    expect(h.ledger.totalUsd() - before).toBeCloseTo(0.05, 9)
  })

  it('配樂：同上', async () => {
    const h = createStudioHarness({ mockCostUsd: () => 0.08 })
    harnesses.push(h)
    await h.runQuickStart()
    const before = h.ledger.totalUsd()
    closeRightAfterJob(h)
    await expect(h.sound.generateMusic({})).rejects.toThrow('專案')
    expect(h.ledger.totalUsd() - before).toBeCloseTo(0.08, 9)
  })
})
