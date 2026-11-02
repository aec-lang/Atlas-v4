import { useEffect, useRef, useState } from 'react'
import { CheckCircle2, Eye, EyeOff, Loader2, PlugZap } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { fetchModelCatalog, type CatalogModel } from '@/lib/modelCatalog'
import { CONNECTION_SERVICES, connectionError, normalizeConnectionURL, serviceForConnection, type ConnectionService } from '@/lib/connectionSetup'
import { providerProtocol, useSettingsStore } from '@/stores/settingsStore'
import { applyNetworkProxy } from '@/lib/proxyConfig'

export function ConnectionSetup({ onSaved, onAdvanced }: { onSaved: () => void; onAdvanced: () => void }) {
  const initial = useSettingsStore.getState().taskConfigs['text-chat']
  const [service, setService] = useState<ConnectionService>(() => serviceForConnection(initial))
  const [baseURL, setBaseURL] = useState(initial.baseURL)
  const [apiKey, setApiKey] = useState(initial.apiKey)
  const [model, setModel] = useState(initial.model)
  const [models, setModels] = useState<CatalogModel[]>([])
  const [showKey, setShowKey] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [loaded, setLoaded] = useState(false)
  const request = useRef(0)
  useEffect(() => () => { request.current++ }, [])
  const selected = CONNECTION_SERVICES.find(s => s.id === service)!
  const editableURL = service === 'compatible' || service === 'ollama'
  const inputStyle = { color: 'var(--text-primary)', background: 'rgba(128,128,128,0.08)' }
  const inputClass = 'min-w-0 w-full rounded-xl border border-transparent px-3 py-3 text-sm outline-none focus:border-[var(--accent)]'

  const invalidate = () => {
    request.current++
    setModels([])
    setLoaded(false)
    setLoading(false)
    setError('')
  }
  const chooseService = (id: ConnectionService) => {
    if (id === service) return
    const next = CONNECTION_SERVICES.find(s => s.id === id)!
    invalidate()
    setService(id)
    setBaseURL(next.baseURL)
    setApiKey('')
    setModel('')
    setShowKey(false)
  }
  const loadModels = async () => {
    const current = ++request.current
    setLoading(true)
    setError('')
    setLoaded(false)
    setModels([])
    try {
      const base = normalizeConnectionURL(baseURL, selected.provider)
      if (service !== 'ollama' && service !== 'compatible' && !apiKey.trim()) {
        throw new Error('کلید API سرویس را وارد کن.')
      }
      const proxy = await applyNetworkProxy(useSettingsStore.getState().proxy)
      if (!proxy.ok && useSettingsStore.getState().proxy.enabled) throw new Error(proxy.error || 'پروکسی اعمال نشد.')
      const list = await fetchModelCatalog(providerProtocol(selected.provider), {
        baseURL: base, ollamaBaseURL: base, apiKey: apiKey.trim(),
      })
      if (current !== request.current) return
      const chatModels = list.filter(m => !m.kind || m.kind === 'chat' || m.kind === 'reasoning')
      const unique = [...new Map(chatModels.map(m => [m.id, m])).values()]
      if (!unique.length) throw new Error('مدل گفت‌وگو پیدا نشد. دسترسی سرویس را بررسی کن؛ برای Ollama ابتدا یک مدل نصب کن.')
      setBaseURL(base)
      setModels(unique)
      setModel(previous => unique.some(m => m.id === previous) ? previous : unique[0].id)
      setLoaded(true)
    } catch (e) {
      if (current === request.current) setError(connectionError(e))
    } finally {
      if (current === request.current) setLoading(false)
    }
  }
  const save = () => {
    try {
      const base = normalizeConnectionURL(baseURL, selected.provider)
      if (!model.trim()) throw new Error('ابتدا مدل گفت‌وگو را انتخاب کن.')
      useSettingsStore.getState().setChatConnection({
        provider: selected.provider, baseURL: base, apiKey: apiKey.trim(), model,
      })
      onSaved()
    } catch (e) { setError(connectionError(e)) }
  }

  if (initial.provider === 'custom') return (
    <div className="grid gap-3 rounded-2xl p-4 glass">
      <p>چت فعلی از API سفارشی استفاده می‌کند. تنظیمات آن را از بخش پیشرفته ویرایش کن.</p>
      <Button onClick={onAdvanced}>تنظیمات پیشرفته</Button>
    </div>
  )

  return (
    <div className="grid gap-5">
      <section className="grid gap-3">
        <h3 className="text-sm font-semibold">۱. از کدام سرویس استفاده می‌کنی؟</h3>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3" aria-label="سرویس هوش مصنوعی">
          {CONNECTION_SERVICES.map(item => (
            <button key={item.id} type="button" aria-pressed={service === item.id} onClick={() => chooseService(item.id)}
              className="grid gap-1 rounded-xl border p-3 text-start transition-colors"
              style={{ borderColor: service === item.id ? 'var(--accent)' : 'var(--glass-border)', background: service === item.id ? 'var(--accent-soft)' : 'rgba(128,128,128,0.04)' }}>
              <span className="text-sm font-semibold" dir="auto">{item.name}</span>
              <span className="text-[11px] leading-5" style={{ color: 'var(--text-secondary)' }}>{item.hint}</span>
            </button>
          ))}
        </div>
      </section>
      <section className="grid gap-3 rounded-2xl p-4 glass">
        <h3 className="text-sm font-semibold">۲. {service === 'ollama' ? 'به مدل محلی وصل شو' : 'اطلاعات اتصال را وارد کن'}</h3>
        {editableURL && <div className="grid gap-1.5">
          <label htmlFor="connection-url" className="text-xs">{service === 'ollama' ? 'آدرس Ollama' : 'آدرس پایهٔ API'}</label>
          <input id="connection-url" dir="ltr" type="url" value={baseURL} spellCheck={false} autoComplete="off"
            onChange={e => { invalidate(); setBaseURL(e.target.value) }} className={`${inputClass} font-mono`} style={inputStyle}
            placeholder={service === 'ollama' ? 'http://localhost:11434/v1' : 'https://your-service.com/v1'} />
          <p className="text-[11px] leading-5" style={{ color: 'var(--text-secondary)' }}>
            {service === 'ollama' ? 'اگر Ollama روی همین دستگاه اجرا می‌شود، آدرس آماده است.' : 'آدرسی که سرویس همراه کلید داده را وارد کن؛ مسیر chat/completions لازم نیست.'}
          </p>
        </div>}
        {service !== 'ollama' && <div className="grid gap-1.5">
          <label htmlFor="connection-key" className="text-xs">کلید API{service === 'compatible' ? ' (اگر سرویس نیاز دارد)' : ''}</label>
          <div className="flex gap-2">
            <input id="connection-key" dir="ltr" type={showKey ? 'text' : 'password'} value={apiKey}
              autoComplete="off" spellCheck={false} onChange={e => { invalidate(); setApiKey(e.target.value) }}
              className={`${inputClass} font-mono`} style={inputStyle} placeholder="کلیدت را اینجا جای‌گذاری کن" />
            <Button variant="outline" size="icon" className="h-auto shrink-0 rounded-xl" onClick={() => setShowKey(v => !v)}
              aria-label={showKey ? 'پنهان کردن کلید' : 'نمایش کلید'}>{showKey ? <EyeOff size={16} /> : <Eye size={16} />}</Button>
          </div>
          {!editableURL && <p className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>آدرس {selected.name} خودکار تنظیم شده است.</p>}
        </div>}
        <Button variant="outline" onClick={() => void loadModels()} disabled={loading || !baseURL.trim() || (service !== 'ollama' && service !== 'compatible' && !apiKey.trim())}
          className="gap-2 rounded-xl">
          {loading ? <Loader2 size={16} className="animate-spin" /> : <PlugZap size={16} />}
          {loading ? 'در حال دریافت مدل‌ها…' : loaded ? 'دریافت دوبارهٔ مدل‌ها' : 'اتصال و دریافت مدل‌ها'}
        </Button>
        {error && <p role="alert" className="text-xs leading-6 text-red-400">{error}</p>}
      </section>
      <section className="grid gap-3">
        <h3 className="text-sm font-semibold">۳. مدل گفت‌وگو را انتخاب کن</h3>
        {loaded && <p role="status" className="flex items-center gap-2 text-xs text-green-500"><CheckCircle2 size={15} />لیست مدل‌ها دریافت شد؛ {models.length} مدل گفت‌وگو در دسترس است.</p>}
        <Select value={model || undefined} onValueChange={setModel} disabled={!loaded}>
          <SelectTrigger aria-label="مدل گفت‌وگو" className="w-full rounded-xl" dir="ltr"><SelectValue placeholder="ابتدا به سرویس وصل شو" /></SelectTrigger>
          <SelectContent>{models.map(item => <SelectItem key={item.id} value={item.id} dir="ltr">{item.id}</SelectItem>)}</SelectContent>
        </Select>
        {!loaded && model && <p className="text-xs break-all" style={{ color: 'var(--text-secondary)' }}>مدل ذخیره‌شده: <bdi>{model}</bdi></p>}
        <p className="text-[11px] leading-5" style={{ color: 'var(--text-secondary)' }}>این اتصال برای چت متنی ذخیره می‌شود. مدل‌های تصویر، صدا و ویدیو را در تنظیمات پیشرفته انتخاب کن.</p>
        <Button onClick={save} disabled={!loaded || !model || loading} className="rounded-xl text-white" style={{ background: 'var(--accent)' }}>ذخیره و شروع گفت‌وگو</Button>
      </section>
    </div>
  )
}
