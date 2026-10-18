/**
 * TasksPanel — پنل «کارها»: کارهای پس‌زمینه + تسک‌های زمان‌بندی‌شده.
 * بدون ایموجی؛ فقط آیکون Lucide. لیبل‌ها فارسی.
 */
import { useMemo, useState } from 'react'
import {
  Ban,
  CheckCircle2,
  ChevronDown,
  Clock,
  Layers,
  Loader2,
  MessageSquareText,
  Pencil,
  Play,
  Plus,
  ShieldAlert,
  Trash2,
  X,
  XCircle,
} from 'lucide-react'
import { useTasksStore } from '@/stores/tasksStore'
import { createAndRunBackgroundTask } from '@/lib/tasksSync'
import { parseScheduleFa, isValidCron } from '@/lib/scheduleParse'
import type { BgTask, BgTaskStatus, CronSchedule, PendingApproval } from '@/types/atlas-api'
import { cn } from '@/lib/utils'

type SubTab = 'bg' | 'sched'

const STATUS_META: Record<BgTaskStatus, { label: string; cls: string }> = {
  running: { label: 'در حال اجرا', cls: 'text-sky-400' },
  done: { label: 'تمام‌شده', cls: 'text-emerald-400' },
  error: { label: 'خطا', cls: 'text-red-400' },
  cancelled: { label: 'لغوشده', cls: 'text-zinc-500' },
}

function StatusIcon({ status }: { status: BgTaskStatus }) {
  if (status === 'running') return <Loader2 size={14} className="animate-spin text-sky-400" />
  if (status === 'done') return <CheckCircle2 size={14} className="text-emerald-400" />
  if (status === 'error') return <XCircle size={14} className="text-red-400" />
  return <Ban size={14} className="text-zinc-500" />
}

