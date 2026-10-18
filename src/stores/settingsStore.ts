import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type ThemeName =
  | 'midnight' | 'aurora' | 'paper' | 'lavender'
  | 'sunset' | 'ocean' | 'rose' | 'forest'

export interface ThemeMeta {
  id: ThemeName
  name: string      // نام فارسی
  latin: string     // نام لاتین روی کارت
  preview: string   // گرادیان پیشنمایش کارت
  mode: 'dark' | 'light'
}

export const THEMES: ThemeMeta[] = [
  {
    id: 'midnight', name: 'نیمهشب', latin: 'Midnight', mode: 'dark',
    preview: 'linear-gradient(120deg, #0f172a 0%, #4f46e5 55%, #a5b4fc 100%)'
  },
  {
    id: 'aurora', name: 'شفق', latin: 'Aurora', mode: 'dark',
    preview: 'linear-gradient(120deg, #022c22 0%, #0d9488 55%, #6ee7b7 100%)'
  },
  {
    id: 'sunset', name: 'غروب', latin: 'Sunset', mode: 'dark',
    preview: 'linear-gradient(120deg, #1c0a02 0%, #c2410c 55%, #fdba74 100%)'
  },
  {
    id: 'ocean', name: 'اقیانوس', latin: 'Ocean', mode: 'dark',
    preview: 'linear-gradient(120deg, #082f49 0%, #0369a1 55%, #7dd3fc 100%)'
  },
  {
    id: 'forest', name: 'جنگل', latin: 'Forest', mode: 'dark',
    preview: 'linear-gradient(120deg, #052e16 0%, #16a34a 55%, #86efac 100%)'
  },
  {
    id: 'paper', name: 'کاغذی', latin: 'Paper', mode: 'light',
    preview: 'linear-gradient(120deg, #f6f1e7 0%, #e7c98f 60%, #b45309 130%)'
  },
  {
    id: 'lavender', name: 'لاوندری', latin: 'Lavender', mode: 'light',
    preview: 'linear-gradient(120deg, #eef0fb 0%, #c4b5fd 60%, #6366f1 130%)'
  },
  {
    id: 'rose', name: 'رز', latin: 'Rose', mode: 'light',
    preview: 'linear-gradient(120deg, #fdf2f6 0%, #f9a8d4 60%, #db2777 140%)'
  }
]

/* ═════════ تنظیمات مدل — نسخهٔ فاز ۲ ═════════ */

/** پروتکل موتور: سازگار با OpenAI، Ollama محلی، API رسمی Anthropic، Gemini گوگل، یا پرووایدر کاستوم (BYO API) */
export type ProviderKind = 'openai' | 'ollama' | 'anthropic' | 'gemini' | 'custom'

/** نقطهٔ سازگار OpenAI گوگل — اطلاعات عمومی، بدون نیاز به حدس */
export const GEMINI_DEFAULT_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/openai/'
export const ANTHROPIC_DEFAULT_BASE_URL = 'https://api.anthropic.com/v1'

/* ═════════ پرووایدر کاستوم — «کلید خودت را بیاور» (BYO API) ═════════ */

/** استایل احراز هویت پرووایدر کاستوم */
export type CustomAuthStyle = 'bearer' | 'key' | 'x-api-key' | 'none'

/**
 * کانفیگ job ناهمزمان برای پرووایدر کاستوم (ویدیو/سه‌بعدی و...).
 * APIهای ویدیو/سه‌بعدی استاندارد OpenAI ندارند: submit → job-id → polling → دانلود.
 * همهٔ فیلدها قابل ویرایش‌اند؛ تمپلیت‌های آماده در src/lib/providerTemplates.ts
 */
