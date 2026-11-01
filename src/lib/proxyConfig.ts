/**
 * proxyConfig — تنظیمات پروکسی شبکهٔ داخل برنامه
 * فقط HTTP و SOCKS5 ساده؛ vless/vmess/trojan و سابسکریپشن پشتیبانی نمی‌شود
 * (تصمیم کاربر، ۲۰۲۶-۱۱-۰۱: «پروکسی ساده کافیه»).
 *
 * قوانین پروکسی در رندرر ساخته می‌شود و با IPC به پروسهٔ اصلی فرستاده می‌شود؛
 * main آن را با session.setProxy روی سشن الکترون اعمال می‌کند، پس همهٔ
 * fetchهای رندرر (چت AI SDK و غیره) از همان پروکسی رد می‌شوند.
 * اعتبار (یوزر/پسورد) هرگز داخل رشتهٔ قوانین نمی‌آید؛ main آن را از طریق
 * رویداد login الکترون به احراز هویت پروکسی می‌دهد.
 */

export type ProxyType = 'http' | 'socks5'

export interface NetworkProxyConfig {
  enabled: boolean
  type: ProxyType
  /** هاست پروکسی — بدون scheme، مثلاً 127.0.0.1 */
  host: string
  /** پورت به‌صورت رشته (برای input) — اعتبارسنجی عددی در isValidNetworkProxy */
  port: string
  /** اختیاری — فقط برای پروکسی‌هایی که احراز هویت می‌خواهند */
  username: string
  password: string
}

export const DEFAULT_NETWORK_PROXY: NetworkProxyConfig = {
  enabled: false,
  type: 'socks5',
  host: '',
  port: '',
  username: '',
  password: '',
}

/** اعتبارسنجی: فعال + هاست غیرخالی + پورت عددی معتبر */
export function isValidNetworkProxy(cfg: NetworkProxyConfig): boolean {
  if (!cfg.enabled) return false
  if (!cfg.host.trim()) return false
  const port = Number(cfg.port)
  return Number.isInteger(port) && port >= 1 && port <= 65535
}

/**
 * ساخت رشتهٔ proxyRules کرومیوم از کانفیگ — null یعنی پروکسی معتبر/فعال نیست.
 * SOCKS: «socks5://host:port» (برای همهٔ پروتکل‌ها).
 * HTTP: «http=host:port;https=host:port».
 * آدرس‌های محلی جداگانه با proxyBypassRules «<local>» در main دور زده می‌شوند،
 * پس Ollama محلی و سرویس‌های localhost مستقیم وصل می‌شوند.
 */
export function buildProxyRules(cfg: NetworkProxyConfig): string | null {
  if (!isValidNetworkProxy(cfg)) return null
  const host = cfg.host.trim()
  const port = Number(cfg.port)
  if (cfg.type === 'socks5') return `socks5://${host}:${port}`
  return `http=${host}:${port};https=${host}:${port}`
}

/**
 * اعمال کانفیگ روی پروسهٔ اصلی (فقط نسخهٔ دسکتاپ).
 * غیرفعال یا نامعتبر → فرستادن null یعنی برگشت به پروکسی سیستم.
 * در نسخهٔ مرورگر atlasAPI وجود ندارد و ok:false برمی‌گردد.
 */
export async function applyNetworkProxy(
  cfg: NetworkProxyConfig,
): Promise<{ ok: boolean; error?: string }> {
  const api = typeof window !== 'undefined' ? window.atlasAPI : undefined
  if (!api?.setNetworkProxy) {
    return { ok: false, error: 'فقط در نسخهٔ دسکتاپ اعمال می‌شود' }
  }
  const rules = buildProxyRules(cfg)
  return api.setNetworkProxy(
    rules
      ? { rules, username: cfg.username || undefined, password: cfg.password || undefined }
      : null,
  )
}
