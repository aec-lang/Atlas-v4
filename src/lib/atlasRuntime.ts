/**
 * Atlas Runtime — پل بین assistant-ui و موتور عامل
 * فاز ۲: استریم واقعی با AI SDK (آرسنال) — Ollama محلی / سازگار با OpenAI / Anthropic
 * حالت نمایش حذف شد؛ همیشه یک مدل واقعی لازم است.
 */
import {
  type AssistantRuntime,
  type ChatModelAdapter,
  useLocalRuntime,
} from '@assistant-ui/react'
import { streamText, type LanguageModel } from 'ai'
import { createOpenAI } from '@ai-sdk/openai'
import { createAnthropic } from '@ai-sdk/anthropic'
import { getModelSettings, getTaskConfig, useSettingsStore } from '@/stores/settingsStore'
import type { TaskConfig } from '@/stores/settingsStore'
import { buildSystemPrompt } from '@/lib/corePrompt'
import { buildAgentTools } from '@/lib/agentTools'
import { buildMcpTools } from '@/lib/mcpTools'
import {
  generateImage,
  generateVideo,
  generate3d,
  parseSlashCommand,
  synthesizeSpeech,
  type MediaJobResult,
  type SlashCmd,
} from '@/lib/mediaEngines'
import type { JobEvent } from '@/lib/jobAdapter'

/**
 * ساخت مدل بر اساس کانفیگ یک کار — نبودِ model یعنی پیام خطا برای کاربر.
 * موتور گفت‌وگو (هم چت متنی، هم پنل صوتی که متنش را به همین چت می‌فرستد)
 * از کانفیگ task مربوطه خوانده می‌شود، نه تنظیمات سراسری.
 * export شده تا رانر headless کارهای پس‌زمینه هم از همین منطق استفاده کند.
 */
export function resolveModel(cfg: TaskConfig): { model?: LanguageModel; error?: string } {
  if (cfg.provider === 'ollama') {
    if (!cfg.model.trim()) {
      return { error: 'مدلی انتخاب نشده — از تنظیمات ⚙️ لیست مدلهای Ollama را بگیر' }
    }
    return {
      model: createOpenAI({
        baseURL: cfg.baseURL,
        apiKey: 'ollama' // Ollama کلید نمیخواهد ولی SDK اجباری است
      }).languageModel(cfg.model)
    }
  }

  if (cfg.provider === 'anthropic') {
    if (!cfg.apiKey.trim() || !cfg.model.trim()) {
      return { error: 'کلید API یا مدل آنتراپیک تنظیم نشده — از تنظیمات ⚙️ تکمیلش کن' }
    }
    return {
      model: createAnthropic({ apiKey: cfg.apiKey }).languageModel(cfg.model)
    }
  }

  // openai-compatible — شامل gemini (نقطهٔ سازگار OpenAI گوگل)
  if (!cfg.apiKey.trim() || !cfg.model.trim()) {
    return { error: 'کلید API یا مدل تنظیم نشده — از تنظیمات ⚙️ تکمیلش کن' }
  }
  return {
    model: createOpenAI({ baseURL: cfg.baseURL, apiKey: cfg.apiKey }).languageModel(cfg.model)
  }
}

/** تبدیل پیامهای assistant-ui به فرمت AI SDK */
function toAiSdkMessages(messages: ChatModelRunOptions['messages']) {
  return messages
    .filter(m => m.role === 'system' || m.role === 'user' || m.role === 'assistant')
    .map(m => ({
      role: m.role as 'system' | 'user' | 'assistant',
      content: m.content
        .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
        .map(p => p.text)
        .join('\n')
    }))
}

/** متن آخرین پیام کاربر — برای تشخیص دستور اسلش */
function lastUserText(
  messages: ChatModelRunOptions['messages'],
): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!
    if (m.role !== 'user') continue
    const text = m.content
      .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
      .map(p => p.text)
      .join('\n')
      .trim()
    if (text) return text
  }
  return null
}