export interface CustomJobConfig {
  /** نام نمایشی پرووایدر، مثلاً «fal.ai» */
  name: string
  /** آدرس submit — می‌تواند شامل ‎{model}‎ باشد */
  submitURL: string
  submitMethod: 'POST' | 'GET'
  /** تمپلیت بدنهٔ JSON — جای ‎{{prompt}}‎ و ‎{{model}}‎ جایگذاری می‌شود */
  bodyTemplate: string
  /** مسیر job-id در پاسخ submit با نقطه، مثلاً request_id یا id */
  jobIdPath: string
  /** آدرس polling وضعیت — جای ‎{jobId}‎ جایگذاری می‌شود؛ خالی یعنی نتیجهٔ همزمان */
  statusURL: string
  /** آدرس گرفتن نتیجهٔ نهایی — خالی یعنی همان پاسخ آخرین polling */
  resultURL: string
  /** مسیر وضعیت در JSON پاسخ، مثلاً status */
  statusPath: string
  /** مقادیر وضعیت به‌معنی «تمام شد»، با کاما از هم جدا */
  doneValues: string
  /** مسیر پیام خطا در JSON */
  errorPath: string
  /** مسیر آدرس فایل نتیجه در JSON، مثلاً video.url یا output.0 */
  resultPath: string
  /** استایل احراز هویت */
  authStyle: CustomAuthStyle
  /** نام هدر کلید وقتی authStyle برابر x-api-key است */
  apiKeyHeader: string
  /** هدرهای اضافه به‌صورت JSON (مثلاً {"X-Runway-Version": "2024-11-06"}) */
  extraHeaders: string
  /** فاصلهٔ polling به میلی‌ثانیه */
  pollIntervalMs: number
  /** حداکثر زمان انتظار به میلی‌ثانیه */
  timeoutMs: number
}

export const DEFAULT_CUSTOM_JOB: CustomJobConfig = {
  name: '',
  submitURL: '',
  submitMethod: 'POST',
  bodyTemplate: '{\n  "prompt": "{{prompt}}",\n  "model": "{{model}}"\n}',
  jobIdPath: 'request_id',
  statusURL: '',
  resultURL: '',
  statusPath: 'status',
  doneValues: 'COMPLETED,succeeded,Success,done',
  errorPath: 'error',
  resultPath: 'result_url',
  authStyle: 'bearer',
  apiKeyHeader: 'x-api-key',
  extraHeaders: '{}',
  pollIntervalMs: 5000,
  timeoutMs: 600000,
}

/** تکمیل فیلدهای جاافتادهٔ کانفیگ کاستوم با پیش‌فرض (برای مایگریشن و تمپلیت‌ها) */
export function normalizeCustomJob(p?: Partial<CustomJobConfig>): CustomJobConfig {
  const c = { ...DEFAULT_CUSTOM_JOB, ...(p ?? {}) }
  if (c.pollIntervalMs < 1000) c.pollIntervalMs = 1000
  if (c.timeoutMs < 10000) c.timeoutMs = 10000
  return c
}

/* ═════════ تنظیمات چند API — هر کار، موتور خودش ═════════ */

export type TaskKind = 'text-chat' | 'voice-chat' | 'image' | 'video' | '3d' | 'tts'

export const TASKS: Array<{ id: TaskKind; name: string }> = [
  { id: 'text-chat', name: 'چت متنی' },
  { id: 'voice-chat', name: 'چت صوتی' },
  { id: 'image', name: 'تولید تصویر' },
  { id: 'video', name: 'تولید ویدیو' },
  { id: '3d', name: 'مدل سه‌بعدی' },
  { id: 'tts', name: 'صوتی/TTS' }
]

/**
 * کانفیگ یک کار: پرووایدر + کلید + آدرس پایه + مدل.
 * نکته: برای image / video / 3d / tts هنوز موتور واقعی در اپ سیم‌کشی نشده
 * (استاب‌اند) — این کانفیگ‌ها برای وقتی که موتورشان اضافه شود آماده‌اند.
 * voice-chat هم فعلاً مغز گفت‌وگویی‌اش همان موتور text-chat است
 * (پنل صوتی متن را به همان چت می‌فرستد)؛ کانفیگ voice-chat برای
 * پایپ‌لاین اختصاصی STT/TTS رزرو شده است.
 */
export interface TaskConfig {
  provider: ProviderKind
  apiKey: string
  baseURL: string
  model: string
  /**
   * کانفیگ job ناهمزمان — فقط وقتی provider برابر 'custom' است استفاده می‌شود.
   * برای APIهای ویدیو/سه‌بعدی که استاندارد OpenAI ندارند (submit → polling → دانلود).
   */
  custom?: CustomJobConfig
}

