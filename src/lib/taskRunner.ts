/**
 * TaskRunner — اجرای headless (بدون UI) موتور ایجنت برای کارهای پس‌زمینه
 * و زمان‌بندی‌شده.
 *
 * از همان resolveModel / buildAgentTools / buildSystemPrompt چت استفاده می‌کند،
 * با دو تفاوت مهم:
 *  ۱) خروجی استریم به UI نمی‌رود؛ متن نهایی + لاگ ابزارها جمع می‌شود.
 *  ۲) سیاست امنیتی taskPolicy روی همهٔ ابزارها اعمال می‌شود: ابزارهای
 *     نیازمند تأیید در حالت خودکار اجرا نمی‌شوند و «در انتظار تأیید» ثبت می‌شوند.
 */
import { streamText, type ToolSet, type Tool } from 'ai'
import { getModelSettings, getTaskConfig, useSettingsStore } from '@/stores/settingsStore'
import { buildSystemPrompt } from '@/lib/corePrompt'
import { buildAgentTools } from '@/lib/agentTools'
import { buildMcpTools } from '@/lib/mcpTools'
import { resolveModel } from '@/lib/atlasRuntime'
import {
  isToolAllowedInBackground,
  backgroundDenialMessage,
} from '@/lib/taskPolicy'
import type { PendingApproval } from '@/types/atlas-api'

export interface BackgroundRunResult {
  text: string
  toolLog: Array<{ tool: string; ok: boolean; ts: number }>
  pendingApprovals: PendingApproval[]
}

export interface RunTaskOptions {
  /** حداکثر زمان اجرا (پیش‌فرض ۱۰ دقیقه) */
  timeoutMs?: number
  /** گزارش پیشرفت زنده برای پنل */
  onProgress?: (note: string) => void
  /** کنترلر خارجی لغو (اختیاری) */
  signal?: AbortSignal
}

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000
const MAX_STEPS = 12

const BG_SYSTEM_SUFFIX =
  '\n\n[حالت پس‌زمینه] تو بدون نظارت مستقیم کاربر اجرا می‌شوی. ' +
  'ابزارهایی که نیازمند تأیید دستی‌اند در این حالت اجرا نمی‌شوند و درخواستشان ' +
  'در پنل «کارها» ثبت می‌شود؛ با ابزارهای مجاز ادامه بده. ' +
  'در پاسخ نهایی: خلاصهٔ کاری که انجام شد + فهرست قدم‌هایی که منتظر تأیید کاربر ماندند.'

/** کنترلرهای زنده برای لغو از پنل */
const liveControllers = new Map<string, AbortController>()

export function abortTaskRun(taskId: string): void {
  const c = liveControllers.get(taskId)
  if (c) {
    try { c.abort() } catch { /* ignore */ }
    liveControllers.delete(taskId)
  }
}

let approvalSeq = 0

/** پیچیدن ابزارها با سیاست امنیتی حالت خودکار + لاگ */
function wrapToolsForBackground(
  tools: ToolSet,
  hooks: {
    onToolCall: (tool: string, ok: boolean) => void
    collectApproval: (a: PendingApproval) => void
  },
): ToolSet {
  const out: ToolSet = {}
  for (const [name, t] of Object.entries(tools)) {
    out[name] = {
      ...(t as unknown as Record<string, unknown>),
      execute: async (args: unknown, opts: unknown) => {
        const rec = (args ?? {}) as Record<string, unknown>
        const decision = isToolAllowedInBackground(name, rec)
        if (!decision.allowed) {
          hooks.collectApproval({
            id: `pa_${Date.now().toString(36)}_${(approvalSeq++).toString(36)}`,
            tool: name,
            args: rec,
            reason: decision.reason ?? 'نیازمند تأیید دستی',
            ts: Date.now(),
            status: 'pending',
          })
          hooks.onToolCall(name, false)
          return { ok: false, pendingApproval: true, note: backgroundDenialMessage(name) }
        }
        try {
          const fn = (t as unknown as { execute: (a: unknown, o: unknown) => Promise<unknown> }).execute
          const res = await fn(rec, opts)
          hooks.onToolCall(name, true)
          return res
        } catch (e) {
          hooks.onToolCall(name, false)
          throw e
        }
      },
    } as unknown as Tool
  }
  return out
}

export async function runBackgroundTask(
  taskId: string,
  prompt: string,
  opts: RunTaskOptions = {},
): Promise<BackgroundRunResult> {
  const controller = new AbortController()
  liveControllers.set(taskId, controller)
  if (opts.signal) {
    opts.signal.addEventListener('abort', () => controller.abort(), { once: true })
  }
  const timeout = setTimeout(() => controller.abort(), opts.timeoutMs ?? DEFAULT_TIMEOUT_MS)

  const toolLog: BackgroundRunResult['toolLog'] = []
  const pendingApprovals: PendingApproval[] = []

  try {
    const taskCfg = getTaskConfig('text-chat')
    const { model, error } = resolveModel(taskCfg)
    if (!model) {
      throw new Error(error ?? 'مدلی در دسترس نیست')
    }

    const settings = getModelSettings()
    const agentEnabled = useSettingsStore.getState().agentEnabled
    const hasDesktop =
      typeof window !== 'undefined' &&
      !!(window as unknown as { atlasAPI?: unknown }).atlasAPI
    const tools =
      agentEnabled && hasDesktop
        ? wrapToolsForBackground({ ...buildAgentTools(), ...(await buildMcpTools()) }, {
            onToolCall: (tool, ok) => {
              toolLog.push({ tool, ok, ts: Date.now() })
              opts.onProgress?.(`در حال اجرا: ${tool}`)
            },
            collectApproval: a => pendingApprovals.push(a),
          })
        : undefined

    const result = streamText({
      model,
      system: buildSystemPrompt(settings.systemPrompt) + BG_SYSTEM_SUFFIX,
      messages: [{ role: 'user' as const, content: prompt }],
      abortSignal: controller.signal,
      ...(tools ? { tools, maxSteps: MAX_STEPS } : {}),
    })

    let text = ''
    for await (const delta of result.textStream) {
      text += delta
    }
    await result.finishReason

    return {
      text: text.trim() || 'پاسخی از مدل دریافت نشد.',
      toolLog,
      pendingApprovals,
    }
  } catch (e) {
    if (controller.signal.aborted) {
      const err = new Error('لغو شد توسط کاربر.')
      ;(err as unknown as { code?: string }).code = 'ABORTED'
      throw err
    }
    throw e
  } finally {
    clearTimeout(timeout)
    liveControllers.delete(taskId)
  }
}
