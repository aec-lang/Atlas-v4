/**
 * Skills Store — لایهٔ دادهٔ فروشگاه مهارتها
 * منبع اصلی: skills.sh API (با پروکسی Vite) — فالبک: GitHub raw
 * نصب: ذخیرهٔ کامل فایلهای مهارت در localStorage (ماندگار بین اجراها)
 */

/* ─── انواع ─── */

export interface SkillSummary {
  id: string            // "owner/repo/slug"
  slug: string
  name: string
  source: string        // "owner/repo" یا دامنه
  installs: number
  sourceType: 'github' | 'well-known'
  installUrl: string | null
  url: string
}

export interface SkillFile {
  path: string
  contents: string
}

export interface InstalledSkill extends Record<string, unknown> {
  id: string
  name: string
  source: string
  slug: string
  installedAt: number
  hash: string | null
  files: SkillFile[]
}

/** متادیتا از SKILL.md (فرانت‌متر YAML ساده) */
export interface SkillMeta {
  name?: string
  description?: string
  version?: string
  author?: string
}

export interface AuditEntry {
  provider: string
  status: 'pass' | 'warn' | 'fail'
  summary: string
  riskLevel?: string
}

/* ─── کلاینت skills.sh ─── */

import { proxyFetch } from './modelCatalog'

const PROXY = '/skills-api' // فقط در حالت توسعه (پروکسی Vite)
const SKILLS_SH_BASE = 'https://skills.sh/api/v1' // حالت پکیج‌شده: از پروسهٔ اصلی عبور میکند

async function apiFetch<T>(path: string, token?: string): Promise<T> {
  const headers: Record<string, string> = {}
  if (token) headers.Authorization = `Bearer ${token}`
  // در اپ پکیج‌شده (Electron/file://) پروکسی Vite وجود ندارد؛ پس مستقیم به
  // دامنهٔ skills.sh میزنیم و proxyFetch آن را از پروسهٔ اصلی عبور میدهد
  // (دور زدن CORS). در حالت توسعه از پروکسی Vite استفاده میشود.
  const hasMainProxy = typeof window !== 'undefined' && !!window.atlasAPI?.proxy
  const url = hasMainProxy ? `${SKILLS_SH_BASE}${path}` : `${PROXY}${path}`
  const res = await proxyFetch(url, { headers })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`skills.sh ${res.status}: ${body.slice(0, 120)}`)
  }
  return res.json() as Promise<T>
}

/** توکن از env (پروکسی هم خودش تزریق میکند؛ این برای حالت مستقیم) */
function envToken(): string | undefined {
  return import.meta.env.VITE_SKILLS_SH_TOKEN || undefined
}

/* ─── فالبک گیتهاب ─── */

/**
 * استخراج owner/repo و مسیر احتمالی پوشهٔ مهارت از id
 * "vercel-labs/skills/find-skills" → repo=skills، پوشههای محتمل: skills/ ، skill/ ، ریشه
 */
function githubCandidates(id: string): Array<{ api: string; rawBase: string }> {
  const parts = id.split('/')
  if (parts.length < 3) return []
  const [owner, repo, ...slugParts] = parts
  const slug = slugParts.join('/')
  const dirs = ['', 'skills/', 'skill/', 'src/skills/']
  return dirs.map(d => ({
    api: `https://api.github.com/repos/${owner}/${repo}/contents/${d}${slug}`,
    rawBase: d ? `${d}${slug}` : slug
  })).map(c => ({ api: c.api, rawBase: c.rawBase }))
    .concat([{ api: `https://api.github.com/repos/${parts[0]}/${parts[1]}/contents/.`, rawBase: '' }])
}

/** واکشی مهارت از گیتهاب وقتی skills.sh در دسترس نیست */
async function fetchFromGitHub(id: string): Promise<{ files: SkillFile[]; hash: null } | null> {
  for (const cand of githubCandidates(id).slice(0, 4)) {
    try {
      const res = await fetch(cand.api)
      if (!res.ok) continue
      const listing = (await res.json()) as Array<{ name: string; type: string; download_url: string | null }>
      if (!Array.isArray(listing)) continue

      // SKILL.md الزامی + فایلهای متنی همراه (باینریها نادیده)
      const textFiles = listing.filter(f =>
        f.type === 'file' && f.download_url &&
        (/\.(md|txt|json|ya?ml|toml|ts|tsx|js|jsx|py|sh)$/i.test(f.name) || f.name === 'SKILL.md')
      )
      const files: SkillFile[] = []
      for (const f of textFiles.slice(0, 20)) {
        if (!f.download_url) continue
        const cres = await fetch(f.download_url)
        if (!cres.ok) continue
        const text = await cres.text()
        if (text.length > 400_000) continue
        files.push({ path: f.name, contents: text })
      }
      if (files.some(f => f.path.endsWith('SKILL.md'))) {
        return { files, hash: null }
      }
    } catch {
      /* کاندید بعدی */
    }
  }
  return null
}