export type TaskConfigs = Record<TaskKind, TaskConfig>

export interface ModelSettings {
  provider: ProviderKind
  /** Ollama — پایگاهنشانی سازگار با OpenAI */
  ollamaBaseURL: string
  ollamaModel: string
  /** سرویس سازگار با OpenAI — LM Studio ، LiteLLM آرسنال ، vLLM و ... */
  apiBaseURL: string
  apiKey: string
  apiModel: string
  /** Anthropic رسمی — پایگاهنشانی پیشفرض خود SDK استفاده میشود */
  anthropicApiKey: string
  anthropicModel: string
  /** Gemini گوگل — نقطهٔ سازگار OpenAI */
  geminiApiKey: string
  geminiModel: string
  geminiBaseURL: string
  systemPrompt: string
}

export const DEFAULT_MODEL_SETTINGS: ModelSettings = {
  provider: 'ollama',
  ollamaBaseURL: 'http://localhost:11434/v1',
  ollamaModel: '',
  apiBaseURL: 'http://localhost:4000/v1',
  apiKey: '',
  apiModel: '',
  anthropicApiKey: '',
  anthropicModel: '',
  geminiApiKey: '',
  geminiModel: '',
  geminiBaseURL: GEMINI_DEFAULT_BASE_URL,
  systemPrompt:
    'تو «Atlas» هستی، دستیار هوشمند محلی کاربر. فارسی روان پاسخ میدهی، ' +
    'کوتاه و دقیق هستی و برای کد از بلوک مارکداون استفاده میکنی. ' +
    'دادههای کاربر روی دستگاه خودش میماند.'
}

/* ─── تبدیل تنظیمات سراسری قدیمی به کانفیگ یک کار (مایگریشن) ─── */

/** ساخت کانفیگ یک کار از روی ModelSettings سراسری — رفتار قبلی دقیقاً حفظ میشود */
export function taskConfigFromModelSettings(s: ModelSettings): TaskConfig {
  switch (s.provider) {
    case 'ollama':
      return { provider: 'ollama', apiKey: '', baseURL: s.ollamaBaseURL, model: s.ollamaModel }
    case 'anthropic':
      return { provider: 'anthropic', apiKey: s.anthropicApiKey, baseURL: ANTHROPIC_DEFAULT_BASE_URL, model: s.anthropicModel }
    case 'gemini':
      return { provider: 'gemini', apiKey: s.geminiApiKey, baseURL: s.geminiBaseURL || GEMINI_DEFAULT_BASE_URL, model: s.geminiModel }
    default:
      return { provider: 'openai', apiKey: s.apiKey, baseURL: s.apiBaseURL, model: s.apiModel }
  }
}

/** مقدار پیشفرض هر ۶ کار: کپی مستقل از تنظیمات سراسری فعلی کاربر */
export function defaultTaskConfigs(global: ModelSettings): TaskConfigs {
  const base = taskConfigFromModelSettings(global)
  return {
    'text-chat': { ...base },
    'voice-chat': { ...base },
    image: { ...base },
    video: { ...base },
    '3d': { ...base },
    tts: { ...base }
  }
}

/**
 * نگاشت پرووایدر به پروتکل سیمی — جمینای از نقطهٔ سازگار OpenAI استفاده میکند.
 * 'custom' فال‌بک openai برمی‌گرداند ولی UI برای کاستوم مسیر جدا دارد
 * (کاتالوگ مدل و تست اتصال استاندارد برایش اعمال نمی‌شود).
 */
export function providerProtocol(p: ProviderKind): 'openai' | 'ollama' | 'anthropic' {
  return p === 'gemini' ? 'openai' : p === 'custom' ? 'openai' : p
}

