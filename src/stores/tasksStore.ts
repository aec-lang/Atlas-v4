/**
 * Tasks Store — آینهٔ رندرر از رجیستری کارهای پس‌زمینه/زمان‌بندی‌شده.
 * منبع حقیقت پروسهٔ اصلی است (desktop/tasks.cjs → atlas-tasks.json)؛
 * این استور فقط وضعیت زنده را نگه می‌دارد و persist نمی‌شود.
 */
import { create } from 'zustand'
import type {
  AtlasAPI,
  BgTask,
  CronSchedule,
  PendingApproval,
  TasksSnapshot,
} from '@/types/atlas-api'
import { abortTaskRun } from '@/lib/taskRunner'

function getApi(): AtlasAPI | undefined {
  return (window as unknown as { atlasAPI?: AtlasAPI }).atlasAPI
}

interface TasksState {
  bgTasks: BgTask[]
  schedules: CronSchedule[]
  loaded: boolean
  /** جایگزینی کامل با اسنپ‌شات پروسهٔ اصلی */
  applySnapshot: (s: TasksSnapshot) => void
  /** خواندن اولیه از پروسهٔ اصلی */
  refresh: () => Promise<void>
  /** لغو تسک در حال اجرا */
  cancelTask: (id: string) => Promise<void>
  /** تأیید دستی و اجرای یک pending approval (با دریچهٔ تأیید معمول اپ) */
  approvePending: (taskId: string, approvalId: string) => Promise<void>
  /** رد یک pending approval */
  rejectPending: (taskId: string, approvalId: string) => Promise<void>
  addSchedule: (input: { title: string; prompt: string; cron: string; label: string }) => Promise<string | null>
  updateSchedule: (id: string, patch: Partial<CronSchedule>) => Promise<void>
  removeSchedule: (id: string) => Promise<void>
  /** باز کردن نتیجهٔ تسک در چت جاری */
  openInChat: (taskId: string) => void
}

export const useTasksStore = create<TasksState>()((set, get) => ({
  bgTasks: [],
  schedules: [],
  loaded: false,

  applySnapshot: s =>
    set({ bgTasks: s.bgTasks ?? [], schedules: s.schedules ?? [], loaded: true }),

  refresh: async () => {
    const api = getApi()
    if (!api?.tasksList) return
    try {
      const r = await api.tasksList()
      if (r.ok && r.snapshot) get().applySnapshot(r.snapshot)
    } catch { /* ignore */ }
  },

  cancelTask: async id => {
    abortTaskRun(id)
    const api = getApi()
    if (api?.bgCancel) {
      try { await api.bgCancel(id) } catch { /* ignore */ }
    }
  },

  approvePending: async (taskId, approvalId) => {
    const api = getApi()
    if (!api?.invokeTool || !api?.bgApprovalResolved) return
    const task = get().bgTasks.find(t => t.id === taskId)
    const ap: PendingApproval | undefined = task?.pendingApprovals.find(a => a.id === approvalId)
    if (!ap || ap.status !== 'pending') return
    // اجرا از مسیر عادی ابزارها → دیالوگ تأیید خود اپ (کاربر حاضر است) اعمال می‌شود
    let result: unknown
    try {
      result = await api.invokeTool(ap.tool, ap.args)
    } catch (e) {
      result = { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
    try {
      await api.bgApprovalResolved(taskId, approvalId, 'approved', result)
    } catch { /* ignore */ }
  },

  rejectPending: async (taskId, approvalId) => {
    const api = getApi()
    if (!api?.bgApprovalResolved) return
    try {
      await api.bgApprovalResolved(taskId, approvalId, 'rejected')
    } catch { /* ignore */ }
  },

  addSchedule: async input => {
    const api = getApi()
    if (!api?.scheduleAdd) return null
    try {
      const r = await api.scheduleAdd(input)
      return r.ok ? (r.id ?? null) : null
    } catch {
      return null
    }
  },

  updateSchedule: async (id, patch) => {
    const api = getApi()
    if (!api?.scheduleUpdate) return
    try { await api.scheduleUpdate(id, patch) } catch { /* ignore */ }
  },

  removeSchedule: async id => {
    const api = getApi()
    if (!api?.scheduleRemove) return
    try { await api.scheduleRemove(id) } catch { /* ignore */ }
  },

  openInChat: taskId => {
    const task = get().bgTasks.find(t => t.id === taskId)
    if (!task) return
    const body = task.result || task.error || '(بدون نتیجه)'
    const text = `**نتیجهٔ کار پس‌زمینه: ${task.title}**\n\n${body}`
    window.dispatchEvent(new CustomEvent('atlas:open-task-in-chat', { detail: { text } }))
  },
}))
