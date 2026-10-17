/**
 * Conversations Store — مدیریت واقعی مکالمهها (ماندگار)
 * ساخت/حذف/تغییرنام/پین + گروهبندی Pinned/Today/Previous 7 days/Older
 */
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { useMessagesStore } from './messagesStore'

/** خلاصهٔ مکالمه برای لیست سایدبار (پیامها جدا ذخیره میشوند تا سنگین نشود) */
export interface ConversationMeta {
  id: string
  title: string
  preview?: string
  createdAt: number
  updatedAt: number
  pinned: boolean
  starred: boolean
}

interface ConvState {
  conversations: ConversationMeta[]
  activeId: string | null
  /** تعداد پیامهای زندهٔ هر مکالمه (گذرا — در حافظهٔ محلی ذخیره نمی‌شود) */
  liveCounts: Record<string, number>

  create: () => string
  remove: (id: string) => void
  rename: (id: string, title: string) => void
  togglePin: (id: string) => void
  toggleStar: (id: string) => void
  setActive: (id: string | null) => void
  /** اگر عنوان هنوز «مکالمهٔ جدید» است، از پیام کاربر بساز (۴۸ کاراکتر اول) */
  ensureTitle: (id: string, firstMessage: string) => void
  touch: (id: string) => void
  /** به‌روزرسانی تعداد پیامهای زنده (App هنگام تغییر نخ صدا می‌زند) */
  setLiveCount: (id: string | null, n: number) => void
}

function genId(): string {
  const rand =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10)
  return `c_${Date.now().toString(36)}_${rand}`
}

const NEW_TITLE = 'مکالمهٔ جدید'

/** تعداد پیامهای یک مکالمه: ذخیره‌شده در messagesStore + زندهٔ حافظه (هنوز ذخیره نشده) */
function messageCountOf(liveCounts: Record<string, number>, id: string): number {
  const t = useMessagesStore.getState().threads[id]
  const repo = t?.repository as { messages?: unknown[] } | undefined
  const saved = Array.isArray(repo?.messages) ? repo.messages.length : 0
  if (saved > 0) return saved
  return liveCounts[id] ?? 0
}

export const useConversationsStore = create<ConvState>()(
  persist(
    (set, get) => ({
      conversations: [],
      activeId: null,
      liveCounts: {},

      create: () => {
        const st = get()
        const newest = st.conversations[0]
        // ضداسپم: اگر تازه‌ترین مکالمه هنوز هیچ پیامی ندارد، تکراری نساز —
        // همان را فعال کن و شناسه‌اش را برگردان (دکمه عملاً کاری نمی‌کند).
        if (newest && messageCountOf(st.liveCounts, newest.id) === 0) {
          if (st.activeId !== newest.id) set({ activeId: newest.id })
          return newest.id
        }
        const now = Date.now()
        const conv: ConversationMeta = {
          id: genId(), title: NEW_TITLE, preview: '',
          createdAt: now, updatedAt: now,
          pinned: false, starred: false
        }
        set(s => ({
          conversations: [conv, ...s.conversations],
          activeId: conv.id,
          liveCounts: { ...s.liveCounts, [conv.id]: 0 },
        }))
        return conv.id
      },

      remove: id =>
        set(s => {
          const { [id]: _dropped, ...restCounts } = s.liveCounts
          return {
            conversations: s.conversations.filter(c => c.id !== id),
            // آبشاری: حذف پیامهای مکالمه هم اینجا انجام میشود (messagesStore گوش میدهد)
            activeId: s.activeId === id ? null : s.activeId,
            liveCounts: restCounts,
          }
        }),

      rename: (id, title) =>
        set(s => ({
          conversations: s.conversations.map(c =>
            c.id === id ? { ...c, title: title.trim().slice(0, 80), updatedAt: Date.now() } : c)
        })),

      togglePin: id =>
        set(s => ({
          conversations: s.conversations.map(c =>
            c.id === id ? { ...c, pinned: !c.pinned, updatedAt: Date.now() } : c)
        })),

      toggleStar: id =>
        set(s => ({
          conversations: s.conversations.map(c =>
            c.id === id ? { ...c, starred: !c.starred } : c)
        })),

      setActive: id => set({ activeId: id }),

      ensureTitle: (id, firstMessage) => {
        const conv = get().conversations.find(c => c.id === id)
        if (!conv) return
        const clean = firstMessage.trim().replace(/\s+/g, ' ').slice(0, 80)
        const preview = clean.length ? clean : (conv.preview ?? '')
        const title = conv.title === NEW_TITLE
          ? clean.slice(0, 48) || conv.title
          : conv.title
        set(s => ({
          conversations: s.conversations.map(c =>
            c.id === id ? { ...c, title, preview, updatedAt: Date.now() } : c)
        }))
      },

      touch: id =>
        set(s => ({
          conversations: s.conversations.map(c =>
            c.id === id ? { ...c, updatedAt: Date.now() } : c)
        })),

      setLiveCount: (id, n) => {
        if (!id) return
        const cur = get().liveCounts[id] ?? 0
        if (cur === n) return
        set(s => ({ liveCounts: { ...s.liveCounts, [id]: n } }))
      },
    }),
    {
      name: 'atlas-conversations',
      version: 1,
      // liveCounts گذراست — نباید در localStorage ماندگار شود
      partialize: (s) => ({ conversations: s.conversations, activeId: s.activeId }),
    }
  )
)

/* ─── ذخیرهٔ پیامها (جدا از متا) ─── */
// تعریف واقعی در src/stores/messagesStore.ts قرار دارد؛ اینجا فقط بازصادر میشود
// تا واردات قبلی خرد نشوند.
export { useMessagesStore } from './messagesStore'
export type { StoredThread } from './messagesStore'

/* ─── گروهبندی لیست (Pinned / Today / Previous 7 days / Older) ─── */

export type ConvGroup = 'pinned' | 'today' | 'week' | 'older'

export function groupConversations(convs: ConversationMeta[]): Array<{ group: ConvGroup; items: ConversationMeta[] }> {
  const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0)
  const todayMs = startOfDay.getTime()
  const weekMs = todayMs - 7 * 86_400_000

  const buckets: Record<ConvGroup, ConversationMeta[]> = { pinned: [], today: [], week: [], older: [] }
  for (const c of [...convs].sort((a, b) => b.updatedAt - a.updatedAt)) {
    if (c.pinned) buckets.pinned.push(c)
    else if (c.updatedAt >= todayMs) buckets.today.push(c)
    else if (c.updatedAt >= weekMs) buckets.week.push(c)
    else buckets.older.push(c)
  }

  const labels: Record<ConvGroup, string> = {
    pinned: '📌 سنجاقشده', today: 'امروز', week: '۷ روز اخیر', older: 'قدیمیتر'
  }
  return (Object.keys(buckets) as ConvGroup[])
    .filter(g => buckets[g].length > 0)
    .map(g => ({ group: g, items: buckets[g], label: labels[g] }) as { group: ConvGroup; items: ConversationMeta[]; label: string })
}