interface SettingsState extends ModelSettings {
  theme: ThemeName
  setTheme: (t: ThemeName) => void
  /** وضعیت گوی: idle | thinking | listening */
  orbState: 'idle' | 'thinking' | 'listening'
  setOrbState: (s: 'idle' | 'thinking' | 'listening') => void
  /** حالت عامل: ابزارهای سیستمی (شل/فایل/موس/کیبورد/صفحه) فعال باشند؟ */
  agentEnabled: boolean
  setAgentEnabled: (v: boolean) => void
  /** حالت حریم خصوصی: فعالیت ثبت نشود و مکالمه‌ها پایدار نمانند */
  privacyMode: boolean
  setPrivacyMode: (v: boolean) => void
  /** حالت پلن: دستورات خطرناک ابتدا «در انتظار تأیید» میشوند (فقط دسکتاپ) */
  planMode: boolean
  setPlanMode: (v: boolean) => void
  /** مدل ایمبدینگ (برای RAG / جستجوی معنایی) — پیش‌فرض nomic-embed-text در Ollama */
  embeddingModel: string
  setEmbeddingModel: (v: string) => void
  /** همگام‌سازی: خاموش / محلی (export-import) / ریموت (REST) */
  syncMode: "off" | "local" | "remote"
  setSyncMode: (v: "off" | "local" | "remote") => void
  syncEndpoint: string
  setSyncEndpoint: (v: string) => void
  syncToken: string
  setSyncToken: (v: string) => void
  /** عبارت بیدار برای حالت صوتی (wake word) */
  wakePhrase: string
  setWakePhrase: (v: string) => void
  /** بهروزرسانی جزئی تنظیمات مدل */
  setModel: (patch: Partial<ModelSettings>) => void
  /** برگرداندن تنظیمات مدل به پیشفرض */
  resetModel: () => void
  /** کانفیگ هر کار (چت متنی، چت صوتی، تصویر، ویدیو، سه‌بعدی، TTS) */
  taskConfigs: TaskConfigs
  /** بهروزرسانی جزئی کانفیگ یک کار */
  setTaskConfig: (task: TaskKind, patch: Partial<TaskConfig>) => void
  /** بازنشانی همهٔ کارها از روی تنظیمات سراسری فعلی */
  resetTaskConfigs: () => void
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      ...DEFAULT_MODEL_SETTINGS,
      theme: 'midnight',
      setTheme: theme => set({ theme }),
      orbState: 'idle',
      setOrbState: orbState => set({ orbState }),
      agentEnabled: false,
      setAgentEnabled: v => set({ agentEnabled: v }),
      privacyMode: false,
      setPrivacyMode: v => set({ privacyMode: v }),
      planMode: false,
      setPlanMode: v => {
        set({ planMode: v })
        window.atlasAPI?.setPlan?.(v)
      },
      embeddingModel: "nomic-embed-text",
      setEmbeddingModel: v => set({ embeddingModel: v }),
      syncMode: "local",
      setSyncMode: v => set({ syncMode: v }),
      syncEndpoint: "",
      setSyncEndpoint: v => set({ syncEndpoint: v }),
      syncToken: "",
      setSyncToken: v => set({ syncToken: v }),
      wakePhrase: "atlas",
      setWakePhrase: v => set({ wakePhrase: v }),
      setModel: patch => set(patch),
      resetModel: () => set({ ...DEFAULT_MODEL_SETTINGS }),
      taskConfigs: defaultTaskConfigs(DEFAULT_MODEL_SETTINGS),
      setTaskConfig: (task, patch) =>
        set(s => ({
          taskConfigs: {
            ...s.taskConfigs,
            [task]: { ...s.taskConfigs[task], ...patch }
          }
        })),
      resetTaskConfigs: () =>
        set(s => ({ taskConfigs: defaultTaskConfigs(modelSettingsOf(s)) }))
    }),
    {
      name: 'atlas-settings',
      version: 4,
      migrate: (persistedState, version) => {
        const p = (persistedState ?? {}) as Partial<SettingsState>
        // نسخه‌های قدیمی taskConfigs ندارند — از تنظیمات سراسری ذخیره‌شده بساز
        if (version < 3 || !p.taskConfigs) {
          const legacy: ModelSettings = { ...DEFAULT_MODEL_SETTINGS }
          const src = p as Partial<ModelSettings>
          for (const k of [
            'provider', 'ollamaBaseURL', 'ollamaModel', 'apiBaseURL', 'apiKey', 'apiModel',
            'anthropicApiKey', 'anthropicModel', 'geminiApiKey', 'geminiModel', 'geminiBaseURL',
            'systemPrompt'
          ] as const) {
            const v = src[k]
            if (k === 'provider') {
              if (v === 'openai' || v === 'ollama' || v === 'anthropic' || v === 'gemini') legacy.provider = v
            } else if (typeof v === 'string') {
              legacy[k] = v
            }
          }
          return { ...p, taskConfigs: defaultTaskConfigs(legacy) } as SettingsState
        }
        // نسخه ۴: نرمال‌سازی کانفیگ‌های کاستوم (فیلدهای جاافتاده با پیش‌فرض پر شوند)
        if (version < 4 && p.taskConfigs) {
          const cfgs = { ...p.taskConfigs } as TaskConfigs
          for (const t of Object.keys(cfgs) as TaskKind[]) {
            const c = cfgs[t]
            if (c && c.provider === 'custom') {
              cfgs[t] = { ...c, custom: normalizeCustomJob(c.custom) }
            }
          }
          return { ...p, taskConfigs: cfgs } as SettingsState
        }
        return p as SettingsState
      },
      // orbState گذراست و نباید ذخیره شود
      partialize: s => ({
        theme: s.theme,
        provider: s.provider,
        ollamaBaseURL: s.ollamaBaseURL,
        ollamaModel: s.ollamaModel,
        apiBaseURL: s.apiBaseURL,
        apiKey: s.apiKey,
        apiModel: s.apiModel,
        anthropicApiKey: s.anthropicApiKey,
        anthropicModel: s.anthropicModel,
        geminiApiKey: s.geminiApiKey,
        geminiModel: s.geminiModel,
        geminiBaseURL: s.geminiBaseURL,
        systemPrompt: s.systemPrompt,
        taskConfigs: s.taskConfigs,
        agentEnabled: s.agentEnabled,
        privacyMode: s.privacyMode,
        planMode: s.planMode,
        embeddingModel: s.embeddingModel,
        syncMode: s.syncMode,
        syncEndpoint: s.syncEndpoint,
        syncToken: s.syncToken,
        wakePhrase: s.wakePhrase
      })
    }
  )
)

