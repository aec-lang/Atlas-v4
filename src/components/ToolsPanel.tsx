/**
 * ToolsPanel — میزبان قابلیت‌های پیشرفته Atlas (۱۲ ویژگی):
 * ماکروها، زمان‌بندی، حالت پلن، داشبورد سیستم، RAG محلی، مقایسه مدل‌ها،
 * جستجوی معنایی، بازپخش جلسه، همگام‌سازی ابری.
 */
import { useEffect, useRef, useState, useCallback } from 'react'
import { motion } from 'motion/react'
import {
  X, Save, Trash2, Play, Plus, RefreshCw, Download, Upload,
  Clock, ListTree, Cpu, Search, Layers, Radio, History, Cloud, Plug
} from 'lucide-react'
import { useAui } from '@assistant-ui/react'
import { usePlanStore } from '@/stores/planStore'
import { useMacrosStore, type MacroStep } from '@/stores/macrosStore'
import { useScheduleStore } from '@/stores/scheduleStore'
import { useActivityStore } from '@/stores/activityStore'
import { useToastStore } from '@/stores/toastStore'
import { AnimatedNumber } from '@/components/fx/AnimatedNumber'
import { celebrate } from '@/lib/celebrate'
import { Skeleton } from '@/components/ui/skeleton'
import { useSettingsStore, getTaskConfig } from '@/stores/settingsStore'
import { useConversationsStore, useMessagesStore } from '@/stores/conversationsStore'
import { proxyFetch } from '@/lib/modelCatalog'
import { ragAddDocument, ragList, ragRemove, ragClear, ragQuery, formatRagContext } from '@/lib/rag'
import { semanticQuery, indexConversation } from '@/lib/semanticIndex'
import { syncPush, syncPull, collectSnapshot, applySnapshot } from '@/lib/sync'
import { TasksPanel } from '@/components/TasksPanel'
import { McpPanel } from '@/components/McpPanel'

type Tab = 'macros' | 'schedule' | 'plan' | 'system' | 'rag' | 'ensemble' | 'semantic' | 'replay' | 'sync' | 'tasks' | 'mcp'

const TABS: Array<{ id: Tab; label: string; icon: React.ReactNode }> = [
  { id: 'macros', label: 'ماکروها', icon: <ListTree size={14} /> },
  { id: 'schedule', label: 'زمان‌بندی', icon: <Clock size={14} /> },
  { id: 'tasks', label: 'کارها', icon: <Layers size={14} /> },
  { id: 'mcp', label: 'کانکتورها', icon: <Plug size={14} /> },
  { id: 'plan', label: 'حالت پلن', icon: <Radio size={14} /> },
  { id: 'system', label: 'داشبورد', icon: <Cpu size={14} /> },
  { id: 'rag', label: 'RAG محلی', icon: <Layers size={14} /> },
  { id: 'ensemble', label: 'مقایسه مدل‌ها', icon: <Layers size={14} /> },
  { id: 'semantic', label: 'جستجوی معنایی', icon: <Search size={14} /> },
  { id: 'replay', label: 'بازپخش جلسه', icon: <History size={14} /> },
  { id: 'sync', label: 'همگام‌سازی', icon: <Cloud size={14} /> },
]

export function ToolsPanel({ open, onClose }: { open: boolean; onClose: () => void }): React.JSX.Element | null {
  const [tab, setTab] = useState<Tab>('macros')
  if (!open) return null
  return (
    <div className="fixed inset-0 z-40 flex justify-start" role="dialog" aria-label="ابزارهای Atlas">
      <button aria-label="بستن" className="absolute inset-0 bg-black/40 backdrop-blur-[2px]" onClick={onClose} />
      <aside className="glass-strong beam-border relative z-10 flex h-full w-[28rem] max-w-[94vw] flex-col rounded-none border-l p-4" style={{ background: 'var(--bg-base)' }}>
        <header className="mb-3 flex items-center gap-2">
          <span className="text-xl">🧰</span>
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-bold">ابزارهای پیشرفته</h2>
            <p className="text-[10px]" style={{ color: 'var(--text-secondary)' }}>قابلیت‌های نسخهٔ بعدی Atlas</p>
          </div>
          <button onClick={onClose} className="rounded-xl p-2 glass-hover" style={{ color: 'var(--text-secondary)' }}><X size={16} /></button>
        </header>

        <nav className="mb-3 flex flex-wrap gap-1 rounded-2xl p-1 glass">
          {TABS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className="relative flex items-center gap-1 rounded-xl px-2 py-1 text-[10px] transition-colors"
              style={tab === t.id ? { color: 'var(--accent)' } : { color: 'var(--text-secondary)' }}>
              {tab === t.id && <motion.span layoutId="toolTab" className="absolute inset-0 rounded-xl" style={{ background: 'var(--accent-soft)' }} />}
              <span className="relative z-10 flex items-center gap-1">{t.icon} {t.label}</span>
            </button>
          ))}
        </nav>

        <div className="-mr-1 min-h-0 flex-1 animate-in fade-in slide-in-from-bottom-2 duration-500 overflow-y-auto pl-1">
          {tab === 'macros' && <MacrosTab />}
          {tab === 'schedule' && <ScheduleTab />}
          {tab === 'tasks' && <TasksPanel />}
          {tab === 'mcp' && <McpPanel />}
          {tab === 'plan' && <PlanTab />}
          {tab === 'system' && <SystemTab />}
          {tab === 'rag' && <RagTab />}
          {tab === 'ensemble' && <EnsembleTab />}
          {tab === 'semantic' && <SemanticTab />}
          {tab === 'replay' && <ReplayTab />}
          {tab === 'sync' && <SyncTab />}
        </div>
      </aside>
    </div>
  )
}

