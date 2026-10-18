import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { getPath, runCustomJob } from '@/lib/jobAdapter'
import { normalizeCustomJob, type CustomJobConfig } from '@/stores/settingsStore'

const json = (obj: unknown, status = 200): Response =>
  new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } })

function baseCustom(over: Partial<CustomJobConfig> = {}): CustomJobConfig {
  return normalizeCustomJob({
    name: 'test',
    submitURL: 'https://api.example.com/submit',
    submitMethod: 'POST',
    bodyTemplate: '{"prompt": "{{prompt}}", "model": "{{model}}"}',
    jobIdPath: 'request_id',
    statusURL: 'https://api.example.com/status/{jobId}',
    resultURL: '',
    statusPath: 'status',
    doneValues: 'COMPLETED,succeeded',
    errorPath: 'error',
    resultPath: 'video.url',
    authStyle: 'bearer',
    apiKeyHeader: 'x-api-key',
    pollIntervalMs: 1000,
    timeoutMs: 30000,
    ...over,
  })
}

describe('jobAdapter — getPath', () => {
  it('مسیر تودرتو', () => {
    expect(getPath({ a: { b: { c: 1 } } }, 'a.b.c')).toBe(1)
  })
  it('آرایه با ایندکس', () => {
    expect(getPath({ output: ['x', 'y'] }, 'output.0')).toBe('x')
    expect(getPath({ o: [{ url: 'u' }] }, 'o.0.url')).toBe('u')
  })
  it('مسیر ناموجود undefined', () => {
    expect(getPath({ a: 1 }, 'b.c')).toBeUndefined()
    expect(getPath(null, 'a')).toBeUndefined()
    expect(getPath({ a: 1 }, '')).toBeUndefined()
  })
})

describe('jobAdapter — runCustomJob', () => {
  let calls: Array<{ url: string; init: RequestInit }>

  beforeEach(() => {
    calls = []
    vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
      calls.push({ url, init })
      return json({ ok: true })
    })
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('نتیجهٔ همزمان (بدون polling)', async () => {
    vi.stubGlobal('fetch', async () => json({ video: { url: 'https://cdn/x.mp4' } }))
    const r = await runCustomJob({
      custom: baseCustom({ statusURL: '', resultPath: 'video.url' }),
      apiKey: 'k',
      model: 'm',
      prompt: 'غروب',
    })
    expect(r.resultUrl).toBe('https://cdn/x.mp4')
  })

  it('جایگذاری prompt و model در بدنه', async () => {
    let seenBody = ''
    vi.stubGlobal('fetch', async (_u: string, init: RequestInit = {}) => {
      seenBody = String(init.body)
      return json({ video: { url: 'https://cdn/x.mp4' } })
    })
    await runCustomJob({
      custom: baseCustom({ statusURL: '', resultPath: 'video.url' }),
      apiKey: 'k',
      model: 'my-model',
      prompt: 'سلام دنیا',
    })
    const body = JSON.parse(seenBody)
    expect(body.prompt).toBe('سلام دنیا')
    expect(body.model).toBe('my-model')
  })

  it('polling تا COMPLETED', async () => {
    let n = 0
    vi.stubGlobal('fetch', async (url: string) => {
      if (url.includes('/submit')) return json({ request_id: 'job-1' })
      n++
      if (n === 1) return json({ status: 'IN_PROGRESS' })
      return json({ status: 'COMPLETED', video: { url: 'https://cdn/v.mp4' } })
    })
    const events: string[] = []
    const r = await runCustomJob({
      custom: baseCustom(),
      apiKey: 'k',
      model: 'm',
      prompt: 'p',
      onEvent: e => events.push(e.phase),
    })
    expect(r.resultUrl).toBe('https://cdn/v.mp4')
    expect(r.jobId).toBe('job-1')
    expect(events).toContain('poll')
    expect(events).toContain('done')
  })

  it('resultURL جدا برای گرفتن نتیجه', async () => {
    vi.stubGlobal('fetch', async (url: string) => {
      if (url.includes('/submit')) return json({ id: 'j9' })
      if (url.includes('/result')) return json({ output: ['https://cdn/r.glb'] })
      return json({ status: 'succeeded' })
    })
    const r = await runCustomJob({
      custom: baseCustom({
        jobIdPath: 'id',
        statusURL: 'https://api.example.com/s/{jobId}',
        resultURL: 'https://api.example.com/result/{jobId}',
        resultPath: 'output.0',
      }),
      apiKey: 'k',
      model: 'm',
      prompt: 'p',
    })
    expect(r.resultUrl).toBe('https://cdn/r.glb')
  })

  it('خطای سرویس از errorPath', async () => {
    vi.stubGlobal('fetch', async (url: string) => {
      if (url.includes('/submit')) return json({ request_id: 'j1' })
      return json({ status: 'FAILED', error: 'bad prompt' })
    })
    await expect(
      runCustomJob({ custom: baseCustom(), apiKey: 'k', model: 'm', prompt: 'p' }),
    ).rejects.toThrow('bad prompt')
  })

  it('استایل‌های احراز هویت', async () => {
    const headers: Array<Record<string, string>> = []
    vi.stubGlobal('fetch', async (_u: string, init: RequestInit = {}) => {
      headers.push((init.headers as Record<string, string>) ?? {})
      return json({ video: { url: 'https://cdn/x.mp4' } })
    })
    const run = (authStyle: CustomJobConfig['authStyle'], apiKeyHeader = 'x-api-key') =>
      runCustomJob({
        custom: baseCustom({ statusURL: '', resultPath: 'video.url', authStyle, apiKeyHeader }),
        apiKey: 'secret',
        model: 'm',
        prompt: 'p',
      })
    await run('bearer')
    expect(headers[0]!['Authorization']).toBe('Bearer secret')
    await run('key')
    expect(headers[1]!['Authorization']).toBe('Key secret')
    await run('x-api-key', 'x-goog-api-key')
    expect(headers[2]!['x-goog-api-key']).toBe('secret')
    await run('none')
    expect(headers[3]!['Authorization']).toBeUndefined()
  })

  it('بدون job-id در پاسخ خطا می‌دهد', async () => {
    vi.stubGlobal('fetch', async () => json({ nope: 1 }))
    await expect(
      runCustomJob({ custom: baseCustom(), apiKey: 'k', model: 'm', prompt: 'p' }),
    ).rejects.toThrow('شناسهٔ job')
  })

  it('بدنهٔ نامعتبر JSON خطا می‌دهد', async () => {
    await expect(
      runCustomJob({
        custom: baseCustom({ bodyTemplate: 'not-json{{{' }),
        apiKey: 'k',
        model: 'm',
        prompt: 'p',
      }),
    ).rejects.toThrow('JSON معتبر')
  })
})
