import { describe, it, expect } from 'vitest'
import {
  isToolAllowedInBackground,
  backgroundDenialMessage,
  BACKGROUND_BLOCKED_TOOLS,
} from '../lib/taskPolicy'

describe('BACKGROUND_BLOCKED_TOOLS', () => {
  it('همان مجموعهٔ DANGEROUS پروسهٔ اصلی است', () => {
    expect([...BACKGROUND_BLOCKED_TOOLS].sort()).toEqual(
      [
        'shell_exec', 'proc_kill',
        'mouse_move', 'mouse_click', 'mouse_scroll',
        'keyboard_type', 'keyboard_press',
      ].sort(),
    )
  })
})

describe('isToolAllowedInBackground', () => {
  it('ابزارهای خطرناک مسدودند', () => {
    for (const t of BACKGROUND_BLOCKED_TOOLS) {
      const d = isToolAllowedInBackground(t, {})
      expect(d.allowed).toBe(false)
      expect(d.reason).toBeTruthy()
    }
  })
  it('ابزارهای خواندنی/بی‌خطر مجازند', () => {
    for (const t of ['fs_list', 'fs_read', 'fs_exists', 'system_info', 'proc_list', 'memory_get', 'get_task_config', 'fs_write']) {
      expect(isToolAllowedInBackground(t, {}).allowed).toBe(true)
    }
  })
  it('set_task_config با کلید مسدود، بدون کلید مجاز', () => {
    expect(isToolAllowedInBackground('set_task_config', { apiKey: 'sk-x' }).allowed).toBe(false)
    expect(isToolAllowedInBackground('set_task_config', { model: 'x' }).allowed).toBe(true)
    expect(isToolAllowedInBackground('set_task_config', {}).allowed).toBe(true)
  })
  it('ساخت تسک از درون تسک خودکار مسدود است (ضد آبشار)', () => {
    expect(isToolAllowedInBackground('create_background_task', {}).allowed).toBe(false)
    expect(isToolAllowedInBackground('schedule_task', {}).allowed).toBe(false)
  })
})

describe('backgroundDenialMessage', () => {
  it('پیام فارسی و بدون ایموجی برمی‌گرداند', () => {
    const msg = backgroundDenialMessage('shell_exec')
    expect(msg).toContain('shell_exec')
    expect(msg).toContain('تأیید')
    expect(msg).not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u)
  })
})