/* ─── ماکروها ─── */
function MacrosTab(): React.JSX.Element {
  const macros = useMacrosStore(s => s.macros)
  const save = useMacrosStore(s => s.save)
  const remove = useMacrosStore(s => s.remove)
  const run = useMacrosStore(s => s.run)
  const toast = useToastStore(s => s.push)
  const [name, setName] = useState('')
  const [stepsJson, setStepsJson] = useState('[\n  { "tool": "shell_exec", "args": { "command": "echo hi" } }\n]')
  const [busy, setBusy] = useState(false)

  const saveFromActivity = (): void => {
    const steps: MacroStep[] = useActivityStore.getState().entries
      .filter(e => !e.pending && e.tool !== 'screen_capture' && e.args)
      .slice(0, 8)
      .map(e => ({ tool: e.tool, args: e.args as Record<string, unknown> }))
    if (steps.length === 0) return
    save(name || 'ماکرو از فعالیت اخیر', steps)
    setName('')
  }

  const doRun = async (id: string): Promise<void> => {
    setBusy(true)
    try { await run(id); toast('ماکرو اجرا شد ✓', 'success'); celebrate() }
    catch { toast('خطا در اجرای ماکرو', 'error') }
    finally { setBusy(false) }
  }

  return (
    <div className="grid gap-3">
      <div className="rounded-2xl p-3 glass">
        <p className="mb-2 text-xs font-medium">ماکروی جدید</p>
        <input value={name} onChange={e => setName(e.target.value)} placeholder="نام ماکرو" className="mb-2 w-full rounded-xl bg-transparent px-3 py-2 text-xs outline-none" style={{ background: 'rgba(128,128,128,.08)', color: 'var(--text-primary)' }} />
        <textarea value={stepsJson} onChange={e => setStepsJson(e.target.value)} rows={5} className="w-full resize-none rounded-xl bg-transparent px-3 py-2 text-[11px] font-mono outline-none" style={{ background: 'rgba(128,128,128,.08)', color: 'var(--text-primary)' }} />
        <div className="mt-2 flex gap-2">
          <Button onClick={() => { try { const s = JSON.parse(stepsJson); if (Array.isArray(s)) { save(name, s); setName('') } } catch { alert('فرمت JSON نامعتبر') } }}><Save size={12} /> ذخیره دستی</Button>
          <Button onClick={saveFromActivity}>ذخیره از فعالیت اخیر</Button>
        </div>
      </div>
      {macros.map(m => (
        <div key={m.id} className="flex items-center gap-2 rounded-2xl p-3 glass">
          <div className="min-w-0 flex-1">
            <div className="truncate text-xs font-semibold">{m.name}</div>
            <div className="text-[10px]" style={{ color: 'var(--text-secondary)' }}>{m.steps.length} گام</div>
          </div>
          <Button disabled={busy} onClick={() => void doRun(m.id)}><Play size={12} /> اجرا</Button>
          <button onClick={() => remove(m.id)} className="rounded-xl p-1.5" style={{ color: '#f87171' }}><Trash2 size={13} /></button>
        </div>
      ))}
      {macros.length === 0 && <p className="text-center text-[11px]" style={{ color: 'var(--text-secondary)' }}>هنوز ماکرویی نداری — از فعالیت اخیر بساز 🪄</p>}
    </div>
  )
}

