/**
 * ScheduleParse — تبدیل زمانِ فارسیِ زبان‌طبیعی به کرون (۵ فیلدی استاندارد).
 * مثال: «هر صبح ساعت ۸» → «0 8 * * *»
 *
 * از وابستگی croner برای محاسبهٔ اجرای بعدی استفاده می‌شود؛ این فایل فقط
 * «فهمیدن» ورودی کاربر و تولید عبارت کرون معتبر را بر عهده دارد.
 */

export interface ParsedSchedule {
  /** عبارت کرون ۵ فیلدی (دقیقه ساعت روزماه ماه روزهفته) */
  cron: string
  /** توصیف فارسی خوانا برای نمایش در UI */
  label: string
}

const FA_DIGITS: Record<string, string> = {
  '۰': '0', '۱': '1', '۲': '2', '۳': '3', '۴': '4',
  '۵': '5', '۶': '6', '۷': '7', '۸': '8', '۹': '9',
  '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4',
  '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9',
}

/** نرمال‌سازی: ارقام فارسی/عربی → لاتین، نیم‌فاصله‌ها و فاصله‌های اضافه */
export function normalizeFa(input: string): string {
  return input
    .replace(/[۰-۹٠-٩]/g, d => FA_DIGITS[d] ?? d)
    .replace(/[\u200c\u200d]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

const WEEKDAYS: Array<{ names: string[]; cron: number }> = [
  { names: ['یکشنبه', 'یک شنبه'], cron: 0 },
  { names: ['دوشنبه', 'دو شنبه'], cron: 1 },
  { names: ['سه شنبه', 'سه‌شنبه'], cron: 2 },
  { names: ['چهارشنبه', 'چهار شنبه'], cron: 3 },
  { names: ['پنجشنبه', 'پنج شنبه'], cron: 4 },
  { names: ['جمعه'], cron: 5 },
  { names: ['شنبه'], cron: 6 },
]

function validHM(h: number, m: number): boolean {
  return Number.isInteger(h) && Number.isInteger(m) && h >= 0 && h <= 23 && m >= 0 && m <= 59
}

function faTime(h: number, m: number): string {
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

/**
 * تلاش برای فهمیدن زمان از متن فارسی.
 * ترتیب الگوها از خاص به عام است؛ اولین تطابق برمی‌گردد.
 */
export function parseScheduleFa(input: string): ParsedSchedule | null {
  const t = normalizeFa(input)

  // ۱) هر N دقیقه → */N * * * *
  let m = t.match(/هر\s+(\d{1,3})\s*دقیقه/)
  if (m) {
    const n = Number(m[1])
    if (n >= 1 && n <= 59) {
      return { cron: `*/${n} * * * *`, label: `هر ${n} دقیقه` }
    }
  }

  // ۲) هر ساعت → 0 * * * *
  if (/هر\s+(یک\s+)?ساعت/.test(t)) {
    return { cron: '0 * * * *', label: 'هر ساعت' }
  }

  // ۳) هر <روزهفته> ساعت H[:M] → M H * * DOW
  for (const wd of WEEKDAYS) {
    for (const name of wd.names) {
      const wm = t.match(new RegExp(`هر\\s+${name}\\s+(?:ساعت\\s+)?(\\d{1,2})(?::(\\d{1,2}))?`))
      if (wm) {
        const h = Number(wm[1]); const min = wm[2] ? Number(wm[2]) : 0
        if (validHM(h, min)) {
          return { cron: `${min} ${h} * * ${wd.cron}`, label: `هر ${name} ساعت ${faTime(h, min)}` }
        }
      }
    }
  }

  // ۴) هر صبح ساعت H[:M] → روزانه همان ساعت صبح
  m = t.match(/هر\s+صبح\s+(?:ساعت\s+)?(\d{1,2})(?::(\d{1,2}))?/)
  if (m) {
    const h = Number(m[1]); const min = m[2] ? Number(m[2]) : 0
    if (h >= 0 && h <= 12 && validHM(h, min)) {
      return { cron: `${min} ${h} * * *`, label: `هر روز صبح ساعت ${faTime(h, min)}` }
    }
  }

  // ۵) هر شب ساعت H[:M] → روزانه ساعت H+12 (اگر H<=12)
  m = t.match(/هر\s+شب\s+(?:ساعت\s+)?(\d{1,2})(?::(\d{1,2}))?/)
  if (m) {
    let h = Number(m[1]); const min = m[2] ? Number(m[2]) : 0
    if (h >= 1 && h <= 12) h += 12
    if (validHM(h, min)) {
      return { cron: `${min} ${h} * * *`, label: `هر شب ساعت ${faTime(h, min)}` }
    }
  }

  // ۶) هر روز ساعت H[:M] → M H * * *
  m = t.match(/هر\s+روز\s+(?:ساعت\s+)?(\d{1,2})(?::(\d{1,2}))?/)
  if (m) {
    const h = Number(m[1]); const min = m[2] ? Number(m[2]) : 0
    if (validHM(h, min)) {
      return { cron: `${min} ${h} * * *`, label: `هر روز ساعت ${faTime(h, min)}` }
    }
  }

  // ۷) ساعت H:M (تکی) → روزانه همان ساعت
  m = t.match(/ساعت\s+(\d{1,2}):(\d{1,2})/)
  if (m) {
    const h = Number(m[1]); const min = Number(m[2])
    if (validHM(h, min)) {
      return { cron: `${min} ${h} * * *`, label: `هر روز ساعت ${faTime(h, min)}` }
    }
  }

  return null
}

/** آیا عبارت کرون ۵ فیلدی معتبر است؟ (اعتبارسنجی سبک، بدون وابستگی) */
export function isValidCron(expr: string): boolean {
  const parts = expr.trim().split(/\s+/)
  if (parts.length !== 5) return false
  const ranges: Array<[number, number]> = [[0, 59], [0, 23], [1, 31], [1, 12], [0, 7]]
  return parts.every((p, i) => {
    const [lo, hi] = ranges[i]!
    if (p === '*') return true
    return p.split(',').every(seg => {
      const step = seg.split('/')
      if (step.length > 2) return false
      const range = step[0]!
      const stepN = step[1] ? Number(step[1]) : 1
      if (!Number.isInteger(stepN) || stepN < 1) return false
      if (range === '*') return true
      if (range.includes('-')) {
        const [a, b] = range.split('-').map(Number)
        return Number.isInteger(a) && Number.isInteger(b) && a! >= lo && b! <= hi && a! <= b!
      }
      const n = Number(range)
      return Number.isInteger(n) && n >= lo && n <= hi
    })
  })
}
