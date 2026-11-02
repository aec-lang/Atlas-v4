import { ANTHROPIC_DEFAULT_BASE_URL, GEMINI_DEFAULT_BASE_URL, type TaskConfig } from '@/stores/settingsStore'

export const CONNECTION_SERVICES = [
  { id: 'openai', name: 'OpenAI', hint: 'اتصال با کلید API', provider: 'openai', baseURL: 'https://api.openai.com/v1' },
  { id: 'gemini', name: 'Google Gemini', hint: 'اتصال با کلید Google AI Studio', provider: 'gemini', baseURL: GEMINI_DEFAULT_BASE_URL },
  { id: 'anthropic', name: 'Claude', hint: 'اتصال با کلید Anthropic', provider: 'anthropic', baseURL: ANTHROPIC_DEFAULT_BASE_URL },
  { id: 'ollama', name: 'Ollama', hint: 'مدل محلی، بدون کلید API', provider: 'ollama', baseURL: 'http://localhost:11434/v1' },
  { id: 'compatible', name: 'سرویس دیگر', hint: 'آدرس و کلید API سازگار با OpenAI', provider: 'openai', baseURL: '' },
] as const
export type ConnectionService = typeof CONNECTION_SERVICES[number]['id']

export function serviceForConnection(cfg: TaskConfig): ConnectionService {
  if (cfg.provider === 'openai') {
    return cfg.baseURL.replace(/\/+$/, '') === 'https://api.openai.com/v1' ? 'openai' : 'compatible'
  }
  return cfg.provider === 'custom' ? 'compatible' : cfg.provider
}

export function normalizeConnectionURL(value: string, provider: TaskConfig['provider']): string {
  const url = new URL(value.trim())
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('آدرس باید با http:// یا https:// شروع شود و نام کاربری یا رمز نداشته باشد.')
  }
  if (url.search || url.hash) throw new Error('آدرس پایه را بدون پارامتر یا # وارد کن.')
  let path = url.pathname.replace(/\/+$/, '').replace(/\/(chat\/completions|models)$/, '')
  if (provider === 'ollama') path = path.replace(/\/api\/tags$/, '')
  if (!path) path = '/v1'
  url.pathname = path
  return url.toString().replace(/\/+$/, '')
}

export function connectionError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  if (/401|403/.test(message)) return 'کلید API پذیرفته نشد؛ کلید و دسترسی حساب را بررسی کن.'
  if (/404/.test(message)) return 'لیست مدل‌ها در این آدرس پیدا نشد؛ آدرس پایهٔ API را بررسی کن.'
  if (/429/.test(message)) return 'سرویس محدودیت درخواست یا اعتبار حساب را گزارش کرد؛ کمی بعد دوباره امتحان کن.'
  if (/abort|timeout/i.test(message)) return 'سرویس به‌موقع پاسخ نداد؛ اتصال اینترنت یا پروکسی را بررسی کن.'
  if (/fetch|network|failed to/i.test(message)) return 'اتصال برقرار نشد؛ آدرس، اینترنت و پروکسی را بررسی کن. در نسخهٔ مرورگر محدودیت دسترسی سرویس هم ممکن است مانع اتصال شود.'
  return message.slice(0, 200)
}
