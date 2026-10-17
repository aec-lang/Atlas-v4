/**
 * Sidebar — مدیریت واقعی مکالمهها
 * گروهبندی، جستوجوی زنده، پین/ستاره/تغییرنام/حذف + فروشگاه مهارتها و تنظیمات
 */
import { MessageSquarePlus, PanelRightClose, Pin, Search, Trash2, Settings, Puzzle, Star, Pencil, Check, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { motion } from 'motion/react'
import { SettingsDialog } from '@/components/SettingsDialog'
import { SkillsStorePanel } from '@/components/SkillsStorePanel'
import { useSkillsStore } from '@/stores/skillsStore'
import { AppIcon } from '@/components/AppIcon'
import {
  useConversationsStore, useMessagesStore, groupConversations
} from '@/stores/conversationsStore'

const GROUP_LABELS: Record<string, string> = {
  pinned: '📌 سنجاقشده', today: 'امروز', week: '۷ روز اخیر', older: 'قدیمیتر'
}

export function Sidebar({ onClose }: { onClose: () => void }): React.JSX.Element {
  const [query, setQuery] = useState('')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [skillsOpen, setSkillsOpen] = useState(false)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameText, setRenameText] = useState('')

  const conversations = useConversationsStore(s => s.conversations)
  const activeId = useConversationsStore(s => s.activeId)
  const liveCounts = useConversationsStore(s => s.liveCounts)
  const threads = useMessagesStore(s => s.threads)
  const createConv = useConversationsStore(s => s.create)
  const removeConv = useConversationsStore(s => s.remove)
  const renameConv = useConversationsStore(s => s.rename)
  const togglePin = useConversationsStore(s => s.togglePin)
  const toggleStar = useConversationsStore(s => s.toggleStar)
  const setActive = useConversationsStore(s => s.setActive)

  const installedCount = useSkillsStore(s => Object.keys(s.installed).length)

  /** مکالمهٔ فعلی هیچ پیامی ندارد → دکمهٔ «مکالمهٔ جدید» غیرفعال می‌ماند */
  const activeEmpty = (() => {
    if (!activeId) return false
    const repo = threads[activeId]?.repository as { messages?: unknown[] } | undefined
    if (Array.isArray(repo?.messages) && repo.messages.length > 0) return false
    return (liveCounts[activeId] ?? 0) === 0
  })()

  // باز شدن فروشگاه مهارتها از دکمهٔ مرورگر/پرامپت (رویداد سراسری)
  useEffect(() => {
    const h = (): void => setSkillsOpen(true)
    window.addEventListener('atlas:open-skills', h)
    return () => window.removeEventListener('atlas:open-skills', h)
  }, [])

  // حذف پیامهای مکالمهٔ حذفشده (آبشاری)
  const removeCascade = (id: string): void => {
    useMessagesStore.getState().drop(id)
    removeConv(id)
  }

  const filtered = query.trim()
    ? conversations.filter(c => {
        const q = query.trim()
        if (c.title.includes(q)) return true
        // جستوجو در محتوای پیامهای ذخیرهشدهٔ آن مکالمه
        const t = useMessagesStore.getState().threads[c.id]
        return t ? JSON.stringify(t.repository ?? '').toLowerCase().includes(q.toLowerCase()) : false
      })
    : conversations
  const groups = groupConversations(filtered)

  const startRename = (id: string, current: string): void => {
    setRenamingId(id); setRenameText(current)
  }
  const commitRename = (): void => {
    if (renamingId && renameText.trim()) renameConv(renamingId, renameText)
    setRenamingId(null)
  }

  return (
    <aside className="glass-strong flex h-full w-72 shrink-0 flex-col rounded-[1.6rem] m-3 ml-0 p-3">
      {/* لوگو */}
      <div className="rise-in mb-3 flex items-center gap-2.5 px-1 pt-1">
        <div className="glass-accent-ring flex h-10 w-10 items-center justify-center rounded-2xl" style={{ background: 'var(--accent-soft)' }}>
          <AppIcon size={26} />
        </div>
        <div>
          <h1 className="text-lg font-bold tracking-tight">Atlas</h1>
          <p className="text-[10px]" style={{ color: 'var(--text-secondary)' }}>دستیار محلی تو</p>
        </div>
        <button onClick={onClose} className="mr-auto rounded-xl p-2 glass-hover" title="بستن (Ctrl+B)" style={{ color: 'var(--text-secondary)' }}>
          <PanelRightClose size={17} />
        </button>
      </div>

      {/* جستوجو */}
      <div className="glass rise-in stagger-1 mb-2 flex items-center gap-2 rounded-2xl px-3 py-2.5">
        <Search size={14} style={{ color: 'var(--text-secondary)' }} />
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="جستوجو در مکالمهها..."
          className="w-full bg-transparent text-xs outline-none placeholder:opacity-50"
          style={{ color: 'var(--text-primary)' }}
        />
      </div>

      {/* مکالمهٔ جدید — وقتی مکالمهٔ فعلی هنوز خالی است غیرفعال */}
      <button onClick={() => { createConv(); onClose?.() }}
        disabled={activeEmpty}
        title={activeEmpty ? 'مکالمهٔ فعلی هنوز خالی است' : 'مکالمهٔ جدید'}
        className="btn-gradient rise-in stagger-2 mb-3 flex items-center gap-2 rounded-2xl px-3 py-2.5 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-40">
        <MessageSquarePlus size={16} /> مکالمهٔ جدید
        <kbd className="mr-auto rounded-md px-1.5 py-0.5 text-[9px] glass" style={{ color: 'rgba(255,255,255,.8)' }}>Ctrl K</kbd>
      </button>

       {/* لیست گروهی */}
       <nav className="-mr-1 min-h-0 flex-1 animate-in fade-in overflow-y-auto pl-1">
        {groups.length === 0 && (
          <p className="mt-6 text-center text-[11px]" style={{ color: 'var(--text-secondary)' }}>
            {conversations.length === 0 ? 'اولین مکالمهات رو بساز ✨' : 'چیزی پیدا نشد'}
          </p>
        )}
        {groups.map(({ group, items }) => (
          <div key={group} className="mb-2">
            <p className="mb-1 px-2 text-[9px] font-medium tracking-wide" style={{ color: 'var(--text-secondary)' }}>
              {GROUP_LABELS[group]}
            </p>
            {items.map(c => (
              <div key={c.id}
                onClick={() => setActive(c.id)}
                className={`group relative mb-1 flex w-full cursor-pointer items-center gap-2 rounded-2xl px-3 py-2 text-right transition-all glass glass-hover`}
                style={{
                  background: activeId === c.id ? 'var(--accent-soft)' : undefined,
                  borderColor: activeId === c.id ? 'color-mix(in srgb, var(--accent) 40%, transparent)' : undefined,
                  color: 'var(--text-primary)'
                }}>
                {activeId === c.id && (
                  <motion.span layoutId="activeConv"
                    className="absolute inset-y-1.5 left-0 w-1 rounded-full"
                    style={{ background: 'var(--accent)' }} />
                )}
                {c.pinned && <Pin size={11} style={{ color: 'var(--accent)', flexShrink: 0 }} />}
                {c.starred && <Star size={11} fill="currentColor" style={{ color: '#facc15', flexShrink: 0 }} />}

                <div className="min-w-0 flex-1">
                  {renamingId === c.id ? (
                    <input autoFocus value={renameText}
                      onChange={e => setRenameText(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') commitRename()
                        if (e.key === 'Escape') setRenamingId(null)
                      }}
                      onClick={e => e.stopPropagation()}
                      className="w-full rounded-lg bg-transparent text-xs outline-none"
                      style={{ color: 'var(--text-primary)', border: '1px solid var(--glass-border)' }} />
                  ) : (
                    <>
                      <span className="block truncate text-xs font-medium">{c.title}</span>
                      {c.preview && <span className="block truncate text-[10px] opacity-60">{c.preview}</span>}
                    </>
                  )}
                </div>

                {/* اکشنهای شناور */}
                <span className="mr-auto flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100"
                  onClick={e => e.stopPropagation()}>
                  {renamingId === c.id ? (
                    <>
                      <button onClick={commitRename} className="rounded-lg p-1" style={{ color: '#4ade80' }} title="ثبت"><Check size={12} /></button>
                      <button onClick={() => setRenamingId(null)} className="rounded-lg p-1" style={{ color: 'var(--text-secondary)' }} title="لغو"><X size={12} /></button>
                    </>
                  ) : (
                    <>
                      <button onClick={() => togglePin(c.id)} className="rounded-lg p-1" style={{ color: 'var(--text-secondary)' }} title={c.pinned ? 'برداشتن سنجاق' : 'سنجاق'}>
                        <Pin size={11} style={c.pinned ? { color: 'var(--accent)' } : undefined} />
                      </button>
                      <button onClick={() => toggleStar(c.id)} className="rounded-lg p-1" style={{ color: 'var(--text-secondary)' }} title="ستاره">
                        <Star size={11} style={c.starred ? { color: '#facc15', fill: 'currentColor' } : undefined} />
                      </button>
                      <button onClick={() => startRename(c.id, c.title)} className="rounded-lg p-1" style={{ color: 'var(--text-secondary)' }} title="تغییر نام">
                        <Pencil size={11} />
                      </button>
                      <button onClick={() => removeCascade(c.id)} className="rounded-lg p-1 hover:!opacity-100" style={{ color: '#f87171' }} title="حذف">
                        <Trash2 size={11} />
                      </button>
                    </>
                  )}
                </span>
              </div>
            ))}
          </div>
        ))}
      </nav>

      {/* پایین */}
      <div className="mt-2 flex flex-col gap-1.5">
        <button onClick={() => setSkillsOpen(true)} className="glass glass-hover flex items-center gap-2 rounded-2xl px-3 py-2.5 text-xs" style={{ color: 'var(--text-secondary)' }}>
          <Puzzle size={14} /> فروشگاه مهارتها
          <span className="mr-auto rounded-full px-2 py-0.5 text-[9px]" style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}>
            {installedCount > 0 ? `${installedCount} نصبشده` : 'skills.sh'}
          </span>
        </button>
        <button onClick={() => setSettingsOpen(true)} className="glass glass-hover flex items-center gap-2 rounded-2xl px-3 py-2.5 text-xs" style={{ color: 'var(--text-secondary)' }}>
          <Settings size={14} /> تنظیمات
          <kbd className="mr-auto rounded-md px-1.5 py-0.5 text-[9px] glass">Ctrl ,</kbd>
        </button>
      </div>

      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
      <SkillsStorePanel open={skillsOpen} onClose={() => setSkillsOpen(false)} conversationId={activeId ?? undefined} />
    </aside>
  )
}
