import { describe, it, expect } from 'vitest'
import {
  engineLabel, activeModelName, type ProviderKind,
  TASKS, type TaskKind, taskConfigFromModelSettings, defaultTaskConfigs,
  providerProtocol, GEMINI_DEFAULT_BASE_URL, normalizeCustomJob,
  useSettingsStore, getTaskConfig, DEFAULT_MODEL_SETTINGS, type ModelSettings
} from '@/stores/settingsStore'
import { CORE_PROMPT } from '@/lib/corePrompt'

describe('settingsStore — برچسب و نام مدل', () => {
  it('engineLabel بر اساس پروتکل برچسب فارسی می‌سازد', () => {
    expect(engineLabel('ollama' as ProviderKind, 'llama3')).toContain('Ollama')
    expect(engineLabel('anthropic' as ProviderKind, 'claude')).toContain('Anthropic')
    expect(engineLabel('openai' as ProviderKind, 'gpt')).toContain('API')
  })

  it('activeModelName مدل فعال پروتکل را برمی‌گرداند', () => {
    expect(activeModelName({ provider: 'ollama', ollamaModel: 'llama3', apiModel: 'x', anthropicModel: 'y' })).toBe('llama3')
    expect(activeModelName({ provider: 'openai', ollamaModel: 'a', apiModel: 'gpt', anthropicModel: 'b' })).toBe('gpt')
  })
})

describe('CORE_PROMPT', () => {
  it('ابزارهای عامل را به مدل معرفی می‌کند', () => {
    expect(CORE_PROMPT).toContain('عامل')
    expect(CORE_PROMPT).toContain('shell_exec')
    expect(CORE_PROMPT.length).toBeGreaterThan(50)
  })
})

describe('تنظیمات چند API — نگاشت و مایگریشن', () => {
  const base: ModelSettings = {
    ...DEFAULT_MODEL_SETTINGS,
    ollamaBaseURL: 'http://localhost:11434/v1',
    ollamaModel: 'llama3',
    apiBaseURL: 'http://localhost:4000/v1',
    apiKey: 'k-openai',
    apiModel: 'gpt-x',
    anthropicApiKey: 'k-ant',
    anthropicModel: 'claude-x',
    geminiApiKey: 'k-gem',
    geminiModel: 'gemini-x',
    geminiBaseURL: GEMINI_DEFAULT_BASE_URL
  }

  it('TASKS دقیقاً ۶ کار با لیبل فارسی دارد', () => {
    expect(TASKS.map(t => t.id)).toEqual(['text-chat', 'voice-chat', 'image', 'video', '3d', 'tts'])
    expect(TASKS.find(t => t.id === 'text-chat')?.name).toBe('چت متنی')
    expect(TASKS.find(t => t.id === 'tts')?.name).toBe('صوتی/TTS')
  })

  it('taskConfigFromModelSettings هر ۴ پرووایدر را درست نگاشت می‌کند', () => {
    const ollama = taskConfigFromModelSettings({ ...base, provider: 'ollama' })
    expect(ollama).toEqual({ provider: 'ollama', apiKey: '', baseURL: 'http://localhost:11434/v1', model: 'llama3' })

    const openai = taskConfigFromModelSettings({ ...base, provider: 'openai' })
    expect(openai).toEqual({ provider: 'openai', apiKey: 'k-openai', baseURL: 'http://localhost:4000/v1', model: 'gpt-x' })

    const anthropic = taskConfigFromModelSettings({ ...base, provider: 'anthropic' })
    expect(anthropic).toEqual({ provider: 'anthropic', apiKey: 'k-ant', baseURL: 'https://api.anthropic.com/v1', model: 'claude-x' })

    const gemini = taskConfigFromModelSettings({ ...base, provider: 'gemini' })
    expect(gemini).toEqual({ provider: 'gemini', apiKey: 'k-gem', baseURL: GEMINI_DEFAULT_BASE_URL, model: 'gemini-x' })
  })

  it('defaultTaskConfigs هر ۶ کار را مستقل کپی می‌کند', () => {
    const cfgs = defaultTaskConfigs({ ...base, provider: 'openai' })
    const ids = Object.keys(cfgs) as TaskKind[]
    expect(ids).toHaveLength(6)
    for (const id of ids) {
      expect(cfgs[id]).toEqual({ provider: 'openai', apiKey: 'k-openai', baseURL: 'http://localhost:4000/v1', model: 'gpt-x' })
    }
    // استقلال کپی‌ها: تغییر یکی، بقیه را دست نمی‌زند
    cfgs['text-chat'].model = 'changed'
    expect(cfgs['tts'].model).toBe('gpt-x')
  })

  it('providerProtocol جمینای را به openai نگاشت می‌کند', () => {
    expect(providerProtocol('gemini')).toBe('openai')
    expect(providerProtocol('openai')).toBe('openai')
    expect(providerProtocol('ollama')).toBe('ollama')
    expect(providerProtocol('anthropic')).toBe('anthropic')
  })

  it('engineLabel و activeModelName جمینای را می‌شناسند', () => {
    expect(engineLabel('gemini' as ProviderKind, 'gemini-2.0-flash')).toContain('Gemini')
    expect(activeModelName({ provider: 'gemini', ollamaModel: 'a', apiModel: 'b', anthropicModel: 'c', geminiModel: 'gemini-x' })).toBe('gemini-x')
  })
})

