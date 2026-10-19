import { AppError, type Job } from '@svs/schema'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { JobDriver, PollResult, SubmitResult } from './driver'
import { MemoryJobStore } from './job-store'
import { JobQueue, type JobQueueOptions } from './queue'

const START = new Date('2026-10-12T08:00:00.000Z')

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(START)
})
afterEach(() => {
  vi.useRealTimers()
})

const tick = async (ms = 0): Promise<void> => {
  await vi.advanceTimersByTimeAsync(ms)
}

const rateLimited = (retryAfterMs?: number): AppError =>
  new AppError({
    code: 'provider_rate_limited',
    retryable: true,
    userMessage: '請求太頻繁。',
    ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
  })
const unauthorized = (): AppError =>
  new AppError({ code: 'provider_auth_failed', retryable: false, userMessage: 'API Key 無效。' })

/** 假供應商：每個方法都記錄呼叫，結果由測試用 script 決定。 */
class FakeDriver implements JobDriver {
  submits: { job: Job; at: number; signal: AbortSignal }[] = []
  polls: Job[] = []
  cancels: Job[] = []
  submitScript: (() => Promise<SubmitResult> | SubmitResult)[] = []
  pollScript: (() => Promise<PollResult> | PollResult)[] = []
  submitFallback: () => Promise<SubmitResult> | SubmitResult = () => ({
    status: 'done',
    output: 'ok',
  })

  submit = (job: Job, ctx: { signal: AbortSignal }): Promise<SubmitResult> => {
    this.submits.push({ job, at: Date.now(), signal: ctx.signal })
    return Promise.resolve((this.submitScript.shift() ?? this.submitFallback)())
  }
  poll = (job: Job): Promise<PollResult> => {
    this.polls.push(job)
    const step = this.pollScript.shift()
    return Promise.resolve(step ? step() : { status: 'pending' })
  }
  cancel = (job: Job): Promise<void> => {
    this.cancels.push(job)
    return Promise.resolve()
  }
}

function setup(driver = new FakeDriver(), extra: Partial<JobQueueOptions> = {}) {
  const store = new MemoryJobStore()
  let n = 0
  const queue = new JobQueue({
    store,
    drivers: { fal: driver },
    newId: () => `job-${String(++n)}`,
    random: () => 0.5, // 抖動係數 = 1，退避時間可精確計算
    backoff: { baseMs: 1000, maxMs: 8000 },
    defaultLimits: { pollIntervalMs: 1000 },
    ...extra,
  })
  queue.start()
  return { driver, store, queue }
}

const spec = { provider: 'fal', modelId: 'kling-3.0', kind: 'video' as const, input: { p: 1 } }