/* ─── زمان‌بندی ─── */
function ScheduleTab(): React.JSX.Element {
  const tasks = useScheduleStore(s => s.tasks)
  const add = useScheduleStore(s => s.add)
  const remove = useScheduleStore(s => s.remove)
  const toggle = useScheduleStore(s => s.toggle)
  const [prompt, setPrompt] = useState('')
  const [at, setAt] = useState('09:00')
  const [everyMin, setEveryMin] = useState('')

  return (
    <div className="grid gap-3">
      <div className="rounded-2xl p-3 glass">
        <p className="mb-2 text-xs font-medium">تسک زمان‌بندی‌شده</p>
        <textarea value={prompt} onChange={e => setPrompt(e.target.value)} rows={2} placeholder="پرامپتی که اجرا شود (مثل: گزارش وضعیت سیستم)" className="mb-2 w-full resize-none rounded-xl bg-transparent px-3 py-2 text-xs outline-none" style={{ background: 'rgba(128,128,128,.08)', color: 'var(--text-primary)' }} />
        <div className="flex items-center gap-2 text-[11px]" style={{ color: 'var(--text-secondary)' }}>
          <label>هر روز ساعت</label>
          <input value={at} onChange={e => setAt(e.target.value)} type="time" className="rounded-lg px-2 py-1" style={{ background: 'rgba(128,128,128,.08)', color: 'var(--text-primary)' }} />
          <label>یا هر</label>
          <input value={everyMin} onChange={e => setEveryMin(e.target.value)} placeholder="۲۰" className="w-14 rounded-lg px-2 py-1" style={{ background: 'rgba(128,128,128,.08)', color: 'var(--text-primary)' }} />
          <label>دقیقه</label>
        </div>
        <div className="mt-2"><Button onClick={() => { if (prompt.trim()) { add({ prompt, at: everyMin ? undefined : at, everyMin: everyMin ? Number(everyMin) : undefined, enabled: true }); setPrompt('') } }}><Plus size={12} /> افزودن</Button></div>
      </div>
      {tasks.map(t => (
        <div key={t.id} className="flex items-center gap-2 rounded-2xl p-3 glass">
          <div className="min-w-0 flex-1">
            <div className="truncate text-xs font-semibold">{t.prompt}</div>
            <div className="text-[10px]" style={{ color: 'var(--text-secondary)' }}>{t.at ? `هر روز ${t.at}` : `هر ${t.everyMin} دقیقه`}{t.lastRun ? ` · آخرین اجرا ${new Date(t.lastRun).toLocaleTimeString('fa-IR')}` : ''}</div>
          </div>
          <Button onClick={() => toggle(t.id)} style={t.enabled ? { color: 'var(--accent)' } : undefined}>{t.enabled ? 'روشن' : 'خاموش'}</Button>
          <button onClick={() => remove(t.id)} className="rounded-xl p-1.5" style={{ color: '#f87171' }}><Trash2 size={13} /></button>
        </div>
      ))}
      {tasks.length === 0 && <p className="text-center text-[11px]" style={{ color: 'var(--text-secondary)' }}>تسکی ثبت نشده — مثلاً «هر روز ۰۹:۰۰ گزارش بده»</p>}
    </div>
  )
}

/* ─── حالت پلن ─── */
function PlanTab(): React.JSX.Element {
  const pending = usePlanStore(s => s.pending)
  const approve = usePlanStore(s => s.approve)
  const reject = usePlanStore(s => s.reject)
  const planMode = useSettingsStore(s => s.planMode)
  const setPlanMode = useSettingsStore(s => s.setPlanMode)
  const toast = useToastStore(s => s.push)
  return (
    <div className="grid gap-3">
      <div className="flex items-center justify-between rounded-2xl p-3 glass">
        <div>
          <div className="text-xs font-medium">حالت پلن (Plan &amp; Approve)</div>
          <div className="text-[10px]" style={{ color: 'var(--text-secondary)' }}>دستورات خطرناک ابتدا در انتظار تأیید میمانند</div>
        </div>
        <Button onClick={() => setPlanMode(!planMode)} style={planMode ? { color: 'var(--accent)' } : undefined}>{planMode ? 'روشن' : 'خاموش'}</Button>
      </div>
      {pending.map(p => (
        <div key={p.id} className="rounded-2xl p-3 glass">
          <div className="text-xs font-semibold">{p.tool}</div>
          <pre className="mt-1 max-h-28 overflow-auto rounded-lg p-2 text-[10px]" style={{ background: 'rgba(128,128,128,.08)', color: 'var(--text-secondary)' }}>{JSON.stringify(p.args, null, 2)}</pre>
          <div className="mt-2 flex gap-2">
            <Button onClick={() => { void approve(p.id); toast('دستور تأیید و اجرا شد ✓', 'success'); celebrate() }} style={{ color: '#4ade80' }}>تأیید و اجرا</Button>
            <Button onClick={() => { reject(p.id); toast('دستور رد شد', 'info') }} style={{ color: '#f87171' }}>رد</Button>
          </div>
        </div>
      ))}
      {pending.length === 0 && <p className="text-center text-[11px]" style={{ color: 'var(--text-secondary)' }}>گام در انتظاری نیست. وقتی ایجنت بخواهد دستور خطرناک اجرا کند اینجا ظاهر میشود.</p>}
    </div>
  )
}

