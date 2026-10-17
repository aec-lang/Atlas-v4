/**
 * TerminalPanel — ترمینال واقعی محلی
 * نشست شلِ ماندگار در پروسهٔ اصلی الکترون (desktop/backend.cjs)؛ خروجی به‌صورت
 * استریم نمایش داده می‌شود. ظاهر و رفتار دقیقاً مثل یک ترمینال واقعی است:
 * پرامپت زندهٔ شل، cwd ماندگار، تاریخچه، Ctrl+C / Ctrl+D / Ctrl+L.
 * برنامه‌های تمام‌صفحهٔ تعاملی (vim، htop) بدون pty کامل کار نمی‌کنند.
 */
import { useEffect, useRef, useState } from 'react'
import { Terminal as TermIcon, RotateCcw, Ban } from 'lucide-react'
import type { TerminalAPI } from '@/types/atlas-api'

/* ─── مدل خط: قطعه‌های متنی با رنگ ─── */
interface Seg { t: string; fg?: string; bold?: boolean }
type Line = Seg[]

interface Buf { lines: Line[]; cur: Seg[]; fg?: string; bold: boolean }

const MAX_LINES = 2000

const FG: Record<number, string> = {
  30: '#8b93a7', 31: '#f87171', 32: '#4ade80', 33: '#facc15',
  34: '#7aa2ff', 35: '#c084fc', 36: '#22d3ee', 37: '#e8eaf0',
  90: '#6b7280', 91: '#fca5a5', 92: '#86efac', 93: '#fde047',
  94: '#93c5fd', 95: '#d8b4fe', 96: '#67e8f9', 97: '#ffffff',
}

function applySgr(params: string, st: { fg?: string; bold: boolean }): void {
  const parts = params.split(';')
  if (parts.length === 1 && parts[0] === '') { st.fg = undefined; st.bold = false; return }
  let i = 0
  while (i < parts.length) {
    const n = parseInt(parts[i], 10)
    if (Number.isNaN(n) || n === 0) { st.fg = undefined; st.bold = false; i++ }
    else if (n === 1) { st.bold = true; i++ }
    else if (n === 22) { st.bold = false; i++ }
    else if (n === 39) { st.fg = undefined; i++ }
    else if (FG[n]) { st.fg = FG[n]; i++ }
    else if (n === 38 || n === 48) {
      // 38;5;N یا 38;2;r;g;b — فعلاً پشتیبانی نمی‌شود، رد شو
      const mode = parseInt(parts[i + 1], 10)
      if (mode === 5) i += 3
      else if (mode === 2) i += 5
      else i += 2
    } else i++
  }
}

