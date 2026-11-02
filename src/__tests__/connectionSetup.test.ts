import { describe, expect, it } from 'vitest'
import { connectionError, normalizeConnectionURL, serviceForConnection } from '@/lib/connectionSetup'
import { activeModelName, getTaskConfig, useSettingsStore } from '@/stores/settingsStore'

describe('simple connection setup', () => {
  it('accepts a host or a pasted completions URL and preserves custom prefixes', () => {
    expect(normalizeConnectionURL(' https://example.com ', 'openai')).toBe('https://example.com/v1')
    expect(normalizeConnectionURL('https://example.com/api/v1/chat/completions/', 'openai')).toBe('https://example.com/api/v1')
    expect(normalizeConnectionURL('http://localhost:11434/api/tags', 'ollama')).toBe('http://localhost:11434/v1')
    expect(normalizeConnectionURL('https://example.com/v1beta/openai/', 'gemini')).toBe('https://example.com/v1beta/openai')
  })
  it('rejects credentials, query parameters and non-HTTP URLs', () => {
    for (const url of ['file:///tmp/key', 'https://user:secret@example.com', 'https://example.com?key=secret', 'not a url']) {
      expect(() => normalizeConnectionURL(url, 'openai')).toThrow()
    }
  })
  it('identifies existing compatible endpoints without replacing them', () => {
    expect(serviceForConnection({ provider: 'openai', baseURL: 'http://localhost:4000/v1', apiKey: '', model: '' })).toBe('compatible')
  })
  it('saves the actual chat config and displayed model together without overwriting media configs', () => {
    const before = useSettingsStore.getState()
    const media = before.taskConfigs.image
    try {
      const config = { provider: 'gemini' as const, baseURL: 'https://example.com/v1', apiKey: 'test-key', model: 'test-model' }
      before.setChatConnection(config)
      expect(getTaskConfig('text-chat')).toEqual(config)
      expect(activeModelName(useSettingsStore.getState())).toBe('test-model')
      expect(useSettingsStore.getState().geminiBaseURL).toBe(config.baseURL)
      expect(getTaskConfig('image')).toBe(media)
    } finally { useSettingsStore.setState(before) }
  })
  it('turns common service failures into actionable messages', () => {
    expect(connectionError(new Error('HTTP 401'))).toContain('کلید API')
    expect(connectionError(new Error('HTTP 404'))).toContain('آدرس پایه')
    expect(connectionError(new Error('Failed to fetch'))).toContain('پروکسی')
  })
})
