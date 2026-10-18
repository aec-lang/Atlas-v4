import { describe, it, expect } from 'vitest'
import { parseSlashCommand } from '@/lib/mediaEngines'

describe('mediaEngines — تجزیه دستور اسلش', () => {
  it('/image با پرامپت', () => {
    expect(parseSlashCommand('/image یک گربه فضانورد')).toEqual({
      cmd: 'image',
      arg: 'یک گربه فضانورد',
    })
  })

  it('/tts با متن', () => {
    expect(parseSlashCommand('/tts سلام دنیا')).toEqual({
      cmd: 'tts',
      arg: 'سلام دنیا',
    })
  })

  it('حساس به بزرگی/کوچیکی نیست', () => {
    expect(parseSlashCommand('/IMAGE cat')!.cmd).toBe('image')
    expect(parseSlashCommand('/TTS hi')!.cmd).toBe('tts')
  })

  it('/video و /3d بدون آرگومان هم معتبرند', () => {
    expect(parseSlashCommand('/video')!.cmd).toBe('video')
    expect(parseSlashCommand('/3d')!.cmd).toBe('3d')
  })

  it('متن عادی null برمی‌گرداند', () => {
    expect(parseSlashCommand('سلام چطوری')).toBeNull()
    expect(parseSlashCommand('/unknown چیز')).toBeNull()
    expect(parseSlashCommand('برو /image بزن')).toBeNull()
  })

  it('فاصله‌های اضافی trim می‌شوند', () => {
    expect(parseSlashCommand('  /image   گربه  ')!.arg).toBe('گربه')
  })
})
