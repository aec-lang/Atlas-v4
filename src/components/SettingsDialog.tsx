/**
 * SettingsDialog — پنجرهٔ تنظیمات Atlas (فاز ۲ — بازطراحی بزرگ)
 * تغییرات نسبت به فاز ۱: حذف دما/حداکثر توکن/تایپ دستی نام مدل/حالت نمایش،
 * افزودن پروتکل Anthropic، فچ لیست مدلها از API با Dropdown شادکن.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogDescription, DialogFooter
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from '@/components/ui/select'
import {
  useSettingsStore, engineLabel, activeModelName,
  TASKS, GEMINI_DEFAULT_BASE_URL, ANTHROPIC_DEFAULT_BASE_URL, providerProtocol
} from '@/stores/settingsStore'
import type { ProviderKind, TaskKind, TaskConfig } from '@/stores/settingsStore'
import {
  fetchModelCatalog, MODEL_KIND_META, proxyFetch, withTimeout,
  type CatalogModel, type Protocol
} from '@/lib/modelCatalog'
import { PlugZap, Loader2, CheckCircle2, XCircle, RefreshCw, RotateCcw, Download, Upload, FileJson2, Wand2, ChevronDown, SlidersHorizontal } from 'lucide-react'
import { useToastStore } from '@/stores/toastStore'
import {
  normalizeCustomJob,
  type CustomJobConfig,
} from '@/stores/settingsStore'
import { templatesFor, applyTemplate, type ProviderTemplate } from '@/lib/providerTemplates'
import { writeProvidersFile, applyProvidersFile } from '@/lib/providerFile'

const PROVIDERS: Array<{ id: ProviderKind; name: string; desc: string }> = [
  { id: 'ollama', name: 'Ollama (محلی)', desc: 'مدل روی دستگاه خودت — کاملاً خصوصی' },
  { id: 'openai', name: 'API سازگار OpenAI', desc: 'LM Studio ، LiteLLM آرسنال ، vLLM و ...' },
  { id: 'anthropic', name: 'Anthropic', desc: 'API رسمی Claude — ابری' },
  { id: 'gemini', name: 'Gemini (Google)', desc: 'نقطهٔ سازگار OpenAI گوگل — ابری' },
  { id: 'custom', name: 'سفارشی (BYO API)', desc: 'کلید خودت را بیاور — ویدیو/سه‌بعدی و هر API دیگر' },
]

type TestState = { status: 'idle' | 'testing' | 'ok' | 'fail'; message?: string }

/** تست واقعی اتصال بر اساس پروتکل انتخابی (بدون fallback گمراه‌کننده) */
async function testConnection(
  protocol: Protocol,
  baseURL: string,
  apiKey: string,
  model: string
): Promise<TestState> {
  try {
    const t0 = Date.now()
    const base = baseURL.replace(/\/+$/, '')

    const headers: Record<string, string> =
      protocol === 'anthropic'
        ? {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
            'anthropic-dangerous-direct-browser-access': 'true'
          }
        : {
            'Content-Type': 'application/json',
            ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {})
          }

    // آنتراپیک مسیر متفاوتی دارد؛ بقیه /chat/completions
    const url = protocol === 'anthropic' ? `${base}/messages` : `${base}/chat/completions`
    const body = JSON.stringify(
      protocol === 'anthropic'
        ? { model, max_tokens: 5, messages: [{ role: 'user', content: 'ping' }] }
        : { model, messages: [{ role: 'user', content: 'ping' }], max_tokens: 5, stream: false }
    )

    const res = await proxyFetch(url, { method: 'POST', headers, body, signal: withTimeout(8000) })

    if (!res.ok) {
      const text = await res.text().catch(() => '')
      return { status: 'fail', message: `HTTP ${res.status} — ${text.slice(0, 140)}` }
    }
    const json: unknown = await res.json()
    const okShape =
      typeof json === 'object' && json !== null &&
      ('choices' in json || ('content' in json && 'role' in json))
    if (!okShape) {
      return { status: 'fail', message: 'پاسخ غیرمنتظره — این endpoint چت نیست' }
    }
    return { status: 'ok', message: `متصل ✓ (${Date.now() - t0}ms)` }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { status: 'fail', message: msg.slice(0, 160) }
  }
}

/* ─── فیلد انتخاب مدل با فچ از API ─── */