/** خواندن لحظهای تنظیمات مدل — برای استفاده خارج از React (آداپتور چت) */
export function getModelSettings(): ModelSettings {
  return modelSettingsOf(useSettingsStore.getState())
}

/** استخراج ModelSettings از وضعیت استور */
function modelSettingsOf(s: SettingsState): ModelSettings {
  return {
    provider: s.provider,
    ollamaBaseURL: s.ollamaBaseURL,
    ollamaModel: s.ollamaModel,
    apiBaseURL: s.apiBaseURL,
    apiKey: s.apiKey,
    apiModel: s.apiModel,
    anthropicApiKey: s.anthropicApiKey,
    anthropicModel: s.anthropicModel,
    geminiApiKey: s.geminiApiKey,
    geminiModel: s.geminiModel,
    geminiBaseURL: s.geminiBaseURL,
    systemPrompt: s.systemPrompt
  }
}

/** خواندن لحظهای کانفیگ یک کار — برای استفاده خارج از React */
export function getTaskConfig(task: TaskKind): TaskConfig {
  return useSettingsStore.getState().taskConfigs[task]
}

/** نام مدل فعال بر اساس پروتکل — برای نمایش در نوار بالا و تست اتصال */
export function activeModelName(s: Pick<ModelSettings, 'provider' | 'ollamaModel' | 'apiModel' | 'anthropicModel'> & { geminiModel?: string }): string {
  switch (s.provider) {
    case 'ollama': return s.ollamaModel
    case 'anthropic': return s.anthropicModel
    case 'gemini': return s.geminiModel ?? ''
    default: return s.apiModel
  }
}

/** برچسب فارسی وضعیت موتور — نشان نوار بالا */
export function engineLabel(provider: ProviderKind, model: string, customName?: string): string {
  switch (provider) {
    case 'anthropic': return `Anthropic · ${model || '—'}`
    case 'ollama': return `Ollama · ${model || '—'}`
    case 'gemini': return `Gemini · ${model || '—'}`
    case 'custom': return `${customName?.trim() || 'سفارشی'} · ${model || '—'}`
    case 'openai': return `API · ${model || '—'}`
  }
}

export function applyTheme(theme: ThemeName): void {
  document.documentElement.dataset.theme = theme
}