type RunUpdate = {
  content: Array<
    | { type: 'text'; text: string }
    | { type: 'image'; image: string }
    | { type: 'file'; data: string; mimeType: string; filename: string }
  >
  status: { type: 'running' } | { type: 'complete'; reason: 'stop' }
}

function doneRun(
  ...content: RunUpdate['content']
): RunUpdate {
  return {
    content,
    status: { type: 'complete', reason: 'stop' },
  }
}

const errText = (e: unknown): string =>
  e instanceof Error ? e.message : String(e)

/**
 * اجرای دستور اسلش (/image ، /tts ، /video ، /3d) — بدون رفتن به LLM.
 * ویدیو و سه‌بعدی با پرووایدر کاستوم کاربر (BYO API) اجرا می‌شوند؛
 * job ناهمزمان است پس پیشرفت مرحله‌به‌مرحله در چت گزارش می‌شود
 * (متن فارسی ساده، بدون ایموجی — هم‌زبان با کارت‌های tool call).
 */

/** تبدیل job ناهمزمان به آپدیت‌های پیشروندهٔ چت */
async function* runJobWithProgress(
  run: (opts: { signal?: AbortSignal; onEvent?: (e: JobEvent) => void }) => Promise<MediaJobResult>,
  abortSignal: AbortSignal,
  label: string,
): AsyncGenerator<RunUpdate, MediaJobResult> {
  const events: JobEvent[] = []
  let notify: (() => void) | null = null
  let settled = false
  const job = run({
    signal: abortSignal,
    onEvent: e => {
      events.push(e)
      notify?.()
      notify = null
    },
  }).finally(() => {
    settled = true
    notify?.()
    notify = null
  })

  let shown = -1
  for (;;) {
    while (shown < events.length - 1) {
      shown++
      const e = events[shown]!
      if (e.phase === 'done' || e.phase === 'error') continue
      yield {
        content: [{ type: 'text', text: `${label} — ${e.message}` }],
        status: { type: 'running' },
      }
    }
    if (settled && shown >= events.length - 1) break
    await Promise.race([job.then(() => {}, () => {}), new Promise<void>(res => { notify = res })])
  }
  return await job
}

async function* runSlashCommand(
  cmd: SlashCmd,
  arg: string,
  abortSignal: AbortSignal,
): AsyncGenerator<RunUpdate> {
  if (cmd === 'video' || cmd === '3d') {
    const isVideo = cmd === 'video'
    const what = isVideo ? 'ویدیو' : 'مدل سه‌بعدی'
    if (!arg) {
      yield doneRun({
        type: 'text',
        text: `پرامپت ${what} را هم بنویس — مثلاً: \`/${cmd} غروب روی دریا\``,
      })
      return
    }
    try {
      const run = isVideo ? generateVideo : generate3d
      const { resultUrl } = yield* runJobWithProgress(
        opts => run(arg, opts),
        abortSignal,
        `تولید ${what}`,
      )
      const mimeType = isVideo ? 'video/mp4' : 'model/gltf-binary'
      const filename = isVideo ? 'video.mp4' : 'model.glb'
      yield doneRun(
        { type: 'text', text: `${arg}` },
        // file با data از نوع URL — رندرر فایل (VideoPlayer/دانلود) خودش تشخیص می‌دهد
        { type: 'file', data: resultUrl, mimeType, filename },
      )
    } catch (e) {
      yield doneRun({
        type: 'text',
        text: `خطا در تولید ${what}: ${errText(e)}`,
      })
    }
    return
  }
  if (cmd === 'image') {
    if (!arg) {
      yield doneRun({
        type: 'text',
        text: 'پرامپت تصویر را هم بنویس — مثلاً: `/image یک گربه فضانورد`',
      })
      return
    }
    yield {
      content: [{ type: 'text', text: 'در حال تولید تصویر…' }],
      status: { type: 'running' },
    }
    try {
      const { dataUrl } = await generateImage(arg, abortSignal)
      yield doneRun(
        { type: 'text', text: arg },
        { type: 'image', image: dataUrl },
      )
    } catch (e) {
      yield doneRun({
        type: 'text',
        text: `خطا در تولید تصویر: ${errText(e)}`,
      })
    }
    return
  }
  // tts
  if (!arg) {
    yield doneRun({
      type: 'text',
      text: 'متنی برای گفتار بنویس — مثلاً: `/tts سلام دنیا`',
    })
    return
  }
  yield {
    content: [{ type: 'text', text: 'در حال تولید گفتار…' }],
    status: { type: 'running' },
  }
  try {
    const { base64, mimeType } = await synthesizeSpeech(arg, abortSignal)
    yield doneRun(
      { type: 'text', text: arg },
      { type: 'file', data: base64, mimeType, filename: 'tts.mp3' },
    )
  } catch (e) {
    yield doneRun({
      type: 'text',
      text: `خطا در تولید گفتار: ${errText(e)}`,
    })
  }
}

