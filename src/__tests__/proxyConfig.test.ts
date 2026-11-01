import { describe, it, expect } from 'vitest'
import {
  buildProxyRules, isValidNetworkProxy, DEFAULT_NETWORK_PROXY,
  type NetworkProxyConfig,
} from '@/lib/proxyConfig'

const base = (patch: Partial<NetworkProxyConfig>): NetworkProxyConfig => ({
  ...DEFAULT_NETWORK_PROXY, ...patch,
})

describe('proxyConfig — اعتبارسنجی و ساخت قوانین', () => {
  it('پروکسی غیرفعال → null', () => {
    expect(buildProxyRules(base({ enabled: false, host: '127.0.0.1', port: '1080' }))).toBeNull()
    expect(isValidNetworkProxy(base({ enabled: false, host: '127.0.0.1', port: '1080' }))).toBe(false)
  })

  it('SOCKS5 → socks5://host:port', () => {
    const cfg = base({ enabled: true, type: 'socks5', host: '127.0.0.1', port: '1080' })
    expect(isValidNetworkProxy(cfg)).toBe(true)
    expect(buildProxyRules(cfg)).toBe('socks5://127.0.0.1:1080')
  })

  it('HTTP → http=host:port;https=host:port', () => {
    const cfg = base({ enabled: true, type: 'http', host: '127.0.0.1', port: '8080' })
    expect(buildProxyRules(cfg)).toBe('http=127.0.0.1:8080;https=127.0.0.1:8080')
  })

  it('پورت نامعتبر → null', () => {
    for (const port of ['0', '99999', 'abc', '']) {
      const cfg = base({ enabled: true, host: '127.0.0.1', port })
      expect(isValidNetworkProxy(cfg)).toBe(false)
      expect(buildProxyRules(cfg)).toBeNull()
    }
  })

  it('هاست خالی → null', () => {
    const cfg = base({ enabled: true, host: '   ', port: '1080' })
    expect(isValidNetworkProxy(cfg)).toBe(false)
    expect(buildProxyRules(cfg)).toBeNull()
  })

  it('فاصله‌های دور هاست trim می‌شود', () => {
    const cfg = base({ enabled: true, type: 'socks5', host: '  127.0.0.1  ', port: '1080' })
    expect(buildProxyRules(cfg)).toBe('socks5://127.0.0.1:1080')
  })
})