describe('基本流程', () => {
  it('同步完成的任務：queued → running → succeeded，並帶出輸出與花費', async () => {
    const driver = new FakeDriver()
    driver.submitFallback = () => ({ status: 'done', output: { text: '你好' }, costUsd: 0.01 })
    const { queue } = setup(driver)
    const seen: string[] = []
    queue.subscribe((j) => seen.push(j.status))

    const job = queue.enqueue(spec)
    expect(job).toMatchObject({ status: 'queued', attempt: 0, maxAttempts: 3, input: { p: 1 } })
    const done = await queue.wait(job.id)

    expect(done).toMatchObject({
      status: 'succeeded',
      attempt: 1,
      output: { text: '你好' },
      costUsd: 0.01,
    })
    expect(seen).toEqual(['queued', 'running', 'succeeded'])
  })

  it('長任務：submitted → polling → succeeded，輪詢間隔依設定', async () => {
    const driver = new FakeDriver()
    driver.submitScript = [() => ({ status: 'submitted', providerJobId: 'req-1' })]
    driver.pollScript = [
      () => ({ status: 'pending' }),
      () => ({ status: 'pending' }),
      () => ({ status: 'done', output: 'https://x/y.mp4' }),
    ]
    const { queue } = setup(driver)
    const seen: string[] = []
    queue.subscribe((j) => seen.push(j.status))
    const job = queue.enqueue(spec)

    await tick(0)
    expect(queue.get(job.id)).toMatchObject({ status: 'submitted', providerJobId: 'req-1' })
    expect(driver.polls).toHaveLength(0)

    await tick(1000)
    expect(driver.polls).toHaveLength(1)
    expect(queue.get(job.id)?.status).toBe('polling')
    await tick(1000)
    await tick(1000)

    const done = await queue.wait(job.id)
    expect(done).toMatchObject({ status: 'succeeded', output: 'https://x/y.mp4' })
    expect(driver.submits).toHaveLength(1)
    expect(driver.polls).toHaveLength(3)
    expect(driver.polls.every((j) => j.providerJobId === 'req-1')).toBe(true)
    expect(seen).toEqual(['queued', 'running', 'submitted', 'polling', 'succeeded'])
  })

  it('wait 對已完成的任務立刻回傳；找不到的任務與供應商會回報錯誤', async () => {
    const { queue } = setup()
    const job = queue.enqueue(spec)
    await queue.wait(job.id)
    await expect(queue.wait(job.id)).resolves.toMatchObject({ status: 'succeeded' })
    expect(() => queue.wait('nope')).toThrow(/找不到任務/)
    expect(() => queue.enqueue({ ...spec, provider: 'ghost' })).toThrow(/找不到供應商/)
  })

  it('取消訂閱後不再收到通知；list 可依狀態過濾', async () => {
    const { queue } = setup()
    const listener = vi.fn()
    const off = queue.subscribe(listener)
    const a = queue.enqueue(spec)
    await queue.wait(a.id)
    const calls = listener.mock.calls.length
    off()
    const b = queue.enqueue(spec)
    await queue.wait(b.id)
    expect(listener).toHaveBeenCalledTimes(calls)
    expect(queue.list({ statuses: ['succeeded'] })).toHaveLength(2)
    expect(queue.list({ statuses: ['failed'] })).toHaveLength(0)
  })
})