/* ─── عملیات عمومی ─── */

export interface CatalogResult {
  skills: SkillSummary[]
  total: number
  hasMore: boolean
  source: 'skills.sh' | 'fallback'
}

/** لیدربورد — trending / hot / all-time */
export async function fetchCatalog(view: 'trending' | 'hot' | 'all-time', page = 0): Promise<CatalogResult> {
  try {
    const json = await apiFetch<{
      data: Array<Record<string, unknown>>
      pagination?: { total?: number; hasMore?: boolean }
    }>(`/skills?view=${view}&page=${page}&per_page=60`, envToken())
    return {
      skills: json.data.map(normalizeSkill),
      total: json.pagination?.total ?? json.data.length,
      hasMore: json.pagination?.hasMore ?? false,
      source: 'skills.sh'
    }
  } catch {
    return fallbackCatalog()
  }
}

function normalizeSkill(raw: Record<string, unknown>): SkillSummary {
  return {
    id: String(raw.id ?? ''),
    slug: String(raw.slug ?? ''),
    name: String(raw.name ?? raw.slug ?? ''),
    source: String(raw.source ?? ''),
    installs: Number(raw.installs ?? 0),
    sourceType: raw.sourceType === 'well-known' ? 'well-known' : 'github',
    installUrl: typeof raw.installUrl === 'string' ? raw.installUrl : null,
    url: String(raw.url ?? '')
  }
}

