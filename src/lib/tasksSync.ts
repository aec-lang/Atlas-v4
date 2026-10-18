/**
 * TasksSync — اتصال رندرر به سرویس تسک‌های پروسهٔ اصلی.
 * یک‌بار از main.tsx صدا زده می‌شود (کنار initProvidersFile).
 *
 * - رجیستری را می‌خواند و در useTasksStore می‌ریزد
 * - به‌روزرسانی‌های زنده (atlas:tasks-changed) را اعمال می‌کند
 * - با فرا رسیدن موعد زمان‌بند (atlas:schedule-fire)، اجرای headless را شروع می‌کند
 */
import type { AtlasAPI } from '@/types/atlas-api'
import { useTasksStore } from '@/stores/tasksStore'
import { runBackgroundTask } from '@/lib/taskRunner'

function getApi(): AtlasAPI | undefined {
  return (window as unknown as { atlasAPI?: AtlasAPI }).atlasAPI
}

let initialized = false

/** اجرای یک تسک و گزارش نتیجه به پروسهٔ اصلی */
export async function startTaskRun(taskId: string, prompt: string): Promise<void> {
  const api = getApi()
  try {
    const res = await runBackgroundTask(taskId, prompt, {
      onProgress: note => {
        api?.bgUpdate?.(taskId, { progressNote: note })?.catch(() => {})
      },
    })
    await api?.bgUpdate?.(taskId, {
      status: 'done',
      result: res.text,
      toolLog: res.toolLog,
      pendingApprovals: res.pendingApprovals,
      progressNote: '',
    })
  } catch (e) {
    const aborted = (e as { code?: string })?.code === 'ABORTED'
    await api?.bgUpdate?.(taskId, {
      status: aborted ? 'cancelled' : 'error',
      error: aborted ? 'لغو شد توسط کاربر.' : e instanceof Error ? e.message : String(e),
      progressNote: '',
    })?.catch(() => {})
  }
}

/** ساخت تسک پس‌زمینه از چت/ابزار و شروع فوری اجرایش */
export async function createAndRunBackgroundTask(
  prompt: string,
  title?: string,
): Promise<{ ok: boolean; id?: string; error?: string }> {
  const api = getApi()
  if (!api?.bgCreate) {
    return { ok: false, error: 'کار پس‌زمینه فقط در نسخهٔ دسکتاپ (Electron) در دسترس است.' }
  }
  const r = await api.bgCreate({
    title: title?.trim() || prompt.slice(0, 60),
    prompt,
    kind: 'background',
  })
  if (!r.ok || !r.id) return { ok: false, error: r.error ?? 'ساخت تسک ناموفق بود' }
  // اجرا بدون انتظار (fire-and-forget)؛ نتیجه با ناتیفیکیشن اعلام می‌شود
  void startTaskRun(r.id, prompt)
  return { ok: true, id: r.id }
}

export function initTasksSync(): void {
  if (initialized) return
  initialized = true
  const api = getApi()
  if (!api) return
  void useTasksStore.getState().refresh()
  api.onTasksChanged?.(snap => {
    useTasksStore.getState().applySnapshot(snap)
  })
  api.onScheduleFire?.(({ taskId, prompt }) => {
    void startTaskRun(taskId, prompt)
  })
}
