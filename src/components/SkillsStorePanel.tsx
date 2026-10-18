/**
 * SkillsStorePanel — فروشگاه مهارتها (متصل به skills.sh)
 * جستوجوی زنده، تبهای داغ/ترند/همه، نصب ماندگار، فعالسازی در سطح مکالمه
 */
import { useEffect, useState, useCallback, useRef } from 'react'
import {
  fetchCatalog, searchSkills, fetchSkillDetail,
  fetchSkillAudit, parseSkillMd
} from '@/lib/skillsApi'
import type { SkillSummary, AuditEntry } from '@/lib/skillsApi'
import { useSkillsStore } from '@/stores/skillsStore'
import { Search, Download, Trash2, Loader2, X, Flame, TrendingUp, Globe2, ShieldCheck, ShieldAlert, FileText, ExternalLink } from 'lucide-react'

type Tab = 'hot' | 'trending' | 'all'
type View = 'store' | 'installed'

function fmtInstalls(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`
  return String(n)
}

export function SkillsStorePanel({
  open, onClose, conversationId
}: { open: boolean; onClose: () => void; conversationId?: string }): React.JSX.Element | null {
  const [view, setView] = useState<View>('store')
  const [tab, setTab] = useState<Tab>('hot')
  const [query, setQuery] = useState('')
  const [skills, setSkills] = useState<SkillSummary[]>([])
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [page, setPage] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const [dataSource, setDataSource] = useState<'skills.sh' | 'fallback'>('skills.sh')
  const [detailId, setDetailId] = useState<string | null>(null)

  // بارگذاری کاتالوگ (با نشانهٔ درخواست برای جلوگیری از race condition)
  // nextPage > 0 یعنی «نمایش بیشتر» — نتایج به انتهای لیست اضافه میشوند
  const reqRef = useRef(0)
  const loadCatalog = useCallback(async (v: Tab, token: number, nextPage = 0) => {
    if (nextPage === 0) setLoading(true)
    else setLoadingMore(true)
    try {
      const r = await fetchCatalog(v === 'all' ? 'all-time' : v, nextPage)
      if (reqRef.current === token) {
        setSkills(prev => (nextPage === 0 ? r.skills : [...prev, ...r.skills]))
        setPage(nextPage)
        setHasMore(r.hasMore)
        setDataSource(r.source)
      }
    } finally {
      if (reqRef.current === token) { setLoading(false); setLoadingMore(false) }
    }
  }, [])

  const loadMore = useCallback(() => {
    const token = ++reqRef.current
    void loadCatalog(tab, token, page + 1)
  }, [tab, page, loadCatalog])

  useEffect(() => {
    if (!open || detailId) return
    if (view === 'installed') return
    const token = ++reqRef.current
    if (query.trim().length >= 2) {
      const t = setTimeout(() => {
        void searchSkills(query).then(r => {
          if (reqRef.current === token) { setSkills(r.skills); setDataSource(r.source); setHasMore(false); setPage(0) }
        })
      }, 350)
      return () => clearTimeout(t)
    }
    void loadCatalog(tab, token)
  }, [open, tab, query, view, detailId, loadCatalog])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-40 flex justify-start" role="dialog" aria-label="فروشگاه مهارتها">
      <button aria-label="بستن" className="absolute inset-0 bg-black/40 backdrop-blur-[2px]" onClick={onClose} />
      <aside className="glass-strong relative z-10 flex h-full w-[26rem] max-w-[92vw] flex-col rounded-none border-l p-4"
        style={{ background: 'var(--bg-base)' }}>

        {/* سرصفحه */}
        <header className="mb-3 flex items-center gap-2">
          <span className="text-xl">🧩</span>
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-bold">فروشگاه مهارتها</h2>
            <p className="text-[10px]" style={{ color: 'var(--text-secondary)' }}>
              متصل به skills.sh · {dataSource === 'skills.sh' ? 'آنلاین ✓' : 'فالبک گیتهاب'}
            </p>
          </div>
          <button onClick={onClose} className="rounded-xl p-2 glass-hover" style={{ color: 'var(--text-secondary)' }}>
            <X size={16} />
          </button>
        </header>

        {/* سوییچ نصبشده/فروشگاه */}
        <div className="mb-2 grid grid-cols-2 gap-1 rounded-2xl p-1 glass">
          {([['store', '🏪 فروشگاه'], ['installed', '📦 نصبشده']] as const).map(([v, label]) => (
            <button key={v} onClick={() => { setView(v); setDetailId(null) }}
              data-active={view === v}
              className="rounded-xl px-2 py-1.5 text-xs font-medium transition-colors"
              style={view === v
                ? { background: 'var(--accent-soft)', color: 'var(--accent)' }
                : { color: 'var(--text-secondary)' }}>
              {label}
            </button>
          ))}
        </div>

        {/* جستوجو */}
        <div className="glass mb-2 flex items-center gap-2 rounded-2xl px-3 py-2.5">
          <Search size={14} style={{ color: 'var(--text-secondary)' }} />
          <input value={query} onChange={e => setQuery(e.target.value)}
            placeholder="جستوجو در هزاران مهارت..."
            className="w-full bg-transparent text-xs outline-none placeholder:opacity-50"
            style={{ color: 'var(--text-primary)' }} />
        </div>

        {view === 'store' && !detailId && (
          /* تبها */
          <nav className="mb-2 flex gap-1">
            {([['hot', '🔥 داغ', Flame], ['trending', '📈 ترند', TrendingUp], ['all', '🏆 همه', Globe2]] as const).map(([t, label, Icon]) => (
              <button key={t} onClick={() => setTab(t)}
                className="flex items-center gap-1 rounded-full px-3 py-1 text-[11px] transition-colors"
                style={tab === t
                  ? { background: 'var(--accent-soft)', color: 'var(--accent)' }
                  : { color: 'var(--text-secondary)' }}>
                <Icon size={11} /> {label}
              </button>
            ))}
          </nav>
        )}

        {/* محتوا */}
        <div className="-mr-1 min-h-0 flex-1 overflow-y-auto pl-1">
          {loading ? (
            <div className="flex h-32 items-center justify-center gap-2 text-xs" style={{ color: 'var(--text-secondary)' }}>
              <Loader2 size={14} className="animate-spin" /> در حال دریافت...
            </div>
          ) : detailId ? (
            <SkillDetail id={detailId} onBack={() => setDetailId(null)} />
          ) : view === 'installed' ? (
            <InstalledList conversationId={conversationId} />
          ) : (
            <div className="grid gap-1.5">
              {skills.map(s => (
                <SkillRow key={s.id} skill={s} onOpenDetail={() => setDetailId(s.id)} />
              ))}
              {skills.length === 0 && (
                <p className="mt-8 text-center text-xs" style={{ color: 'var(--text-secondary)' }}>
                  چیزی پیدا نشد — عبارت دیگری امتحان کن
                </p>
              )}
              {hasMore && query.trim().length < 2 && skills.length > 0 && (
                <button onClick={loadMore} disabled={loadingMore}
                  className="glass glass-hover mx-auto mt-2 flex items-center gap-2 rounded-2xl px-5 py-2 text-[11px] font-medium disabled:opacity-50"
                  style={{ color: 'var(--accent)' }}>
                  {loadingMore ? <Loader2 size={12} className="animate-spin" /> : null}
                  {loadingMore ? 'در حال دریافت...' : 'نمایش مهارتهای بیشتر ↓'}
                </button>
              )}
            </div>
          )}
        </div>
      </aside>
    </div>
  )
}

/* ─── ردیف مهارت ─── */

function SkillRow({ skill, onOpenDetail }: {
  skill: SkillSummary; onOpenDetail: () => void
}): React.JSX.Element {
  const installed = useSkillsStore(s => Boolean(s.installed[skill.id]))
  const install = useSkillsStore(s => s.install)
  const uninstall = useSkillsStore(s => s.uninstall)
  const [busy, setBusy] = useState(false)

  const doInstall = async (): Promise<void> => {
    setBusy(true)
    try {
      const d = await fetchSkillDetail(skill.id)
      const md = d.files.find(f => f.path.endsWith('SKILL.md'))
      const meta = md ? parseSkillMd(md.contents) : {}
      install({
        id: skill.id,
        name: meta.name ?? skill.name,
        source: skill.source,
        slug: skill.slug,
        installedAt: Date.now(),
        hash: d.hash,
        files: d.files
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="group glass rise-in mb-0.5 flex items-center gap-2 rounded-2xl px-3 py-2.5 transition-all">
      <button onClick={onOpenDetail} className="min-w-0 flex-1 text-right">
        <div className="truncate text-xs font-semibold">{skill.name}</div>
        <div className="truncate text-[10px]" dir="ltr" style={{ color: 'var(--text-secondary)', textAlign: 'right' }}>
          {skill.source} · ⬇ {fmtInstalls(skill.installs)}
        </div>
      </button>
      {installed ? (
        <button onClick={() => uninstall(skill.id)} title="حذف"
          className="rounded-xl p-1.5 opacity-60 transition-opacity hover:opacity-100"
          style={{ color: '#f87171' }}>
          <Trash2 size={14} />
        </button>
      ) : (
        <button onClick={() => void doInstall()} disabled={busy} title="نصب برای همیشه"
          className="rounded-xl p-1.5 transition-transform hover:scale-110 disabled:opacity-40"
          style={{ color: 'var(--accent)' }}>
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
        </button>
      )}
    </div>
  )
}

/* ─── جزئیات مهارت ─── */

function SkillDetail({ id, onBack }: { id: string; onBack: () => void }): React.JSX.Element {
  const installedSkill = useSkillsStore(s => s.installed[id])
  const install = useSkillsStore(s => s.install)
  const uninstall = useSkillsStore(s => s.uninstall)
  const [files, setFiles] = useState<Array<{ path: string; contents: string }> | null>(null)
  const [audits, setAudits] = useState<AuditEntry[] | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [activeFile, setActiveFile] = useState(0)
  const [showMd, setShowMd] = useState(false)

  useEffect(() => {
    let alive = true
    setFiles(installedSkill?.files ?? null)
    setShowMd(false)
    if (!installedSkill) {
      fetchSkillDetail(id).then(d => { if (alive) setFiles(d.files) }).catch(e => { if (alive) setErr(String(e.message)) })
    }
    fetchSkillAudit(id).then(a => { if (alive && a.length) setAudits(a) }).catch(() => {})
    return () => { alive = false }
  }, [id, installedSkill])

  const md = files?.find(f => f.path.endsWith('SKILL.md'))?.contents ?? ''
  const meta = md ? parseSkillMd(md) : {}

  return (
    <div className="rise-in">
      <button onClick={onBack} className="mb-2 rounded-lg px-2 py-1 text-[11px] glass glass-hover" style={{ color: 'var(--text-secondary)' }}>
        → برگرد به فروشگاه
      </button>

      <h3 className="text-sm font-bold">{meta.name ?? id.split('/').pop()}</h3>
      <p className="mt-0.5 text-[10px]" dir="ltr" style={{ color: 'var(--text-secondary)', textAlign: 'right' }}>{id}</p>

      {meta.description && (
        <p className="mt-2 text-[11px] leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
          {meta.description}
        </p>
      )}

      {/* ممیزی امنیتی */}
      {audits && audits.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {audits.map((a, i) => (
            <span key={i} className="flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px]"
              style={{
                background: a.status === 'pass' ? 'rgba(74,222,128,0.12)' : a.status === 'warn' ? 'rgba(250,204,21,0.12)' : 'rgba(248,113,113,0.14)',
                color: a.status === 'pass' ? '#4ade80' : a.status === 'warn' ? '#facc15' : '#f87171'
              }}>
              {a.status === 'fail' ? <ShieldAlert size={10} /> : <ShieldCheck size={10} />}
              {a.provider}{a.riskLevel ? ` · ${a.riskLevel}` : ''}
            </span>
          ))}
        </div>
      )}

      {/* اکشنها */}
      <div className="mt-3 flex items-center gap-2">
        {installedSkill ? (
          <>
            <button onClick={() => uninstall(id)} className="rounded-xl px-3 py-1.5 text-[11px]"
              style={{ background: 'rgba(248,113,113,0.12)', color: '#f87171' }}>
              حذف مهارت
            </button>
          </>
        ) : (
          <InstallButton id={id} onDone={(d) => install({
            id, name: parseSkillMd(d.files.find(f => f.path.endsWith('SKILL.md'))?.contents ?? '').name ?? id.split('/').pop() ?? id,
            source: id.split('/').slice(0, 2).join('/'),
            slug: id.split('/').pop() ?? id,
            installedAt: Date.now(), hash: d.hash, files: d.files
          })} onError={setErr} />
        )}
        {md && (
          <button onClick={() => setShowMd(v => !v)} className="flex items-center gap-1 rounded-xl px-3 py-1.5 text-[11px] glass glass-hover" style={{ color: 'var(--text-secondary)' }}>
            <FileText size={11} /> {showMd ? 'بستن' : 'مشاهدهٔ SKILL.md'}
          </button>
        )}
        <a href={`https://skills.sh/${id}`} target="_blank" rel="noreferrer"
          className="ml-auto rounded-xl p-1.5 glass-hover" style={{ color: 'var(--text-secondary)' }} title="صفحهٔ skills.sh">
          <ExternalLink size={12} />
        </a>
      </div>

      {err && <p className="mt-2 text-[11px]" style={{ color: '#f87171' }}>⚠️ {err}</p>}

      {/* نمایش SKILL.md */}
      {showMd && md && (
        <pre className="glass mt-2 max-h-64 overflow-auto rounded-xl p-3 text-[10px] leading-relaxed" dir="ltr"
          style={{ color: 'var(--text-primary)' }}>
          {md}
        </pre>
      )}

      {/* فایلهای همراه */}
      {files && files.length > 1 && (
        <div className="mt-3">
          <p className="mb-1 text-[10px]" style={{ color: 'var(--text-secondary)' }}>فایلهای همراه:</p>
          <div className="flex flex-wrap gap-1">
            {files.map((f, i) => (
              <button key={f.path} onClick={() => setActiveFile(i)}
                className="rounded-lg px-2 py-0.5 text-[10px] font-mono"
                style={i === activeFile
                  ? { background: 'var(--accent-soft)', color: 'var(--accent)' }
                  : { color: 'var(--text-secondary)' }}
                dir="ltr">
                {f.path}
              </button>
            ))}
          </div>
          {activeFile > 0 && (
            <pre className="glass mt-1.5 max-h-40 overflow-auto rounded-xl p-2.5 text-[10px]" dir="ltr"
              style={{ color: 'var(--text-primary)' }}>
              {files[activeFile].contents.slice(0, 4000)}
            </pre>
          )}
        </div>
      )}
    </div>
  )
}

