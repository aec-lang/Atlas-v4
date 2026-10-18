import { describe, it, expect } from 'vitest'
import {
  PROVIDER_TEMPLATES,
  templatesFor,
  applyTemplate,
} from '@/lib/providerTemplates'
import { normalizeCustomJob } from '@/stores/settingsStore'
import { parseProvidersFile } from '@/lib/providerFile'

const EMOJI_RE =
  /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{200D}\u{20E3}]/u

describe('providerTemplates', () => {
  it('حداقل تمپلیت‌های مورد انتظار وجود دارند', () => {
    const ids = PROVIDER_TEMPLATES.map(t => t.id)
    for (const id of [
      'openai-text', 'anthropic-text', 'gemini-text', 'deepseek-text', 'xai-text',
      'mistral-text', 'cohere-text', 'together-text', 'fireworks-text', 'groq-text',
      'openrouter-text', 'ollama-text', 'lmstudio-text', 'vllm-text', 'litellm-text',
      'perplexity-text', 'moonshot-text', 'qwen-text', 'zhipu-text', 'yi-text',
      'minimax-text', 'pollinations-text', 'llm7-text', 'venice-text', 'nvidia-nim-text',
      'oxion-text',
      'openai-image', 'together-image', 'gemini-imagen', 'fal-image', 'replicate-image',
      'fal-video', 'replicate-video', 'minimax-video', 'veo-gemini', 'runway-video',
      'luma-video', 'pika-video', 'selfhosted-video',
      'fal-3d', 'replicate-3d', 'tripo-3d', 'meshy-3d', 'hunyuan-3d', 'selfhosted-3d',
      'openai-tts', 'groq-tts', 'gemini-tts', 'elevenlabs-tts', 'cartesia-tts',
      'deepgram-tts', 'selfhosted-tts',
      'openai-stt', 'groq-stt', 'deepgram-stt', 'selfhosted-stt',
    ]) {
      expect(ids).toContain(id)
    }
  })

  it('کاتالوگ به اندازه کافی بزرگ است', () => {
    expect(PROVIDER_TEMPLATES.length).toBeGreaterThanOrEqual(50)
  })

  it('idها یکتا هستند', () => {
    const ids = PROVIDER_TEMPLATES.map(t => t.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('هر تمپلیت make معتبر تولید می‌کند (بدون کلید)', () => {
    const validProviders = ['openai', 'ollama', 'anthropic', 'gemini', 'custom']
    const validAuth = ['bearer', 'key', 'x-api-key', 'none']
    for (const t of PROVIDER_TEMPLATES) {
      const m = t.make()
      expect(validProviders).toContain(m.provider)
      expect(typeof t.verified).toBe('boolean')
      expect(t.tasks.length).toBeGreaterThan(0)
      expect(t.name.trim().length).toBeGreaterThan(0)
      expect(t.hint.trim().length).toBeGreaterThan(0)
      expect('apiKey' in m).toBe(false)
      if (m.provider === 'custom') {
        const c = normalizeCustomJob(m.custom)
        expect(c.submitURL.trim().length).toBeGreaterThan(0)
        expect(c.resultPath.trim().length).toBeGreaterThan(0)
        expect(validAuth).toContain(c.authStyle)
        // extraHeaders باید JSON معتبر باشد (اگر خالی نیست)
        expect(() => JSON.parse(c.extraHeaders || '{}')).not.toThrow()
      } else {
        // تمپلیت سازگار OpenAI باید baseURL واقعی داشته باشد (به‌جز موارد تأییدنشدهٔ علامت‌خورده)
        if (t.verified) expect(m.baseURL.trim().length).toBeGreaterThan(0)
      }
    }
  })

  it('بدون ایموجی در نام و توضیحات', () => {
    for (const t of PROVIDER_TEMPLATES) {
      for (const s of [t.name, t.nameEn, t.desc, t.hint]) {
        expect(EMOJI_RE.test(s)).toBe(false)
      }
    }
  })

  it('templatesFor فیلتر درست می‌کند', () => {
    const v = templatesFor('video').map(t => t.id)
    expect(v).toContain('fal-video')
    expect(v).not.toContain('fal-3d')
    const d = templatesFor('3d').map(t => t.id)
    expect(d).toContain('fal-3d')
    expect(d).not.toContain('fal-video')
    expect(templatesFor('text-chat').map(t => t.id)).toContain('deepseek-text')
    expect(templatesFor('image').map(t => t.id)).toContain('openai-image')
    expect(templatesFor('tts').map(t => t.id)).toContain('openai-tts')
    expect(templatesFor('voice-chat').map(t => t.id)).toContain('openai-stt')
  })

  it('تمپلیت‌های تأییدنشده hint هشدار دارند', () => {
    for (const t of PROVIDER_TEMPLATES.filter(x => !x.verified)) {
      expect(/تأییدنشده|چک کن/.test(t.hint)).toBe(true)
    }
  })

  it('applyTemplate کلید را دست نمی‌زند', () => {
    const t = PROVIDER_TEMPLATES.find(x => x.id === 'fal-video')!
    const p = applyTemplate(t)
    expect(p.provider).toBe('custom')
    expect('apiKey' in p).toBe(false)
  })

  it('runway هدر نسخهٔ API را دارد', () => {
    const t = PROVIDER_TEMPLATES.find(x => x.id === 'runway-video')!
    const c = normalizeCustomJob(t.make().custom)
    const extra = JSON.parse(c.extraHeaders) as Record<string, string>
    expect(extra['X-Runway-Version']).toBeTruthy()
  })

  it('pika از هدر X-API-Key استفاده می‌کند', () => {
    const t = PROVIDER_TEMPLATES.find(x => x.id === 'pika-video')!
    const c = normalizeCustomJob(t.make().custom)
    expect(c.authStyle).toBe('x-api-key')
    expect(c.apiKeyHeader).toBe('X-API-Key')
  })
})

describe('providerFile — parseProvidersFile', () => {
  it('JSON معتبر', () => {
    const f = parseProvidersFile(JSON.stringify({
      version: 1,
      taskConfigs: {
        video: { provider: 'custom', apiKey: 'k123', custom: { name: 'fal.ai' } },
      },
    }))
    expect(f?.taskConfigs.video?.provider).toBe('custom')
    expect(f?.taskConfigs.video?.apiKey).toBe('k123')
    expect(f?.taskConfigs.video?.custom?.name).toBe('fal.ai')
  })

  it('JSON خراب null', () => {
    expect(parseProvidersFile('{{{')).toBeNull()
    expect(parseProvidersFile('[]')).toBeNull()
  })

  it('پرووایدر نامعتبر نادیده گرفته می‌شود', () => {
    const f = parseProvidersFile(JSON.stringify({
      taskConfigs: { video: { provider: 'nope', model: 'm' } },
    }))
    expect(f?.taskConfigs.video?.provider).toBeUndefined()
    expect(f?.taskConfigs.video?.model).toBe('m')
  })

  it('تسک نامعتبر نادیده گرفته می‌شود', () => {
    const f = parseProvidersFile(JSON.stringify({
      taskConfigs: { whatever: { provider: 'openai' } },
    }))
    expect(f).toBeNull()
  })

  it('کانفیگ کاستوم نرمال می‌شود', () => {
    const f = parseProvidersFile(JSON.stringify({
      taskConfigs: { '3d': { provider: 'custom', custom: { submitURL: 'https://x' } } },
    }))
    const c = f?.taskConfigs['3d']?.custom
    expect(c?.submitURL).toBe('https://x')
    expect(c?.pollIntervalMs).toBeGreaterThanOrEqual(1000)
  })
})
