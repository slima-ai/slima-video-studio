import type { HistoryChanged, IpcEventName } from '@svs/schema'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { ProjectManager } from '../project-manager'
import { runAsAi } from './ai-origin'
import { createHistoryService, outlineLabel, shotEditLabel } from './history-service'

const dirs: string[] = []
const projectsToClose: ProjectManager[] = []
afterEach(() => {
  for (const p of projectsToClose.splice(0)) p.close()
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

function setup() {
  const root = mkdtempSync(join(tmpdir(), 'svs-history-'))
  dirs.push(root)
  const projects = new ProjectManager('test')
  projectsToClose.push(projects)
  const events: HistoryChanged[] = []
  const history = createHistoryService({
    projects,
    broadcast: (name: IpcEventName, payload: unknown) => {
      if (name === 'history.changed') events.push(payload as HistoryChanged)
    },
  })
  return { root, projects, history, events }
}

describe('createHistoryService', () => {
  it('沒有開啟專案：編輯照常執行、什麼都不記，復原與重做回傳「沒做」', () => {
    const { history } = setup()
    expect(history.record('x', () => 42)).toBe(42)
    expect(history.state()).toMatchObject({ canUndo: false, canRedo: false })
    expect(history.undo()).toEqual({
      applied: false,
      state: { canUndo: false, canRedo: false },
    })
    expect(history.redo().applied).toBe(false)
  })

  it('記錄 → 復原 → 重做；每一步都廣播狀態，復原與重做才會讓 revision 加一', () => {
    const { root, projects, history, events } = setup()
    projects.create(join(root, 'a.svsproj'), 'A')
    const repos = projects.current()?.repos
    if (!repos) throw new Error('專案沒開起來')

    const act = history.record('新增一幕', () => repos.outline.addAct({ title: '序幕' }))
    expect(history.state()).toMatchObject({ canUndo: true, canRedo: false, undoLabel: '新增一幕' })
    expect(events.at(-1)).toMatchObject({ canUndo: true, revision: 0 })

    const undone = history.undo()
    expect(undone).toMatchObject({ applied: true, label: '新增一幕' })
    expect(undone.state).toMatchObject({ canUndo: false, canRedo: true, redoLabel: '新增一幕' })
    expect(repos.outline.listActs()).toHaveLength(0)
    expect(events.at(-1)).toMatchObject({ canRedo: true, revision: 1 })

    expect(history.redo()).toMatchObject({ applied: true, label: '新增一幕' })
    expect(repos.outline.listActs().map((a) => a.id)).toEqual([act.id])
    expect(events.at(-1)).toMatchObject({ canUndo: true, revision: 2 })

    // 沒有可重做的了
    expect(history.redo()).toMatchObject({ applied: false })
  })

  it('每個專案各有一份歷史；換專案之後不能復原到前一個專案的動作', () => {
    const { root, projects, history, events } = setup()
    projects.create(join(root, 'a.svsproj'), 'A')
    history.record('新增一幕', () => projects.current()?.repos.outline.addAct({ title: '甲' }))
    expect(history.state().canUndo).toBe(true)

    projects.create(join(root, 'b.svsproj'), 'B')
    expect(history.state()).toMatchObject({ canUndo: false, canRedo: false })
    expect(events.at(-1)).toMatchObject({ canUndo: false })
    expect(history.undo().applied).toBe(false)
  })

  it('clear：做了無法復原的大動作之後清空，並通知畫面', () => {
    const { root, projects, history, events } = setup()
    projects.create(join(root, 'a.svsproj'), 'A')
    history.record('新增一幕', () => projects.current()?.repos.outline.addAct({ title: '甲' }))
    history.clear()
    expect(history.state().canUndo).toBe(false)
    expect(events.at(-1)).toMatchObject({ canUndo: false })
  })

  it('編輯失敗就不記、也不改變狀態；復原失敗（資料對不上）丟出白話錯誤並讓這筆作廢', () => {
    const { root, projects, history } = setup()
    projects.create(join(root, 'a.svsproj'), 'A')
    const repos = projects.current()?.repos
    if (!repos) throw new Error('專案沒開起來')
    expect(() =>
      history.record('會失敗', () => {
        throw new Error('壞了')
      }),
    ).toThrow('壞了')
    expect(history.state().canUndo).toBe(false)

    const act = repos.outline.addAct({ title: '一' })
    const scene = repos.outline.addScene(act.id, { title: '街角' })
    history.record('刪除這個場', () => {
      repos.outline.deleteScene(scene.id)
    })
    repos.outline.deleteAct(act.id)
    expect(() => history.undo()).toThrow('沒辦法復原')
    expect(history.state().canUndo).toBe(false)
  })
})

describe('begin：背景跑一段時間的動作', () => {
  it('結束時記成一筆並通知畫面；結束前換了專案就不記', () => {
    const { root, projects, history, events } = setup()
    projects.create(join(root, 'a.svsproj'), 'A')
    const finish = history.begin('一句話生成')
    projects.current()?.repos.outline.addAct({ title: '長出來的' })
    finish()
    expect(history.state()).toMatchObject({ canUndo: true, undoLabel: '一句話生成' })
    expect(events.at(-1)).toMatchObject({ canUndo: true, undoLabel: '一句話生成' })
    history.undo()
    expect(projects.current()?.repos.outline.listActs()).toHaveLength(0)

    const late = history.begin('一句話生成')
    projects.create(join(root, 'b.svsproj'), 'B')
    expect(() => {
      late()
    }).not.toThrow()
    expect(history.state().canUndo).toBe(false)
  })

  it('還沒有專案（生成時才自動建）：結束時把整個內容記成這一筆', () => {
    const { root, projects, history } = setup()
    const finish = history.begin('一句話生成')
    projects.create(join(root, 'auto.svsproj'), '自動建立')
    projects.current()?.repos.outline.addAct({ title: '序幕' })
    finish()
    expect(history.state()).toMatchObject({ undoLabel: '一句話生成' })
    history.undo()
    expect(projects.current()?.repos.outline.listActs()).toHaveLength(0)
  })
})

describe('第一個動作自動建立專案', () => {
  it('還沒有專案時的第一個編輯會自動建專案；這個編輯也能復原（回到什麼都沒有）', () => {
    const { root, projects, history } = setup()
    expect(projects.current()).toBeUndefined()
    // 模擬服務：沒有專案時先建立一個，再新增
    history.record('新增一幕', () => {
      projects.create(join(root, 'auto.svsproj'), '自動建立')
      projects.current()?.repos.outline.addAct({ title: '序幕' })
    })
    expect(history.state()).toMatchObject({ canUndo: true, canRedo: false, undoLabel: '新增一幕' })
    history.undo()
    expect(projects.current()?.repos.outline.listActs()).toHaveLength(0)
    history.redo()
    expect(projects.current()?.repos.outline.listActs()).toHaveLength(1)
  })
})

describe('動作名稱', () => {
  it('大綱每一種編輯都有名稱', () => {
    expect(outlineLabel({ op: 'deleteScene', sceneId: 's' })).toBe('刪除這個場')
    expect(outlineLabel({ op: 'addLocation' })).toBe('新增地點')
  })

  it('只改一個欄位就指出是哪一個，改多個就統稱', () => {
    expect(shotEditLabel({ description: 'x' })).toBe('修改鏡頭的畫面描述')
    expect(shotEditLabel({ dialogue: 'x', mood: null })).toBe('修改鏡頭')
    expect(shotEditLabel({ action: '向左跳' })).toBe('修改鏡頭的動作')
  })

  it('beginAiTurn：AI（MCP）呼叫的改動併成一步、使用者的照舊各一步；最上面是 Claude 還開著的那一步時，復原被擋下', () => {
    const { root, projects, history } = setup()
    projects.create(join(root, 'ai.svsproj'), 'AI')
    const repos = projects.current()?.repos
    if (!repos) throw new Error('專案沒開起來')
    const end = history.beginAiTurn('Claude 這一輪')
    const asAi = <T>(run: () => T): T => runAsAi(run)
    asAi(() => history.record('新增一幕', () => repos.outline.addAct({ title: 'AI 一' })))
    asAi(() => history.record('新增一幕', () => repos.outline.addAct({ title: 'AI 二' })))
    // 最上面是 Claude 這一輪、還沒收尾：復原擋下
    expect(history.state()).toMatchObject({ undoCount: 1, undoLabel: 'Claude 這一輪' })
    expect(history.undo()).toMatchObject({ applied: false, blocked: 'ai_running' })
    expect(repos.outline.listActs()).toHaveLength(2)
    // 使用者自己做了一件事：它在最上面，可以復原，而且只退它
    history.record('新增一幕', () => repos.outline.addAct({ title: '我的' }))
    expect(history.state().undoCount).toBe(2)
    expect(history.undo()).toMatchObject({ applied: true, label: '新增一幕' })
    expect(repos.outline.listActs().map((a) => a.title)).toEqual(['AI 一', 'AI 二'])
    // 又被擋（最上面又是 Claude 的）；收尾之後就能一次退掉整輪
    expect(history.undo().blocked).toBe('ai_running')
    end()
    expect(history.undo()).toMatchObject({ applied: true, label: 'Claude 這一輪' })
    expect(repos.outline.listActs()).toHaveLength(0)
  })

  it('復原時這一步的內容後來又被改過：整步沒動回 skipped=all；正常的沒有這個欄位', () => {
    const { root, projects, history } = setup()
    projects.create(join(root, 'skip.svsproj'), 'S')
    const repos = projects.current()?.repos
    if (!repos) throw new Error('專案沒開起來')
    const act = history.record('新增一幕', () => repos.outline.addAct({ title: 'A' }))
    history.record('改名', () => repos.outline.updateAct(act.id, { title: 'B' }))
    // 別的地方又改了
    repos.outline.updateAct(act.id, { title: 'C' })
    const all = history.undo()
    expect(all).toMatchObject({ applied: true, label: '改名', skipped: 'all' })
    // 再按一次：退回更早的一步（新增那一幕），沒有略過
    const normal = history.undo()
    expect(normal.applied).toBe(true)
    expect(normal.skipped).toBeUndefined()
  })

  it('takeUserOps：使用者自己按的復原／重做依序記下（Claude 一輪帶著裡面各編輯的名稱）、取走就清掉；整步被略過的不算', () => {
    const { root, projects, history } = setup()
    projects.create(join(root, 'ops.svsproj'), 'OPS')
    const repos = projects.current()?.repos
    if (!repos) throw new Error('專案沒開起來')
    expect(history.takeUserOps()).toEqual([])
    const end = history.beginAiTurn('Claude 這一輪的改動')
    runAsAi(() => history.record('新增一幕', () => repos.outline.addAct({ title: 'AI 一' })))
    runAsAi(() => history.record('新增地點', () => repos.outline.addLocation({ name: '街角' })))
    end()
    history.record('新增一幕', () => repos.outline.addAct({ title: '我的' }))
    history.undo() // 退掉我自己的
    history.undo() // 退掉 Claude 這一輪
    history.redo()
    expect(history.takeUserOps()).toEqual([
      { direction: 'undo', label: '新增一幕', details: [] },
      { direction: 'undo', label: 'Claude 這一輪的改動', details: ['新增一幕', '新增地點'] },
      { direction: 'redo', label: 'Claude 這一輪的改動', details: ['新增一幕', '新增地點'] },
    ])
    // 取走就清掉
    expect(history.takeUserOps()).toEqual([])
    // 沒東西可復原（沒做事）不記
    history.undo()
    history.undo()
    history.undo()
    history.takeUserOps()
    expect(history.undo()).toMatchObject({ applied: false })
    expect(history.takeUserOps()).toEqual([])
  })

  it('沒有 beginAiTurn 時，AI 呼叫跟使用者的一樣各是一步（Claude Desktop 之類在面板外連進來）', () => {
    const { root, projects, history } = setup()
    projects.create(join(root, 'ai2.svsproj'), 'AI')
    const repos = projects.current()?.repos
    if (!repos) throw new Error('專案沒開起來')
    runAsAi(() => history.record('新增一幕', () => repos.outline.addAct({ title: 'A' })))
    runAsAi(() => history.record('新增一幕', () => repos.outline.addAct({ title: 'B' })))
    expect(history.state().undoCount).toBe(2)
    expect(history.undo().blocked).toBeUndefined()
  })
})