function InstallButton({ id, onDone, onError }: {
  id: string; onDone: (d: Awaited<ReturnType<typeof fetchSkillDetail>>) => void; onError: (e: string | null) => void
}): React.JSX.Element {
  const [busy, setBusy] = useState(false)
  const go = async (): Promise<void> => {
    setBusy(true); onError(null)
    try {
      const d = await fetchSkillDetail(id)
      onDone(d)
    } catch (e) {
      onError(e instanceof Error ? e.message : 'نصب ناموفق بود')
    } finally {
      setBusy(false)
    }
  }
  return (
    <button onClick={() => void go()} disabled={busy}
      className="flex items-center gap-1.5 rounded-xl px-3.5 py-1.5 text-[11px] font-bold text-white transition-transform hover:scale-105 disabled:opacity-50"
      style={{ background: 'var(--accent)' }}>
      {busy ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
      نصب
    </button>
  )
}

/** کلید روشن/خاموش برای مکالمهٔ جاری */
function ConvToggle({ skillId, conversationId, onChange }: {
  skillId: string; conversationId: string; onChange: (enabled: boolean) => void
}): React.JSX.Element {
  const enabled = useSkillsStore(s => !(s.disabledForConv[conversationId] ?? []).includes(skillId))
  return (
    <button onClick={() => onChange(!enabled)}
      className="rounded-full px-3 py-1.5 text-[11px]"
      style={enabled
        ? { background: 'var(--accent-soft)', color: 'var(--accent)' }
        : { color: 'var(--text-secondary)' }}
      title={enabled ? 'فعال در این مکالمه — کلیک=غیرفعال' : 'غیرفعال در این مکالمه — کلیک=فعال'}>
      {enabled ? '● فعال در این مکالمه' : '○ غیرفعال اینجا'}
    </button>
  )
}

/* ─── لیست نصبشدهها ─── */

function InstalledList({ conversationId }: { conversationId?: string }): React.JSX.Element {
  const installed = useSkillsStore(s => s.installed)
  const uninstall = useSkillsStore(s => s.uninstall)
  const list = Object.values(installed)

  if (list.length === 0) {
    return (
      <div className="mt-10 text-center">
        <p className="text-3xl">🧩</p>
        <p className="mt-2 text-xs" style={{ color: 'var(--text-secondary)' }}>
          هنوز مهارتی نصب نشده — از تب «فروشگاه» شروع کن!
        </p>
      </div>
    )
  }

  return (
    <div className="grid gap-1.5">
      {list.map(sk => (
        <div key={sk.id} className="glass rise-in flex items-center gap-2 rounded-2xl px-3 py-2.5">
          <div className="min-w-0 flex-1">
            <div className="truncate text-xs font-semibold">{sk.name}</div>
            <div className="truncate text-[10px]" dir="ltr" style={{ color: 'var(--text-secondary)', textAlign: 'right' }}>{sk.id}</div>
          </div>
          {conversationId && (
            <ConvToggle skillId={sk.id} conversationId={conversationId}
              onChange={e => useSkillsStore.getState().setEnabledForConv(conversationId, sk.id, e)} />
          )}
          <button onClick={() => uninstall(sk.id)} title="حذف"
            className="rounded-xl p-1.5 opacity-60 hover:opacity-100" style={{ color: '#f87171' }}>
            <Trash2 size={13} />
          </button>
        </div>
      ))}
    </div>
  )
}
