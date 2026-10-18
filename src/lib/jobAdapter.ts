/**
 * آداپتور job ناهمزمان برای پرووایدرهای کاستوم (BYO API).
 * APIهای ویدیو/سه‌بعدی استاندارد OpenAI ندارند؛ الگوی رایج:
 *   submit → job-id → polling وضعیت → دانلود نتیجه
 * این آداپتور کاملاً با CustomJobConfig هدایت می‌شود — بدون hardcode سرویس خاص.
 */
import { proxyFetch } from '@/lib/modelCatalog'
import { normalizeCustomJob, type CustomJobConfig } from '@/stores/settingsStore'

export type JobPhase = 'submit' | 'poll' | 'done' | 'error'

export interface JobEvent {
  phase: JobPhase
  /** شناسهٔ job وقتی مشخص شد */
  jobId?: string
  /** وضعیت خام گزارش‌شده توسط سرویس */
  status?: string
  /** شمارهٔ تلاش polling */
  attempt?: number
  message: string
}

/** خواندن مسیر نقطه‌ای از آبجکت: «video.url» ،«output.0» ،«a.b.c» */
export function getPath(obj: unknown, path: string): unknown {
  if (!path.trim()) return undefined
  let cur: unknown = obj
  for (const seg of path.split('.')) {
    if (cur == null) return undefined
    if (Array.isArray(cur)) {
      const i = Number(seg)
      if (!Number.isInteger(i)) return undefined
      cur = cur[i]
    } else if (typeof cur === 'object') {
      cur = (cur as Record<string, unknown>)[seg]
    } else {
      return undefined
    }
  }
  return cur
}

/** جایگذاری ‎{model}‎ و ‎{jobId}‎ در URL */
function fillUrl(tpl: string, model: string, jobId: string): string {
  return tpl.split('{model}').join(model).split('{jobId}').join(jobId)
}

/** جایگذاری ‎{{prompt}}‎ و ‎{{model}}‎ در تمپلیت بدنه */
function fillBody(tpl: string, prompt: string, model: string): string {
  return tpl.split('{{prompt}}').join(prompt).split('{{model}}').join(model)
}

function authHeaders(cfg: CustomJobConfig, apiKey: string): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' }
  // هدرهای اضافهٔ کاربر (JSON) — مثلاً X-Runway-Version
  try {
    const extra = JSON.parse(cfg.extraHeaders || '{}') as unknown
    if (extra && typeof extra === 'object') {
      for (const [k, v] of Object.entries(extra as Record<string, unknown>)) {
        if (typeof v === 'string' && v) h[k] = v
      }
    }
  } catch {
    /* JSON خراب نادیده گرفته می‌شود */
  }
  const key = apiKey.trim()
  if (!key) return h
  switch (cfg.authStyle) {
    case 'bearer':
      h['Authorization'] = `Bearer ${key}`
      break
    case 'key':
      // مثل fal.ai که اسکیم «Key» می‌خواهد، نه Bearer
      h['Authorization'] = `Key ${key}`
      break
    case 'x-api-key':
      h[cfg.apiKeyHeader.trim() || 'x-api-key'] = key
      break
    case 'none':
      break
  }
  return h
}

async function readJson(res: Response): Promise<unknown> {
  const text = await res.text()
  if (!text.trim()) return {}
  try {
    return JSON.parse(text)
  } catch {
    throw new Error('پاسخ JSON معتبر از سرویس برنگشت')
  }
}

const sleep = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException('لغو شد', 'AbortError'))
    const t = setTimeout(() => resolve(), ms)
    signal?.addEventListener('abort', () => {
      clearTimeout(t)
      reject(new DOMException('لغو شد', 'AbortError'))
    }, { once: true })
  })

export interface RunCustomJobOptions {
  custom: CustomJobConfig
  apiKey: string
  model: string
  prompt: string
  signal?: AbortSignal
  onEvent?: (e: JobEvent) => void
}

/**
 * اجرای یک job کاستوم تا رسیدن به نتیجه.
 * برمی‌گرداند آدرس فایل نتیجه (URL) + شناسهٔ job.
 */