function ModelField(props: {
  protocol: Protocol
  value: string
  onChange: (id: string) => void
  /** پارامترهای اتصال برای فچ کاتالوگ */
  conn: { baseURL: string; apiKey?: string; ollamaBaseURL?: string }
}): React.JSX.Element {
  const { protocol, value, onChange, conn } = props
  const [models, setModels] = useState<CatalogModel[]>([])
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')
  const [loadedOnce, setLoadedOnce] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setErr('')
    try {
      const list = await fetchModelCatalog(protocol, conn)
      setModels(list)
      if (list.length === 0) setErr('هیچ مدلی گزارش نشد — سرور را بررسی کن')
    } catch (e) {
      setErr(e instanceof Error ? e.message.slice(0, 120) : 'خطا در گرفتن لیست مدلها')
    } finally {
      setLoading(false)
      setLoadedOnce(true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [protocol, conn.baseURL, conn.apiKey, conn.ollamaBaseURL])

  // اولین ورود به پنل → فچ خودکار؛ بعدش فقط با دکمهٔ رفرش
  useEffect(() => {
    if (!loadedOnce) void load()
  }, [loadedOnce, load])

  // اگر مقدار فعلی در لیست نیست (مثلاً قبل از فچ)، موقتاً به لیست اضافه کن تا نمایش نپرد
  const items = useMemo(() => {
    if (value && !models.some(m => m.id === value)) {
      return [{ id: value }, ...models]
    }
    return models
  }, [models, value])

  return (
    <div className="grid gap-1">
      <div className="flex items-center gap-1.5">
        <Select value={value || undefined} onValueChange={onChange}>
          <SelectTrigger size="sm" dir="ltr"
            className="flex-1 rounded-xl border-none font-mono text-xs"
            style={{ background: 'rgba(128,128,128,0.08)', color: 'var(--text-primary)' }}>
            <SelectValue placeholder={loading ? 'در حال گرفتن مدلها...' : 'مدل را انتخاب کن'} />
          </SelectTrigger>
          <SelectContent>
            {items.map(m => (
              <SelectItem key={m.id} value={m.id} dir="ltr" className="font-mono text-xs">
                {m.kind ? `${MODEL_KIND_META[m.kind].icon}  ${m.id}` : m.id}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button variant="outline" size="icon" onClick={() => void load()} disabled={loading}
          title="گرفتن مجدد لیست مدلها"
          className="size-8 shrink-0 rounded-xl">
          {loading ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
        </Button>
      </div>
      {err && (
        <p className="px-1 text-[10px] leading-relaxed text-red-400">{err}</p>
      )}
    </div>
  )
}

/* ─── فرم پرووایدر سفارشی (BYO API) ─── */

const AUTH_STYLES: Array<{ id: CustomJobConfig['authStyle']; name: string }> = [
  { id: 'bearer', name: 'Bearer (Authorization: Bearer)' },
  { id: 'key', name: 'Key (Authorization: Key) — مثل fal.ai' },
  { id: 'x-api-key', name: 'هدر دلخواه (x-api-key)' },
  { id: 'none', name: 'بدون احراز هویت' },
]

/** بررسی محلی کانفیگ کاستوم — بدون ارسال شبکه (تست واقعی پول خرج می‌کند!) */
function validateCustom(c: CustomJobConfig, apiKey: string): string[] {
  const issues: string[] = []
  if (!c.submitURL.trim()) issues.push('آدرس submit خالی است')
  if (c.authStyle !== 'none' && !apiKey.trim()) issues.push('کلید API وارد نشده')
  try {
    JSON.parse(c.bodyTemplate.split('{{prompt}}').join('x').split('{{model}}').join('x'))
  } catch {
    issues.push('تمپلیت بدنه JSON معتبر نیست')
  }
  if (c.statusURL.trim() && !c.jobIdPath.trim()) issues.push('مسیر job-id برای polling لازم است')
  if (!c.resultPath.trim()) issues.push('مسیر نتیجه (resultPath) خالی است')
  return issues
}

function CustomProviderForm({ task }: { task: TaskKind }): React.JSX.Element {
  const cfg = useSettingsStore(s => s.taskConfigs[task])
  const setTaskConfig = useSettingsStore(s => s.setTaskConfig)
  const toast = useToastStore(s => s.push)
  const [advanced, setAdvanced] = useState(false)
  const [check, setCheck] = useState<{ ok: boolean; issues: string[] } | null>(null)

  const custom = useMemo(() => normalizeCustomJob(cfg.custom), [cfg.custom])
  const setC = (patch: Partial<CustomJobConfig>): void => {
    setTaskConfig(task, { custom: { ...custom, ...patch } })
    setCheck(null)
  }

  const inputCls = 'rounded-xl bg-transparent px-3 py-2 font-mono text-xs outline-none'
  const inputStyle = { color: 'var(--text-primary)', background: 'rgba(128,128,128,0.08)' }
  const labelCls = 'text-xs'
  const labelStyle = { color: 'var(--text-secondary)' }
  const templates = useMemo(() => templatesFor(task), [task])

  const applyTpl = (t: ProviderTemplate): void => {
    setTaskConfig(task, applyTemplate(t))
    setCheck(null)
    toast(`تمپلیت «${t.name}» اعمال شد — فقط کلید API را وارد کن`, 'success')
  }

  const runCheck = (): void => {
    const issues = validateCustom(custom, cfg.apiKey)
    setCheck({ ok: issues.length === 0, issues })
  }

  const num = (v: string, d: number): number => {
    const n = parseInt(v, 10)
    return Number.isFinite(n) ? n : d
  }

  return (
    <div className="grid gap-2">
      {templates.length > 0 && (
        <>
          <label className={labelCls} style={labelStyle}>تمپلیت آماده — با یک کلیک پر شود</label>
          <div className="flex flex-wrap gap-1.5">
            {templates.map(t => (
              <Button key={t.id} variant="outline" size="sm" onClick={() => applyTpl(t)}
                className="gap-1.5 rounded-xl text-[11px]" title={t.hint}>
                <Wand2 size={12} />
                {t.name}
              </Button>
            ))}
          </div>
          <p className="text-[10px] leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
            تمپلیت فقط فیلدها را پر می‌کند؛ کلید API را خودت وارد کن. شناسهٔ مدل را از سایت سرویس بررسی کن.
          </p>
        </>
      )}

      <label className={labelCls} style={labelStyle}>نام پرووایدر</label>
      <input dir="auto" value={custom.name}
        onChange={e => setC({ name: e.target.value })}
        className={inputCls} style={inputStyle} placeholder="مثلاً fal.ai" />

      <label className={labelCls} style={labelStyle}>کلید API</label>
      <input dir="ltr" type="password" value={cfg.apiKey}
        onChange={e => { setTaskConfig(task, { apiKey: e.target.value }); setCheck(null) }}
        className={inputCls} style={inputStyle} placeholder="کلید سرویس…" />

      <label className={labelCls} style={labelStyle}>مدل</label>
      <input dir="ltr" value={cfg.model}
        onChange={e => { setTaskConfig(task, { model: e.target.value }); setCheck(null) }}
        className={inputCls} style={inputStyle} placeholder="شناسهٔ مدل در سرویس…" />

      <button onClick={() => setAdvanced(v => !v)}
        className="flex items-center gap-1.5 text-[11px]"
        style={{ color: 'var(--text-secondary)' }}>
        <ChevronDown size={12} className={advanced ? 'rotate-180 transition-transform' : 'transition-transform'} />
        تنظیمات پیشرفتهٔ job (آدرس‌ها و مسیرهای JSON)
      </button>

      {advanced && (
        <div className="grid gap-2 rounded-xl p-2" style={{ background: 'rgba(128,128,128,0.06)' }}>
          <label className={labelCls} style={labelStyle}>آدرس submit (جای {'{model}'} پشتیبانی می‌شود)</label>
          <input dir="ltr" value={custom.submitURL}
            onChange={e => setC({ submitURL: e.target.value })}
            className={inputCls} style={inputStyle} placeholder="https://…" />

          <div className="grid grid-cols-2 gap-2">
            <div className="grid gap-1">
              <label className={labelCls} style={labelStyle}>متد</label>
              <Select value={custom.submitMethod} onValueChange={v => setC({ submitMethod: v as 'POST' | 'GET' })}>
                <SelectTrigger size="sm" className="rounded-xl border-none text-xs"
                  style={{ background: 'rgba(128,128,128,0.08)', color: 'var(--text-primary)' }}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="POST" className="text-xs">POST</SelectItem>
                  <SelectItem value="GET" className="text-xs">GET</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1">
              <label className={labelCls} style={labelStyle}>احراز هویت</label>
              <Select value={custom.authStyle} onValueChange={v => setC({ authStyle: v as CustomJobConfig['authStyle'] })}>
                <SelectTrigger size="sm" className="rounded-xl border-none text-xs"
                  style={{ background: 'rgba(128,128,128,0.08)', color: 'var(--text-primary)' }}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {AUTH_STYLES.map(a => (
                    <SelectItem key={a.id} value={a.id} className="text-xs">{a.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {custom.authStyle === 'x-api-key' && (
            <>
              <label className={labelCls} style={labelStyle}>نام هدر کلید</label>
              <input dir="ltr" value={custom.apiKeyHeader}
                onChange={e => setC({ apiKeyHeader: e.target.value })}
                className={inputCls} style={inputStyle} placeholder="x-api-key" />
            </>
          )}

          <label className={labelCls} style={labelStyle}>هدرهای اضافه (JSON) — مثلاً {'{"X-Runway-Version": "2024-11-06"}'}</label>
          <input dir="ltr" value={custom.extraHeaders}
            onChange={e => setC({ extraHeaders: e.target.value })}
            className={inputCls} style={inputStyle} placeholder='{"X-Runway-Version": "2024-11-06"}'
            spellCheck={false} />

          <label className={labelCls} style={labelStyle}>تمپلیت بدنه (‎{'{{prompt}}'}‎ و ‎{'{{model}}'}‎ جایگذاری می‌شوند)</label>
          <textarea dir="ltr" rows={4} value={custom.bodyTemplate}
            onChange={e => setC({ bodyTemplate: e.target.value })}
            className={`${inputCls} resize-y`} style={inputStyle} spellCheck={false} />

          <div className="grid grid-cols-2 gap-2">
            <div className="grid gap-1">
              <label className={labelCls} style={labelStyle}>مسیر job-id</label>
              <input dir="ltr" value={custom.jobIdPath}
                onChange={e => setC({ jobIdPath: e.target.value })}
                className={inputCls} style={inputStyle} placeholder="request_id" />
            </div>
            <div className="grid gap-1">
              <label className={labelCls} style={labelStyle}>مسیر وضعیت</label>
              <input dir="ltr" value={custom.statusPath}
                onChange={e => setC({ statusPath: e.target.value })}
                className={inputCls} style={inputStyle} placeholder="status" />
            </div>
          </div>

          <label className={labelCls} style={labelStyle}>آدرس polling وضعیت (جای {'{jobId}'}؛ خالی = نتیجهٔ همزمان)</label>
          <input dir="ltr" value={custom.statusURL}
            onChange={e => setC({ statusURL: e.target.value })}
            className={inputCls} style={inputStyle} placeholder="https://…/{jobId}…" />

          <label className={labelCls} style={labelStyle}>آدرس گرفتن نتیجه (خالی = همان پاسخ polling)</label>
          <input dir="ltr" value={custom.resultURL}
            onChange={e => setC({ resultURL: e.target.value })}
            className={inputCls} style={inputStyle} placeholder="https://…/{jobId}…" />

          <div className="grid grid-cols-2 gap-2">
            <div className="grid gap-1">
              <label className={labelCls} style={labelStyle}>مقادیر «تمام شد» (با کاما)</label>
              <input dir="ltr" value={custom.doneValues}
                onChange={e => setC({ doneValues: e.target.value })}
                className={inputCls} style={inputStyle} placeholder="COMPLETED,succeeded" />
            </div>
            <div className="grid gap-1">
              <label className={labelCls} style={labelStyle}>مسیر نتیجه</label>
              <input dir="ltr" value={custom.resultPath}
                onChange={e => setC({ resultPath: e.target.value })}
                className={inputCls} style={inputStyle} placeholder="video.url" />
            </div>
          </div>

          <label className={labelCls} style={labelStyle}>مسیر پیام خطا</label>
          <input dir="ltr" value={custom.errorPath}
            onChange={e => setC({ errorPath: e.target.value })}
            className={inputCls} style={inputStyle} placeholder="error" />

          <div className="grid grid-cols-2 gap-2">
            <div className="grid gap-1">
              <label className={labelCls} style={labelStyle}>فاصلهٔ polling (میلی‌ثانیه)</label>
              <input dir="ltr" type="number" min={1000} step={1000} value={custom.pollIntervalMs}
                onChange={e => setC({ pollIntervalMs: num(e.target.value, 5000) })}
                className={inputCls} style={inputStyle} />
            </div>
            <div className="grid gap-1">
              <label className={labelCls} style={labelStyle}>حداکثر انتظار (میلی‌ثانیه)</label>
              <input dir="ltr" type="number" min={10000} step={10000} value={custom.timeoutMs}
                onChange={e => setC({ timeoutMs: num(e.target.value, 600000) })}
                className={inputCls} style={inputStyle} />
            </div>
          </div>
        </div>
      )}

      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={runCheck}
          className="gap-1.5 rounded-xl text-xs">
          <FileJson2 size={13} />
          بررسی کانفیگ
        </Button>
        {check && (
          <span className={`flex items-center gap-1 text-[11px] ${check.ok ? 'text-green-400' : 'text-red-400'}`}>
            {check.ok ? <CheckCircle2 size={13} /> : <XCircle size={13} />}
            {check.ok ? 'کانفیگ معتبر است' : check.issues.join('؛ ')}
          </span>
        )}
      </div>
      <p className="text-[10px] leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
        تست واقعی شبکه انجام نمی‌شود چون تولید ویدیو/سه‌بعدی هزینه دارد؛ «بررسی کانفیگ» فقط فیلدها را اعتبارسنجی می‌کند.
      </p>
    </div>
  )
}

/* ─── سطر تنظیمات یک کار ─── */

function TaskRow({ task }: { task: TaskKind }): React.JSX.Element {
  const cfg = useSettingsStore(s => s.taskConfigs[task])
  const setTaskConfig = useSettingsStore(s => s.setTaskConfig)
  const [test, setTest] = useState<TestState>({ status: 'idle' })
  const meta = TASKS.find(t => t.id === task) ?? TASKS[0]

  const protocol = providerProtocol(cfg.provider)
  const conn = useMemo(() => ({
    baseURL: cfg.provider === 'ollama' ? '' : cfg.baseURL,
    apiKey: cfg.provider === 'ollama' ? '' : cfg.apiKey,
    ollamaBaseURL: cfg.provider === 'ollama' ? cfg.baseURL : ''
  }), [cfg.provider, cfg.baseURL, cfg.apiKey])

  const onProviderChange = (v: string): void => {
    const p = v as ProviderKind
    const patch: Partial<TaskConfig> = { provider: p }
    if (p === 'gemini' && !cfg.baseURL.trim()) patch.baseURL = GEMINI_DEFAULT_BASE_URL
    if (p === 'ollama' && !cfg.baseURL.trim()) patch.baseURL = 'http://localhost:11434/v1'
    if (p === 'custom' && !cfg.custom) patch.custom = normalizeCustomJob()
    setTaskConfig(task, patch)
    setTest({ status: 'idle' })
  }

  const runTest = (): void => {
    if (!cfg.model.trim()) {
      setTest({ status: 'fail', message: 'اول یک مدل انتخاب کن' })
      return
    }
    const base = cfg.provider === 'gemini' && !cfg.baseURL.trim()
      ? GEMINI_DEFAULT_BASE_URL
      : cfg.baseURL
    setTest({ status: 'testing' })
    void testConnection(protocol, base, cfg.apiKey, cfg.model).then(setTest)
  }

  const inputCls = 'rounded-xl bg-transparent px-3 py-2 font-mono text-xs outline-none'
  const inputStyle = { color: 'var(--text-primary)', background: 'rgba(128,128,128,0.08)' }

  return (
    <div className="grid gap-2 rounded-2xl p-3 glass">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium">{meta.name}</span>
        <span className="font-mono text-[10px]" dir="ltr" style={{ color: 'var(--text-secondary)' }}>
          {engineLabel(cfg.provider, cfg.model, cfg.custom?.name)}
        </span>
      </div>

      <Select value={cfg.provider} onValueChange={onProviderChange}>
        <SelectTrigger size="sm" className="rounded-xl border-none text-xs"
          style={{ background: 'rgba(128,128,128,0.08)', color: 'var(--text-primary)' }}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {PROVIDERS.map(p => (
            <SelectItem key={p.id} value={p.id} className="text-xs">{p.name}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      {cfg.provider === 'ollama' && (
        <>
          <label className="text-xs" style={{ color: 'var(--text-secondary)' }}>آدرس سرور</label>
          <input dir="ltr" value={cfg.baseURL}
            onChange={e => setTaskConfig(task, { baseURL: e.target.value })}
            className={inputCls} style={inputStyle}
            placeholder="http://localhost:11434/v1" />
          <label className="text-xs" style={{ color: 'var(--text-secondary)' }}>مدل</label>
          <ModelField protocol="ollama" value={cfg.model}
            onChange={id => setTaskConfig(task, { model: id })}
            conn={conn} />
        </>
      )}

      {(cfg.provider === 'openai' || cfg.provider === 'gemini') && (
        <>
          <label className="text-xs" style={{ color: 'var(--text-secondary)' }}>آدرس پایه</label>
          <input dir="ltr" value={cfg.baseURL}
            onChange={e => setTaskConfig(task, { baseURL: e.target.value })}
            className={inputCls} style={inputStyle}
            placeholder={cfg.provider === 'gemini' ? GEMINI_DEFAULT_BASE_URL : 'https://api.openai.com/v1'} />
          <label className="text-xs" style={{ color: 'var(--text-secondary)' }}>کلید API</label>
          <input dir="ltr" type="password" value={cfg.apiKey}
            onChange={e => setTaskConfig(task, { apiKey: e.target.value })}
            className={inputCls} style={inputStyle}
            placeholder={cfg.provider === 'gemini' ? 'AIza-...' : 'sk-...'} />
          <label className="text-xs" style={{ color: 'var(--text-secondary)' }}>مدل</label>
          <ModelField protocol="openai" value={cfg.model}
            onChange={id => setTaskConfig(task, { model: id })}
            conn={conn} />
        </>
      )}

      {cfg.provider === 'anthropic' && (
        <>
          <label className="text-xs" style={{ color: 'var(--text-secondary)' }}>کلید API</label>
          <input dir="ltr" type="password" value={cfg.apiKey}
            onChange={e => setTaskConfig(task, { apiKey: e.target.value })}
            className={inputCls} style={inputStyle}
            placeholder="sk-ant-..." />
          <label className="text-xs" style={{ color: 'var(--text-secondary)' }}>مدل</label>
          <ModelField protocol="anthropic" value={cfg.model}
            onChange={id => setTaskConfig(task, { model: id })}
            conn={conn} />
        </>
      )}

      {cfg.provider === 'custom' && (
        <CustomProviderForm task={task} />
      )}

      {cfg.provider !== 'custom' && (
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={runTest} disabled={test.status === 'testing'}
            className="gap-1.5 rounded-xl text-xs">
            {test.status === 'testing' ? <Loader2 size={13} className="animate-spin" /> : <PlugZap size={13} />}
            {test.status === 'testing' ? 'در حال تست...' : 'تست اتصال'}
          </Button>
          {test.status !== 'idle' && test.status !== 'testing' && (
            <span className={`flex items-center gap-1 text-[11px] ${test.status === 'ok' ? 'text-green-400' : 'text-red-400'}`}>
              {test.status === 'ok' ? <CheckCircle2 size={13} /> : <XCircle size={13} />}
              {test.message}
            </span>
          )}
        </div>
      )}
    </div>
  )
}

/* ─── دیالوگ اصلی ─── */

export function SettingsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const s = useSettingsStore()
  const toast = useToastStore(st => st.push)
  const [test, setTest] = useState<TestState>({ status: 'idle' })
  const [confirmDangerous, setConfirmDangerous] = useState(true)

  /** نوشتن کانفیگ فعلی در providers.json */
  const onExportProviders = useCallback(async (): Promise<void> => {
    const r = await writeProvidersFile()
    if (r.ok) {
      toast(r.path ? `فایل ذخیره شد: ${r.path}` : 'فایل providers.json ذخیره شد', 'success')
    } else {
      toast(`خطا در نوشتن فایل: ${r.error ?? 'نامشخص'}`, 'error')
    }
  }, [toast])

  /** خواندن کانفیگ از providers.json و اعمال روی استور */
  const onImportProviders = useCallback(async (): Promise<void> => {
    const ok = await applyProvidersFile()
    if (ok) {
      toast('کانفیگ از فایل providers.json خوانده و اعمال شد', 'success')
    } else {
      toast('فایل providers.json پیدا یا خوانده نشد', 'error')
    }
  }, [toast])
  const toggleConfirm = (): void => {
    const next = !confirmDangerous
    setConfirmDangerous(next)
    window.atlasAPI?.setConfirm?.(next)
  }

  const activeBase =
    s.provider === 'ollama' ? s.ollamaBaseURL :
    s.provider === 'anthropic' ? ANTHROPIC_DEFAULT_BASE_URL :
    s.provider === 'gemini' ? (s.geminiBaseURL.trim() || GEMINI_DEFAULT_BASE_URL) : s.apiBaseURL
  const activeKey =
    s.provider === 'anthropic' ? s.anthropicApiKey :
    s.provider === 'gemini' ? s.geminiApiKey :
    s.provider === 'openai' ? s.apiKey : ''
  const activeModel = activeModelName(s)

  const conn = useMemo(() => ({
    baseURL: s.provider === 'ollama' ? '' : activeBase,
    apiKey: activeKey,
    ollamaBaseURL: s.provider === 'ollama' ? s.ollamaBaseURL : ''
  }), [s.provider, s.apiBaseURL, s.apiKey, s.anthropicApiKey, s.geminiApiKey, s.ollamaBaseURL, activeBase, activeKey])

  const runTest = (): void => {
    if (!activeModel.trim()) {
      setTest({ status: 'fail', message: 'اول یک مدل انتخاب کن' })
      return
    }
    setTest({ status: 'testing' })
    void testConnection(providerProtocol(s.provider), activeBase, activeKey, activeModel).then(setTest)
  }

  const inputCls = 'rounded-xl bg-transparent px-3 py-2 font-mono text-xs outline-none'
  const inputStyle = { color: 'var(--text-primary)', background: 'rgba(128,128,128,0.08)' }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="glass-strong beam-border max-h-[86vh] overflow-y-auto rounded-[1.4rem] sm:max-w-lg" style={{ background: 'var(--bg-base)' }}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-right">⚙️ تنظیمات Atlas</DialogTitle>
          <DialogDescription className="text-right">
            موتور فعلی: <strong style={{ color: 'var(--accent)' }}>{engineLabel(s.provider, activeModel)}</strong>
          </DialogDescription>
        </DialogHeader>

        {/* ─── انتخاب پروایدر ─── */}
        <div className="grid gap-2">
          {PROVIDERS.map(p => (
            <button
              key={p.id}
              onClick={() => {
                s.setModel({ provider: p.id })
                // انتخاب جمینای با آدرس خالی → پر کردن پیشفرض عمومی
                if (p.id === 'gemini' && !s.geminiBaseURL.trim()) {
                  s.setModel({ geminiBaseURL: GEMINI_DEFAULT_BASE_URL })
                }
                setTest({ status: 'idle' })
              }}
              data-active={s.provider === p.id}
              className="theme-card flex flex-row items-center gap-3 rounded-2xl p-3 text-right"
              style={{
                border: s.provider === p.id
                  ? '1px solid color-mix(in srgb, var(--accent) 55%, transparent)'
                  : '1px solid var(--glass-border)',
                background: s.provider === p.id ? 'var(--accent-soft)' : 'var(--glass-bg)',
                aspectRatio: 'auto',
                height: 'auto'
              }}
            >
              <span className="text-sm font-semibold">{p.name}</span>
              <span className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>{p.desc}</span>
            </button>
          ))}
        </div>

        {/* ─── Ollama ─── */}
        {s.provider === 'ollama' && (
          <div className="grid gap-2 rounded-2xl p-3 glass">
            <label className="text-xs" style={{ color: 'var(--text-secondary)' }}>آدرس سرور</label>
            <input dir="ltr" value={s.ollamaBaseURL}
              onChange={e => s.setModel({ ollamaBaseURL: e.target.value })}
              className={inputCls} style={inputStyle}
              placeholder="http://localhost:11434/v1" />
            <label className="text-xs" style={{ color: 'var(--text-secondary)' }}>مدل</label>
            <ModelField protocol="ollama" value={s.ollamaModel}
              onChange={id => s.setModel({ ollamaModel: id })}
              conn={conn} />
            <p className="text-[10px] leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
              💡 اجرای سرور محلی: <code dir="ltr">ollama serve</code> — لیست مدلها از همین دکمهٔ ↻ گرفته میشود
            </p>
          </div>
        )}

        {/* ─── API سازگار OpenAI ─── */}
        {s.provider === 'openai' && (
          <div className="grid gap-2 rounded-2xl p-3 glass">
            <label className="text-xs" style={{ color: 'var(--text-secondary)' }}>آدرس پایه</label>
            <input dir="ltr" value={s.apiBaseURL}
              onChange={e => s.setModel({ apiBaseURL: e.target.value })}
              className={inputCls} style={inputStyle}
              placeholder="https://api.openai.com/v1" />
            <label className="text-xs" style={{ color: 'var(--text-secondary)' }}>کلید API</label>
            <input dir="ltr" type="password" value={s.apiKey}
              onChange={e => s.setModel({ apiKey: e.target.value })}
              className={inputCls} style={inputStyle}
              placeholder="sk-..." />
            <label className="text-xs" style={{ color: 'var(--text-secondary)' }}>مدل</label>
            <ModelField protocol="openai" value={s.apiModel}
              onChange={id => s.setModel({ apiModel: id })}
              conn={conn} />
          </div>
        )}

        {/* ─── Anthropic ─── */}
        {s.provider === 'anthropic' && (
          <div className="grid gap-2 rounded-2xl p-3 glass">
            <label className="text-xs" style={{ color: 'var(--text-secondary)' }}>کلید API</label>
            <input dir="ltr" type="password" value={s.anthropicApiKey}
              onChange={e => s.setModel({ anthropicApiKey: e.target.value })}
              className={inputCls} style={inputStyle}
              placeholder="sk-ant-..." />
            <label className="text-xs" style={{ color: 'var(--text-secondary)' }}>مدل</label>
            <ModelField protocol="anthropic" value={s.anthropicModel}
              onChange={id => s.setModel({ anthropicModel: id })}
              conn={conn} />
            <p className="text-[10px] leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
               💡 کلید را از console.anthropic.com بگیر — روی نسخهٔ دسکتاپ درخواستها از پروسهٔ اصلی عبور میکنند (کلید در مرورگر دیده نمیشود)
             </p>
          </div>
        )}

        {/* ─── Gemini ─── */}
        {s.provider === 'gemini' && (
          <div className="grid gap-2 rounded-2xl p-3 glass">
            <label className="text-xs" style={{ color: 'var(--text-secondary)' }}>آدرس پایه</label>
            <input dir="ltr" value={s.geminiBaseURL}
              onChange={e => s.setModel({ geminiBaseURL: e.target.value })}
              className={inputCls} style={inputStyle}
              placeholder={GEMINI_DEFAULT_BASE_URL} />
            <label className="text-xs" style={{ color: 'var(--text-secondary)' }}>کلید API</label>
            <input dir="ltr" type="password" value={s.geminiApiKey}
              onChange={e => s.setModel({ geminiApiKey: e.target.value })}
              className={inputCls} style={inputStyle}
              placeholder="AIza-..." />
            <label className="text-xs" style={{ color: 'var(--text-secondary)' }}>مدل</label>
            <ModelField protocol="openai" value={s.geminiModel}
              onChange={id => s.setModel({ geminiModel: id })}
              conn={conn} />
            <p className="text-[10px] leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
              💡 کلید را از Google AI Studio بگیر — جمینای از نقطهٔ سازگار OpenAI استفاده میکند
            </p>
          </div>
        )}

        {/* ─── تنظیمات هر کار ─── */}
        <div className="grid gap-2">
          <div className="flex items-center justify-between gap-2 px-1">
            <span className="flex items-center gap-1.5 text-sm font-semibold">
              <SlidersHorizontal size={14} />
              تنظیمات هر کار
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => void onExportProviders()}
                className="flex items-center gap-1 text-[11px] underline-offset-2 hover:underline"
                style={{ color: 'var(--text-secondary)' }}
                title="نوشتن کانفیگ فعلی در فایل providers.json"
              >
                <Download size={11} />
                خروجی فایل
              </button>
              <button
                onClick={() => void onImportProviders()}
                className="flex items-center gap-1 text-[11px] underline-offset-2 hover:underline"
                style={{ color: 'var(--text-secondary)' }}
                title="خواندن کانفیگ از فایل providers.json"
              >
                <Upload size={11} />
                ورودی فایل
              </button>
              <button
                onClick={() => s.resetTaskConfigs()}
                className="flex items-center gap-1 text-[11px] underline-offset-2 hover:underline"
                style={{ color: 'var(--text-secondary)' }}
                title="بازنشانی هر ۶ کار از روی تنظیمات سراسری بالا"
              >
                <RotateCcw size={11} />
                بازنشانی از تنظیمات سراسری
              </button>
            </div>
          </div>
          <p className="px-1 text-[11px] leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
            هر کار می‌تواند پرووایدر، کلید و مدل خودش را داشته باشد — در اولین اجرا از تنظیمات سراسری بالا کپی شده‌اند.
            فایل <span className="font-mono" dir="ltr">providers.json</span> را هم می‌توانی دستی ویرایش کنی (به سبک OpenCode)؛ در استارت بعدی خوانده می‌شود.
          </p>
          {TASKS.map(t => <TaskRow key={t.id} task={t.id} />)}
        </div>

        {/* ─── پرامپت سیستم ─── */}
        <div className="grid gap-2 rounded-2xl p-3 glass">
          <label className="text-xs" style={{ color: 'var(--text-secondary)' }}>پرامپت سیستم</label>
          <textarea rows={3} value={s.systemPrompt} maxLength={8000}
            onChange={e => s.setModel({ systemPrompt: e.target.value })}
            className="w-full resize-none rounded-xl bg-transparent px-3 py-2 text-xs leading-relaxed outline-none"
            style={inputStyle} />
          <p className="text-[10px]" style={{ color: 'var(--text-secondary)' }}>
            این پرامپت به پرامپت پایهٔ قفل Atlas زنجیر میشود.
          </p>
        </div>

        {/* ─── حالت عامل (Agent) ─── */}
        <div className="flex items-center justify-between gap-3 rounded-2xl p-3 glass">
          <div className="grid gap-0.5">
            <span className="text-sm font-medium">حالت عامل (Agent)</span>
            <span className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>
              دسترسی ابزارهای سیستمی: شل، فایل، موس، کیبورد، صفحه‌نمایش، حافظه. فقط در نسخهٔ دسکتاپ.
            </span>
          </div>
          <button
            role="switch"
            aria-checked={s.agentEnabled}
            onClick={() => s.setAgentEnabled(!s.agentEnabled)}
            className="relative h-6 w-11 shrink-0 rounded-full transition-colors"
            style={{ background: s.agentEnabled ? 'var(--accent)' : 'rgba(128,128,128,0.3)' }}
            title="حالت عامل"
          >
            <span
              className="absolute top-0.5 size-5 rounded-full bg-white transition-all duration-200"
              style={{ insetInlineStart: s.agentEnabled ? '22px' : '2px' }}
            />
          </button>
        </div>

        {/* ─── تأیید دستورات خطرناک ─── */}
        <div className="flex items-center justify-between gap-3 rounded-2xl p-3 glass">
          <div className="grid gap-0.5">
            <span className="text-sm font-medium">تأیید دستورات خطرناک</span>
            <span className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>
              پیش از اجرای شل یا کشتن فرآیند، دیالوگ تأیید نشان داده شود. فقط در نسخهٔ دسکتاپ.
            </span>
          </div>
          <button
            role="switch"
            aria-checked={confirmDangerous}
            onClick={toggleConfirm}
            className="relative h-6 w-11 shrink-0 rounded-full transition-colors"
            style={{ background: confirmDangerous ? 'var(--accent)' : 'rgba(128,128,128,0.3)' }}
            title="تأیید دستورات خطرناک"
          >
            <span
              className="absolute top-0.5 size-5 rounded-full bg-white transition-all duration-200"
              style={{ insetInlineStart: confirmDangerous ? '22px' : '2px' }}
            />
          </button>
        </div>

        {/* ─── حالت پلن ─── */}
        <div className="flex items-center justify-between gap-3 rounded-2xl p-3 glass">
          <div className="grid gap-0.5">
            <span className="text-sm font-medium">حالت پلن (Plan &amp; Approve)</span>
            <span className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>
              دستورات خطرناک ابتدا در انتظار تأیید میمانند — فقط دسکتاپ.
            </span>
          </div>
          <button
            role="switch"
            aria-checked={s.planMode}
            onClick={() => s.setPlanMode(!s.planMode)}
            className="relative h-6 w-11 shrink-0 rounded-full transition-colors"
            style={{ background: s.planMode ? 'var(--accent)' : 'rgba(128,128,128,0.3)' }}
            title="حالت پلن"
          >
            <span className="absolute top-0.5 size-5 rounded-full bg-white transition-all duration-200" style={{ insetInlineStart: s.planMode ? '22px' : '2px' }} />
          </button>
        </div>

        {/* ─── حریم خصوصی ─── */}
        <div className="flex items-center justify-between gap-3 rounded-2xl p-3 glass">
          <div className="grid gap-0.5">
            <span className="text-sm font-medium">حالت حریم خصوصی</span>
            <span className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>
              فعالیت ابزارهای عامل ثبت نشود (پنل فعالیت خالی میماند).
            </span>
          </div>
          <button
            role="switch"
            aria-checked={s.privacyMode}
            onClick={() => s.setPrivacyMode(!s.privacyMode)}
            className="relative h-6 w-11 shrink-0 rounded-full transition-colors"
            style={{ background: s.privacyMode ? 'var(--accent)' : 'rgba(128,128,128,0.3)' }}
            title="حریم خصوصی"
          >
            <span className="absolute top-0.5 size-5 rounded-full bg-white transition-all duration-200" style={{ insetInlineStart: s.privacyMode ? '22px' : '2px' }} />
          </button>
        </div>

        {/* ─── نتیجهٔ تست ─── */}
        {test.status !== 'idle' && test.status !== 'testing' && (
          <div className={`flex items-center gap-2 rounded-xl px-3 py-2 text-xs ${
            test.status === 'ok' ? 'text-green-400' : 'text-red-400'}`}
            style={{ background: 'rgba(128,128,128,0.08)' }}>
            {test.status === 'ok' ? <CheckCircle2 size={14} /> : <XCircle size={14} />}
            <span>{test.message}</span>
          </div>
        )}

        <DialogFooter className="sm:justify-between">
          <Button variant="outline" size="sm" onClick={runTest} disabled={test.status === 'testing'}
            className="gap-1.5 rounded-xl text-xs">
            {test.status === 'testing' ? <Loader2 size={13} className="animate-spin" /> : <PlugZap size={13} />}
            {test.status === 'testing' ? 'در حال تست...' : 'تست اتصال'}
          </Button>
          <Button size="sm" onClick={() => onOpenChange(false)}
            className="rounded-xl text-xs text-white" style={{ background: 'var(--accent)' }}>
            ذخیره و بستن
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