function fmtTime(ts?: number): string {
  if (!ts) return '—'
  try {
    return new Date(ts).toLocaleString('fa-IR', { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'numeric' })
  } catch {
    return '—'
  }
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

/* ─── کارت یک کار پس‌زمینه ─── */
function BgTaskCard({ task }: { task: BgTask }) {
  const cancelTask = useTasksStore(s => s.cancelTask)
  const approvePending = useTasksStore(s => s.approvePending)
  const rejectPending = useTasksStore(s => s.rejectPending)
  const openInChat = useTasksStore(s => s.openInChat)
  const [open, setOpen] = useState(false)
  const meta = STATUS_META[task.status]
  const pendings = task.pendingApprovals.filter(a => a.status === 'pending')

  return (
    <div className="rounded-2xl p-3 glass">
      <div className="flex items-center gap-2">
        <StatusIcon status={task.status} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>
            {task.title}
          </div>
          <div className="text-[10px]" style={{ color: 'var(--text-secondary)' }}>
            <span className={meta.cls}>{meta.label}</span>
            {' · '}{task.kind === 'scheduled' ? 'زمان‌بندی‌شده' : 'پس‌زمینه'}
            {' · '}{fmtTime(task.createdAt)}
            {task.progressNote && task.status === 'running' ? ` · ${task.progressNote}` : ''}
          </div>
        </div>
        {task.status === 'running' && (
          <MiniButton danger onClick={() => void cancelTask(task.id)} title="لغو">
            <X size={13} /> لغو
          </MiniButton>
        )}
        <MiniButton onClick={() => setOpen(o => !o)} title="جزئیات">
          <ChevronDown size={13} className={cn('transition-transform', open && 'rotate-180')} />
        </MiniButton>
      </div>

      {pendings.length > 0 && (
        <div className="mt-2 space-y-1.5 rounded-xl p-2" style={{ background: 'rgba(251,191,36,.07)' }}>
          <p className="flex items-center gap-1 text-[11px] font-medium text-amber-300">
            <ShieldAlert size={12} /> در انتظار تأیید ({pendings.length})
          </p>
          {pendings.map(a => (
            <PendingRow key={a.id} taskId={task.id} approval={a}
              onApprove={() => void approvePending(task.id, a.id)}
              onReject={() => void rejectPending(task.id, a.id)} />
          ))}
        </div>
      )}

      {open && (
        <div className="mt-2 space-y-2 text-[11px]" style={{ color: 'var(--text-secondary)' }}>
          <p className="whitespace-pre-wrap rounded-xl p-2" style={{ background: 'rgba(128,128,128,.08)', color: 'var(--text-primary)' }}>
            {task.prompt}
          </p>
          {task.result && (
            <div>
              <p className="mb-1 font-medium" style={{ color: 'var(--text-primary)' }}>نتیجه:</p>
              <p className="whitespace-pre-wrap rounded-xl p-2" style={{ background: 'rgba(128,128,128,.08)', color: 'var(--text-primary)' }}>
                {task.result.slice(0, 4000)}{task.result.length > 4000 ? '…' : ''}
              </p>
              <MiniButton onClick={() => openInChat(task.id)} className="mt-1">
                <MessageSquareText size={12} /> نمایش در چت
              </MiniButton>
            </div>
          )}
          {task.error && <p className="text-red-400">خطا: {task.error}</p>}
          {task.toolLog.length > 0 && (
            <p>ابزارها: {task.toolLog.map(l => l.tool).join('، ')}</p>
          )}
          {task.pendingApprovals.filter(a => a.status !== 'pending').length > 0 && (
            <p>تأییدهای تعیین‌تکلیف‌شده: {task.pendingApprovals.filter(a => a.status !== 'pending').length}</p>
          )}
        </div>
      )}
    </div>
  )
}

function PendingRow({ approval, onApprove, onReject }: {
  taskId: string
  approval: PendingApproval
  onApprove: () => void
  onReject: () => void
}) {
  const [busy, setBusy] = useState(false)
  return (
    <div className="flex items-center gap-2 text-[11px]">
      <code className="flex-1 truncate" dir="ltr" style={{ color: 'var(--text-primary)' }}>{approval.tool}</code>
      <MiniButton disabled={busy} onClick={() => { setBusy(true); onApprove() }} className="text-emerald-400">
        <Play size={12} /> تأیید و اجرا
      </MiniButton>
      <MiniButton danger disabled={busy} onClick={() => { setBusy(true); onReject() }}>
        رد
      </MiniButton>
    </div>
  )
}

/* ─── تب کارهای پس‌زمینه ─── */
function BgTab() {
  const bgTasks = useTasksStore(s => s.bgTasks)
  const [title, setTitle] = useState('')
  const [prompt, setPrompt] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const submit = async () => {
    if (!prompt.trim() || busy) return
    setBusy(true); setErr('')
    try {
      const r = await createAndRunBackgroundTask(prompt.trim(), title.trim() || undefined)
      if (!r.ok) setErr(r.error ?? 'ساخت تسک ناموفق بود')
      else { setPrompt(''); setTitle('') }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="grid gap-3">
      <div className="rounded-2xl p-3 glass">
        <p className="mb-2 text-xs font-medium" style={{ color: 'var(--text-primary)' }}>کار جدید در پس‌زمینه</p>
        <input value={title} onChange={e => setTitle(e.target.value)} placeholder="عنوان (اختیاری)"
          className="mb-2 w-full rounded-xl px-3 py-2 text-xs outline-none"
          style={{ background: 'rgba(128,128,128,.08)', color: 'var(--text-primary)' }} />
        <textarea value={prompt} onChange={e => setPrompt(e.target.value)} rows={2}
          placeholder="چه کاری انجام شود؟ (مثلاً: این پوشه را بررسی کن و باگ‌ها را لیست کن)"
          className="mb-2 w-full resize-none rounded-xl px-3 py-2 text-xs outline-none"
          style={{ background: 'rgba(128,128,128,.08)', color: 'var(--text-primary)' }} />
        {err && <p className="mb-2 text-[11px] text-red-400">{err}</p>}
        <button onClick={() => void submit()} disabled={busy || !prompt.trim()}
          className="flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-medium disabled:opacity-40"
          style={{ background: 'var(--accent)', color: '#fff' }}>
          <Play size={13} /> {busy ? 'در حال ساخت…' : 'اجرا در پس‌زمینه'}
        </button>
        <p className="mt-2 text-[10px]" style={{ color: 'var(--text-secondary)' }}>
          ابزارهای نیازمند تأیید (مثل اجرای دستور) در پس‌زمینه اجرا نمی‌شوند و برای تأیید دستی ثبت می‌شوند.
        </p>
      </div>
      {bgTasks.map(t => <BgTaskCard key={t.id} task={t} />)}
      {bgTasks.length === 0 && (
        <p className="text-center text-[11px]" style={{ color: 'var(--text-secondary)' }}>
          کاری ثبت نشده — از چت هم می‌توانی بگویی «تو پس‌زمینه انجام بده»
        </p>
      )}
    </div>
  )
}

/* ─── تب زمان‌بندی‌شده ─── */
function SchedTab() {
  const schedules = useTasksStore(s => s.schedules)
  const addSchedule = useTasksStore(s => s.addSchedule)
  const updateSchedule = useTasksStore(s => s.updateSchedule)
  const removeSchedule = useTasksStore(s => s.removeSchedule)
  const [prompt, setPrompt] = useState('')
  const [when, setWhen] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editCron, setEditCron] = useState('')

  const parsed = useMemo(() => (when.trim() ? parseScheduleFa(when) : null), [when])
  const cronValid = useMemo(() => (when.trim() && !parsed ? isValidCron(when.trim()) : false), [when, parsed])

  const submit = async () => {
    if (!prompt.trim() || busy) return
    const cron = parsed?.cron ?? (cronValid ? when.trim() : null)
    if (!cron) { setErr('زمان را نفهمیدم — مثلاً بنویس «هر صبح ساعت ۸» یا کرون بده'); return }
    setBusy(true); setErr('')
    try {
      const id = await addSchedule({
        title: prompt.trim().slice(0, 60),
        prompt: prompt.trim(),
        cron,
        label: parsed?.label ?? cron,
      })
      if (!id) setErr('ثبت زمان‌بند ناموفق بود')
      else { setPrompt(''); setWhen('') }
    } finally {
      setBusy(false)
    }
  }

  const saveEdit = async (s: CronSchedule) => {
    if (!isValidCron(editCron.trim())) { setErr('کرون نامعتبر است'); return }
    await updateSchedule(s.id, { cron: editCron.trim(), label: editCron.trim() })
    setEditingId(null)
  }

  return (
    <div className="grid gap-3">
      <div className="rounded-2xl p-3 glass">
        <p className="mb-2 text-xs font-medium" style={{ color: 'var(--text-primary)' }}>زمان‌بند جدید</p>
        <textarea value={prompt} onChange={e => setPrompt(e.target.value)} rows={2}
          placeholder="چه کاری انجام شود؟ (مثلاً: اخبار هوش مصنوعی را خلاصه کن)"
          className="mb-2 w-full resize-none rounded-xl px-3 py-2 text-xs outline-none"
          style={{ background: 'rgba(128,128,128,.08)', color: 'var(--text-primary)' }} />
        <input value={when} onChange={e => setWhen(e.target.value)}
          placeholder="کی؟ مثلاً: هر صبح ساعت ۸ — یا کرون: 0 8 * * *"
          className="mb-1 w-full rounded-xl px-3 py-2 text-xs outline-none"
          style={{ background: 'rgba(128,128,128,.08)', color: 'var(--text-primary)' }} />
        {when.trim() && (
          <p className="mb-2 text-[11px]" style={{ color: parsed || cronValid ? 'var(--text-secondary)' : '#f87171' }}>
            {parsed ? `فهمیدم: ${parsed.label}` : cronValid ? 'کرون معتبر است' : 'متوجه نشدم…'}
          </p>
        )}
        {err && <p className="mb-2 text-[11px] text-red-400">{err}</p>}
        <button onClick={() => void submit()} disabled={busy || !prompt.trim()}
          className="flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-medium disabled:opacity-40"
          style={{ background: 'var(--accent)', color: '#fff' }}>
          <Plus size={13} /> افزودن زمان‌بند
        </button>
      </div>

      {schedules.map(s => (
        <div key={s.id} className="rounded-2xl p-3 glass">
          <div className="flex items-center gap-2">
            <Clock size={14} style={{ color: s.enabled ? 'var(--accent)' : 'var(--text-secondary)' }} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>{s.title}</div>
              <div className="text-[10px]" style={{ color: 'var(--text-secondary)' }}>
                {s.label}
                {s.nextRun ? ` · اجرای بعدی ${fmtTime(s.nextRun)}` : ''}
                {s.lastRun ? ` · آخرین اجرا ${fmtTime(s.lastRun)}` : ''}
              </div>
            </div>
            <MiniButton onClick={() => void updateSchedule(s.id, { enabled: !s.enabled })}>
              {s.enabled ? 'خاموش' : 'روشن'}
            </MiniButton>
            <MiniButton onClick={() => { setEditingId(s.id); setEditCron(s.cron) }}>
              <Pencil size={12} />
            </MiniButton>
            <MiniButton danger onClick={() => void removeSchedule(s.id)}>
              <Trash2 size={12} />
            </MiniButton>
          </div>
          {editingId === s.id && (
            <div className="mt-2 flex items-center gap-2">
              <input value={editCron} onChange={e => setEditCron(e.target.value)} dir="ltr"
                placeholder="0 8 * * *"
                className="flex-1 rounded-xl px-3 py-1.5 font-mono text-xs outline-none"
                style={{ background: 'rgba(128,128,128,.08)', color: 'var(--text-primary)' }} />
              <MiniButton onClick={() => void saveEdit(s)} className="text-emerald-400">ذخیره</MiniButton>
              <MiniButton onClick={() => setEditingId(null)}>انصراف</MiniButton>
            </div>
          )}
        </div>
      ))}
      {schedules.length === 0 && (
        <p className="text-center text-[11px]" style={{ color: 'var(--text-secondary)' }}>
          زمان‌بندی ثبت نشده — از چت هم می‌توانی بگویی «هر صبح ساعت ۸ …»
        </p>
      )}
    </div>
  )
}

/* ─── پنل اصلی ─── */
export function TasksPanel(): React.JSX.Element {
  const [tab, setTab] = useState<SubTab>('bg')
  const bgTasks = useTasksStore(s => s.bgTasks)
  const schedules = useTasksStore(s => s.schedules)
  const runningCount = bgTasks.filter(t => t.status === 'running').length
  const pendingCount = bgTasks.reduce((n, t) => n + t.pendingApprovals.filter(a => a.status === 'pending').length, 0)

  return (
    <div className="grid gap-3">
      <nav className="flex gap-1 rounded-2xl p-1 glass">
        {(
          [
            { id: 'bg', label: `کارهای پس‌زمینه${runningCount ? ` (${runningCount})` : ''}`, icon: <Layers size={13} /> },
            { id: 'sched', label: `زمان‌بندی‌شده (${schedules.length})`, icon: <Clock size={13} /> },
          ] as Array<{ id: SubTab; label: string; icon: React.ReactNode }>
        ).map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className="flex flex-1 items-center justify-center gap-1 rounded-xl px-2 py-1.5 text-[11px]"
            style={tab === t.id ? { color: 'var(--accent)', background: 'var(--accent-soft)' } : { color: 'var(--text-secondary)' }}>
            {t.icon} {t.label}
          </button>
        ))}
      </nav>
      {pendingCount > 0 && tab === 'bg' && (
        <p className="flex items-center gap-1 rounded-xl p-2 text-[11px] text-amber-300" style={{ background: 'rgba(251,191,36,.07)' }}>
          <ShieldAlert size={13} /> {pendingCount} درخواست در انتظار تأیید دستی
        </p>
      )}
      {tab === 'bg' ? <BgTab /> : <SchedTab />}
    </div>
  )
}