export async function runCustomJob(opts: RunCustomJobOptions): Promise<{ resultUrl: string; jobId: string }> {
  const cfg = normalizeCustomJob(opts.custom)
  const { apiKey, model, prompt, signal, onEvent } = opts
  const emit = (e: JobEvent): void => { try { onEvent?.(e) } catch { /* ignore */ } }

  if (!cfg.submitURL.trim()) throw new Error('آدرس submit پرووایدر کاستوم تنظیم نشده.')
  if (!apiKey.trim() && cfg.authStyle !== 'none') {
    throw new Error('کلید API پرووایدر کاستوم تنظیم نشده.')
  }

  // ─── ۱) submit ───
  emit({ phase: 'submit', message: 'در حال ارسال درخواست…' })
  let body: string | undefined
  if (cfg.submitMethod === 'POST') {
    const filled = fillBody(cfg.bodyTemplate, prompt, model)
    try {
      JSON.parse(filled)
    } catch {
      throw new Error('تمپلیت بدنهٔ JSON معتبر نیست — آن را در تنظیمات بررسی کن.')
    }
    body = filled
  }
  const submitRes = await proxyFetch(fillUrl(cfg.submitURL, model, ''), {
    method: cfg.submitMethod,
    headers: authHeaders(cfg, apiKey),
    body,
    signal,
  })
  if (!submitRes.ok) throw new Error(`خطای submit (HTTP ${submitRes.status})`)
  const submitJson = await readJson(submitRes)
  const jobId = String(getPath(submitJson, cfg.jobIdPath) ?? '')
  if (!jobId && cfg.statusURL.trim()) {
    throw new Error(`شناسهٔ job در پاسخ پیدا نشد (مسیر «${cfg.jobIdPath}»).`)
  }
  emit({ phase: 'submit', jobId, message: jobId ? `درخواست ثبت شد (job: ${jobId})` : 'درخواست ثبت شد' })

  // ─── ۲) نتیجهٔ همزمان (بدون polling) ───
  if (!cfg.statusURL.trim()) {
    const direct = getPath(submitJson, cfg.resultPath)
    if (typeof direct === 'string' && direct) {
      emit({ phase: 'done', jobId, message: 'نتیجه آماده شد.' })
      return { resultUrl: direct, jobId }
    }
    throw new Error(`نتیجه در پاسخ پیدا نشد (مسیر «${cfg.resultPath}»).`)
  }

  // ─── ۳) polling ───
  const doneSet = new Set(cfg.doneValues.split(',').map(s => s.trim()).filter(Boolean))
  const statusUrl = fillUrl(cfg.statusURL, model, jobId)
  const resultUrl = cfg.resultURL.trim() ? fillUrl(cfg.resultURL, model, jobId) : ''
  const deadline = Date.now() + cfg.timeoutMs
  let attempt = 0

  for (;;) {
    if (signal?.aborted) throw new DOMException('لغو شد', 'AbortError')
    if (Date.now() > deadline) throw new Error('زمان انتظار تمام شد — job هنوز آماده نشده.')
    attempt++
    await sleep(cfg.pollIntervalMs, signal)

    const stRes = await proxyFetch(statusUrl, {
      method: 'GET',
      headers: authHeaders(cfg, apiKey),
      signal,
    })
    if (!stRes.ok) throw new Error(`خطای polling وضعیت (HTTP ${stRes.status})`)
    const stJson = await readJson(stRes)
    const rawStatus = String(getPath(stJson, cfg.statusPath) ?? '')

    const errMsg = getPath(stJson, cfg.errorPath)
    if (typeof errMsg === 'string' && errMsg.trim()) {
      emit({ phase: 'error', jobId, status: rawStatus, message: errMsg })
      throw new Error(`خطای سرویس: ${errMsg}`)
    }

    if (doneSet.has(rawStatus)) {
      let finalJson: unknown = stJson
      if (resultUrl) {
        const rRes = await proxyFetch(resultUrl, {
          method: 'GET',
          headers: authHeaders(cfg, apiKey),
          signal,
        })
        if (!rRes.ok) throw new Error(`خطای گرفتن نتیجه (HTTP ${rRes.status})`)
        finalJson = await readJson(rRes)
      }
      const out = getPath(finalJson, cfg.resultPath)
      if (typeof out === 'string' && out) {
        emit({ phase: 'done', jobId, status: rawStatus, message: 'نتیجه آماده شد.' })
        return { resultUrl: out, jobId }
      }
      throw new Error(`نتیجه در پاسخ پیدا نشد (مسیر «${cfg.resultPath}»).`)
    }

    emit({ phase: 'poll', jobId, status: rawStatus, attempt, message: `در حال پردازش… (${rawStatus || 'نامشخص'})` })
  }
}
