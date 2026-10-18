/**
 * Model Catalog — فچ لیست مدلها از endpointهای استاندارد
 * OpenAI-compatible:  GET /v1/models          → { data: [{ id, ... }] }
 * Ollama نیتیو:       GET /api/tags           → { models: [{ name, details }] }
 * Anthropic:          GET /v1/models (هدر x-api-key + anthropic-version)
 */
import type { AtlasAPI } from '@/types/atlas-api'

export type Protocol = 'openai' | 'ollama' | 'anthropic'

export interface CatalogModel {
  id: string
  /** برچسب نوع مدل — از نام و متادیتا حدس زده میشود */
  kind?: ModelKind
}

export type ModelKind =
  | 'chat'
  | 'reasoning'
  | 'image'
  | 'audio'
  | 'video'
  | 'embedding'

export const MODEL_KIND_META: Record<
  ModelKind,
  { label: string; icon: string }
> = {
  chat:      { label: 'چت',        icon: '💬' },
  reasoning: { label: 'استدلالی',  icon: '🧠' },
  image:     { label: 'تصویر',     icon: '🎨' },
  audio:     { label: 'صدا',       icon: '🔊' },
  video:     { label: 'ویدئو',     icon: '🎬' },
  embedding: { label: 'برداری',    icon: '🧲' },
}

/** تشخیص خودکار نوع مدل از نام — بدون فراخوانی شبکه */
export function detectModelKind(id: string): ModelKind {
  const n = id.toLowerCase()
  // ترتیب مهم است — اول تصویر/صوت/ویدئو چون نامهای خاصتری دارند
  if (/(^|[^a-z])(dall-e|dalle|flux|sdxl|stable-diffusion|sd3|sd-|imagen|midjourney|kolors|playground-v)/.test(n)) return 'image'
  if (/whisper|tts|speech|audio|voice|f5-tts|parler/.test(n)) return 'audio'
  if (/video|sora|wan[-_]?2|cogvideo|hunyuan-video|mochi|ltx-video/.test(n)) return 'video'
  if (/embed|bge-|gte-|e5-|nomic-embed|minilm/.test(n)) return 'embedding'
  if (/(^|[^a-z])(o1|o3|o4)([^a-z0-9]|$)|deepseek-r1|qwq|reasoning|r1[\s:-]|think/.test(n)) return 'reasoning'
  if (/vision|-vl|vl-|llava|multimodal/.test(n)) return 'chat'
  return 'chat'
}

function normalizeBase(base: string): string {
  return base.replace(/\/+$/, '')
}

/**
 * تایماوت سازگار با محیطهای قدیمی (به‌جای AbortSignal.timeout ناتیو).
 * یک AbortSignal برمیگرداند که پس از ms میلیثانیه قطع میشود.
 */
export function withTimeout(ms: number): AbortSignal {
  const ac = new AbortController()
  const t = setTimeout(() => ac.abort(), ms)
  ac.signal.addEventListener('abort', () => clearTimeout(t), { once: true })
  return ac.signal
}

/**
 * fetch امن: روی نسخهٔ دسکتاپ درخواست را از پروسهٔ اصلی (Electron) عبور میدهد
 * تا کلیدهای API در لایهٔ شبکهٔ مرورگر (قابل مشاهده با Inspector) ظاهر نشوند.
 */
