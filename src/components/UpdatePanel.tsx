import { useEffect, useState } from 'react'
import { ArrowDownToLine, CheckCircle2, Loader2, RefreshCw, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { UpdateState } from '@/types/atlas-api'

const labels: Record<UpdateState['status'], string> = {
  idle: 'بررسی نسخهٔ جدید',
  unsupported: 'روش به‌روزرسانی این نسخه',
  checking: 'در حال بررسی نسخهٔ جدید…',
  current: 'آخرین نسخه را داری',
  available: 'نسخهٔ جدید آمادهٔ دریافت است',
  downloading: 'در حال دریافت آپدیت…',
  downloaded: 'آپدیت آمادهٔ نصب است',
  error: 'به‌روزرسانی انجام نشد',
}

function megabytes(bytes: number): string {
  return (bytes / 1024 / 1024).toLocaleString('fa-IR', { maximumFractionDigits: 1 })
}

export function UpdatePanel() {
  const api = window.atlasAPI?.updates
  const [state, setState] = useState<UpdateState | null>(null)
  const [error, setError] = useState('')
  const [installing, setInstalling] = useState(false)
  useEffect(() => {
    if (!api) return
    let active = true
    let receivedEvent = false
    const off = api.onState(next => {
      receivedEvent = true
      if (active) { setState(next); setError(''); if (next.status === 'error') setInstalling(false) }
    })
    void api.state().then(next => {
      if (active && !receivedEvent) setState(next)
    }).catch(() => { if (active) setError('خواندن وضعیت آپدیت ناموفق بود؛ تنظیمات را دوباره باز کن.') })
    return () => { active = false; off() }
  }, [api])

  const run = async (action: 'check' | 'download' | 'install') => {
    if (!api) return
    setError('')
    if (action === 'install') setInstalling(true)
    try { setState(await api[action]()) } catch {
      setError('درخواست انجام نشد؛ دوباره تلاش کن.')
      setInstalling(false)
    }
  }

  if (!api) return <p className="rounded-2xl p-4 text-sm leading-7 glass">آپدیت داخلی در نسخهٔ دسکتاپ در دسترس است. اگر نسخهٔ قدیمی نصب است، نسخهٔ جدید را یک بار از گیت‌هاب نصب کن.</p>
  if (!state) return <p role="status" className="text-sm">{error || 'در حال خواندن وضعیت آپدیت…'}</p>

  const busy = installing || state.status === 'checking' || state.status === 'downloading'
  const canDownload = state.status === 'available' || (state.status === 'error' && !!state.version)
  return (
    <div className="grid gap-4 rounded-2xl p-4 glass">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-base font-semibold">به‌روزرسانی Atlas</h3>
        <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>نسخهٔ فعلی: <bdi>{state.currentVersion}</bdi></span>
      </div>
      <p role="status" className="flex items-center gap-2 text-sm">
        {busy ? <Loader2 size={17} className="animate-spin" /> : ['current', 'downloaded'].includes(state.status) ? <CheckCircle2 size={17} /> : <RefreshCw size={17} />}
        {installing ? 'در حال راه‌اندازی نصب…' : labels[state.status]}
        {state.version && <bdi className="font-mono text-xs">{state.version}</bdi>}
      </p>
      {state.message && <p className="text-xs leading-6" role={state.status === 'error' ? 'alert' : undefined}>{state.message}</p>}
      {error && <p role="alert" className="text-xs text-red-400">{error}</p>}
      {state.status === 'downloading' && <div className="grid gap-2">
        <progress className="h-2 w-full" style={{ accentColor: 'var(--accent)' }} max={100} value={state.percent} aria-label="پیشرفت دریافت آپدیت" />
        <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
          {Math.floor(state.percent).toLocaleString('fa-IR')}٪ · {megabytes(state.transferred)} مگابایت
          {state.total > 0 && ` از ${megabytes(state.total)} مگابایت`}
          {state.bytesPerSecond > 0 && ` · ${megabytes(state.bytesPerSecond)} مگابایت در ثانیه`}
        </p>
      </div>}
      {state.supported && <p className="text-xs leading-6" style={{ color: 'var(--text-secondary)' }}>
        {state.differential ? 'برنامه ابتدا دریافت تفاضلی را امتحان می‌کند تا فقط بخش‌های تغییرکرده دانلود شوند. اگر سرور یا بسته پشتیبانی نکند، فایل کامل دریافت می‌شود.' : 'نسخهٔ DEB فایل کامل آپدیت را دریافت می‌کند و هنگام نصب ممکن است رمز مدیر سیستم را بخواهد. برای دریافت تفاضلی از AppImage استفاده کن.'}
        {' '}نصب فقط با انتخاب خودت انجام می‌شود و تنظیمات و گفت‌وگوها حفظ می‌شوند.
      </p>}
      {state.status === 'downloaded' && <p className="text-xs leading-6">نصب، برنامه را می‌بندد و دوباره اجرا می‌کند؛ ابتدا گفت‌وگو و کارهای در حال اجرا را تمام کن.</p>}
      <div className="flex flex-wrap gap-2">
        {state.supported && !canDownload && state.status !== 'downloaded' && <Button variant="outline" className="gap-2 rounded-xl" disabled={busy} onClick={() => void run('check')}><RefreshCw size={15} />بررسی آپدیت</Button>}
        {canDownload && <Button className="gap-2 rounded-xl" disabled={busy} onClick={() => void run('download')}><ArrowDownToLine size={15} />{state.status === 'error' ? 'تلاش دوباره برای دریافت' : 'دریافت آپدیت'}</Button>}
        {state.status === 'downloaded' && <Button className="gap-2 rounded-xl" disabled={installing} onClick={() => void run('install')}><RotateCcw size={15} />نصب و راه‌اندازی مجدد</Button>}
        <Button variant="outline" className="rounded-xl" onClick={() => window.atlasAPI?.openExternal(state.releasesURL)}>صفحهٔ انتشار و تغییرات</Button>
      </div>
    </div>
  )
}
