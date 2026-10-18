/**
 * فایل providers.json — کانفیگ پرووایدرها به سبک OpenCode.
 * کاربر می‌تواند آن را دستی ویرایش کند؛ Atlas در استارت می‌خواندش.
 * - دسکتاپ (Electron): app-data/providers.json از طریق IPC پروسهٔ اصلی
 * - مرورگر: localStorage با همان ساختار (کلید atlas-providers-file)
 */
import {
  TASKS,
  normalizeCustomJob,
  useSettingsStore,
  type TaskConfig,
  type TaskConfigs,
  type TaskKind,
} from '@/stores/settingsStore'
import type { McpServerConfig } from '@/types/atlas-api'

export interface ProvidersFile {
  version: 1
  exportedAt: string
  /** توضیح انسانی — در فایل دستی هم می‌ماند */
  note?: string
  taskConfigs: Partial<Record<TaskKind, Partial<TaskConfig>>>
  /** سرورهای MCP — UI کانکتورها و همین فایل از یک منبع می‌خوانند/می‌نویسند */
  mcpServers?: McpServerConfig[]
}

const BROWSER_KEY = 'atlas-providers-file'
const VALID_PROVIDERS = ['openai', 'ollama', 'anthropic', 'gemini', 'custom'] as const

/** fallback حافظه‌ای وقتی localStorage در دسترس نیست (تست/SSR) */
const memFallback = new Map<string, string>()
function lsGet(key: string): string | null {
  try {
    if (typeof localStorage !== 'undefined') return localStorage.getItem(key)
  } catch { /* ignore */ }
  return memFallback.get(key) ?? null
}
function lsSet(key: string, value: string): void {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(key, value)
      return
    }
  } catch { /* ignore */ }
  memFallback.set(key, value)
}

function isDesktop(): boolean {
  return typeof window !== 'undefined' && !!window.atlasAPI?.providersRead
}

/** اعتبارسنجی و نرمال‌سازی محتوای فایل — ورودی خراب، بی‌صدا نادیده گرفته می‌شود */
export function parseProvidersFile(raw: string): ProvidersFile | null {
  let json: unknown
  try {
    json = JSON.parse(raw)
  } catch {
    return null
  }
  if (typeof json !== 'object' || json === null) return null
  const j = json as Record<string, unknown>
  const cfgs = j.taskConfigs

  const out: Partial<Record<TaskKind, Partial<TaskConfig>>> = {}
  if (typeof cfgs === 'object' && cfgs !== null) {
    for (const t of TASKS) {
      const c = (cfgs as Record<string, unknown>)[t.id]
      if (typeof c !== 'object' || c === null) continue
    const cc = c as Record<string, unknown>
    const patch: Partial<TaskConfig> = {}
    if (typeof cc.provider === 'string' && (VALID_PROVIDERS as readonly string[]).includes(cc.provider)) {
      patch.provider = cc.provider as TaskConfig['provider']
    }
    if (typeof cc.apiKey === 'string') patch.apiKey = cc.apiKey
    if (typeof cc.baseURL === 'string') patch.baseURL = cc.baseURL
    if (typeof cc.model === 'string') patch.model = cc.model
    if (typeof cc.custom === 'object' && cc.custom !== null) {
      patch.custom = normalizeCustomJob(cc.custom as Partial<TaskConfig['custom']>)
    }
    if (Object.keys(patch).length > 0) out[t.id] = patch
    }
  }
  const mcpServers = parseMcpServers(j.mcpServers)
  if (Object.keys(out).length === 0 && (!mcpServers || mcpServers.length === 0)) return null
  return {
    version: 1,
    exportedAt: typeof j.exportedAt === 'string' ? j.exportedAt : new Date().toISOString(),
    note: typeof j.note === 'string' ? j.note : undefined,
    taskConfigs: out,
    mcpServers,
  }
}

/** اعتبارسنجی لیست سرورهای MCP — ورودی خراب نادیده گرفته می‌شود */
export function parseMcpServers(raw: unknown): McpServerConfig[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const out: McpServerConfig[] = []
  for (const s of raw) {
    if (!s || typeof s !== 'object') continue
    const r = s as Record<string, unknown>
    const transport = r.transport === 'http' ? 'http' : 'stdio'
    const id = String(r.id || r.name || '').toLowerCase().replace(/[^a-z0-9_]/g, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '').slice(0, 32)
    if (!id) continue
    const cfg: McpServerConfig = {
      id,
      name: typeof r.name === 'string' && r.name.trim() ? r.name.trim().slice(0, 80) : id,
      transport,
      enabled: r.enabled !== false,
      curated: r.curated === true,
    }
    if (transport === 'stdio') {
      if (typeof r.command !== 'string' || !r.command.trim()) continue
      cfg.command = r.command.trim()
      cfg.args = Array.isArray(r.args) ? r.args.map(a => String(a)) : []
      cfg.env = r.env && typeof r.env === 'object'
        ? Object.fromEntries(Object.entries(r.env as Record<string, unknown>).filter(([, v]) => typeof v === 'string').map(([k, v]) => [k, String(v)]))
        : {}
    } else {
      if (typeof r.url !== 'string' || !r.url.trim()) continue
      cfg.url = r.url.trim()
      cfg.headers = r.headers && typeof r.headers === 'object'
        ? Object.fromEntries(Object.entries(r.headers as Record<string, unknown>).filter(([, v]) => typeof v === 'string').map(([k, v]) => [k, String(v)]))
        : {}
    }
    out.push(cfg)
  }
  const seen = new Set<string>()
  return out.filter(c => (seen.has(c.id) ? false : (seen.add(c.id), true)))
}

