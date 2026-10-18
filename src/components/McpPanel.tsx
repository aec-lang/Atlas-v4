/**
 * McpPanel — پنل «کانکتورها»: مدیریت سرورهای MCP.
 * لیست سرورها با چراغ وضعیت، تاگل فعال‌سازی، افزودن (پیشنهادی/کاستوم)،
 * حذف، دیدن ابزارها و تست اتصال. بدون ایموجی؛ فقط آیکون Lucide. لیبل‌ها فارسی.
 */
import { useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  FlaskConical,
  Globe,
  Loader2,
  Plug,
  PlugZap,
  Plus,
  RefreshCw,
  SquareTerminal,
  Trash2,
  Wrench,
  X,
  XCircle,
} from 'lucide-react'
import { useMcpStore } from '@/stores/mcpStore'
import { CURATED_MCP_SERVERS, curatedToConfig, type CuratedMcpServer } from '@/lib/mcpCurated'
import type { McpServerConfig, McpServerInfo, McpServerStatus, McpToolDef } from '@/types/atlas-api'
import { cn } from '@/lib/utils'

type SubTab = 'list' | 'add'

const STATUS_META: Record<McpServerStatus, { label: string; dot: string; text: string }> = {
  connected: { label: 'متصل', dot: 'bg-emerald-400', text: 'text-emerald-400' },
  error: { label: 'خطا', dot: 'bg-red-400', text: 'text-red-400' },
  disabled: { label: 'خاموش', dot: 'bg-zinc-500', text: 'text-zinc-500' },
  idle: { label: 'در انتظار', dot: 'bg-amber-400', text: 'text-amber-400' },
}

function MiniButton(props: React.ButtonHTMLAttributes<HTMLButtonElement> & { danger?: boolean }) {
  const { danger, className, ...rest } = props
  return (
    <button
      {...rest}
      className={cn(
        'flex items-center gap-1 rounded-xl px-2.5 py-1.5 text-[11px] transition-colors',
        danger ? 'text-red-400 hover:bg-red-500/10' : 'hover:bg-white/5',
        className,
      )}
      style={danger ? undefined : { color: 'var(--text-secondary)' }}
    />
  )
}

function Toggle({ on, onChange, disabled }: { on: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onChange(!on)}
      aria-pressed={on}
      className={cn(
        'relative h-5 w-9 shrink-0 rounded-full transition-colors',
        on ? 'bg-emerald-500/70' : 'bg-white/10',
        disabled && 'opacity-40',
      )}
    >
      <span
        className={cn(
          'absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all',
          on ? 'right-0.5' : 'right-[18px]',
        )}
      />
    </button>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>{label}</span>
      {children}
    </label>
  )
}

const inputCls =
  'w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs outline-none focus:border-white/25'

/* ─── ویرایشگر key/value برای env و headers ─── */
function KvEditor({ pairs, onChange }: { pairs: Record<string, string>; onChange: (p: Record<string, string>) => void }) {
  const rows = useMemo(() => Object.entries(pairs), [pairs])
  const [nk, setNk] = useState('')
  const [nv, setNv] = useState('')
  return (
    <div className="space-y-1.5">
      {rows.map(([k, v]) => (
        <div key={k} className="flex items-center gap-1.5">
          <code className="shrink-0 rounded-lg bg-white/5 px-2 py-1.5 font-mono text-[11px]" dir="ltr">{k}</code>
          <input
            className={cn(inputCls, 'flex-1')}
            value={v}
            dir="ltr"
            placeholder="مقدار…"
            onChange={e => onChange({ ...pairs, [k]: e.target.value })}
          />
          <MiniButton danger onClick={() => { const n = { ...pairs }; delete n[k]; onChange(n) }} aria-label="حذف">
            <Trash2 size={13} />
          </MiniButton>
        </div>
      ))}
      <div className="flex items-center gap-1.5">
        <input className={cn(inputCls, 'w-32')} value={nk} dir="ltr" placeholder="KEY" onChange={e => setNk(e.target.value)} />
        <input className={cn(inputCls, 'flex-1')} value={nv} dir="ltr" placeholder="مقدار…" onChange={e => setNv(e.target.value)} />
        <MiniButton
          onClick={() => { if (nk.trim()) { onChange({ ...pairs, [nk.trim()]: nv }); setNk(''); setNv('') } }}
        >
          <Plus size={13} /> افزودن
        </MiniButton>
      </div>
    </div>
  )
}