/* ─── داشبورد سیستم ─── */
function SystemTab(): React.JSX.Element {
  const [info, setInfo] = useState<Record<string, unknown> | null>(null)
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)
  const refresh = useCallback(() => {
    const api = (window as unknown as { atlasAPI?: { invokeTool: (t: string, a: Record<string, unknown>) => Promise<Record<string, unknown>> } }).atlasAPI
    api?.invokeTool('system_info', {}).then(r => setInfo(r)).catch(() => {})
  }, [])
  useEffect(() => { refresh(); timer.current = setInterval(refresh, 3000); return () => { if (timer.current) clearInterval(timer.current) } }, [refresh])
  if (!info) return (
    <div className="grid gap-3">
      <div className="grid grid-cols-2 gap-2">
        <Skeleton className="h-14 rounded-2xl" />
        <Skeleton className="h-14 rounded-2xl" />
        <Skeleton className="h-14 rounded-2xl" />
        <Skeleton className="h-14 rounded-2xl" />
      </div>
      <Skeleton className="h-12 rounded-2xl" />
      <p className="text-center text-[11px]" style={{ color: 'var(--text-secondary)' }}>در حال دریافت اطلاعات سیستم… (فقط دسکتاپ)</p>
    </div>
  )
  const total = Number(info.totalMemMB) || 1
  const free = Number(info.freeMemMB) || 0
  const usedPct = Math.round((1 - free / total) * 100)
  return (
    <div className="grid gap-3">
      <div className="grid grid-cols-2 gap-2">
        <Stat label="سیستم" value={String(info.platform)} />
        <Stat label="هسته‌ها" value={String(info.cpus)} />
        <Stat label="نمایشگر" value={String(info.displays)} />
        <Stat label="حافظه کل" value={`${Math.round(total)}MB`} />
      </div>
      <div className="rounded-2xl p-3 glass">
        <div className="mb-1 flex justify-between text-[11px]" style={{ color: 'var(--text-secondary)' }}><span>مصرف حافظه</span><span>{usedPct}%</span></div>
        <div className="h-2 overflow-hidden rounded-full" style={{ background: 'rgba(128,128,128,.15)' }}>
          <div className="h-full rounded-full transition-all duration-700 ease-out" style={{ width: `${usedPct}%`, background: 'linear-gradient(90deg,var(--accent),var(--accent2))' }} />
        </div>
      </div>
      <div className="col-span-2 flex items-center gap-3 rounded-2xl p-3 glass animate-in fade-in zoom-in-95 duration-500">
        <div className="relative h-14 w-14 shrink-0 rounded-full" style={{ background: `conic-gradient(var(--accent) ${usedPct}%, rgba(128,128,128,.15) 0)` }}>
          <div className="absolute inset-[6px] flex items-center justify-center rounded-full" style={{ background: 'var(--bg-base)' }}>
            <span className="text-xs font-semibold">{usedPct}%</span>
          </div>
        </div>
        <div>
          <div className="text-[10px]" style={{ color: 'var(--text-secondary)' }}>حافظهٔ استفاده‌شده</div>
          <div className="text-sm font-semibold">{Math.round(total - free)} / {Math.round(total)} MB</div>
        </div>
      </div>
      <Button onClick={refresh}><RefreshCw size={12} /> بروزرسانی</Button>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }): React.JSX.Element {
  const isNum = /^[0-9.]+$/.test(value)
  return (
    <div className="animate-in fade-in zoom-in-95 rounded-2xl p-3 glass duration-500">
      <div className="text-[10px]" style={{ color: 'var(--text-secondary)' }}>{label}</div>
      <div className="mt-0.5 truncate text-sm font-semibold">{isNum ? <AnimatedNumber value={Number(value)} /> : value}</div>
    </div>
  )
}