describe('重試與退避', () => {
  it('429 會指數退避重試：1s、2s 後第三次成功', async () => {
    const driver = new FakeDriver()
    driver.submitScript = [
      () => {
        throw rateLimited()
      },
      () => {
        throw rateLimited()
      },
    ]
    const { queue } = setup(driver)
    const job = queue.enqueue(spec)

    await tick(0)
    expect(queue.get(job.id)).toMatchObject({
      status: 'queued',
      attempt: 1,
      error: { code: 'provider_rate_limited', retryable: true },
      nextRunAt: new Date(START.getTime() + 1000).toISOString(),
    })
    await tick(999)
    expect(driver.submits).toHaveLength(1)
    await tick(1)
    expect(driver.submits).toHaveLength(2)
    expect(queue.get(job.id)?.nextRunAt).toBe(new Date(START.getTime() + 1000 + 2000).toISOString())
    await tick(2000)

    const done = await queue.wait(job.id)
    expect(done).toMatchObject({ status: 'succeeded', attempt: 3 })
    expect(done.error).toBeUndefined()
    expect(done.nextRunAt).toBeUndefined()
    expect(driver.submits.map((s) => s.at - START.getTime())).toEqual([0, 1000, 3000])
  })

  it('供應商指定 Retry-After 時照它等；退避時間不超過上限', async () => {
    const driver = new FakeDriver()
    driver.submitScript = [
      () => {
        throw rateLimited(7500)
      },
    ]
    const { queue } = setup(driver)
    const job = queue.enqueue({ ...spec, maxAttempts: 10 })
    await tick(0)
    expect(queue.get(job.id)?.nextRunAt).toBe(new Date(START.getTime() + 7500).toISOString())

    const capped = new FakeDriver()
    capped.submitFallback = () => {
      throw rateLimited()
    }
    const second = setup(capped)
    const j2 = second.queue.enqueue({ ...spec, maxAttempts: 10 })
    // 1s、2s、4s、8s、8s（上限）
    const waits: number[] = []
    for (let i = 0; i < 5; i++) {
      await tick(0)
      const at = Date.parse(second.queue.get(j2.id)?.nextRunAt ?? '')
      waits.push(at - Date.now())
      await tick(at - Date.now())
    }
    expect(waits).toEqual([1000, 2000, 4000, 8000, 8000])
  })

  it('401 這類不可重試的錯誤只送一次就失敗，錯誤訊息是整理過的', async () => {
    const driver = new FakeDriver()
    driver.submitFallback = () => {
      throw unauthorized()
    }
    const { queue } = setup(driver)
    const job = queue.enqueue(spec)
    const done = await queue.wait(job.id)
    expect(done).toMatchObject({
      status: 'failed',
      attempt: 1,
      error: { code: 'provider_auth_failed', retryable: false, userMessage: 'API Key 無效。' },
    })
    await tick(60_000)
    expect(driver.submits).toHaveLength(1)
  })

  it('重試用完後失敗，保留最後一次的錯誤', async () => {
    const driver = new FakeDriver()
    driver.submitFallback = () => {
      throw rateLimited()
    }
    const { queue } = setup(driver)
    const job = queue.enqueue({ ...spec, maxAttempts: 2 })
    await tick(0)
    await tick(1000)
    const done = await queue.wait(job.id)
    expect(done).toMatchObject({ status: 'failed', attempt: 2 })
    expect(done.error?.code).toBe('provider_rate_limited')
    expect(done.nextRunAt).toBeUndefined()
  })

  it('driver 丟出不明錯誤：視為內部錯誤、不重試，原始錯誤只交給 onUnexpectedError', async () => {
    const driver = new FakeDriver()
    driver.submitFallback = () => {
      throw new TypeError('fetch failed: secret-token')
    }
    const onUnexpectedError = vi.fn()
    const { queue } = setup(driver, { onUnexpectedError })
    const done = await queue.wait(queue.enqueue(spec).id)
    expect(done.status).toBe('failed')
    expect(done.error).toEqual({
      code: 'internal_error',
      retryable: false,
      userMessage: '任務執行時發生未預期的錯誤。',
    })
    expect(JSON.stringify(done)).not.toContain('secret-token')
    expect(onUnexpectedError).toHaveBeenCalledTimes(1)
  })

  it('手動重試：失敗或取消的任務重新排隊並歸零次數；成功的不能重試', async () => {
    const driver = new FakeDriver()
    driver.submitScript = [
      () => {
        throw unauthorized()
      },
    ]
    const { queue } = setup(driver)
    const job = queue.enqueue(spec)
    await queue.wait(job.id)

    const retried = queue.retry(job.id)
    expect(retried).toMatchObject({ status: 'queued', attempt: 0 })
    expect(retried.error).toBeUndefined()
    const done = await queue.wait(job.id)
    expect(done).toMatchObject({ status: 'succeeded', attempt: 1 })
    expect(() => queue.retry(job.id)).toThrow(/只有失敗或已取消/)
  })
})