/** فالبک: کاتالوگ ثابت از مهارتهای شناختهشدهٔ گیتهابی (وقتی API قفل است) */
const FALLBACK_CATALOG: SkillSummary[] = [
  { id: 'vercel-labs/skills/find-skills', slug: 'find-skills', name: 'Find Skills', source: 'vercel-labs/skills', installs: 3_100_000, sourceType: 'github', installUrl: 'https://github.com/vercel-labs/skills', url: 'https://skills.sh/vercel-labs/skills/find-skills' },
  { id: 'anthropics/skills/frontend-design', slug: 'frontend-design', name: 'Frontend Design', source: 'anthropics/skills', installs: 816_000, sourceType: 'github', installUrl: 'https://github.com/anthropics/skills', url: 'https://skills.sh/anthropics/skills/frontend-design' },
  { id: 'mattpocock/skills/tdd', slug: 'tdd', name: 'TDD', source: 'mattpocock/skills', installs: 763_700, sourceType: 'github', installUrl: 'https://github.com/mattpocock/skills', url: 'https://skills.sh/mattpocock/skills/tdd' },
  { id: 'mattpocock/skills/grill-me', slug: 'grill-me', name: 'Grill Me', source: 'mattpocock/skills', installs: 962_800, sourceType: 'github', installUrl: 'https://github.com/mattpocock/skills', url: 'https://skills.sh/mattpocock/skills/grill-me' },
  { id: 'vercel-labs/agent-browser/agent-browser', slug: 'agent-browser', name: 'Agent Browser', source: 'vercel-labs/agent-browser', installs: 727_200, sourceType: 'github', installUrl: 'https://github.com/vercel-labs/agent-browser', url: 'https://skills.sh/vercel-labs/agent-browser/agent-browser' },
  { id: 'vercel-labs/agent-skills/web-design-guidelines', slug: 'web-design-guidelines', name: 'Web Design Guidelines', source: 'vercel-labs/agent-skills', installs: 574_500, sourceType: 'github', installUrl: 'https://github.com/vercel-labs/agent-skills', url: 'https://skills.sh/vercel-labs/agent-skills/web-design-guidelines' },
  { id: 'mattpocock/skills/improve-codebase-architecture', slug: 'improve-codebase-architecture', name: 'Improve Codebase Architecture', source: 'mattpocock/skills', installs: 790_500, sourceType: 'github', installUrl: 'https://github.com/mattpocock/skills', url: 'https://skills.sh/mattpocock/skills/improve-codebase-architecture' },
  { id: 'mattpocock/skills/diagnosing-bugs', slug: 'diagnosing-bugs', name: 'Diagnosing Bugs', source: 'mattpocock/skills', installs: 470_300, sourceType: 'github', installUrl: 'https://github.com/mattpocock/skills', url: 'https://skills.sh/mattpocock/skills/diagnosing-bugs' },
  { id: 'remotion-dev/skills/remotion-best-practices', slug: 'remotion-best-practices', name: 'Remotion Best Practices', source: 'remotion-dev/skills', installs: 494_200, sourceType: 'github', installUrl: 'https://github.com/remotion-dev/skills', url: 'https://skills.sh/remotion-dev/skills/remotion-best-practices' },
  { id: 'microsoft/azure-skills/microsoft-foundry', slug: 'microsoft-foundry', name: 'Microsoft Foundry', source: 'microsoft/azure-skills', installs: 550_400, sourceType: 'github', installUrl: 'https://github.com/microsoft/azure-skills', url: 'https://skills.sh/microsoft/azure-skills/microsoft-foundry' },
  // دستهٔ دوم: مهارتهای رسمی و پرکاربرد — برای وقتی که API در دسترس نیست
  // (تعداد نصبها تقریبی است و فقط در حالت آفلاین نمایش داده میشود)
  { id: 'anthropics/skills/skill-creator', slug: 'skill-creator', name: 'Skill Creator', source: 'anthropics/skills', installs: 400_000, sourceType: 'github', installUrl: 'https://github.com/anthropics/skills', url: 'https://skills.sh/anthropics/skills/skill-creator' },
  { id: 'anthropics/skills/pdf', slug: 'pdf', name: 'PDF', source: 'anthropics/skills', installs: 350_000, sourceType: 'github', installUrl: 'https://github.com/anthropics/skills', url: 'https://skills.sh/anthropics/skills/pdf' },
  { id: 'anthropics/skills/docx', slug: 'docx', name: 'DOCX', source: 'anthropics/skills', installs: 300_000, sourceType: 'github', installUrl: 'https://github.com/anthropics/skills', url: 'https://skills.sh/anthropics/skills/docx' },
  { id: 'anthropics/skills/pptx', slug: 'pptx', name: 'PPTX', source: 'anthropics/skills', installs: 280_000, sourceType: 'github', installUrl: 'https://github.com/anthropics/skills', url: 'https://skills.sh/anthropics/skills/pptx' },
  { id: 'anthropics/skills/xlsx', slug: 'xlsx', name: 'XLSX', source: 'anthropics/skills', installs: 260_000, sourceType: 'github', installUrl: 'https://github.com/anthropics/skills', url: 'https://skills.sh/anthropics/skills/xlsx' },
  { id: 'anthropics/skills/mcp-builder', slug: 'mcp-builder', name: 'MCP Builder', source: 'anthropics/skills', installs: 220_000, sourceType: 'github', installUrl: 'https://github.com/anthropics/skills', url: 'https://skills.sh/anthropics/skills/mcp-builder' },
  { id: 'anthropics/skills/artifacts-builder', slug: 'artifacts-builder', name: 'Artifacts Builder', source: 'anthropics/skills', installs: 200_000, sourceType: 'github', installUrl: 'https://github.com/anthropics/skills', url: 'https://skills.sh/anthropics/skills/artifacts-builder' },
  { id: 'anthropics/skills/canvas-design', slug: 'canvas-design', name: 'Canvas Design', source: 'anthropics/skills', installs: 180_000, sourceType: 'github', installUrl: 'https://github.com/anthropics/skills', url: 'https://skills.sh/anthropics/skills/canvas-design' },
  { id: 'anthropics/skills/algorithmic-art', slug: 'algorithmic-art', name: 'Algorithmic Art', source: 'anthropics/skills', installs: 150_000, sourceType: 'github', installUrl: 'https://github.com/anthropics/skills', url: 'https://skills.sh/anthropics/skills/algorithmic-art' },
  { id: 'anthropics/skills/webapp-testing', slug: 'webapp-testing', name: 'Webapp Testing', source: 'anthropics/skills', installs: 140_000, sourceType: 'github', installUrl: 'https://github.com/anthropics/skills', url: 'https://skills.sh/anthropics/skills/webapp-testing' },
  { id: 'anthropics/skills/doc-coauthoring', slug: 'doc-coauthoring', name: 'Doc Coauthoring', source: 'anthropics/skills', installs: 120_000, sourceType: 'github', installUrl: 'https://github.com/anthropics/skills', url: 'https://skills.sh/anthropics/skills/doc-coauthoring' },
  { id: 'anthropics/skills/theme-factory', slug: 'theme-factory', name: 'Theme Factory', source: 'anthropics/skills', installs: 100_000, sourceType: 'github', installUrl: 'https://github.com/anthropics/skills', url: 'https://skills.sh/anthropics/skills/theme-factory' },
]

