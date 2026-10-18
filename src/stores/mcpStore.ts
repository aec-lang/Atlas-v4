/**
 * MCP Store — آینهٔ رندرر از سرورهای MCP.
 * منبع حقیقت فایل providers.json است (همان که پروسهٔ اصلی می‌خواند)؛
 * این استور از طریق readMcpServers/writeMcpServers همان فایل را می‌خواند/می‌نویسد
 * و وضعیت زنده را از IPC پروسهٔ اصلی می‌گیرد. persist نمی‌شود.
 */
import { create } from 'zustand'
import type { AtlasAPI, McpServerConfig, McpServerInfo, McpToolDef } from '@/types/atlas-api'
import { readMcpServers, writeMcpServers } from '@/lib/providerFile'

function getApi(): AtlasAPI | undefined {
  return (window as unknown as { atlasAPI?: AtlasAPI }).atlasAPI
}

interface McpState {
  servers: McpServerInfo[]
  loaded: boolean
  busy: boolean
  error: string | null
  lastTest: { serverId: string; ok: boolean; message: string } | null
  /** خواندن وضعیت زنده از پروسهٔ اصلی */
  refresh: () => Promise<void>
  /** افزودن سرور جدید (در فایل ذخیره می‌شود) */
  addServer: (cfg: McpServerConfig) => Promise<boolean>
  /** ویرایش جزئی یک سرور */
  updateServer: (id: string, patch: Partial<McpServerConfig>) => Promise<boolean>
  /** حذف سرور */
  removeServer: (id: string) => Promise<void>
  /** فعال/غیرفعال */
  toggleServer: (id: string, enabled: boolean) => Promise<void>
  /** تست اتصال — ابزارها را می‌شمارد */
  testServer: (id: string) => Promise<void>
  /** ابزارهای یک سرور */
  fetchTools: (id: string) => Promise<McpToolDef[]>
  clearTest: () => void
}

async function persistConfigs(configs: McpServerConfig[]): Promise<boolean> {
  const r = await writeMcpServers(configs)
  return r.ok
}

export const useMcpStore = create<McpState>()((set, get) => ({
  servers: [],
  loaded: false,
  busy: false,
  error: null,
  lastTest: null,

  refresh: async () => {
    const api = getApi()
    if (!api?.mcp?.list) {
      set({ loaded: true, error: 'کانکتورهای MCP فقط در نسخهٔ دسکتاپ (Electron) در دسترس‌اند.' })
      return
    }
    set({ busy: true, error: null })
    try {
      const r = await api.mcp.list()
      if (r.ok && r.servers) {
        set({ servers: r.servers, loaded: true })
      } else {
        set({ error: r.error ?? 'خواندن سرورها ناموفق بود' })
      }
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) })
    } finally {
      set({ busy: false })
    }
  },

  addServer: async cfg => {
    const current = await readMcpServers()
    if (current.some(c => c.id === cfg.id)) return false
    const ok = await persistConfigs([...current, cfg])
    if (ok) await get().refresh()
    return ok
  },

  updateServer: async (id, patch) => {
    const current = await readMcpServers()
    const next = current.map(c => (c.id === id ? { ...c, ...patch, id: c.id } : c))
    const ok = await persistConfigs(next)
    if (ok) await get().refresh()
    return ok
  },

  removeServer: async id => {
    const api = getApi()
    const current = await readMcpServers()
    const ok = await persistConfigs(current.filter(c => c.id !== id))
    if (api?.mcp?.disconnect) {
      try { await api.mcp.disconnect(id) } catch { /* ignore */ }
    }
    if (ok) await get().refresh()
  },

  toggleServer: async (id, enabled) => {
    const api = getApi()
    await get().updateServer(id, { enabled })
    if (!enabled && api?.mcp?.disconnect) {
      try { await api.mcp.disconnect(id) } catch { /* ignore */ }
    }
  },

  testServer: async id => {
    const api = getApi()
    if (!api?.mcp?.test) return
    set({ busy: true, lastTest: null })
    try {
      const r = await api.mcp.test(id)
      set({
        lastTest: r.ok
          ? { serverId: id, ok: true, message: `اتصال موفق — ${r.toolCount ?? 0} ابزار یافت شد.` }
          : { serverId: id, ok: false, message: r.error ?? 'تست ناموفق بود' },
      })
      await get().refresh()
    } catch (e) {
      set({ lastTest: { serverId: id, ok: false, message: e instanceof Error ? e.message : String(e) } })
    } finally {
      set({ busy: false })
    }
  },

  fetchTools: async id => {
    const api = getApi()
    if (!api?.mcp?.tools) return []
    try {
      const r = await api.mcp.tools(id)
      return r.ok && r.tools ? r.tools : []
    } catch {
      return []
    }
  },

  clearTest: () => set({ lastTest: null }),
}))
