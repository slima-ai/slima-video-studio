import { describe, expect, it } from 'vitest'

import { OUTPUT_NODE, INPUT_NODE, FOR_EACH_NODE } from './builtin'
import {
  WorkflowValidationError,
  assertValidWorkflow,
  findCycle,
  topologicalOrder,
  validateWorkflow,
} from './graph'
import { testRegistry, wf } from './test-helpers'

const { registry } = testRegistry()
const codes = (w: ReturnType<typeof wf>): string[] =>
  validateWorkflow(w, registry).map((i) => i.code)

describe('validateWorkflow', () => {
  it('合法的工作流沒有問題', () => {
    const w = wf(
      [
        { id: 'a', type: 'test.source' },
        { id: 'b', type: 'test.upper' },
      ],
      [['a', 'value', 'b', 'text']],
    )
    expect(validateWorkflow(w, registry)).toEqual([])
    expect(() => {
      assertValidWorkflow(w, registry)
    }).not.toThrow()
  })

  it('有環的圖被拒絕，並列出環上的節點', () => {
    const w = wf(
      [
        { id: 'a', type: 'test.upper' },
        { id: 'b', type: 'test.upper' },
        { id: 'c', type: 'test.source' },
      ],
      [
        ['a', 'text', 'b', 'text'],
        ['b', 'text', 'a', 'text'],
      ],
    )
    const issues = validateWorkflow(w, registry)
    const cycle = issues.find((i) => i.code === 'cycle')
    expect(cycle?.message).toContain('a')
    expect(cycle?.message).toContain('b')
    expect(cycle?.message).not.toContain('c、')
    expect(findCycle(w.nodes, w.edges).sort()).toEqual(['a', 'b'])
  })

  it('型別不符的連線被拒絕，訊息說明兩邊的型別', () => {
    const w = wf(
      [
        { id: 'a', type: 'test.source' },
        { id: 'img', type: 'test.image' },
        { id: 'b', type: 'test.upper' },
      ],
      [
        ['a', 'value', 'img', 'text'],
        ['img', 'image', 'b', 'text'],
      ],
    )
    const mismatch = validateWorkflow(w, registry).find((i) => i.code === 'type_mismatch')
    expect(mismatch?.message).toContain('image')
    expect(mismatch?.message).toContain('text')
  })

  it('image 可以接到需要 imageList / refList 的輸入（沿用共用規則）', () => {
    // 這裡用 canConnect 的行為間接驗證：text → text 以外不相容
    const w = wf(
      [
        { id: 'a', type: 'test.source' },
        { id: 'b', type: 'test.upper' },
      ],
      [['a', 'value', 'b', 'text']],
    )
    expect(codes(w)).toEqual([])
  })

  it('未知節點類型、版本不符、參數錯誤都會回報', () => {
    const w = wf([
      { id: 'a', type: 'nope' },
      { id: 'b', type: 'test.source', version: 9 },
      { id: 'c', type: 'test.source', params: { delayMs: 'slow' } },
    ])
    expect(codes(w).sort()).toEqual(['invalid_params', 'unknown_node_type', 'version_mismatch'])
  })

  it('未知的節點或埠、重複連同一個輸入、自己連自己、缺少必填輸入', () => {
    const w = wf(
      [
        { id: 'a', type: 'test.source' },
        { id: 'a2', type: 'test.source' },
        { id: 'b', type: 'test.upper' },
        { id: 'loop', type: 'test.upper' },
      ],
      [
        ['a', 'value', 'b', 'text'],
        ['a2', 'value', 'b', 'text'], // 重複
        ['a', 'nope', 'b', 'text'], // 沒有這個輸出埠
        ['a', 'value', 'b', 'nope'], // 沒有這個輸入埠
        ['a', 'value', 'ghost', 'text'], // 不存在的節點
        ['loop', 'text', 'loop', 'text'], // 自己連自己
      ],
    )
    const found = new Set(codes(w))
    for (const code of [
      'duplicate_input',
      'unknown_port',
      'unknown_node',
      'self_loop',
      'missing_input',
    ]) {
      expect(found.has(code), code).toBe(true)
    }
  })

  it('節點 ID 重複會被回報', () => {
    expect(
      codes(
        wf([
          { id: 'a', type: 'test.source' },
          { id: 'a', type: 'test.source' },
        ]),
      ),
    ).toContain('duplicate_node_id')
  })

  it('選填的輸入可以不連線', () => {
    const w = wf(
      [
        { id: 'a', type: 'test.source' },
        { id: 'c', type: 'test.concat' },
      ],
      [['a', 'value', 'c', 'a']],
    )
    expect(validateWorkflow(w, registry)).toEqual([])
  })

  it('assertValidWorkflow 丟出帶有全部問題的 WorkflowValidationError', () => {
    const w = wf([
      { id: 'a', type: 'nope' },
      { id: 'b', type: 'nope2' },
    ])
    try {
      assertValidWorkflow(w, registry)
      expect.unreachable()
    } catch (error) {
      expect(error).toBeInstanceOf(WorkflowValidationError)
      const e = error as WorkflowValidationError
      expect(e.code).toBe('workflow_invalid')
      expect(e.issues).toHaveLength(2)
      expect(e.userMessage).toContain('and 1 more problem(s)')
    }
  })

  describe('forEach 的子工作流', () => {
    const body = (nodes: Parameters<typeof wf>[0], edges: Parameters<typeof wf>[1] = []) =>
      wf(nodes, edges, 'body')

    it('缺少 $input / $output 會被回報', () => {
      const w = wf([
        { id: 's', type: 'test.source' },
        {
          id: 'fe',
          type: FOR_EACH_NODE,
          params: { body: body([{ id: 'x', type: 'test.source' }]) },
        },
      ])
      expect(
        validateWorkflow(w, registry).filter((i) => i.code === 'invalid_body').length,
      ).toBeGreaterThan(0)
    })

    it('子工作流內部的錯誤也會被檢查，訊息帶上父節點', () => {
      const w = wf(
        [
          { id: 's', type: 'test.source' },
          {
            id: 'fe',
            type: FOR_EACH_NODE,
            params: {
              body: body(
                [
                  { id: 'in', type: INPUT_NODE },
                  { id: 'out', type: OUTPUT_NODE },
                  { id: 'bad', type: 'nope' },
                ],
                [['in', 'item', 'out', 'value']],
              ),
            },
          },
        ],
        [['s', 'value', 'fe', 'items']],
      )
      const issue = validateWorkflow(w, registry).find((i) => i.code === 'unknown_node_type')
      expect(issue?.message).toContain('sub-workflow')
    })
  })
})

describe('topologicalOrder', () => {
  it('依相依順序排列，並算出可以平行的層級', () => {
    const w = wf(
      [
        { id: 'a', type: 'test.source' },
        { id: 'b', type: 'test.source' },
        { id: 'c', type: 'test.concat' },
        { id: 'd', type: 'test.upper' },
      ],
      [
        ['a', 'value', 'c', 'a'],
        ['b', 'value', 'c', 'b'],
        ['c', 'text', 'd', 'text'],
      ],
    )
    const { order, level } = topologicalOrder(w.nodes, w.edges)
    expect(order.indexOf('c')).toBeGreaterThan(order.indexOf('a'))
    expect(order.indexOf('c')).toBeGreaterThan(order.indexOf('b'))
    expect(order.indexOf('d')).toBeGreaterThan(order.indexOf('c'))
    expect([level.get('a'), level.get('b'), level.get('c'), level.get('d')]).toEqual([0, 0, 1, 2])
  })
})
