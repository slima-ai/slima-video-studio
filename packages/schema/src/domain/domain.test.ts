import { describe, expect, expectTypeOf, it } from 'vitest'
import type { z } from 'zod'

import {
  ActSchema,
  AssetSchema,
  CharacterPackSchema,
  CharacterSchema,
  CostEntrySchema,
  JobSchema,
  LocationSchema,
  NodeRunSchema,
  PortTypeSchema,
  ProjectSchema,
  RunSchema,
  SceneSchema,
  ShotSchema,
  SlimaLinkSchema,
  StyleSchema,
  TakeSchema,
  WorkflowSchema,
  isPortCompatible,
  type PortType,
  type Shot,
} from '../index'

const NOW = '2026-10-12T07:36:49.000Z'
const HASH = 'a'.repeat(64)
const HASH2 = 'b'.repeat(64)

/** parse → serialize（JSON）→ parse，結果必須相同。 */
function roundTrip<S extends z.ZodType>(schema: S, value: unknown): z.output<S> {
  const parsed = schema.parse(value)
  const reparsed = schema.parse(JSON.parse(JSON.stringify(parsed)))
  expect(reparsed).toEqual(parsed)
  return parsed
}

const fixtures = {
  project: [
    ProjectSchema,
    { id: 'p1', name: '我的短片', schemaVersion: 1, createdAt: NOW, updatedAt: NOW },
  ],
  act: [ActSchema, { id: 'a1', projectId: 'p1', title: '第一幕', order: 0 }],
  scene: [
    SceneSchema,
    { id: 's1', projectId: 'p1', actId: 'a1', title: '咖啡廳', order: 0, estimatedSeconds: 12 },
  ],
  shot: [
    ShotSchema,
    {
      id: 'sh1',
      projectId: 'p1',
      sceneId: 's1',
      number: 1,
      order: 0,
      characters: [{ characterId: 'c1', costumeId: 'k1' }],
    },
  ],
  take: [
    TakeSchema,
    {
      id: 't1',
      shotId: 'sh1',
      kind: 'video',
      version: 2,
      assetHash: HASH,
      modelId: 'kling-3.0',
      createdAt: NOW,
    },
  ],
  style: [StyleSchema, { id: 'st1', name: '日系動畫', kind: 'anime', palette: ['#ff8800'] }],
  character: [
    CharacterSchema,
    {
      id: 'c1',
      projectId: 'p1',
      name: '阿鐵',
      costumes: [{ id: 'k1', name: '工作服' }],
      voices: { elevenlabs: 'voice-1' },
      createdAt: NOW,
      updatedAt: NOW,
    },
  ],
  characterPack: [
    CharacterPackSchema,
    {
      id: 'cp1',
      characterId: 'c1',
      version: 1,
      status: 'locked',
      anchorText: '黑色短髮、琥珀色眼睛、左耳銀色耳環',
      heroAssetHash: HASH,
      turnaround: { front: HASH, side: HASH2, back: HASH },
      createdAt: NOW,
    },
  ],
  location: [
    LocationSchema,
    { id: 'l1', projectId: 'p1', name: '咖啡廳', angleAssetHashes: [HASH] },
  ],
  workflow: [
    WorkflowSchema,
    {
      id: 'w1',
      name: '快速開始',
      nodes: [
        { id: 'n1', type: 'llm.breakdown', version: 1, params: { shots: 5 } },
        {
          id: 'n2',
          type: 'image.generate',
          version: 1,
          modelId: 'nano-banana-2',
          position: { x: 10, y: 20 },
        },
      ],
      edges: [
        { id: 'e1', from: { nodeId: 'n1', port: 'shots' }, to: { nodeId: 'n2', port: 'shot' } },
      ],
      createdAt: NOW,
      updatedAt: NOW,
    },
  ],
  asset: [
    AssetSchema,
    {
      hash: HASH,
      kind: 'video',
      mime: 'video/mp4',
      bytes: 1024,
      width: 1920,
      height: 1080,
      durationSec: 3,
      createdAt: NOW,
    },
  ],
  run: [
    RunSchema,
    {
      id: 'r1',
      projectId: 'p1',
      workflowId: 'w1',
      status: 'running',
      startedAt: NOW,
      createdAt: NOW,
    },
  ],
  nodeRun: [
    NodeRunSchema,
    {
      id: 'nr1',
      runId: 'r1',
      nodeId: 'n1',
      status: 'failed',
      cacheKey: HASH,
      error: { code: 'internal_error', retryable: true, userMessage: '失敗了' },
    },
  ],
  job: [
    JobSchema,
    {
      id: 'j1',
      provider: 'fal',
      modelId: 'kling-3.0',
      kind: 'video',
      status: 'polling',
      providerJobId: 'req-123',
      createdAt: NOW,
      updatedAt: NOW,
    },
  ],
  costEntry: [
    CostEntrySchema,
    {
      id: 'ce1',
      projectId: 'p1',
      provider: 'fal',
      modelId: 'kling-3.0',
      amountUsd: 0.42,
      estimated: true,
      createdAt: NOW,
    },
  ],
  slimaLink: [
    SlimaLinkSchema,
    {
      id: 'sl1',
      projectId: 'p1',
      entityType: 'character',
      entityId: 'c1',
      bookToken: 'bk_abc',
      path: '.script_studio/characters/hero.character',
      importedAt: NOW,
    },
  ],
} satisfies Record<string, readonly [z.ZodType, unknown]>

