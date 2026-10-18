import { describe, it, expect } from 'vitest'
import { parseScheduleFa, isValidCron, normalizeFa } from '../lib/scheduleParse'

describe('normalizeFa', () => {
  it('ارقام فارسی و عربی را لاتین می‌کند', () => {
    expect(normalizeFa('ساعت ۸:۳۰')).toBe('ساعت 8:30')
    expect(normalizeFa('هر ٣٠ دقیقه')).toBe('هر 30 دقیقه')
  })
})

describe('parseScheduleFa', () => {
  it('هر صبح ساعت ۸ → روزانه ۰۸:۰۰', () => {
    expect(parseScheduleFa('هر صبح ساعت ۸ اخبار هوش مصنوعی را خلاصه کن'))
      .toMatchObject({ cron: '0 8 * * *' })
  })
  it('هر شب ساعت ۱۰ → روزانه ۲۲:۰۰', () => {
    expect(parseScheduleFa('هر شب ساعت ۱۰')).toMatchObject({ cron: '0 22 * * *' })
  })
  it('هر روز ساعت ۱۴:۳۰', () => {
    expect(parseScheduleFa('هر روز ساعت 14:30')).toMatchObject({ cron: '30 14 * * *' })
  })
  it('ساعت تکی → روزانه', () => {
    expect(parseScheduleFa('ساعت ۹:۱۵ به من یادآوری کن')).toMatchObject({ cron: '15 9 * * *' })
  })
  it('هر ۳۰ دقیقه', () => {
    expect(parseScheduleFa('هر ۳۰ دقیقه وضعیت سیستم را چک کن'))
      .toMatchObject({ cron: '*/30 * * * *' })
  })
  it('هر ساعت', () => {
    expect(parseScheduleFa('هر ساعت')).toMatchObject({ cron: '0 * * * *' })
  })
  it('هر جمعه ساعت ۹ → کرون هفتگی', () => {
    expect(parseScheduleFa('هر جمعه ساعت ۹')).toMatchObject({ cron: '0 9 * * 5' })
  })
  it('هر دوشنبه ساعت ۱۰:۳۰', () => {
    expect(parseScheduleFa('هر دوشنبه ساعت ۱۰:۳۰')).toMatchObject({ cron: '30 10 * * 1' })
  })
  it('متن نامفهوم → null', () => {
    expect(parseScheduleFa('فردا هوا چطوره؟')).toBeNull()
    expect(parseScheduleFa('')).toBeNull()
  })
  it('ساعت نامعتبر → null', () => {
    expect(parseScheduleFa('هر روز ساعت ۲۵')).toBeNull()
  })
})

describe('isValidCron', () => {
  it('کرون‌های معتبر', () => {
    expect(isValidCron('0 8 * * *')).toBe(true)
    expect(isValidCron('*/15 * * * *')).toBe(true)
    expect(isValidCron('30 9 * * 1,3,5')).toBe(true)
    expect(isValidCron('0 0 1 * *')).toBe(true)
  })
  it('کرون‌های نامعتبر', () => {
    expect(isValidCron('0 8 * *')).toBe(false)
    expect(isValidCron('61 8 * * *')).toBe(false)
    expect(isValidCron('abc')).toBe(false)
    expect(isValidCron('')).toBe(false)
  })
})