/* ─── کارت یک سرور ─── */
function ServerCard({ info }: { info: McpServerInfo }) {
  const { config } = info
  const toggleServer = useMcpStore(s => s.toggleServer)
  const removeServer = useMcpStore(s => s.removeServer)
  const testServer = useMcpStore(s => s.testServer)
  const fetchTools = useMcpStore(s => s.fetchTools)
  const updateServer = useMcpStore(s => s.updateServer)
  const busy = useMcpStore(s => s.busy)
  const [open, setOpen] = useState(false)
  const [tools, setTools] = useState<McpToolDef[] | null>(null)
  const [toolsLoading, setToolsLoading] = useState(false)
  const [confirmDel, setConfirmDel] = useState(false)
  const meta = STATUS_META[info.status]
  const missingEnv = useMemo(
    () => Object.entries(config.env ?? {}).filter(([, v]) => !v.trim()).map(([k]) => k),
    [config.env],
  )

  const loadTools = async () => {
    if (tools || toolsLoading) return
    setToolsLoading(true)
    try { setTools(await fetchTools(config.id)) } finally { setToolsLoading(false) }
  }

  return (
    <div className="glass rounded-2xl p-3">
      <div className="flex items-center gap-2">
        <span className={cn('h-2.5 w-2.5 shrink-0 rounded-full', meta.dot)} title={meta.label} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-sm font-medium">{config.name}</span>
            {config.curated && (
              <span className="rounded-full bg-white/5 px-2 py-0.5 text-[10px]" style={{ color: 'var(--text-secondary)' }}>
                پیشنهادی
              </span>
            )}
          </div>
          <div className="mt-0.5 flex items-center gap-1.5 text-[11px]" style={{ color: 'var(--text-secondary)' }}>
            {config.transport === 'stdio' ? <SquareTerminal size={11} /> : <Globe size={11} />}
            <span dir="ltr" className="truncate font-mono">
              {config.transport === 'stdio' ? `${config.command} ${(config.args ?? []).join(' ')}`.trim().slice(0, 48) : (config.url ?? '').slice(0, 48)}
            </span>
            <span className={meta.text}>· {meta.label}</span>
          </div>
        </div>
        <Toggle on={config.enabled} disabled={busy} onChange={v => void toggleServer(config.id, v)} />
        <button
          onClick={() => { setOpen(o => !o); if (!open) void loadTools() }}
          className="rounded-lg p-1.5 hover:bg-white/5"
          style={{ color: 'var(--text-secondary)' }}
          aria-label="جزئیات"
        >
          <ChevronDown size={15} className={cn('transition-transform', open && 'rotate-180')} />
        </button>
      </div>

      {info.error && (
        <div className="mt-2 rounded-xl bg-red-500/10 px-2.5 py-1.5 text-[11px] text-red-400" dir="ltr">
          {info.error}
        </div>
      )}
      {missingEnv.length > 0 && config.enabled && (
        <div className="mt-2 rounded-xl bg-amber-500/10 px-2.5 py-1.5 text-[11px] text-amber-300">
          این مقادیر خالی‌اند: {missingEnv.join('، ')} — جزئیات را باز کن و پرشان کن.
        </div>
      )}

      {open && (
        <div className="mt-2 space-y-2 border-t border-white/5 pt-2">
          <div className="flex flex-wrap gap-1">
            <MiniButton disabled={busy} onClick={() => void testServer(config.id)}>
              {busy ? <Loader2 size={13} className="animate-spin" /> : <FlaskConical size={13} />}
              تست اتصال
            </MiniButton>
            {!confirmDel ? (
              <MiniButton danger onClick={() => setConfirmDel(true)}>
                <Trash2 size={13} /> حذف
              </MiniButton>
            ) : (
              <>
                <MiniButton danger onClick={() => void removeServer(config.id)}>بله، حذف کن</MiniButton>
                <MiniButton onClick={() => setConfirmDel(false)}>انصراف</MiniButton>
              </>
            )}
          </div>

          <div>
            <div className="mb-1 text-[11px] font-medium" style={{ color: 'var(--text-secondary)' }}>
              متغیرهای محیطی {toolsLoading ? '(در حال خواندن ابزارها…)' : tools ? `(${tools.length} ابزار)` : ''}
            </div>
            <KvEditor pairs={config.env ?? {}} onChange={p => void updateServer(config.id, { env: p })} />
          </div>

          {tools && tools.length > 0 && (
            <div className="max-h-44 space-y-1 overflow-y-auto rounded-xl bg-black/20 p-2">
              {tools.map(t => (
                <div key={t.name} className="text-[11px]">
                  <code dir="ltr" className="font-mono text-sky-300">{t.name}</code>
                  {t.description && (
                    <div className="mt-0.5 line-clamp-2" style={{ color: 'var(--text-secondary)' }} dir="auto">
                      {t.description.slice(0, 160)}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
          {tools && tools.length === 0 && !toolsLoading && (
            <div className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>
              ابزاری یافت نشد — اول «تست اتصال» را بزن.
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/* ─── کارت پیشنهادی (یک‌کلیک) ─── */
function CuratedCard({ item, added, onAdd }: { item: CuratedMcpServer; added: boolean; onAdd: () => void }) {
  return (
    <div className="glass flex items-center gap-2 rounded-2xl p-2.5">
      <PlugZap size={16} className="shrink-0 text-sky-300" />
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-medium">{item.nameFa}</div>
        <div className="truncate text-[11px]" style={{ color: 'var(--text-secondary)' }}>{item.descriptionFa}</div>
        <div className="mt-0.5 truncate font-mono text-[10px]" dir="ltr" style={{ color: 'var(--text-secondary)' }}>
          {item.command} {item.args.filter(a => a).join(' ')}
        </div>
      </div>
      {added ? (
        <span className="flex shrink-0 items-center gap-1 text-[11px] text-emerald-400">
          <CheckCircle2 size={13} /> افزوده شد
        </span>
      ) : (
        <MiniButton onClick={onAdd}>
          <Plus size={13} /> افزودن
        </MiniButton>
      )}
    </div>
  )
}

/* ─── فرم سرور کاستوم ─── */
function CustomForm({ onDone }: { onDone: () => void }) {
  const addServer = useMcpStore(s => s.addServer)
  const [name, setName] = useState('')
  const [transport, setTransport] = useState<'stdio' | 'http'>('stdio')
  const [command, setCommand] = useState('npx')
  const [argsText, setArgsText] = useState('-y\n@modelcontextprotocol/server-…')
  const [env, setEnv] = useState<Record<string, string>>({})
  const [url, setUrl] = useState('')
  const [headers, setHeaders] = useState<Record<string, string>>({})
  const [ackRisk, setAckRisk] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    setError(null)
    const id = name.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '').slice(0, 32)
    if (!id) { setError('نام سرور لازم است.'); return }
    let cfg: McpServerConfig
    if (transport === 'stdio') {
      if (!command.trim()) { setError('دستور (command) لازم است.'); return }
      if (!ackRisk) { setError('برای سرور stdio باید هشدار امنیتی را تأیید کنی.'); return }
      cfg = {
        id, name: name.trim().slice(0, 80), transport,
        command: command.trim(),
        args: argsText.split('\n').map(a => a.trim()).filter(Boolean),
        env, enabled: true,
      }
    } else {
      if (!url.trim()) { setError('آدرس سرور (URL) لازم است.'); return }
      try { new URL(url.trim()) } catch { setError('آدرس معتبر نیست.'); return }
      cfg = { id, name: name.trim().slice(0, 80), transport, url: url.trim(), headers, enabled: true }
    }
    setSaving(true)
    try {
      const ok = await addServer(cfg)
      if (!ok) { setError('سروری با این نام از قبل هست.'); return }
      onDone()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="glass space-y-3 rounded-2xl p-3">
      <div className="text-sm font-medium">سرور کاستوم</div>
      <Field label="نام نمایشی">
        <input className={inputCls} value={name} onChange={e => setName(e.target.value)} placeholder="مثلاً سرور من" />
      </Field>
      <div className="flex gap-1.5">
        {(['stdio', 'http'] as const).map(t => (
          <button
            key={t}
            onClick={() => setTransport(t)}
            className={cn('flex flex-1 items-center justify-center gap-1.5 rounded-xl border px-3 py-2 text-xs transition-colors',
              transport === t ? 'border-white/25 bg-white/10' : 'border-white/5 hover:bg-white/5')}
          >
            {t === 'stdio' ? <SquareTerminal size={13} /> : <Globe size={13} />}
            {t === 'stdio' ? 'دستوری (stdio)' : 'تحت وب (HTTP)'}
          </button>
        ))}
      </div>

      {transport === 'stdio' ? (
        <>
          <Field label="دستور (command)">
            <input className={inputCls} value={command} dir="ltr" onChange={e => setCommand(e.target.value)} placeholder="npx" />
          </Field>
          <Field label="آرگومان‌ها (هر خط یکی)">
            <textarea className={cn(inputCls, 'min-h-16 font-mono')} dir="ltr" value={argsText} onChange={e => setArgsText(e.target.value)} />
          </Field>
          <Field label="متغیرهای محیطی (کلیدها)">
            <KvEditor pairs={env} onChange={setEnv} />
          </Field>
          <div className="rounded-2xl border border-amber-400/30 bg-amber-500/10 p-3">
            <div className="flex items-start gap-2 text-[12px] text-amber-200">
              <AlertTriangle size={15} className="mt-0.5 shrink-0" />
              <div>
                <b>هشدار امنیتی:</b> سرور stdio می‌تواند <b>هر دستوری</b> روی سیستم شما اجرا کند
                (خواندن/حذف فایل، اجرای برنامه…). فقط سرورهایی را اضافه کن که به منبع‌شان
                اعتماد داری و دستورشان را می‌فهمی.
              </div>
            </div>
            <label className="mt-2 flex cursor-pointer items-center gap-2 text-[12px]" style={{ color: 'var(--text-secondary)' }}>
              <input type="checkbox" checked={ackRisk} onChange={e => setAckRisk(e.target.checked)} className="h-4 w-4 accent-amber-400" />
              می‌فهمم و تأیید می‌کنم
            </label>
          </div>
        </>
      ) : (
        <>
          <Field label="آدرس سرور (URL)">
            <input className={inputCls} value={url} dir="ltr" onChange={e => setUrl(e.target.value)} placeholder="https://example.com/mcp" />
          </Field>
          <Field label="هدرها (مثل Authorization)">
            <KvEditor pairs={headers} onChange={setHeaders} />
          </Field>
        </>
      )}

      {error && <div className="text-[12px] text-red-400">{error}</div>}
      <button
        onClick={() => void submit()}
        disabled={saving}
        className="flex w-full items-center justify-center gap-1.5 rounded-2xl px-4 py-2.5 text-sm font-medium text-white transition-opacity disabled:opacity-50"
        style={{ background: 'var(--accent)' }}
      >
        {saving ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />}
        افزودن سرور
      </button>
    </div>
  )
}

/* ─── پنل اصلی ─── */
export function McpPanel(): React.JSX.Element {
  const servers = useMcpStore(s => s.servers)
  const loaded = useMcpStore(s => s.loaded)
  const busy = useMcpStore(s => s.busy)
  const error = useMcpStore(s => s.error)
  const lastTest = useMcpStore(s => s.lastTest)
  const refresh = useMcpStore(s => s.refresh)
  const addServer = useMcpStore(s => s.addServer)
  const clearTest = useMcpStore(s => s.clearTest)
  const [tab, setTab] = useState<SubTab>('list')

  useEffect(() => { void refresh() }, [refresh])
  useEffect(() => {
    if (!lastTest) return
    const t = setTimeout(() => clearTest(), 8000)
    return () => clearTimeout(t)
  }, [lastTest, clearTest])

  const addedIds = useMemo(() => new Set(servers.map(s => s.config.id)), [servers])

  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto p-1">
      <div className="flex items-center gap-2">
        <Plug size={16} style={{ color: 'var(--accent)' }} />
        <div className="flex-1">
          <div className="text-sm font-medium">کانکتورها (MCP)</div>
          <div className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>
            صدها ابزار آماده: گیت‌هاب، وب، دیتابیس و…
          </div>
        </div>
        <MiniButton onClick={() => void refresh()} disabled={busy} aria-label="به‌روزرسانی">
          <RefreshCw size={13} className={busy ? 'animate-spin' : ''} />
        </MiniButton>
      </div>

      <div className="flex gap-1.5">
        {(['list', 'add'] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn('flex-1 rounded-xl px-3 py-2 text-xs transition-colors',
              tab === t ? 'bg-white/10 font-medium' : 'hover:bg-white/5')}
            style={tab === t ? { color: 'var(--text)' } : { color: 'var(--text-secondary)' }}
          >
            {t === 'list' ? `سرورها (${servers.length})` : 'افزودن سرور'}
          </button>
        ))}
      </div>

      {lastTest && (
        <div className={cn('flex items-center gap-2 rounded-2xl px-3 py-2 text-[12px]',
          lastTest.ok ? 'bg-emerald-500/10 text-emerald-300' : 'bg-red-500/10 text-red-300')}>
          {lastTest.ok ? <CheckCircle2 size={14} /> : <XCircle size={14} />}
          <span className="flex-1">{lastTest.message}</span>
          <button onClick={() => clearTest()} className="opacity-60 hover:opacity-100" aria-label="بستن">
            <X size={13} />
          </button>
        </div>
      )}

      {error && (
        <div className="rounded-2xl bg-red-500/10 px-3 py-2 text-[12px] text-red-300">{error}</div>
      )}

      {tab === 'list' && (
        <div className="space-y-2">
          {!loaded ? (
            <div className="flex items-center justify-center gap-2 py-8 text-[12px]" style={{ color: 'var(--text-secondary)' }}>
              <Loader2 size={14} className="animate-spin" /> در حال خواندن…
            </div>
          ) : servers.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-white/10 p-6 text-center text-[12px]" style={{ color: 'var(--text-secondary)' }}>
              <Wrench size={20} className="mx-auto mb-2 opacity-50" />
              هنوز سروری اضافه نشده — از تب «افزودن سرور» یکی از پیشنهادها را با یک کلیک اضافه کن.
            </div>
          ) : (
            servers.map(s => <ServerCard key={s.config.id} info={s} />)
          )}
        </div>
      )}

      {tab === 'add' && (
        <div className="space-y-2">
          <div className="text-[12px] font-medium" style={{ color: 'var(--text-secondary)' }}>پیشنهادی — با یک کلیک</div>
          {CURATED_MCP_SERVERS.map(c => (
            <div key={c.id}>
              <CuratedCard
                item={c}
                added={addedIds.has(c.id)}
                onAdd={() => void addServer(curatedToConfig(c))}
              />
              {c.hintFa && !addedIds.has(c.id) && (
                <div className="px-1 pt-1 text-[10px] leading-4" style={{ color: 'var(--text-secondary)' }}>{c.hintFa}</div>
              )}
            </div>
          ))}
          <div className="pt-1">
            <CustomForm onDone={() => setTab('list')} />
          </div>
        </div>
      )}
    </div>
  )
}
