/**
 * Atlas Desktop — وضعیت پروکسی شبکه برای پروسهٔ اصلی
 * رندرر قوانین proxyRules را می‌سازد و با IPC می‌فرستد؛ main آن را روی سشن
 * اعمال می‌کند و backend برای فچ‌های خودش از net.fetch (همان استک شبکهٔ
 * کرومیوم، پس تابع قوانین سشن) استفاده می‌کند.
 * فقط برای GET/POST ساده با بدنهٔ رشته‌ای استفاده می‌شود — همان کاری که
 * هندلر atlas:proxy انجام می‌دهد.
 */

let current = null // { rules, username, password } | null

/** ذخیرهٔ وضعیت جدید — rules خالی/null یعنی پروکسی خاموش */
function setNetProxy(cfg) {
  current = cfg && cfg.rules
    ? { rules: cfg.rules, username: cfg.username || '', password: cfg.password || '' }
    : null
}

function getNetProxy() {
  return current
}

function hasNetProxy() {
  return !!current
}

/**
 * فچ از پروسهٔ اصلی: با پروکسی فعال از net.fetch الکترون استفاده می‌شود تا
 * قوانین سشن اعمال شود؛ بدون پروکسی دقیقاً همان fetch سراسری قبلی است.
 */
function netFetch(url, init) {
  if (!current) return fetch(url, init)
  const { net } = require('electron')
  return net.fetch(url, init)
}

module.exports = { setNetProxy, getNetProxy, hasNetProxy, netFetch }