describe('輪詢錯誤', () => {
  it('輪詢遇到暫時性錯誤只會稍後再問，不會重送任務', async () => {
    const driver = new FakeDriver()
    driver.submitScript = [() => ({ status: 'submitted', providerJobId: 'req-1' })]
    driver.pollScript = [
      () => {
        throw new AppError({ code: 'provider_unavailable', retryable: true, userMessage: '503' })
      },
      () => ({ status: 'done', output: 'ok' }),
    ]
    const { queue } = setup(driver)
    const job = queue.enqueue(spec)
    await tick(1000) // 第一次輪詢失敗，退避 1s
    await tick(1000)
    const done = await queue.wait(job.id)
    expect(done.status).toBe('succeeded')
    expect(driver.submits).toHaveLength(1)
    expect(driver.polls).toHaveLength(2)
  })

  it('連續輪詢失敗太多次就放棄；不可重試的輪詢錯誤立刻失敗', async () => {
    const flaky = new FakeDriver()
    flaky.submitScript = [() => ({ status: 'submitted', providerJobId: 'req-1' })]
    flaky.poll = (job) => {
      flaky.polls.push(job)
      return Promise.reject(
        new AppError({ code: 'provider_timeout', retryable: true, userMessage: '逾時' }),
      )
    }
    const a = setup(flaky, { maxPollErrors: 2 })
    const job = a.queue.enqueue(spec)
    await tick(1000)
    for (let i = 0; i < 10; i++) await tick(2000)
    expect((await a.queue.wait(job.id)).error?.code).toBe('provider_timeout')
    expect(flaky.polls).toHaveLength(3)
    expect(flaky.submits).toHaveLength(1)

    const denied = new FakeDriver()
    denied.submitScript = [() => ({ status: 'submitted', providerJobId: 'req-2' })]
    denied.poll = () => Promise.reject(unauthorized())
    const b = setup(denied)
    const j2 = b.queue.enqueue(spec)
    await tick(1000)
    expect(await b.queue.wait(j2.id)).toMatchObject({ status: 'failed', attempt: 1 })
  })

  it('供應商回報任務失敗：可重試就重新送出，不可重試就失敗', async () => {
    const driver = new FakeDriver()
    driver.submitScript = [
      () => ({ status: 'submitted', providerJobId: 'req-1' }),
      () => ({ status: 'submitted', providerJobId: 'req-2' }),
    ]
    driver.pollScript = [
      () => ({
        status: 'failed',
        error: { code: 'provider_unavailable', retryable: true, userMessage: '生成失敗' },
      }),
      () => ({
        status: 'failed',
        error: { code: 'provider_rejected', retryable: false, userMessage: '內容被拒絕' },
      }),
    ]
    const { queue } = setup(driver)
    const job = queue.enqueue(spec)
    await tick(1000) // 第一次輪詢 → 失敗 → 排隊等 1s
    expect(queue.get(job.id)).toMatchObject({ status: 'queued' })
    expect(queue.get(job.id)?.providerJobId).toBeUndefined()
    await tick(1000) // 重新送出
    await tick(1000) // 第二次輪詢
    const done = await queue.wait(job.id)
    expect(done).toMatchObject({ status: 'failed', attempt: 2 })
    expect(done.error?.code).toBe('provider_rejected')
    expect(driver.submits).toHaveLength(2)
  })

  it('driver 沒有 poll 卻回了 submitted：任務失敗並說明', async () => {
    const driver = new FakeDriver()
    driver.submitScript = [() => ({ status: 'submitted', providerJobId: 'req-1' })]
    const bare: JobDriver = { submit: driver.submit }
    const { queue } = setup(undefined, { drivers: { fal: bare } })
    const job = queue.enqueue(spec)
    await tick(1000)
    expect((await queue.wait(job.id)).error?.code).toBe('internal_error')
  })
})

