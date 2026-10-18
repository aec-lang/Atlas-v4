/**
 * TaskPolicy — سیاست امنیتی اجرای خودکار (پس‌زمینه / زمان‌بندی‌شده)
 *
 * تسک‌های خودکار نمی‌توانند «تأیید تعاملی» بگیرند (کاربر ممکن است پای سیستم
 * نباشد). پس ابزارهایی که در حالت عادی هم نیازمند تأییدند، در حالت خودکار
 * اصلاً اجرا نمی‌شوند و به‌صورت «در انتظار تأیید» در پنل کارها ثبت می‌شوند
 * تا کاربر بعداً دستی تأیید/رد کند.
 *
 * مجموعهٔ مسدودشده دقیقاً همان DANGEROUS پروسهٔ اصلی است
 * (desktop/backend.cjs) تا مدل امنیتی یکپارچه بماند:
 *  - shell_exec: اجرای دستور دلخواه شل (حذف فایل، نصب، تغییر سیستم…)
 *  - proc_kill: توقف فرآیندها
 *  - ابزارهای موس و کیبورد (mouse_move، mouse_click، mouse_scroll، keyboard_type، keyboard_press):
 *    کنترل نشست کاربر (کلیک/تایپ خودسرانه)
 *
 * قوانین تکمیلی مخصوص حالت خودکار:
 *  - set_task_config با apiKey: ذخیرهٔ کلید نیازمند تأیید صریح تعاملی است → مسدود
 *  - create_background_task / schedule_task درون تسک خودکار: جلوگیری از
 *    آبشاری‌شدن تسک‌ها (تسکی که تسک می‌سازد) → مسدود
 */
export const BACKGROUND_BLOCKED_TOOLS: ReadonlySet<string> = new Set([
  'shell_exec',
  'proc_kill',
  'mouse_move',
  'mouse_click',
  'mouse_scroll',
  'keyboard_type',
  'keyboard_press',
])

/** ابزارهایی که حتی بدون آرگومان حساس، در حالت خودکار هرگز مجاز نیستند */
const ALWAYS_BLOCKED_IN_AUTO: ReadonlySet<string> = new Set([
  'create_background_task',
  'schedule_task',
])

export interface PolicyDecision {
  allowed: boolean
  /** دلیل فارسی برای نمایش/لاگ وقتی مجاز نیست */
  reason?: string
}

/**
 * آیا ابزار در اجرای خودکار (پس‌زمینه/زمان‌بندی‌شده) مجاز است؟
 * خروجی قطعی و خالص است تا مستقیم تست شود.
 */
export function isToolAllowedInBackground(
  tool: string,
  args?: Record<string, unknown>,
): PolicyDecision {
  // ابزارهای MCP شخص ثالث‌اند و ریسک‌شان ارزیابی‌نشده است → در حالت خودکار
  // هرگز خودکار اجرا نمی‌شوند و «در انتظار تأیید» می‌مانند.
  if (tool.startsWith('mcp_')) {
    return {
      allowed: false,
      reason:
        'ابزار MCP در حالت خودکار نیازمند تأیید دستی است و اجرا نشد؛ ' +
        'درخواست در پنل «کارها» ثبت شد تا بعداً تأیید شود.',
    }
  }
  if (ALWAYS_BLOCKED_IN_AUTO.has(tool)) {
    return {
      allowed: false,
      reason: `ابزار «${tool}» در اجرای خودکار مجاز نیست (جلوگیری از آبشاری‌شدن تسک‌ها).`,
    }
  }
  if (BACKGROUND_BLOCKED_TOOLS.has(tool)) {
    return {
      allowed: false,
      reason:
        'این ابزار در حالت خودکار نیازمند تأیید دستی است و اجرا نشد؛ ' +
        'درخواست در پنل «کارها» ثبت شد تا بعداً تأیید شود.',
    }
  }
  if (tool === 'set_task_config' && args && typeof args.apiKey === 'string' && args.apiKey.trim()) {
    return {
      allowed: false,
      reason:
        'ذخیرهٔ کلید API نیازمند تأیید صریح تعاملی کاربر است؛ در حالت خودکار انجام نشد.',
    }
  }
  return { allowed: true }
}

/** پیام فارسی که به‌جای خروجی ابزارِ مسدودشده به مدل داده می‌شود */
export function backgroundDenialMessage(tool: string): string {
  return (
    `ابزار ${tool} در حالت پس‌زمینه/زمان‌بندی‌شده نیازمند تأیید دستی است و اجرا نشد. ` +
    `درخواست در پنل «کارها» → «در انتظار تأیید» ثبت شد. ` +
    `با ابزارهای مجاز ادامه بده و در پاسخ نهایی به کاربر بگو کدام قدم‌ها منتظر تأیید او هستند.`
  )
}
