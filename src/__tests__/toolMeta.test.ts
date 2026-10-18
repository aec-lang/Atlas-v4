import { describe, it, expect } from 'vitest'
import { TOOL_META, getToolMeta } from '@/components/assistant-ui/toolMeta'

/** همه‌ی ابزارهای buildAgentTools — باید لیبل فارسی داشته باشند */
const ALL_TOOLS = [
  'system_info',
  'shell_exec',
  'fs_list',
  'fs_read',
  'fs_write',
  'fs_mkdir',
  'fs_exists',
  'proc_list',
  'proc_kill',
  'clipboard_read',
  'clipboard_write',
  'mouse_move',
  'mouse_click',
  'mouse_scroll',
  'keyboard_type',
  'keyboard_press',
  'memory_set',
  'memory_get',
  'memory_list',
  'memory_delete',
  'screen_capture',
  'get_task_config',
  'set_task_config',
  'create_background_task',
  'schedule_task',
]

/** بازه‌های یونیکد ایموجی — قانون کاربر: بدون ایموجی در UI جدید */
const EMOJI_RE =
  /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}]/u

describe('toolMeta — لیبل فارسی ابزارها', () => {
  it('همه‌ی ۲۵ ابزار لیبل فارسی و آیکون دارند', () => {
    for (const name of ALL_TOOLS) {
      const meta = TOOL_META[name]
      expect(meta, `ابزار ${name} متا ندارد`).toBeDefined()
      expect(meta!.label.trim().length).toBeGreaterThan(0)
      expect(typeof meta!.icon).toBeDefined()
    }
  })

  it('هیچ لیبلی ایموجی ندارد', () => {
    for (const name of ALL_TOOLS) {
      expect(TOOL_META[name]!.label).not.toMatch(EMOJI_RE)
    }
  })

  it('ابزار ناشناخته با آیکون عمومی و همان اسم برمی‌گردد (نمی‌شکند)', () => {
    const meta = getToolMeta('some_future_tool')
    expect(meta.label).toBe('some_future_tool')
    expect(meta.icon).toBeDefined()
  })
})

describe('agentTools — تنظیم محاوره‌ای پرووایدر', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const exec = async (name: string, args: Record<string, unknown>): Promise<any> => {
    const { buildAgentTools } = await import('@/lib/agentTools')
    const tools = buildAgentTools() as unknown as Record<string, { execute: (a: unknown) => Promise<unknown> }>
    return tools[name]!.execute(args)
  }

  it('get_task_config مقدار کلید را لو نمی‌دهد', async () => {
    const { useSettingsStore } = await import('@/stores/settingsStore')
    useSettingsStore.getState().setTaskConfig('video', { apiKey: 'secret-123', provider: 'openai' })
    const r = await exec('get_task_config', { task: 'video' })
    expect(r.ok).toBe(true)
    expect(r.hasApiKey).toBe(true)
    expect(JSON.stringify(r)).not.toContain('secret-123')
  })

  it('set_task_config برای کلید، اول pending می‌دهد و بدون تأیید ذخیره نمی‌کند', async () => {
    const { useSettingsStore } = await import('@/stores/settingsStore')
    useSettingsStore.getState().setTaskConfig('video', { apiKey: 'old-key' })
    const r1 = await exec('set_task_config', { task: 'video', apiKey: 'new-key' })
    expect(r1.pending).toBe(true)
    // هنوز ذخیره نشده
    expect(useSettingsStore.getState().taskConfigs.video.apiKey).toBe('old-key')
  })

  it('با confirmed=true بعد از pending، کلید ذخیره می‌شود', async () => {
    const { useSettingsStore } = await import('@/stores/settingsStore')
    useSettingsStore.getState().setTaskConfig('video', { apiKey: 'old-key' })
    await exec('set_task_config', { task: 'video', apiKey: 'new-key-2' })
    const r2 = await exec('set_task_config', { task: 'video', apiKey: 'ignored', confirmed: true })
    expect(r2.ok).toBe(true)
    expect(useSettingsStore.getState().taskConfigs.video.apiKey).toBe('new-key-2')
  })

  it('confirmed بدون pending قبلی رد می‌شود', async () => {
    const r = await exec('set_task_config', { task: 'tts', apiKey: 'x', confirmed: true })
    expect(r.ok).toBe(false)
  })

  it('فیلدهای غیرکلیدی بدون تأیید اعمال می‌شوند', async () => {
    const { useSettingsStore } = await import('@/stores/settingsStore')
    const r = await exec('set_task_config', { task: 'tts', model: 'tts-1', baseURL: 'https://x' })
    expect(r.ok).toBe(true)
    const cfg = useSettingsStore.getState().taskConfigs.tts
    expect(cfg.model).toBe('tts-1')
    expect(cfg.baseURL).toBe('https://x')
  })
})
