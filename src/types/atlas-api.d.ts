/**
 * انواع سراسری برای پل Electron (preload → renderer)
 * تعریف تایپ‌دار window.atlasAPI تا نیازی به cast های پراکنده نباشد.
 */

export interface AtlasActivity {
  tool: string
  args?: Record<string, unknown>
  result?: unknown
  error?: string
  ts: number
  pending?: boolean
}

/* ═════════ کارهای پس‌زمینه و زمان‌بندی‌شده ═════════ */

export type BgTaskStatus = 'running' | 'done' | 'error' | 'cancelled'

export interface PendingApproval {
  id: string
  tool: string
  args: Record<string, unknown>
  reason: string
  ts: number
  status: 'pending' | 'approved' | 'rejected'
  result?: unknown
}

export interface BgTask {
  id: string
  title: string
  prompt: string
  /** 'background' = دستی/چت، 'scheduled' = از روی زمان‌بند اجرا شده */
  kind: 'background' | 'scheduled'
  scheduleId?: string
  status: BgTaskStatus
  createdAt: number
  finishedAt?: number
  /** خلاصهٔ پیشرفت زنده (اختیاری) */
  progressNote?: string
  /** نتیجهٔ متنی نهایی */
  result?: string
  error?: string
  /** ابزارهایی که در حالت خودکار مسدود و منتظر تأیید دستی‌اند */
  pendingApprovals: PendingApproval[]
  /** لاگ فشردهٔ فراخوانی ابزارها */
  toolLog: Array<{ tool: string; ok: boolean; ts: number }>
}

export interface CronSchedule {
  id: string
  title: string
  prompt: string
  /** عبارت کرون ۵ فیلدی */
  cron: string
  /** توصیف فارسی (مثل «هر روز ساعت ۰۸:۰۰») */
  label: string
  enabled: boolean
  createdAt: number
  lastRun?: number
  nextRun?: number
}

export interface TasksSnapshot {
  bgTasks: BgTask[]
  schedules: CronSchedule[]
}

export interface ProxyOptions {
  url: string
  method?: string
  headers?: Record<string, string>
  body?: string
  /** 'base64' برای پاسخ‌های باینری (مثل صوت) — بدنه base64 برمی‌گردد */
  responseType?: 'text' | 'base64'
}

export interface ProxyResult {
  ok: boolean
  status?: number
  body?: string
  /** true یعنی body رشته‌ی base64 است */
  base64?: boolean
  contentType?: string
  error?: string
}

export interface TerminalStartResult {
  ok: boolean
  id?: string
  error?: string
}

export interface TerminalAPI {
  /** ساخت نشست شل جدید — برمیگرداند شناسهٔ نشست */
  start: () => Promise<TerminalStartResult>
  /** نوشتن در stdin شل */
  write: (id: string, data: string) => void
  /** فرستادن سیگنال (مثل SIGINT برای Ctrl+C) */
  signal: (id: string, signal?: string) => void
  /** بستن نشست */
  kill: (id: string) => void
  /** خروجی شل: { id, data } */
  onData: (cb: (d: { id: string; data: string }) => void) => () => void
  /** پایان نشست: { id, code } */
  onExit: (cb: (d: { id: string; code: number | null }) => void) => () => void
}

/* ═════════ کانکتورهای MCP ═════════ */

/** کانفیگ یک سرور MCP — در providers.json ذخیره می‌شود */
export interface McpServerConfig {
  id: string
  /** نام نمایشی فارسی */
  name: string
  transport: 'stdio' | 'http'
  /** stdio */
  command?: string
  args?: string[]
  env?: Record<string, string>
  /** http */
  url?: string
  headers?: Record<string, string>
  enabled: boolean
  /** از لیست پیشنهادی Atlas آمده؟ */
  curated?: boolean
}

export type McpServerStatus = 'connected' | 'error' | 'disabled' | 'idle'

export interface McpToolDef {
  name: string
  description: string
  inputSchema: Record<string, unknown>
}

export interface McpServerInfo {
  config: McpServerConfig
  status: McpServerStatus
  tools: McpToolDef[]
  error: string | null
}

/** ابزار MCP برای ایجنت — namespace: mcp_<server>__<tool> */
export interface McpAgentToolDef {
  serverId: string
  serverName: string
  toolName: string
  description: string
  inputSchema: Record<string, unknown>
}