async function fallbackCatalog(): Promise<CatalogResult> {
  return { skills: FALLBACK_CATALOG, total: FALLBACK_CATALOG.length, hasMore: false, source: 'fallback' }
}

/** جستوجو — skills.sh semantic/fuzzy ، فالبک: فیلتر روی کاتالوگ فالبک */
export async function searchSkills(q: string, limit = 100): Promise<CatalogResult> {
  const query = q.trim()
  if (query.length < 2) return fetchCatalog('trending')
  try {
    const json = await apiFetch<{ data: Array<Record<string, unknown>>; count?: number }>(
      `/skills/search?q=${encodeURIComponent(query)}&limit=${limit}`, envToken())
    return { skills: json.data.map(normalizeSkill), total: json.count ?? json.data.length, hasMore: false, source: 'skills.sh' }
  } catch {
    const lower = query.toLowerCase()
    const filtered = FALLBACK_CATALOG.filter(s =>
      s.name.toLowerCase().includes(lower) || s.slug.toLowerCase().includes(lower) || s.source.toLowerCase().includes(lower))
    // اگر در کاتالوگ محلی نبود، حدس گیتهابی: جستوجوی مخزن معروف
    return { skills: filtered, total: filtered.length, hasMore: false, source: 'fallback' }
  }
}

/** جزئیات + فایلهای کامل مهارت — اول skills.sh، بعد گیتهاب */
export async function fetchSkillDetail(id: string, token?: string): Promise<{ files: SkillFile[]; hash: string | null; installs: number } > {
  const t = token ?? envToken()
  try {
    const json = await apiFetch<{ files: SkillFile[] | null; hash: string | null; installs: number }>(
      `/skills/${id}`, t)
    if (json.files && json.files.length > 0) {
      return { files: json.files, hash: json.hash, installs: json.installs }
    }
    throw new Error('no snapshot')
  } catch {
    const gh = await fetchFromGitHub(id)
    if (!gh) throw new Error(`مهارت «${id}» نه از skills.sh و نه از گیتهاب قابل دریافت بود`)
    return { files: gh.files, hash: null, installs: 0 }
  }

}

/** ممیزی امنیتی (اگر موجود باشد) */
export async function fetchSkillAudit(id: string, token?: string): Promise<AuditEntry[]> {
  const t = token ?? envToken()
  try {
    const json = await apiFetch<{ audits: AuditEntry[] }>(`/skills/audit/${id}`, t)
    return json.audits ?? []
  } catch {
    return [] // بدون ممیزی = نامشخص، نه خطر
  }
}

/* ─── متادیتای SKILL.md ─── */

export function parseSkillMd(contents: string): SkillMeta {
  const meta: SkillMeta = {}
  const m = contents.match(/^---\n([\s\S]*?)\n---/)
  if (m) {
    for (const line of m[1].split('\n')) {
      const kv = line.match(/^(\w[\w-]*):\s*(.+)$/)
      if (!kv) continue
      const key = kv[1].toLowerCase()
      const val = kv[2].trim().replace(/^["']|["']$/g, '').slice(0, 300)
      if (key === 'name') meta.name = val
      else if (key === 'description') meta.description = val
      else if (key === 'version') meta.version = val
      else if (key === 'author') meta.author = val
    }
  }
  if (!meta.description) {
    // اولین پاراگراف غیرعنوان بهعنوان توضیح
    const para = contents.replace(/^---[\s\S]*?---/, '').split('\n\n').find(p => !p.trim().startsWith('#'))
    if (para) meta.description = para.replace(/[#*`>\-\n]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 220)
  }
  return meta
}