/* ─── RAG محلی ─── */
function RagTab(): React.JSX.Element {
  const aui = useAui()
  const toast = useToastStore(s => s.push)
  const [name, setName] = useState('')
  const [docs, setDocs] = useState('')
  const [list, setList] = useState(() => ragList())
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<Array<{ doc: string; chunk: string; score: number }>>([])
  const [busy, setBusy] = useState(false)

  const onFiles = (files: FileList | null): void => {
    if (!files) return
    Array.from(files).forEach(f => {
      const r = new FileReader()
      r.onload = () => setDocs(d => `${d}\n\n=== ${f.name} ===\n${String(r.result ?? '')}`)
      r.readAsText(f)
    })
  }

  const addDoc = async (): Promise<void> => {
    const text = docs.trim()
    if (!text) return
    setBusy(true)
    try {
      await ragAddDocument(name.trim() || `سند ${list.length + 1}`, text)
      setList(ragList())
      setDocs('')
      setName('')
      toast('سند ایمبد و ذخیره شد ✓', 'success')
    } catch (e) {
      toast(`خطا: ${e instanceof Error ? e.message : String(e)}`, 'error')
    } finally {
      setBusy(false)
    }
  }

  const ask = async (): Promise<void> => {
    if (!q.trim()) return
    setBusy(true)
    try {
      const res = await ragQuery(q, 4)
      setHits(res)
      if (res.length === 0) toast('مدرکی یافت نشد — ابتدا سند اضافه کن', 'error')
    } finally {
      setBusy(false)
    }
  }

  const sendToChat = (): void => {
    const ctx = formatRagContext(hits)
    if (!ctx) return
    aui.thread.append(`${ctx}\n\nسوال: ${q}`)
    setQ('')
    setHits([])
  }

  return (
    <div className="grid gap-3">
      <div className="rounded-2xl p-3 glass">
        <p className="mb-2 text-xs font-medium">افزودن سند به ایندکس RAG</p>
        <input value={name} onChange={e => setName(e.target.value)} placeholder="نام سند (اختیاری)" className="mb-2 w-full rounded-lg px-2 py-1 text-[11px] outline-none" style={{ background: 'rgba(128,128,128,.08)', color: 'var(--text-primary)' }} />
        <textarea value={docs} onChange={e => setDocs(e.target.value)} rows={5} placeholder="متن اسناد را بچسبان یا فایل اضافه کن…" className="w-full resize-none rounded-xl bg-transparent px-3 py-2 text-[11px] outline-none" style={{ background: 'rgba(128,128,128,.08)', color: 'var(--text-primary)' }} />
        <div className="mt-2 flex items-center gap-2">
          <input type="file" multiple hidden id="rag-files" onChange={e => onFiles(e.target.files)} />
          <Button asLabel htmlFor="rag-files">افزودن فایل</Button>
          <Button disabled={busy} onClick={() => void addDoc()}>ذخیره سند</Button>
        </div>
      </div>

      {list.length > 0 && (
        <div className="rounded-2xl p-3 glass">
          <div className="mb-1 flex items-center justify-between text-[11px]" style={{ color: 'var(--text-secondary)' }}>
            <span>اسناد ایندکس‌شده ({list.length})</span>
            <button className="underline" onClick={() => { ragClear(); setList([]) }}>پاکسازی</button>
          </div>
          <div className="flex flex-wrap gap-1">
            {list.map(d => (
              <span key={d.id} className="flex items-center gap-1 rounded-lg px-2 py-1 text-[10px]" style={{ background: 'var(--accent-soft)' }}>
                {d.name}
                <button onClick={() => { ragRemove(d.id); setList(ragList()) }}>✕</button>
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="flex gap-2">
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="سوال از مدارک…" className="flex-1 rounded-xl bg-transparent px-3 py-2 text-xs outline-none" style={{ background: 'rgba(128,128,128,.08)', color: 'var(--text-primary)' }} />
        <Button disabled={busy} onClick={() => void ask()}>جستجو</Button>
      </div>

      {hits.map((h, i) => (
        <div key={i} className="rounded-2xl p-3 glass">
          <div className="mb-1 flex items-center justify-between text-[10px]" style={{ color: 'var(--text-secondary)' }}>
            <span>{h.doc}</span><span>نمره {h.score.toFixed(2)}</span>
          </div>
          <pre className="max-h-28 overflow-auto text-[10px] leading-relaxed" style={{ color: 'var(--text-primary)' }}>{h.chunk}</pre>
        </div>
      ))}

      {hits.length > 0 && <Button onClick={sendToChat}>ارسال منابع به چت</Button>}
      <p className="text-[10px] leading-relaxed" style={{ color: 'var(--text-secondary)' }}>هر سند به تکه‌های کوچک تقسیم، ایمبد و در دستگاه ذخیره میشود. با Ollama + nomic-embed-text دقت واقعی؛ در غیر این صورت بردار محلی آفلاین.</p>
    </div>
  )
}

/* ─── مقایسه مدل‌ها (Ensemble) ─── */
function chatCompletion(opts: { baseURL: string; key: string; model: string; prompt: string }): Promise<string> {
  const base = opts.baseURL.replace(/\/+$/, '')
  return proxyFetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(opts.key ? { Authorization: `Bearer ${opts.key}` } : {}) },
    body: JSON.stringify({ model: opts.model, messages: [{ role: 'user', content: opts.prompt }], max_tokens: 600, stream: false }),
  }).then(async r => {
    const j = await r.json().catch(() => ({})) as { choices?: Array<{ message?: { content?: string } }> }
    return j.choices?.[0]?.message?.content ?? '(پاسخی دریافت نشد)'
  })
}

function EnsembleTab(): React.JSX.Element {
  // مدل A: موتور «چت متنی» از کانفیگ task خودش (نه تنظیمات سراسری)
  const cfg = getTaskConfig('text-chat')
  const [prompt, setPrompt] = useState('')
  const [bModel, setBModel] = useState('')
  const [bUrl, setBUrl] = useState('http://localhost:11434/v1')
  const [bKey, setBKey] = useState('')
  const [a, setA] = useState('')
  const [b, setB] = useState('')
  const [busy, setBusy] = useState(false)
  const run = async (): Promise<void> => {
    if (!prompt.trim() || !bModel.trim()) return
    setBusy(true)
    const aBase = cfg.baseURL
    const aKey = cfg.provider === 'ollama' ? '' : cfg.apiKey
    const aModel = cfg.model
    try {
      const [ra, rb] = await Promise.all([
        chatCompletion({ baseURL: aBase, key: aKey, model: aModel, prompt }),
        chatCompletion({ baseURL: bUrl, key: bKey, model: bModel, prompt }),
      ])
      setA(ra); setB(rb)
    } finally { setBusy(false) }
  }
  return (
    <div className="grid gap-3">
      <textarea value={prompt} onChange={e => setPrompt(e.target.value)} rows={2} placeholder="پرامپت مشترک برای مقایسهٔ دو مدل…" className="w-full resize-none rounded-xl bg-transparent px-3 py-2 text-xs outline-none" style={{ background: 'rgba(128,128,128,.08)', color: 'var(--text-primary)' }} />
      <div className="rounded-2xl p-3 glass">
        <p className="mb-1 text-[11px]" style={{ color: 'var(--text-secondary)' }}>مدل دوم (سازگار با OpenAI)</p>
        <input value={bUrl} onChange={e => setBUrl(e.target.value)} placeholder="baseURL" className="mb-1 w-full rounded-lg px-2 py-1 text-[11px]" style={{ background: 'rgba(128,128,128,.08)', color: 'var(--text-primary)' }} />
        <input value={bModel} onChange={e => setBModel(e.target.value)} placeholder="نام مدل" className="mb-1 w-full rounded-lg px-2 py-1 text-[11px]" style={{ background: 'rgba(128,128,128,.08)', color: 'var(--text-primary)' }} />
        <input value={bKey} onChange={e => setBKey(e.target.value)} placeholder="کلید (اختیاری)" className="w-full rounded-lg px-2 py-1 text-[11px]" style={{ background: 'rgba(128,128,128,.08)', color: 'var(--text-primary)' }} />
      </div>
      <Button disabled={busy} onClick={() => void run()}>{busy ? 'در حال مقایسه…' : 'مقایسه'}</Button>
      {(a || b) && (
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-2xl p-3 glass text-[11px] leading-relaxed"><div className="mb-1 font-semibold" style={{ color: 'var(--accent)' }}>مدل ۱</div>{a}</div>
          <div className="rounded-2xl p-3 glass text-[11px] leading-relaxed"><div className="mb-1 font-semibold" style={{ color: 'var(--accent2)' }}>مدل ۲</div>{b}</div>
        </div>
      )}
    </div>
  )
}

/* ─── جستجوی معنایی (MVP) ─── */
function SemanticTab(): React.JSX.Element {
  const [q, setQ] = useState('')
  const [ranked, setRanked] = useState<Array<{ id: string; title: string; score: number }>>([])
  const [busy, setBusy] = useState(false)
  const run = async (): Promise<void> => {
    if (!q.trim()) return
    setBusy(true)
    try {
      const convs = useConversationsStore.getState().conversations
      // ایندکس‌سازیِ کامل (فقط در صورت تغییر متن دوباره ایمبد میشود)
      await Promise.all(
        convs.map(c => {
          const t = useMessagesStore.getState().threads[c.id]
          const text = `${c.title}\n${(t?.repository ? JSON.stringify(t.repository) : '')}`.slice(0, 6000)
          return indexConversation(c.id, text)
        })
      )
      const res = await semanticQuery(q, 8)
      const byId = new Map(convs.map(c => [c.id, c.title]))
      setRanked(res.map(r => ({ id: r.id, title: byId.get(r.id) ?? r.id, score: r.score })))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="grid gap-3">
      <div className="flex gap-2">
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="جستجوی معنایی در مکالمه‌ها…" className="flex-1 rounded-xl bg-transparent px-3 py-2 text-xs outline-none" style={{ background: 'rgba(128,128,128,.08)', color: 'var(--text-primary)' }} />
        <Button disabled={busy} onClick={() => void run()}>جستجو</Button>
      </div>
      {ranked.map(r => (
        <div key={r.id} className="flex items-center gap-2 rounded-2xl p-3 glass">
          <div className="min-w-0 flex-1 truncate text-xs">{r.title}</div>
          <span className="text-[10px]" style={{ color: 'var(--text-secondary)' }}>نمره {r.score.toFixed(2)}</span>
        </div>
      ))}
      {ranked.length === 0 && !busy && <p className="text-center text-[11px]" style={{ color: 'var(--text-secondary)' }}>ایندکس معنایی از مکالمه‌ها ساخته میشود (با Ollama دقیق، وگرنه بردار محلی آفلاین).</p>}
    </div>
  )
}

/* ─── بازپخش جلسه ─── */
function ReplayTab(): React.JSX.Element {
  const entries = useActivityStore(s => s.entries)
  const [i, setI] = useState(0)
  const exportJson = (): void => {
    const blob = new Blob([JSON.stringify(entries, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = 'atlas-session.json'; a.click()
    URL.revokeObjectURL(url)
  }
  const cur = entries[i]
  return (
    <div className="grid gap-3">
      <Button onClick={exportJson}><Download size={12} /> خروجی جلسه (JSON)</Button>
      {entries.length === 0 && <p className="text-center text-[11px]" style={{ color: 'var(--text-secondary)' }}>فعالیتی برای بازپخش ثبت نشده.</p>}
      {cur && (
        <div className="rounded-2xl p-3 glass">
          <div className="flex items-center justify-between text-[11px]" style={{ color: 'var(--text-secondary)' }}>
            <span>{i + 1} / {entries.length}</span>
            <span>{new Date(cur.ts).toLocaleTimeString('fa-IR')}</span>
          </div>
          <div className="mt-1 text-sm font-semibold">{cur.tool}{cur.pending ? ' (در انتظار)' : ''}</div>
          <pre className="mt-1 max-h-40 overflow-auto rounded-lg p-2 text-[10px]" style={{ background: 'rgba(128,128,128,.08)', color: 'var(--text-secondary)' }}>{JSON.stringify(cur.args ?? cur.result ?? cur.error ?? {}, null, 2)}</pre>
          <div className="mt-2 flex gap-2">
            <Button disabled={i === 0} onClick={() => setI(i - 1)}>قبلی</Button>
            <Button disabled={i === entries.length - 1} onClick={() => setI(i + 1)}>بعدی</Button>
          </div>
        </div>
      )}
    </div>
  )
}

/* ─── همگام‌سازی ابری (export/import) ─── */
function SyncTab(): React.JSX.Element {
  const toast = useToastStore(s => s.push)
  const s = useSettingsStore()
  const [status, setStatus] = useState<string>('')
  const [busy, setBusy] = useState(false)

  const exportAll = (): void => {
    const snap = collectSnapshot()
    const blob = new Blob([JSON.stringify(snap, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = 'atlas-backup.json'; a.click()
    URL.revokeObjectURL(url)
    toast('پشتیبان خروجی گرفته شد ✓', 'success'); celebrate()
  }
  const importAll = (file: File): void => {
    const r = new FileReader()
    r.onload = () => {
      try {
        const snap = JSON.parse(String(r.result ?? '')) as Parameters<typeof applySnapshot>[0]
        const res = applySnapshot(snap)
        if (res.ok) { toast(res.message, 'success'); setStatus(res.message) }
        else toast(res.message, 'error')
      } catch { toast('فایل پشتیبان نامعتبر', 'error') }
    }
    r.readAsText(file)
  }
  const pushRemote = async (): Promise<void> => {
    setBusy(true)
    try {
      const res = await syncPush({ endpoint: s.syncEndpoint, token: s.syncToken })
      setStatus(res.message)
      toast(res.message, res.ok ? 'success' : 'error')
    } finally { setBusy(false) }
  }
  const pullRemote = async (): Promise<void> => {
    setBusy(true)
    try {
      const res = await syncPull({ endpoint: s.syncEndpoint, token: s.syncToken })
      setStatus(res.message)
      toast(res.message, res.ok ? 'success' : 'error')
    } finally { setBusy(false) }
  }

  return (
    <div className="grid gap-3">
      <p className="text-[11px] leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
        همگام‌سازی Atlas: پشتیبان محلی (export/import) یا Push/Pull به یک نقطهٔ پایانی REST (سرور شخصی / WebDAV / صندوقچه). ادغام آخرین نوشته.
      </p>

      <div className="rounded-2xl p-3 glass">
        <p className="mb-1 text-[11px]" style={{ color: 'var(--text-secondary)' }}>تنظیمات ریموت</p>
        <select value={s.syncMode} onChange={e => s.setSyncMode(e.target.value as 'off' | 'local' | 'remote')} className="mb-2 w-full rounded-lg px-2 py-1 text-[11px] outline-none" style={{ background: 'rgba(128,128,128,.08)', color: 'var(--text-primary)' }}>
          <option value="off">خاموش</option>
          <option value="local">محلی (export/import)</option>
          <option value="remote">ریموت (REST)</option>
        </select>
        <input value={s.syncEndpoint} onChange={e => s.setSyncEndpoint(e.target.value)} placeholder="https://sync.example.com/atlas.json" className="mb-2 w-full rounded-lg px-2 py-1 text-[11px] outline-none" style={{ background: 'rgba(128,128,128,.08)', color: 'var(--text-primary)' }} />
        <input value={s.syncToken} onChange={e => s.setSyncToken(e.target.value)} placeholder="توکن (اختیاری)" type="password" className="w-full rounded-lg px-2 py-1 text-[11px] outline-none" style={{ background: 'rgba(128,128,128,.08)', color: 'var(--text-primary)' }} />
      </div>

      <div className="flex flex-wrap gap-2">
        <Button onClick={exportAll}><Download size={12} /> خروجی (backup)</Button>
        <input type="file" accept="application/json" hidden id="sync-in" onChange={e => { const f = e.target.files?.[0]; if (f) importAll(f) }} />
        <Button asLabel htmlFor="sync-in"><Upload size={12} /> وارد کردن</Button>
      </div>

      {s.syncMode === 'remote' && (
        <div className="flex flex-wrap gap-2">
          <Button disabled={busy} onClick={() => void pushRemote()}><Cloud size={12} /> Push (بارگذاری)</Button>
          <Button disabled={busy} onClick={() => void pullRemote()}><RefreshCw size={12} /> Pull (دریافت)</Button>
        </div>
      )}
      {status && <p className="text-[10px]" style={{ color: 'var(--text-secondary)' }}>{status}</p>}
    </div>
  )
}

/* دکمهٔ مشترک (با امکان label برای input مخفی) */
function Button({ children, onClick, asLabel, htmlFor, disabled, style }: {
  children: React.ReactNode; onClick?: () => void; asLabel?: boolean; htmlFor?: string; disabled?: boolean; style?: React.CSSProperties
}): React.JSX.Element {
  if (asLabel) return <label htmlFor={htmlFor} className="glass glass-hover inline-flex cursor-pointer items-center gap-1.5 rounded-xl px-3 py-1.5 text-[11px]" style={style}>{children}</label>
  return <button onClick={onClick} disabled={disabled} className="glass glass-hover inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-[11px] disabled:opacity-40" style={style}>{children}</button>
}