export interface McpAPI {
  list: () => Promise<{ ok: boolean; servers?: McpServerInfo[]; error?: string }>
  tools: (serverId: string) => Promise<{ ok: boolean; tools?: McpToolDef[]; error?: string }>
  toolsAll: () => Promise<{ ok: boolean; tools?: McpAgentToolDef[]; error?: string }>
  test: (serverId: string) => Promise<{ ok: boolean; toolCount?: number; tools?: string[]; error?: string }>
  call: (serverId: string, tool: string, args: Record<string, unknown>) => Promise<{ ok: boolean; result?: string; error?: string }>
  disconnect: (serverId: string) => Promise<{ ok: boolean; error?: string }>
}

export interface AtlasAPI {
  platform: string
  invokeTool: (tool: string, args: Record<string, unknown>) => Promise<Record<string, unknown>>
  captureScreen: () => Promise<string>
  openExternal: (url: string) => void
  /** ترمینال تعاملی (فقط دسکتاپ) */
  terminal?: TerminalAPI
  /** تنظیم نیازبه‌تأیید دستورات خطرناک (شل/کشتن فرآیند/موس/کیبورد) */
  setConfirm?: (enabled: boolean) => void
  /** تنظیم حالت پلن (در انتظار تأیید ماندن دستورات خطرناک) */
  setPlan?: (enabled: boolean) => void
  /** پروکسی درخواستهای شبکه از پروسهٔ اصلی (کلیدها از مرورگر خارج نمیشوند) */
  proxy?: (opts: ProxyOptions) => Promise<ProxyResult>
  /** خواندن فایل providers.json از app-data (فقط دسکتاپ) */
  providersRead?: () => Promise<{ ok: boolean; content?: string | null; path?: string; error?: string }>
  /** نوشتن فایل providers.json در app-data (فقط دسکتاپ) */
  providersWrite?: (content: string) => Promise<{ ok: boolean; path?: string; error?: string }>
  onActivity: (cb: (d: AtlasActivity) => void) => () => void
  /* ─── کارهای پس‌زمینه و زمان‌بندی‌شده ─── */
  /** ثبت تسک پس‌زمینه در پروسهٔ اصلی (رunner در رندرر اجرایش می‌کند) */
  bgCreate?: (t: { title: string; prompt: string; kind: 'background' | 'scheduled'; scheduleId?: string }) => Promise<{ ok: boolean; id?: string; error?: string }>
  /** به‌روزرسانی وضعیت/نتیجهٔ تسک */
  bgUpdate?: (id: string, patch: Partial<BgTask>) => Promise<{ ok: boolean; error?: string }>
  /** لغو تسک */
  bgCancel?: (id: string) => Promise<{ ok: boolean; error?: string }>
  /** ثبت نتیجهٔ تأیید/رد دستی یک pending approval */
  bgApprovalResolved?: (taskId: string, approvalId: string, status: 'approved' | 'rejected', result?: unknown) => Promise<{ ok: boolean; error?: string }>
  /** خواندن کل رجیستری تسک‌ها و زمان‌بندها */
  tasksList?: () => Promise<{ ok: boolean; snapshot?: TasksSnapshot; error?: string }>
  /** افزودن زمان‌بند کرونی */
  scheduleAdd?: (s: { title: string; prompt: string; cron: string; label: string }) => Promise<{ ok: boolean; id?: string; error?: string }>
  /** ویرایش زمان‌بند (عنوان/پرامپت/کرون/فعال) */
  scheduleUpdate?: (id: string, patch: Partial<CronSchedule>) => Promise<{ ok: boolean; error?: string }>
  /** حذف زمان‌بند */
  scheduleRemove?: (id: string) => Promise<{ ok: boolean; error?: string }>
  /** تغییر رجیستری (هر تغییری در تسک‌ها/زمان‌بندها) */
  onTasksChanged?: (cb: (s: TasksSnapshot) => void) => () => void
  /** فرا رسیدن موعد یک زمان‌بند → رندرر باید اجرایش کند */
  onScheduleFire?: (cb: (d: { taskId: string; scheduleId: string; title: string; prompt: string }) => void) => () => void
  /* ─── کانکتورهای MCP ─── */
  mcp?: McpAPI
}

declare global {
  interface Window {
    atlasAPI?: AtlasAPI
  }
}

export {}