describe('領域 schema round-trip', () => {
  it.each(Object.entries(fixtures))(
    '%s：parse → serialize → parse 結果相同',
    (_name, [schema, value]) => {
      roundTrip(schema, value)
    },
  )
})

describe('預設值', () => {
  it('Shot 補上預設的景別、角度、時長、狀態', () => {
    const shot = roundTrip(ShotSchema, { id: 'sh', projectId: 'p', number: 1, order: 0 })
    expect(shot).toMatchObject({
      size: 'medium',
      angle: 'eye_level',
      cameraMove: null,
      durationSec: 3,
      status: 'draft',
      characters: [],
    })
  })

  it('Project 預設 16:9、單次預算 US$5', () => {
    const project = roundTrip(ProjectSchema, fixtures.project[1])
    expect(project.aspectRatio).toBe('16:9')
    expect(project.budget.perRunLimitUsd).toBe(5)
  })

  it('CharacterPack 預設為草稿', () => {
    const pack = CharacterPackSchema.parse({
      id: 'x',
      characterId: 'c',
      version: 1,
      createdAt: NOW,
    })
    expect(pack.status).toBe('draft')
  })

  it('Job 預設重試次數', () => {
    const job = JobSchema.parse(fixtures.job[1])
    expect(job.attempt).toBe(0)
    expect(job.maxAttempts).toBe(3)
  })
})

describe('拒絕不合法的資料', () => {
  it('素材雜湊必須是 64 碼 sha256', () => {
    expect(TakeSchema.safeParse({ ...fixtures.take[1], assetHash: 'abc' }).success).toBe(false)
    expect(TakeSchema.safeParse({ ...fixtures.take[1], assetHash: 'A'.repeat(64) }).success).toBe(
      false,
    )
  })

  it('時間必須是 ISO 8601', () => {
    expect(ProjectSchema.safeParse({ ...fixtures.project[1], createdAt: '昨天' }).success).toBe(
      false,
    )
  })

  it('鏡頭時長必須為正、鏡號必須為正整數', () => {
    const base = { id: 'sh', projectId: 'p', number: 1, order: 0 }
    expect(ShotSchema.safeParse({ ...base, durationSec: 0 }).success).toBe(false)
    expect(ShotSchema.safeParse({ ...base, durationSec: -1 }).success).toBe(false)
    expect(ShotSchema.safeParse({ ...base, number: 0 }).success).toBe(false)
    expect(ShotSchema.safeParse({ ...base, size: 'huge' }).success).toBe(false)
  })

  it('風格色碼必須是 #RRGGBB', () => {
    expect(
      StyleSchema.safeParse({ id: 's', name: 'n', kind: 'anime', palette: ['red'] }).success,
    ).toBe(false)
  })

  it('花費不能是負數', () => {
    expect(CostEntrySchema.safeParse({ ...fixtures.costEntry[1], amountUsd: -1 }).success).toBe(
      false,
    )
  })

  it('NodeRun 的錯誤必須是型別化的 AppError 形狀', () => {
    expect(
      NodeRunSchema.safeParse({
        ...fixtures.nodeRun[1],
        error: { message: '供應商原始錯誤' },
      }).success,
    ).toBe(false)
  })
})

describe('節點埠型別', () => {
  const ALL = PortTypeSchema.options

  it('包含計畫中的九種埠型別', () => {
    expect([...ALL].sort()).toEqual(
      [
        'audio',
        'characterRef',
        'image',
        'imageList',
        'json',
        'refList',
        'shot',
        'text',
        'video',
      ].sort(),
    )
  })

  it('相同型別一律可以連', () => {
    for (const t of ALL) expect(isPortCompatible(t, t)).toBe(true)
  })

  it('image 可以接到 imageList；imageList 不能接到 image', () => {
    expect(isPortCompatible('image', 'imageList')).toBe(true)
    expect(isPortCompatible('imageList', 'image')).toBe(false)
  })

  it('image / imageList / characterRef 可以接到 refList', () => {
    expect(isPortCompatible('image', 'refList')).toBe(true)
    expect(isPortCompatible('imageList', 'refList')).toBe(true)
    expect(isPortCompatible('characterRef', 'refList')).toBe(true)
    expect(isPortCompatible('video', 'refList')).toBe(false)
  })

  it('其餘跨型別一律不能連（只有 json 是萬用輸入）', () => {
    const allowed = new Set([
      'image>imageList',
      'image>refList',
      'imageList>refList',
      'characterRef>refList',
    ])
    for (const from of ALL as readonly PortType[]) {
      for (const to of ALL as readonly PortType[]) {
        if (from === to) continue
        expect(isPortCompatible(from, to), `${from} → ${to}`).toBe(
          to === 'json' || allowed.has(`${from}>${to}`),
        )
      }
    }
  })
})

describe('型別由 Zod 推導', () => {
  it('Shot 的型別反映預設值後的輸出', () => {
    expectTypeOf<Shot['durationSec']>().toEqualTypeOf<number>()
    expectTypeOf<Shot['cameraMove']>().toEqualTypeOf<string | null>()
    expectTypeOf<Shot['characters'][number]['name']>().toEqualTypeOf<string | undefined>()
  })
})