describe('تنظیمات چند API — اکشن‌های استور', () => {
  it('setTaskConfig فقط همان یک کار را عوض می‌کند', () => {
    const st = useSettingsStore.getState()
    const before = getTaskConfig('tts')
    st.setTaskConfig('text-chat', { provider: 'gemini', model: 'gemini-2.0-flash' })
    const after = getTaskConfig('text-chat')
    expect(after.provider).toBe('gemini')
    expect(after.model).toBe('gemini-2.0-flash')
    // بقیه دست‌نخورده
    expect(getTaskConfig('tts')).toEqual(before)
    // بازگردانی
    st.setTaskConfig('text-chat', { provider: before.provider, model: before.model })
  })

  it('resetTaskConfigs از روی تنظیمات سراسری بازسازی می‌کند', () => {
    const st = useSettingsStore.getState()
    st.setModel({ provider: 'ollama', ollamaModel: 'llama3-test' })
    st.resetTaskConfigs()
    const cfg = getTaskConfig('video')
    expect(cfg.provider).toBe('ollama')
    expect(cfg.model).toBe('llama3-test')
    expect(cfg.baseURL).toBe('http://localhost:11434/v1')
    // بازگردانی به پیشفرض سراسری
    st.resetModel()
    st.resetTaskConfigs()
  })
})

describe('settingsStore — پرووایدر کاستوم (BYO API)', () => {
  it('engineLabel برای custom نام پرووایدر را نشان می‌دهد', () => {
    expect(engineLabel('custom' as ProviderKind, 'm', 'fal.ai')).toContain('fal.ai')
    expect(engineLabel('custom' as ProviderKind, '', '')).toContain('سفارشی')
  })

  it('normalizeCustomJob فیلدهای جاافتاده را پر و کلمپ می‌کند', () => {
    const c = normalizeCustomJob({ submitURL: 'https://x', pollIntervalMs: 10, timeoutMs: 5 })
    expect(c.submitURL).toBe('https://x')
    expect(c.pollIntervalMs).toBeGreaterThanOrEqual(1000)
    expect(c.timeoutMs).toBeGreaterThanOrEqual(10000)
    expect(c.jobIdPath).toBe('request_id')
  })

  it('setTaskConfig کانفیگ کاستوم را ذخیره می‌کند', () => {
    useSettingsStore.getState().setTaskConfig('video', {
      provider: 'custom',
      apiKey: 'k',
      model: 'm',
      custom: normalizeCustomJob({ name: 'fal.ai', submitURL: 'https://q.fal.run/m' }),
    })
    const cfg = useSettingsStore.getState().taskConfigs.video
    expect(cfg.provider).toBe('custom')
    expect(cfg.custom?.name).toBe('fal.ai')
    // بقیهٔ تسک‌ها دست‌نخورده
    expect(useSettingsStore.getState().taskConfigs['3d'].provider).not.toBe('custom')
  })
})