export async function proxyFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const api =
    typeof window !== 'undefined'
      ? (window as unknown as { atlasAPI?: AtlasAPI }).atlasAPI
      : undefined
  if (api?.proxy) {
    const r = await api.proxy({
      url,
      method: init.method ?? 'GET',
      headers: (init.headers as Record<string, string>) ?? {},
      body: typeof init.body === 'string' ? init.body : undefined,
    })
    if (!r.ok) throw new Error(r.error ?? 'خطا در پروکسی')
    return new Response(r.body ?? '', {
      status: r.status ?? 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }
  return fetch(url, init)
}

/**
 * فچ باینری امن (مثل صوت TTS): روی دسکتاپ از پروسهٔ اصلی با responseType=base64
 * عبور می‌کند تا کلید API لو نرود؛ در مرورگر مستقیم fetch می‌شود.
 * برمی‌گرداند: بایت‌ها + content-type پاسخ.
 */
export async function proxyFetchBinary(
  url: string,
  init: RequestInit = {},
): Promise<{ bytes: Uint8Array; contentType: string }> {
  const api =
    typeof window !== 'undefined'
      ? (window as unknown as { atlasAPI?: AtlasAPI }).atlasAPI
      : undefined
  if (api?.proxy) {
    const r = await api.proxy({
      url,
      method: init.method ?? 'GET',
      headers: (init.headers as Record<string, string>) ?? {},
      body: typeof init.body === 'string' ? init.body : undefined,
      responseType: 'base64',
    })
    if (!r.ok || !r.body) throw new Error(r.error ?? 'خطا در پروکسی')
    const bin = atob(r.body)
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    return { bytes, contentType: r.contentType ?? 'application/octet-stream' }
  }
  const res = await fetch(url, init)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const buf = await res.arrayBuffer()
  return {
    bytes: new Uint8Array(buf),
    contentType: res.headers.get('content-type') ?? 'application/octet-stream',
  }
}

/** گرفتن مدلها با تایماوت و مدیریت خطای خوانا */
async function fetchJson(url: string, headers: Record<string, string>): Promise<unknown> {
  const res = await proxyFetch(url, {
    headers,
    signal: withTimeout(10_000)
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

/** فچ مدلها بر اساس پروتکل انتخابی — خطا را پرتاب میکند تا UI پیام بدهد */
export async function fetchModelCatalog(
  protocol: Protocol,
  opts: { baseURL: string; apiKey?: string; ollamaBaseURL?: string }
): Promise<CatalogModel[]> {
  if (protocol === 'ollama') {
    // Ollama نیتیو متادیتای بیشتری میدهد؛ اگر نشد به مسیر سازگار OpenAI فال بک میکنیم
    try {
      const base = normalizeBase(opts.ollamaBaseURL ?? '').replace(/\/v1$/, '')
      const json = await fetchJson(`${base}/api/tags`, {}) as {
        models?: Array<{ name?: string; model?: string }>
      }
      const list = json.models ?? []
      const mapped = list
        .map(m => m.name ?? m.model ?? '')
        .filter(Boolean)
        .map(id => ({ id, kind: detectModelKind(id) }))
      if (mapped.length > 0) return mapped
      throw new Error('empty')
    } catch {
      // فال‌بک: مسیر سازگار OpenAI روی همان هاست
      const base = normalizeBase(opts.ollamaBaseURL ?? '')
      const json = await fetchJson(`${base}/models`, {}) as { data?: Array<{ id?: string }> }
      return (json.data ?? [])
        .map(m => m.id ?? '')
        .filter(Boolean)
        .map(id => ({ id, kind: detectModelKind(id) }))
    }
  }

  const base = normalizeBase(opts.baseURL)
  if (protocol === 'anthropic') {
    const json = await fetchJson(`${base}/models`, {
      'x-api-key': opts.apiKey ?? '',
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true'
    }) as { data?: Array<{ id?: string }> }
    return (json.data ?? [])
      .map(m => m.id ?? '')
      .filter(Boolean)
      .map(id => ({ id, kind: detectModelKind(id) }))
  }

  // openai-compatible
  const json = await fetchJson(`${base}/models`, {
    ...(opts.apiKey ? { Authorization: `Bearer ${opts.apiKey}` } : {})
  }) as { data?: Array<{ id?: string }> }
  return (json.data ?? [])
    .map(m => m.id ?? '')
    .filter(Boolean)
    .map(id => ({ id, kind: detectModelKind(id) }))
}