describe('供應商並行與速率限制', () => {
  it('同一供應商同時進行的任務不超過 concurrency，空出來就補上', async () => {
    const driver = new FakeDriver()
    const releases: (() => void)[] = []
    driver.submitFallback = () =>
      new Promise<SubmitResult>((resolve) => {
        releases.push(() => {
          resolve({ status: 'done', output: 1 })
        })
      })
    const { queue } = setup(driver, { limits: { fal: { concurrency: 2 } } })
    const jobs = [spec, spec, spec].map((s) => queue.enqueue(s))

    await tick(0)
    expect(driver.submits).toHaveLength(2)
    expect(queue.get(jobs[2]?.id ?? '')?.status).toBe('queued')

    releases[0]?.()
    await tick(0)
    expect(driver.submits).toHaveLength(3)
    releases[1]?.()
    releases[2]?.()
    await Promise.all(jobs.map((j) => queue.wait(j.id)))
    expect(queue.list({ statuses: ['succeeded'] })).toHaveLength(3)
  })

  it('已送出等結果的長任務也佔用名額', async () => {
    const driver = new FakeDriver()
    driver.submitScript = [() => ({ status: 'submitted', providerJobId: 'req-1' })]
    const { queue } = setup(driver, { limits: { fal: { concurrency: 1 } } })
    queue.enqueue(spec)
    const second = queue.enqueue(spec)
    await tick(3000)
    expect(driver.submits).toHaveLength(1)
    expect(queue.get(second.id)?.status).toBe('queued')
    driver.pollScript = [() => ({ status: 'done', output: 'x' })]
    await tick(1000)
    expect(driver.submits).toHaveLength(2)
  })

  it('minIntervalMs 讓送出時間錯開；不同供應商互不影響', async () => {
    const fal = new FakeDriver()
    const other = new FakeDriver()
    const store = new MemoryJobStore()
    const queue = new JobQueue({
      store,
      drivers: { fal, openrouter: other },
      limits: { fal: { minIntervalMs: 500 } },
    })
    queue.start()
    const ids = [spec, spec, spec].map((s) => queue.enqueue(s).id)
    queue.enqueue({ ...spec, provider: 'openrouter' })
    await tick(2000)
    await Promise.all(ids.map((id) => queue.wait(id)))
    expect(fal.submits.map((s) => s.at - START.getTime())).toEqual([0, 500, 1000])
    expect(other.submits.map((s) => s.at - START.getTime())).toEqual([0])
  })
})

describe('取消', () => {
  it('取消排隊中的任務：不會被送出', async () => {
    const driver = new FakeDriver()
    driver.submitFallback = () => new Promise<SubmitResult>(() => undefined)
    const { queue } = setup(driver, { limits: { fal: { concurrency: 1 } } })
    queue.enqueue(spec)
    const waiting = queue.enqueue(spec)
    await tick(0)
    const cancelled = queue.cancel(waiting.id)
    expect(cancelled).toMatchObject({ status: 'cancelled', error: { code: 'cancelled' } })
    await tick(10_000)
    expect(driver.submits).toHaveLength(1)
    await expect(queue.wait(waiting.id)).resolves.toMatchObject({ status: 'cancelled' })
  })

  it('取消執行中的任務：中止請求，之後回來的結果會被忽略', async () => {
    const driver = new FakeDriver()
    let finish: (r: SubmitResult) => void = () => undefined
    driver.submitFallback = () =>
      new Promise<SubmitResult>((resolve) => {
        finish = resolve
      })
    const { queue } = setup(driver)
    const job = queue.enqueue(spec)
    await tick(0)
    queue.cancel(job.id)
    expect(driver.submits[0]?.signal.aborted).toBe(true)
    finish({ status: 'done', output: '太晚了' })
    await tick(0)
    expect(queue.get(job.id)).toMatchObject({ status: 'cancelled' })
    expect(queue.get(job.id)?.output).toBeUndefined()
  })

  it('取消已送出的長任務：通知供應商，之後不再輪詢；已完成的任務取消沒有作用', async () => {
    const driver = new FakeDriver()
    driver.submitScript = [() => ({ status: 'submitted', providerJobId: 'req-1' })]
    const { queue } = setup(driver)
    const job = queue.enqueue(spec)
    await tick(0)
    queue.cancel(job.id)
    await tick(10_000)
    expect(driver.cancels).toHaveLength(1)
    expect(driver.cancels[0]?.providerJobId).toBe('req-1')
    expect(driver.polls).toHaveLength(0)

    const done = queue.enqueue(spec)
    await queue.wait(done.id)
    expect(queue.cancel(done.id).status).toBe('succeeded')
    expect(driver.cancels).toHaveLength(1)
  })
})