/** پردازش یک تکه از خروجی خام شل و ریختن آن در بافر */
function ingest(buf: Buf, chunk: string): void {
  const pushText = (t: string): void => {
    if (!t) return
    const last = buf.cur[buf.cur.length - 1]
    if (last && last.fg === buf.fg && !!last.bold === !!buf.bold) last.t += t
    else buf.cur.push({ t, fg: buf.fg, bold: buf.bold || undefined })
  }
  const newline = (): void => { buf.lines.push(buf.cur); buf.cur = [] }

  let i = 0
  while (i < chunk.length) {
    const ch = chunk[i]
    if (ch === '\x1b' && chunk[i + 1] === '[') {
      const m = /^\x1b\[([0-9;?]*)?([a-zA-Z])/.exec(chunk.slice(i))
      if (m) {
        const params = m[1] ?? ''
        const cmd = m[2]
        if (cmd === 'm') applySgr(params, buf)
        else if (cmd === 'J') { buf.lines = []; buf.cur = [] } // پاک‌سازی صفحه
        // بقیه (H، K و...) فقط حذف می‌شوند
        i += m[0].length
        continue
      }
      i += 2
      continue
    }
    if (ch === '\r' && chunk[i + 1] === '\n') { newline(); i += 2; continue }
    if (ch === '\n') { newline(); i++; continue }
    if (ch === '\r') { buf.cur = []; i++; continue } // بازگشت به ابتدای خط (پروگرس‌بار)
    if (ch === '\x07' || ch === '\x00') { i++; continue } // زنگ و نال
    if (ch === '\b') {
      const last = buf.cur[buf.cur.length - 1]
      if (last) { last.t = last.t.slice(0, -1); if (!last.t) buf.cur.pop() }
      i++
      continue
    }
    let j = i
    while (
      j < chunk.length && chunk[j] !== '\x1b' && chunk[j] !== '\n' &&
      chunk[j] !== '\r' && chunk[j] !== '\x07' && chunk[j] !== '\x00' && chunk[j] !== '\b'
    ) j++
    pushText(chunk.slice(i, j))
    i = j
  }
}

/* ─── نشست در سطح ماژول زنده می‌ماند (با عوض کردن پنل از بین نمی‌رود) ─── */
const sess = {
  id: null as string | null,
  alive: false,
  buf: { lines: [] as Line[], cur: [] as Seg[], fg: undefined as string | undefined, bold: false } as Buf,
  history: [] as string[],
}
let startPromise: Promise<string | null> | null = null

function detectElectron(): boolean {
  if (typeof window === 'undefined') return false
  if (typeof window.atlasAPI?.terminal !== 'undefined') return true
  if (Boolean(window.atlasAPI)) return true
  return typeof navigator !== 'undefined' && /Electron/i.test(navigator.userAgent)
}

export function TerminalPanel(): React.JSX.Element {
  const isElectron = detectElectron()
  const term = typeof window !== 'undefined' ? window.atlasAPI?.terminal : undefined
  const [, setTick] = useState(0)
  const [input, setInput] = useState('')
  const [dead, setDead] = useState(false)
  const [starting, setStarting] = useState(false)
  const [histIdx, setHistIdx] = useState(-1)
  const outRef = useRef<HTMLDivElement>(null)
  const stickRef = useRef(true)
  const flushTimer = useRef<number | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const flush = (): void => {
    if (sess.buf.lines.length > MAX_LINES) sess.buf.lines.splice(0, sess.buf.lines.length - MAX_LINES)
    setTick(t => t + 1)
    if (stickRef.current) {
      requestAnimationFrame(() => {
        const el = outRef.current
        if (el) el.scrollTop = el.scrollHeight
      })
    }
  }

  const scheduleFlush = (): void => {
    if (flushTimer.current !== null) return
    flushTimer.current = window.setTimeout(() => {
      flushTimer.current = null
      flush()
    }, 40)
  }

  const sysLine = (text: string): void => {
    sess.buf.lines.push([{ t: text, fg: '#8b93a7' }])
    scheduleFlush()
  }

  const ensureSession = async (api: TerminalAPI): Promise<string | null> => {
    if (sess.id && sess.alive) return sess.id
    if (!startPromise) {
      setStarting(true)
      startPromise = api.start().then(r => {
        setStarting(false)
        if (r?.ok && r.id) {
          sess.id = r.id
          sess.alive = true
          setDead(false)
          return r.id
        }
        sysLine(`[خطا در شروع ترمینال: ${r?.error ?? 'نامشخص'}]`)
        return null
      }).finally(() => { startPromise = null })
    }
    return startPromise
  }

  useEffect(() => {
    if (!isElectron || !term) return
    let cancelled = false
    const offData = term.onData(({ id, data }) => {
      if (id !== sess.id) return
      ingest(sess.buf, data)
      scheduleFlush()
    })
    const offExit = term.onExit(({ id, code }) => {
      if (id !== sess.id) return
      sess.alive = false
      sess.id = null
      if (!cancelled) {
        setDead(true)
        sysLine(`[نشست ترمینال پایان یافت (کد ${code ?? '؟'}) — Enter برای شروع دوباره]`)
      }
    })
    void ensureSession(term)
    return () => {
      cancelled = true
      offData()
      offExit()
      if (flushTimer.current !== null) { clearTimeout(flushTimer.current); flushTimer.current = null }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const onScroll = (): void => {
    const el = outRef.current
    if (!el) return
    stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40
  }

  const sendLine = (): void => {
    if (!term) return
    if (!sess.id || !sess.alive) {
      // نشست مرده → شروع دوباره
      sysLine('[شروع نشست تازه…]')
      void ensureSession(term).then(() => inputRef.current?.focus())
      return
    }
    const cmd = input
    // اکوی دستور ته خط پرامپت (مثل ترمینال واقعی)
    if (cmd) {
      sess.buf.cur.push({ t: cmd })
      sess.history.push(cmd)
      if (sess.history.length > 200) sess.history.shift()
    }
    sess.buf.lines.push(sess.buf.cur)
    sess.buf.cur = []
    setInput('')
    setHistIdx(-1)
    term.write(sess.id, cmd + '\n')
    stickRef.current = true
    flush()
    inputRef.current?.focus()
  }

  const sendIntr = (): void => {
    if (!term || !sess.id || !sess.alive) return
    sess.buf.cur.push({ t: '^C', fg: '#f87171' })
    sess.buf.lines.push(sess.buf.cur)
    sess.buf.cur = []
    setInput('')
    setHistIdx(-1)
    term.signal(sess.id, 'SIGINT')
    stickRef.current = true
    flush()
    inputRef.current?.focus()
  }

  const killSession = (): void => {
    if (term && sess.id) term.kill(sess.id)
  }

  const clearView = (): void => {
    sess.buf.lines = []
    sess.buf.cur = []
    flush()
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter') { e.preventDefault(); sendLine() }
    else if (e.key === 'c' && e.ctrlKey) { e.preventDefault(); sendIntr() }
    else if (e.key === 'd' && e.ctrlKey) {
      e.preventDefault()
      if (!input && sess.id && sess.alive) {
        sysLine('[Ctrl+D — بستن نشست]')
        killSession()
      }
    }
    else if (e.key === 'l' && e.ctrlKey) { e.preventDefault(); clearView() }
    else if (e.key === 'ArrowUp') {
      e.preventDefault()
      if (sess.history.length === 0) return
      const ni = histIdx < 0 ? sess.history.length - 1 : Math.max(0, histIdx - 1)
      setHistIdx(ni)
      setInput(sess.history[ni])
    }
    else if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (histIdx < 0) return
      const ni = histIdx + 1
      if (ni >= sess.history.length) { setHistIdx(-1); setInput('') }
      else { setHistIdx(ni); setInput(sess.history[ni]) }
    }
    else if (e.key === 'Tab') { e.preventDefault() /* تکمیل خودکار فعلاً پشتیبانی نمی‌شود */ }
  }

  const renderLine = (ln: Line, i: number): React.JSX.Element => (
    <div key={i} className="whitespace-pre-wrap [overflow-wrap:anywhere]">
      {ln.length === 0 ? ' ' : ln.map((s, j) => (
        <span key={j} style={{ color: s.fg, fontWeight: s.bold ? 700 : undefined }}>{s.t}</span>
      ))}
    </div>
  )

  return (
    <div className="flex h-full flex-col" dir="ltr">
      <div className="flex items-center gap-2 border-b px-3 py-2" style={{ borderColor: 'var(--glass-border)', background: 'var(--glass)' }}>
        <TermIcon size={15} style={{ color: '#4ade80' }} />
        <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>ترمینال — Atlas</span>
        <span className="mr-auto flex items-center gap-1">
          <button onClick={clearView} className="rounded-lg p-1.5 glass-hover" title="پاک‌سازی نمایش (Ctrl+L)" style={{ color: 'var(--text-secondary)' }}>
            <Ban size={13} />
          </button>
          <button onClick={() => { killSession(); sysLine('[نشست بسته شد — Enter برای شروع دوباره]') }} className="rounded-lg p-1.5 glass-hover" title="بستن و شروع نشست تازه" style={{ color: 'var(--text-secondary)' }}>
            <RotateCcw size={13} />
          </button>
        </span>
      </div>

      {!isElectron || !term ? (
        <div className="flex flex-1 items-center justify-center p-6 text-center text-sm" style={{ color: 'var(--text-secondary)' }}>
          ترمینال فقط در نسخهٔ دسکتاپ در دسترس است.
        </div>
      ) : (
        <>
          <div
            ref={outRef}
            onScroll={onScroll}
            onClick={() => inputRef.current?.focus()}
            className="min-h-0 flex-1 cursor-text overflow-y-auto px-3 py-2 font-mono text-[13px] leading-[1.55]"
            style={{ color: '#d7dbe3', background: '#07090d' }}
          >
            {sess.buf.lines.map(renderLine)}
            {sess.buf.cur.length > 0 && renderLine(sess.buf.cur, -1)}
            {starting && <div style={{ color: '#8b93a7' }}>در حال اتصال به شل…</div>}
          </div>
          <div className="flex items-center gap-2 border-t px-3 py-2" style={{ borderColor: 'var(--glass-border)', background: '#0a0d12' }}>
            <span className="font-mono text-[13px] select-none" style={{ color: '#4ade80' }}>❯</span>
            <input
              ref={inputRef}
              value={input}
              disabled={!isElectron || starting}
              onChange={e => { setInput(e.target.value); setHistIdx(-1) }}
              onKeyDown={onKeyDown}
              placeholder={dead ? 'نشست پایان یافت — Enter برای شروع دوباره' : ''}
              dir="ltr"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              className="min-w-0 flex-1 bg-transparent font-mono text-[13px] outline-none"
              style={{ color: '#e8eaf0', caretColor: '#4ade80' }}
            />
          </div>
          <div className="flex items-center gap-3 px-3 py-1 text-[10px]" style={{ color: '#5b6373', background: '#07090d' }}>
            <span><kbd className="rounded bg-white/10 px-1">Ctrl+C</kbd> توقف</span>
            <span><kbd className="rounded bg-white/10 px-1">Ctrl+D</kbd> بستن نشست</span>
            <span><kbd className="rounded bg-white/10 px-1">Ctrl+L</kbd> پاک‌سازی</span>
            <span><kbd className="rounded bg-white/10 px-1">↑↓</kbd> تاریخچه</span>
          </div>
        </>
      )}
    </div>
  )
}