/** خواندن خام فایل (برای merge هنگام نوشتن) */
async function readRawProviders(): Promise<{ content: string | null; path?: string }> {
  try {
    if (isDesktop()) {
      const r = await window.atlasAPI!.providersRead!()
      return { content: r.ok ? (r.content ?? null) : null, path: r.path }
    }
    return { content: lsGet(BROWSER_KEY) }
  } catch {
    return { content: null }
  }
}

/** نوشتن خام فایل */
async function writeRawProviders(content: string): Promise<{ ok: boolean; path?: string; error?: string }> {
  try {
    if (isDesktop()) {
      const r = await window.atlasAPI!.providersWrite!(content)
      return { ok: r.ok, path: r.path, error: r.error }
    }
    lsSet(BROWSER_KEY, content)
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

/** خواندن فایل — null یعنی فایل وجود ندارد یا خراب است */
export async function readProvidersFile(): Promise<{ file: ProvidersFile | null; path?: string }> {
  try {
    if (isDesktop()) {
      const r = await window.atlasAPI!.providersRead!()
      if (!r.ok || !r.content) return { file: null, path: r.path }
      return { file: parseProvidersFile(r.content), path: r.path }
    }
    const raw = lsGet(BROWSER_KEY)
    if (!raw) return { file: null }
    return { file: parseProvidersFile(raw) }
  } catch {
    return { file: null }
  }
}

/** نوشتن فایل از روی کانفیگ فعلی استور — mcpServers موجود حفظ می‌شود */
export async function writeProvidersFile(): Promise<{ ok: boolean; path?: string; error?: string }> {
  const s = useSettingsStore.getState()
  const { content } = await readRawProviders()
  const prev = content ? parseProvidersFile(content) : null
  const data: ProvidersFile = {
    version: 1,
    exportedAt: new Date().toISOString(),
    note: 'Atlas providers — می‌توانی دستی ویرایش کنی؛ در استارت بعدی خوانده می‌شود.',
    taskConfigs: s.taskConfigs as TaskConfigs,
    mcpServers: prev?.mcpServers,
  }
  return writeRawProviders(JSON.stringify(data, null, 2))
}

/** خواندن لیست سرورهای MCP از فایل */
export async function readMcpServers(): Promise<McpServerConfig[]> {
  const { content } = await readRawProviders()
  if (!content) return []
  return parseProvidersFile(content)?.mcpServers ?? []
}

/** نوشتن لیست سرورهای MCP — taskConfigs موجود حفظ می‌شود */
export async function writeMcpServers(servers: McpServerConfig[]): Promise<{ ok: boolean; path?: string; error?: string }> {
  const { content } = await readRawProviders()
  const prev = content ? parseProvidersFile(content) : null
  const data: ProvidersFile = {
    version: 1,
    exportedAt: new Date().toISOString(),
    note: 'Atlas providers — می‌توانی دستی ویرایش کنی؛ در استارت بعدی خوانده می‌شود.',
    taskConfigs: prev?.taskConfigs ?? {},
    mcpServers: servers,
  }
  return writeRawProviders(JSON.stringify(data, null, 2))
}

/**
 * اعمال فایل روی استور — در استارت بعد از rehydration صدا زده می‌شود.
 * برمی‌گرداند true اگر چیزی اعمال شد.
 */
export async function applyProvidersFile(): Promise<boolean> {
  const { file } = await readProvidersFile()
  if (!file) return false
  const setTaskConfig = useSettingsStore.getState().setTaskConfig
  let applied = false
  for (const t of TASKS) {
    const patch = file.taskConfigs[t.id]
    if (patch && Object.keys(patch).length > 0) {
      setTaskConfig(t.id, patch)
      applied = true
    }
  }
  return applied
}

/**
 * راه‌اندازی بارگذاری خودکار در استارت.
 * بعد از اتمام rehydrationِ persist اجرا می‌شود تا با تنظیمات ذخیره‌شده نجنگد.
 */
export function initProvidersFile(): void {
  let done = false
  const run = (): void => {
    if (done) return
    done = true
    void applyProvidersFile()
  }
  try {
    const persist = (useSettingsStore as unknown as { persist?: { onFinishHydration?: (cb: () => void) => void; hasHydrated?: () => boolean } }).persist
    if (persist?.hasHydrated?.()) {
      run()
    } else if (persist?.onFinishHydration) {
      persist.onFinishHydration(run)
      // تور امنیت: اگر rehydration به هر دلیلی تمام نشد، بعد از ۳ ثانیه anyway
      setTimeout(run, 3000)
    } else {
      run()
    }
  } catch {
    run()
  }
}