describe('App 重開後接回任務', () => {
  it('submitted 的任務被強制結束後，新的佇列接著輪詢，不會重複送出', async () => {
    const driver = new FakeDriver()
    driver.submitScript = [() => ({ status: 'submitted', providerJobId: 'req-1' })]
    const first = setup(driver)
    const job = first.queue.enqueue(spec)
    await tick(0)
    expect(first.queue.get(job.id)?.status).toBe('submitted')

    // 模擬被強制結束：舊佇列直接丟掉，新的行程只拿得到資料庫
    first.queue.stop()
    driver.pollScript = [() => ({ status: 'pending' }), () => ({ status: 'done', output: 'ok' })]
    const second = new JobQueue({
      store: first.store,
      drivers: { fal: driver },
      defaultLimits: { pollIntervalMs: 1000 },
    })
    second.start()
    await tick(0)
    expect(driver.polls).toHaveLength(1) // 立刻就問，不用等一個輪詢間隔
    await tick(1000)

    expect(await second.wait(job.id)).toMatchObject({ status: 'succeeded', output: 'ok' })
    expect(driver.submits).toHaveLength(1)
    expect(driver.polls.every((j) => j.providerJobId === 'req-1')).toBe(true)
  })

  it('polling 的任務同樣接回；有 providerJobId 的執行中任務也直接輪詢', async () => {
    const driver = new FakeDriver()
    driver.pollScript = [
      () => ({ status: 'done', output: 'a' }),
      () => ({ status: 'done', output: 'b' }),
    ]
    const store = new MemoryJobStore()
    const stamp = START.toISOString()
    const base: Job = {
      id: 'old-1',
      provider: 'fal',
      modelId: 'm',
      kind: 'video',
      status: 'polling',
      providerJobId: 'req-1',
      attempt: 1,
      maxAttempts: 3,
      createdAt: stamp,
      updatedAt: stamp,
    }
    store.put(base)
    store.put({ ...base, id: 'old-2', status: 'submitted', providerJobId: 'req-2' })
    const queue = new JobQueue({ store, drivers: { fal: driver } })
    queue.start()
    await tick(0)
    expect(await queue.wait('old-1')).toMatchObject({ status: 'succeeded', output: 'a' })
    expect(await queue.wait('old-2')).toMatchObject({ status: 'succeeded', output: 'b' })
    expect(driver.submits).toHaveLength(0)
  })

  it('送出到一半被中斷的任務（還沒拿到 providerJobId）重新排隊，不扣次數', async () => {
    const driver = new FakeDriver()
    driver.submitFallback = () => new Promise<SubmitResult>(() => undefined)
    const first = setup(driver)
    const job = first.queue.enqueue(spec)
    await tick(0)
    expect(first.queue.get(job.id)).toMatchObject({ status: 'running', attempt: 1 })
    first.queue.stop()
    expect(driver.submits[0]?.signal.aborted).toBe(true)

    const second = new JobQueue({ store: first.store, drivers: { fal: new FakeDriver() } })
    const seen: Job[] = []
    second.subscribe((j) => seen.push(j))
    second.start()
    expect(seen[0]).toMatchObject({ status: 'queued', attempt: 0 })
    expect(await second.wait(job.id)).toMatchObject({ status: 'succeeded', attempt: 1 })
  })

  it('等待退避中的任務重開後依原定時間再送；start 重複呼叫無妨', async () => {
    const driver = new FakeDriver()
    driver.submitScript = [
      () => {
        throw rateLimited(5000)
      },
    ]
    const first = setup(driver)
    const job = first.queue.enqueue(spec)
    await tick(0)
    first.queue.stop()

    await tick(2000)
    const fresh = new FakeDriver()
    const second = new JobQueue({ store: first.store, drivers: { fal: fresh } })
    second.start()
    second.start()
    await tick(2999)
    expect(fresh.submits).toHaveLength(0)
    await tick(1)
    expect((await second.wait(job.id)).status).toBe('succeeded')
    expect(fresh.submits).toHaveLength(1)
  })

  it('stop 之後不再排程', async () => {
    const driver = new FakeDriver()
    const { queue } = setup(driver)
    queue.stop()
    queue.enqueue(spec)
    await tick(10_000)
    expect(driver.submits).toHaveLength(0)
  })
})
