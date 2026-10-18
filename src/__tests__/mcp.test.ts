/**
 * تست‌های کلاینت MCP — اعتبارسنجی کانفیگ، نام‌گذاری ابزارها،
 * لیست curated و سیاست امنیتی.
 */
import { describe, it, expect } from 'vitest'
import { parseMcpServers, parseProvidersFile, writeMcpServers, readMcpServers } from '@/lib/providerFile'
import { CURATED_MCP_SERVERS, curatedToConfig } from '@/lib/mcpCurated'
import { sanitizeMcpToolName } from '@/lib/mcpTools'
import { isToolAllowedInBackground } from '@/lib/taskPolicy'
import { getToolMeta } from '@/components/assistant-ui/toolMeta'
import { Plug } from 'lucide-react'

/** بازه‌های یونیکد ایموجی — قانون کاربر: بدون ایموجی */
const EMOJI_RE = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}]/u

describe('parseMcpServers — اعتبارسنجی کانفیگ', () => {
  it('سرور stdio معتبر را می‌پذیرد', () => {
    const out = parseMcpServers([
      { id: 'github', name: 'گیت‌هاب', transport: 'stdio', command: 'npx', args: ['-y', 'x'], env: { K: 'v' }, enabled: true },
    ])
    expect(out).toHaveLength(1)
    expect(out![0].id).toBe('github')
    expect(out![0].transport).toBe('stdio')
    expect(out![0].env).toEqual({ K: 'v' })
  })

  it('سرور http معتبر را می‌پذیرد', () => {
    const out = parseMcpServers([
      { id: 'remote', transport: 'http', url: 'https://example.com/mcp', headers: { Authorization: 'Bearer x' } },
    ])
    expect(out).toHaveLength(1)
    expect(out![0].transport).toBe('http')
    expect(out![0].url).toBe('https://example.com/mcp')
  })

  it('ورودی‌های خراب را نادیده می‌گیرد (بدون command/url، غیرآبجکت)', () => {
    const out = parseMcpServers([
      { id: 'bad1', transport: 'stdio' },
      { id: 'bad2', transport: 'http' },
      null,
      'string',
      { id: 'ok', transport: 'stdio', command: 'npx' },
    ])
    expect(out).toHaveLength(1)
    expect(out![0].id).toBe('ok')
  })

  it('شناسه‌ها را یکدست و تکراری‌ها را حذف می‌کند', () => {
    const out = parseMcpServers([
      { id: 'My Server!', transport: 'stdio', command: 'npx' },
      { id: 'my_server', transport: 'stdio', command: 'npx' },
    ])
    expect(out).toHaveLength(1)
    expect(out![0].id).toBe('my_server')
  })

  it('آرایه نبودن → undefined', () => {
    expect(parseMcpServers(undefined)).toBeUndefined()
    expect(parseMcpServers('x')).toBeUndefined()
  })
})

describe('parseProvidersFile — ادغام mcpServers', () => {
  it('فایل فقط با mcpServers هم معتبر است', () => {
    const f = parseProvidersFile(JSON.stringify({
      version: 1,
      mcpServers: [{ id: 'a', transport: 'stdio', command: 'npx' }],
    }))
    expect(f).not.toBeNull()
    expect(f!.mcpServers).toHaveLength(1)
    expect(f!.taskConfigs).toEqual({})
  })

  it('فایل خالی null برمی‌گرداند', () => {
    expect(parseProvidersFile(JSON.stringify({ version: 1 }))).toBeNull()
    expect(parseProvidersFile('not-json')).toBeNull()
  })
})

describe('writeMcpServers/readMcpServers — حفظ taskConfigs', () => {
  it('نوشتن سرورها، کانفیگ کارها را خراب نمی‌کند', async () => {
    const servers = [{ id: 't1', name: 'تست', transport: 'stdio' as const, command: 'npx', args: [], env: {}, enabled: true }]
    const w = await writeMcpServers(servers)
    expect(w.ok).toBe(true)
    const back = await readMcpServers()
    expect(back.map(s => s.id)).toContain('t1')
    // پاک‌سازی
    await writeMcpServers([])
    expect(await readMcpServers()).toEqual([])
  })
})

describe('sanitizeMcpToolName', () => {
  it('کاراکترهای نامعتبر را جایگزین می‌کند', () => {
    expect(sanitizeMcpToolName('create_issue')).toBe('create_issue')
    expect(sanitizeMcpToolName('a b/c')).toBe('a_b_c')
    expect(sanitizeMcpToolName('')).toBe('tool')
  })
})

describe('CURATED_MCP_SERVERS — لیست پیشنهادی', () => {
  it('شناسه‌ها یکتا و دستورها غیرخالی‌اند', () => {
    const ids = CURATED_MCP_SERVERS.map(c => c.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const c of CURATED_MCP_SERVERS) {
      expect(c.command.trim().length).toBeGreaterThan(0)
      expect(c.nameFa.trim().length).toBeGreaterThan(0)
      expect(c.descriptionFa.trim().length).toBeGreaterThan(0)
      expect(c.hintFa.trim().length).toBeGreaterThan(0)
    }
  })

  it('هیچ لیبل/hint ایموجی ندارد', () => {
    for (const c of CURATED_MCP_SERVERS) {
      expect(c.nameFa).not.toMatch(EMOJI_RE)
      expect(c.descriptionFa).not.toMatch(EMOJI_RE)
      expect(c.hintFa).not.toMatch(EMOJI_RE)
    }
  })

  it('curatedToConfig کانفیگ معتبر می‌سازد', () => {
    for (const c of CURATED_MCP_SERVERS) {
      const cfg = curatedToConfig(c)
      expect(cfg.id).toBe(c.id)
      expect(cfg.transport).toBe('stdio')
      expect(cfg.enabled).toBe(true)
      expect(cfg.curated).toBe(true)
      const parsed = parseMcpServers([cfg])
      expect(parsed).toHaveLength(1)
    }
  })
})

describe('taskPolicy — ابزارهای MCP در حالت خودکار', () => {
  it('همهٔ ابزارهای mcp_* در پس‌زمینه مسدودند', () => {
    for (const t of ['mcp_github__create_issue', 'mcp_fetch__fetch', 'mcp_x']) {
      const d = isToolAllowedInBackground(t, {})
      expect(d.allowed).toBe(false)
      expect(d.reason).toBeTruthy()
    }
  })

  it('ابزار داخلی مجاز همچنان مجاز است', () => {
    expect(isToolAllowedInBackground('fs_list', {}).allowed).toBe(true)
  })
})

describe('getToolMeta — ابزارهای MCP', () => {
  it('نام mcp_<server>__<tool> لیبل خوانا و آیکون Plug می‌گیرد', () => {
    const m = getToolMeta('mcp_github__create_issue')
    expect(m.icon).toBe(Plug)
    expect(m.label).toContain('create_issue')
    expect(m.label).toContain('github')
    expect(m.label).not.toMatch(EMOJI_RE)
  })

  it('ابزار استاتیک قبلی دست‌نخورده است', () => {
    expect(getToolMeta('shell_exec').label).toBe('اجرای دستور')
  })
})