const AtlasChatAdapter: ChatModelAdapter = {
  async *run(options) {
    // ─── دستورات اسلش: قبل از LLM بررسی می‌شوند ───
    const userText = lastUserText(options.messages)
    const slash = userText ? parseSlashCommand(userText) : null
    if (slash) {
      yield* runSlashCommand(slash.cmd, slash.arg, options.abortSignal)
      return
    }

    const settings = getModelSettings()
    // موتور گفت‌وگو: کانفیگ task «چت متنی» (پنل صوتی هم متنش را به همین موتور می‌فرستد)
    const taskCfg = getTaskConfig('text-chat')

    /* ─── مدل واقعی ─── */
    const { model, error } = resolveModel(taskCfg)
    if (!model) {
      yield {
        content: [{ type: 'text' as const, text: `⚠️ ${error ?? 'مدلی در دسترس نیست'}` }],
        status: { type: 'complete' as const, reason: 'stop' as const }
      }
      return
    }

    try {
      const agentEnabled = useSettingsStore.getState().agentEnabled
      const hasDesktop = typeof window !== 'undefined' && !!(window as unknown as { atlasAPI?: unknown }).atlasAPI
      const tools = agentEnabled && hasDesktop ? { ...buildAgentTools(), ...(await buildMcpTools()) } : undefined

      const result = streamText({
        model,
        system: buildSystemPrompt(settings.systemPrompt),
        messages: toAiSdkMessages(options.messages),
        abortSignal: options.abortSignal,
        ...(tools ? { tools, maxSteps: 12 } : {})
      })

      let emitted = false
      for await (const delta of result.textStream) {
        emitted = true
        yield {
          content: [{ type: 'text' as const, text: delta }],
          status: { type: 'running' as const }
        }
      }

      // اطمینان از خطاها بعد از پایان جریان
      await result.finishReason

      if (!emitted) {
        yield {
          content: [{ type: 'text' as const, text: 'پاسخی دریافت نشد — اتصال پروایدر را بررسی کن.' }],
          status: { type: 'complete' as const, reason: 'stop' as const }
        }
      }
    } catch (err) {
      // لغو توسط کاربر خطا نیست
      if (options.abortSignal.aborted) throw err

      let msg = 'خطای ناشناخته'
      if (err instanceof Error) msg = err.message
      else if (typeof err === 'object' && err !== null) msg = JSON.stringify(err)

      yield {
        content: [{ type: 'text' as const, text: `⚠️ خطا در ارتباط با مدل:\n\n\`${msg}\`\n\nاتصال، کلید API و مدل را در تنظیمات بررسی کن.` }],
        status: { type: 'complete' as const, reason: 'stop' as const }
      }
    }
  }
}

type ChatModelRunOptions = Parameters<ChatModelAdapter['run']>[0]

export function useAtlasRuntime(): AssistantRuntime {
  return useLocalRuntime(AtlasChatAdapter)
}
