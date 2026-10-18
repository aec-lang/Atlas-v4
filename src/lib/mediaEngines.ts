/**
 * موتورهای تولید رسانه — تصویر و گفتار، با کانفیگ per-task («تنظیمات هر کار»).
 * تصویر: POST {baseURL}/v1/images/generations (سازگار با OpenAI، خروجی b64_json)
 * گفتار:  POST {baseURL}/v1/audio/speech   (باینری — از پروکسی base64 پروسهٔ اصلی)
 */
import { getTaskConfig, type CustomJobConfig, type TaskConfig } from '@/stores/settingsStore'
import { proxyFetch, proxyFetchBinary } from '@/lib/modelCatalog'
import { runCustomJob, type JobEvent } from '@/lib/jobAdapter'

export type SlashCmd = 'image' | 'tts' | 'video' | '3d'

/**
 * تجزیهٔ دستور اسلش ابتدای پیام.
 * «/image یک گربه فضانورد» → { cmd: 'image', arg: 'یک گربه فضانورد' }
 */
export function parseSlashCommand(
  text: string,
): { cmd: SlashCmd; arg: string } | null {
  const m = text.trim().match(/^\/(image|tts|video|3d)\b\s*([\s\S]*)$/i)
  if (!m) return null
  return { cmd: m[1]!.toLowerCase() as SlashCmd, arg: (m[2] ?? '').trim() }
}

function baseOf(cfg: TaskConfig): string {
  return cfg.baseURL.replace(/\/+$/, '')
}

function authHeaders(cfg: TaskConfig): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${cfg.apiKey}`,
  }
}

/** اعتبارسنجی کانفیگ رسانه — فقط پرووایدرهای سازگار با OpenAI (openai/gemini). */
function requireMediaConfig(task: 'image' | 'tts'): TaskConfig {
  const cfg = getTaskConfig(task)
  const name = task === 'image' ? 'تولید تصویر' : 'صوتی/TTS'
  if (!cfg.baseURL.trim() || !cfg.apiKey.trim() || !cfg.model.trim()) {
    throw new Error(
      `کلید API یا مدل «${name}» تنظیم نشده — از تنظیمات، بخش «تنظیمات هر کار» را تکمیل کن.`,
    )
  }
  if (cfg.provider !== 'openai' && cfg.provider !== 'gemini') {
    throw new Error(
      `پرووایدر «${name}» باید سرویسی سازگار با OpenAI باشد (برای تصویر، «سفارشی» هم قبول است).`,
    )
  }
  return cfg
}

/** تولید تصویر واقعی از پرامپت → dataUrl نمایشی در چت */
export async function generateImage(
  prompt: string,
  signal?: AbortSignal,
): Promise<{ dataUrl: string }> {
  const cfg = getTaskConfig('image')
  // پرووایدر کاستوم (مثل fal.ai / Replicate): job ناهمزمان → URL نتیجه
  if (cfg.provider === 'custom' && cfg.custom?.submitURL.trim()) {
    const { resultUrl } = await runCustomJob({
      custom: cfg.custom,
      apiKey: cfg.apiKey,
      model: cfg.model,
      prompt,
      signal,
    })
    if (!resultUrl) throw new Error('نتیجه‌ای از سرویس تصویر برنگشت')
    return { dataUrl: resultUrl }
  }
  const full = requireMediaConfig('image')
  const res = await proxyFetch(`${baseOf(full)}/v1/images/generations`, {
    method: 'POST',
    headers: authHeaders(full),
    body: JSON.stringify({
      model: full.model,
      prompt,
      n: 1,
      size: '1024x1024',
      response_format: 'b64_json',
    }),
    signal,
  })
  if (!res.ok) throw new Error(`خطای تولید تصویر (HTTP ${res.status})`)
  const json = (await res.json()) as {
    data?: Array<{ b64_json?: string; url?: string }>
  }
  const b64 = json?.data?.[0]?.b64_json
  if (typeof b64 === 'string' && b64.length > 0) {
    return { dataUrl: `data:image/png;base64,${b64}` }
  }
  const url = json?.data?.[0]?.url
  if (typeof url === 'string' && url.length > 0) return { dataUrl: url }
  throw new Error('پاسخ غیرمنتظره از سرویس تولید تصویر')
}

/** تبدیل متن به گفتار واقعی → base64 صوت + mimeType (پخش با AtlasAudioPlayer) */
export async function synthesizeSpeech(
  text: string,
  signal?: AbortSignal,
): Promise<{ base64: string; mimeType: string }> {
  const cfg = requireMediaConfig('tts')
  const { bytes, contentType } = await proxyFetchBinary(
    `${baseOf(cfg)}/v1/audio/speech`,
    {
      method: 'POST',
      headers: authHeaders(cfg),
      body: JSON.stringify({
        model: cfg.model,
        input: text,
        voice: 'alloy',
        response_format: 'mp3',
      }),
      signal,
    },
  )
  if (bytes.length === 0) throw new Error('پاسخ خالی از سرویس گفتار')
  let bin = ''
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  const mime = contentType.includes('audio/')
    ? contentType.split(';')[0]!.trim()
    : 'audio/mp3'
  return { base64: btoa(bin), mimeType: mime }
}

/* ═════════ ویدیو و سه‌بعدی — پرووایدر کاستوم (BYO API) ═════════ */

/** اعتبارسنجی کانفیگ کاستوم یک کار — بدون hardcode سرویس خاص */
function requireCustomConfig(task: 'video' | '3d'): { cfg: TaskConfig; custom: CustomJobConfig } {
  const cfg = getTaskConfig(task)
  const name = task === 'video' ? 'تولید ویدیو' : 'مدل سه‌بعدی'
  if (cfg.provider !== 'custom' || !cfg.custom) {
    throw new Error(
      `«${name}» پرووایدر کاستوم ندارد — از تنظیمات، بخش «تنظیمات هر کار»، ` +
      `پرووایدر «سفارشی» را انتخاب کن یا یک تمپلیت آماده (fal.ai ،Replicate و...) بزن.`,
    )
  }
  const custom = cfg.custom
  if (!custom.submitURL.trim()) {
    throw new Error(`آدرس submit «${name}» تنظیم نشده — از تنظیمات تکمیلش کن.`)
  }
  return { cfg, custom }
}

export interface MediaJobResult {
  /** آدرس فایل نتیجه (URL) */
  resultUrl: string
  jobId: string
}

/** تولید ویدیو با پرووایدر کاستوم کاربر → URL فایل ویدیو */
export async function generateVideo(
  prompt: string,
  opts?: { signal?: AbortSignal; onEvent?: (e: JobEvent) => void },
): Promise<MediaJobResult> {
  const { cfg, custom } = requireCustomConfig('video')
  return runCustomJob({
    custom,
    apiKey: cfg.apiKey,
    model: cfg.model,
    prompt,
    signal: opts?.signal,
    onEvent: opts?.onEvent,
  })
}

/** تولید مدل سه‌بعدی با پرووایدر کاستوم کاربر → URL فایل مدل (GLB/OBJ/...) */
export async function generate3d(
  prompt: string,
  opts?: { signal?: AbortSignal; onEvent?: (e: JobEvent) => void },
): Promise<MediaJobResult> {
  const { cfg, custom } = requireCustomConfig('3d')
  return runCustomJob({
    custom,
    apiKey: cfg.apiKey,
    model: cfg.model,
    prompt,
    signal: opts?.signal,
    onEvent: opts?.onEvent,
  })
}
