import { useEffect, useState, useRef } from 'react'
import { Sidebar } from '@/components/Sidebar'
import { Thread } from '@/components/assistant-ui/thread'
import { Welcome } from '@/components/Welcome'
import { SettingsDialog } from '@/components/SettingsDialog'
import {
  applyTheme, useSettingsStore,
  getModelSettings, engineLabel, activeModelName
} from '@/stores/settingsStore'
import {
  useConversationsStore, useMessagesStore
} from '@/stores/conversationsStore'
import type { ProviderKind } from '@/stores/settingsStore'
import { AssistantRuntimeProvider } from '@assistant-ui/react'
import { useAtlasRuntime } from '@/lib/atlasRuntime'
import { AgentActivityPanel } from '@/components/AgentActivityPanel'
import { InternalBrowser } from '@/components/InternalBrowser'
import { TerminalPanel } from '@/components/TerminalPanel'
import { useUiStore } from '@/stores/uiStore'
import { useActivityStore, formatBackendActivity } from '@/stores/activityStore'
import { usePlanStore } from '@/stores/planStore'
import { useScheduleStore, isTaskDue } from '@/stores/scheduleStore'
import { ToolsPanel } from '@/components/ToolsPanel'
import { CommandPalette } from '@/components/CommandPalette'
import { Toaster } from '@/components/Toaster'
import { VoiceChatPanel } from '@/components/VoiceChatPanel'
import { VoiceOrbDemo } from '@/components/VoiceOrbDemo'
import { PanelRightOpen, Sparkles, Bot, Globe, Terminal, Wrench, Search, Mic } from 'lucide-react'

function App(): React.JSX.Element {
  const engine = useEngineInfo()
  const runtime = useAtlasRuntime()
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [hasStarted, setHasStarted] = useState(false)
  const [activityOpen, setActivityOpen] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [voiceOpen, setVoiceOpen] = useState(false)
  const [orbOpen, setOrbOpen] = useState(false)
  const agentEnabled = useSettingsStore(s => s.agentEnabled)
  const planMode = useSettingsStore(s => s.planMode)
  const panel = useUiStore((s) => s.panel)
  const setPanel = useUiStore((s) => s.setPanel)
  const [toolsOpen, setToolsOpen] = useState(false)

  const conversations = useConversationsStore(s => s.conversations)
  const activeId = useConversationsStore(s => s.activeId)
  const createConv = useConversationsStore(s => s.create)
  const ensureTitle = useConversationsStore(s => s.ensureTitle)
  const touch = useConversationsStore(s => s.touch)
  const saveThread = useMessagesStore(s => s.save)
  const loadThread = useMessagesStore(s => s.load)

  // اشاره‌گر به جدیدترین runtime (جلوگیری از اجرای اثر عنوان با هر تغییر هویت runtime)
  const runtimeRef = useRef(runtime)
  runtimeRef.current = runtime

  /** آخرین پیام کاربر که عنوان از آن ساخته شده — برای تشخیص اولین پیام */
  const lastUserCountRef = useRef(0)

  /* ─── میانبرها: Ctrl+B سایدبار ، Ctrl+, تنظیمات ، Ctrl+K مکالمهٔ جدید ─── */
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!(e.ctrlKey || e.metaKey)) return
      const k = e.key.toLowerCase()
      if (k === 'b') { e.preventDefault(); setSidebarOpen(o => !o) }
      if (e.key === ',') { e.preventDefault(); setSettingsOpen(true) }
      if (k === 'k') { e.preventDefault(); setPaletteOpen(true) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [runtime])

  /* ─── هندلرهای رویداد برای پالت فرمان و دکمه‌ها ─── */
  useEffect(() => {
    const openSettings = (): void => setSettingsOpen(true)
    const openTools = (): void => setToolsOpen(true)
    const openVoice = (): void => setVoiceOpen(true)
    const openOrb = (): void => setOrbOpen(true)
    const newChat = (): void => { try { createConv() } catch { /* ignore */ } }
    window.addEventListener('atlas:open-settings', openSettings)
    window.addEventListener('atlas:open-tools', openTools)
    window.addEventListener('atlas:open-voice', openVoice)
    window.addEventListener('atlas:open-orb', openOrb)
    window.addEventListener('atlas:new-chat', newChat)
    return () => {
      window.removeEventListener('atlas:open-settings', openSettings)
      window.removeEventListener('atlas:open-tools', openTools)
      window.removeEventListener('atlas:open-voice', openVoice)
      window.removeEventListener('atlas:open-orb', openOrb)
      window.removeEventListener('atlas:new-chat', newChat)
    }
  }, [createConv, setToolsOpen, setSettingsOpen, setVoiceOpen, setOrbOpen])

  /* ─── شروع/توقف مکالمه برای نمایش Welcome یا Thread ─── */
  useEffect(() => {
    let alive = true
    const check = (): void => {
      if (!alive) return
      try {
        const n = runtime.thread.getState().messages.length
        setHasStarted(n > 0)
        // شمارندهٔ زنده برای ضداسپم دکمهٔ «مکالمهٔ جدید»
        const cs = useConversationsStore.getState()
        cs.setLiveCount(cs.activeId, n)
      } catch { /* هنوز آماده نیست */ }
    }
    check()
    const unsub = runtime.thread.subscribe(check)
    return () => { alive = false; unsub() }
  }, [runtime])

  /* ─── اشتراک فعالیت ابزارها از پروسهٔ اصلی ─── */
  useEffect(() => {
    const api = window.atlasAPI
    if (!api?.onActivity) return
    const off = api.onActivity((d) => {
      // حالت حریم خصوصی: فعالیت ثبت نشود
      if (useSettingsStore.getState().privacyMode) return
      if (d.pending) {
        // گام در انتظار تأیید → به صف پلن اضافه شود
        usePlanStore.getState().add(d.tool, d.args ?? {})
      }
      useActivityStore.getState().push(formatBackendActivity(d))
    })
    return off
  }, [])

  /* ─── اجراکنندهٔ تسک‌های زمان‌بندی‌شده ─── */
  const scheduleLastCheck = useRef(Date.now())
  useEffect(() => {
    const t = setInterval(() => {
      const now = new Date()
      const last = scheduleLastCheck.current
      scheduleLastCheck.current = Date.now()
      for (const task of useScheduleStore.getState().tasks) {
        if (isTaskDue(task, now, last)) {
          try {
            runtimeRef.current.thread.append(task.prompt)
            useScheduleStore.getState().markRun(task.id)
          } catch { /* ignore */ }
        }
      }
    }, 30_000)
    return () => clearInterval(t)
  }, [])

  /* ─── سوییچ مکالمه: ذخیرهٔ قبلی و بازیابی مقصد ─── */
  const prevActiveRef = useRef<string | null>(null)
  useEffect(() => {
    const prev = prevActiveRef.current
    prevActiveRef.current = activeId
    if (prev === activeId) return

    // ذخیرهٔ مکالمهٔ قبلی (اگر پیام دارد)
    if (prev) {
      try {
        const msgs = runtime.thread.getState().messages
        if (msgs.length > 0) {
          saveThread(prev, runtime.thread.export())
        }
      } catch { /* ignore */ }
    }

    // بارگذاری مکالمهٔ جدید
    try {
      const stored = activeId ? loadThread(activeId) : undefined
       if (stored?.repository) {
        runtime.thread.import(stored.repository as Parameters<typeof runtime.thread.import>[0])
      } else {
        runtime.thread.reset()
      }
    } catch { /* ignore */ }
    lastUserCountRef.current = 0
  }, [activeId, runtime, saveThread, loadThread])

  /* ─── عنوان خودکار + touch بعد از هر پاسخ کامل ─── */
  useEffect(() => {
    if (!activeId || !hasStarted) return
    try {
      const msgs = runtimeRef.current.thread.getState().messages
      const userMsgs = msgs.filter(m => m.role === 'user')
      if (userMsgs.length > lastUserCountRef.current) {
        lastUserCountRef.current = userMsgs.length
        const first = userMsgs[0]
        const text = first?.content.find(p => p.type === 'text')
        if (text && 'text' in text) ensureTitle(activeId, String(text.text))
      }
      touch(activeId)
    } catch { /* ignore */ }
  }, [hasStarted, activeId, ensureTitle, touch])

  /* ─── ذخیرهٔ نهایی هنگام خروج صفحه ─── */
  useEffect(() => {
    const onSave = (): void => {
      if (!activeId) return
      try {
        if (runtime.thread.getState().messages.length > 0) {
          saveThread(activeId, runtime.thread.export())
        }
      } catch { /* ignore */ }
    }
    window.addEventListener('beforeunload', onSave)
    return () => window.removeEventListener('beforeunload', onSave)
  }, [activeId, runtime, saveThread])

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <div className="flex h-full gap-0" dir="rtl" style={{ background: 'var(--bg-base)' }}>
        <div className="atlas-aurora-bg" aria-hidden />
        <div className="atlas-grain" aria-hidden />
        <div className="bg-grid-dots pointer-events-none fixed inset-0" aria-hidden />
        <div className="aurora-blobs pointer-events-none fixed inset-0 -z-10" aria-hidden />

        {sidebarOpen ? (
          <Sidebar onClose={() => setSidebarOpen(false)} />
        ) : (
          <button
            onClick={() => setSidebarOpen(true)}
            className="glass glass-hover m-3 ml-0 flex h-12 w-12 items-center justify-center rounded-2xl self-start"
            title="سایدبار (Ctrl+B)"
            style={{ color: 'var(--text-secondary)' }}
          >
            <PanelRightOpen size={18} />
          </button>
        )}

        <main className="glass relative flex min-w-0 flex-1 flex-col overflow-hidden rounded-none m-0">
          {/* نوار بالا */}
          <div className="flex items-center gap-2 p-3">
            {!sidebarOpen && (
              <button onClick={() => setSidebarOpen(true)} className="glass rounded-xl p-2" title="سایدبار" style={{ color: 'var(--text-secondary)' }}>
                <PanelRightOpen size={15} />
              </button>
            )}
            <button
              onClick={() => setPanel(panel === 'browser' ? 'chat' : 'browser')}
              className="glass glass-hover flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px]"
              style={{ color: panel === 'browser' ? 'var(--accent)' : 'var(--text-secondary)' }}
              title="مرورگر داخلی"
            >
              <Globe size={13} /> مرورگر
            </button>
            <button
              onClick={() => setPanel(panel === 'terminal' ? 'chat' : 'terminal')}
              className="glass glass-hover flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px]"
              style={{ color: panel === 'terminal' ? 'var(--accent)' : 'var(--text-secondary)' }}
              title="ترمینال"
            >
              <Terminal size={13} /> ترمینال
            </button>
            <span className="mr-auto hidden items-center gap-1.5 rounded-full px-3 py-1 text-[11px] glass sm:flex" style={{ color: 'var(--text-secondary)' }}>
               <Sparkles size={11} style={{ color: 'var(--accent)' }} /> Atlas v4 · {engine}
               {conversations.length > 0 && ` · ${conversations.length} مکالمه`}
             </span>
             <span className="hidden items-center gap-1.5 rounded-full px-3 py-1 text-[11px] glass md:flex" style={{ color: 'var(--text-primary)' }}>
               <span className="h-1.5 w-1.5 rounded-full" style={{ background: 'var(--accent)' }} />
               <span className="font-medium">{engine}</span>
             </span>
             <button
               onClick={() => setPaletteOpen(true)}
               className="glass glass-hover flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px]"
               style={{ color: 'var(--text-secondary)' }}
               title="پالت فرمان (⌘K)"
             >
               <Search size={12} /> <kbd className="rounded bg-white/10 px-1">⌘K</kbd>
             </button>
            {agentEnabled && (
            <button
              onClick={() => setActivityOpen(o => !o)}
              className="glass glass-hover flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px]"
              style={{ color: 'var(--accent)' }}
              title="فعالیت عامل"
            >
              <Bot size={13} /> عامل
            </button>
          )}
          <button
            onClick={() => setVoiceOpen(true)}
            className="glass glass-hover flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px]"
            style={{ color: voiceOpen ? 'var(--accent)' : 'var(--text-secondary)' }}
            title="چت صوتی"
          >
            <Mic size={13} /> صوتی
          </button>
          <button
            onClick={() => setOrbOpen(true)}
            className="glass glass-hover flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px]"
            style={{ color: orbOpen ? 'var(--accent)' : 'var(--text-secondary)' }}
            title="اورب صوتی (WebGL)"
          >
            🔮 اورب
          </button>
            <button
              onClick={() => setToolsOpen(o => !o)}
              className="btn-gradient flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px]"
              title="ابزارها و قابلیت‌های پیشرفته"
            >
              <Wrench size={13} /> ابزارها
            </button>
          </div>

          <div className="min-h-0 flex-1">
            {panel === 'browser' ? <InternalBrowser /> : panel === 'terminal' ? <TerminalPanel /> : hasStarted ? <Thread /> : <Welcome />}
          </div>

          <footer className="flex items-center gap-3 border-t px-4 py-1.5 text-[10px]" style={{ borderColor: 'var(--glass-border)', color: 'var(--text-secondary)' }}>
            <span className="flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: agentEnabled ? '#4ade80' : 'var(--text-secondary)' }} />
              عامل {agentEnabled ? 'روشن' : 'خاموش'}
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: planMode ? 'var(--accent)' : 'var(--text-secondary)' }} />
              پلن {planMode ? 'روشن' : 'خاموش'}
            </span>
            <span className="mr-auto hidden font-medium sm:inline" style={{ color: 'var(--text-primary)' }}>{engine}</span>
            <span className="hidden items-center gap-1 sm:flex">
              <kbd className="rounded bg-white/10 px-1">⌘K</kbd> فرمان
            </span>
          </footer>
        </main>
      </div>

      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
      <AgentActivityPanel open={activityOpen} onClose={() => setActivityOpen(false)} />
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
      <Toaster />
      <ToolsPanel open={toolsOpen} onClose={() => setToolsOpen(false)} />
      <VoiceChatPanel open={voiceOpen} onClose={() => setVoiceOpen(false)} />
      <VoiceOrbDemo open={orbOpen} onClose={() => setOrbOpen(false)} />
    </AssistantRuntimeProvider>
  )
}

/** دنبالکردن تنظیمات موتور برای نشان نوار بالا */
function useEngineInfo(): string {
  const [label, setLabel] = useState(() => {
    const s = getModelSettings()
    return engineLabel(s.provider, activeModelName(s))
  })
  useEffect(() => {
    const sync = (): void => {
      const s = useSettingsStore.getState()
      setLabel(engineLabel(s.provider, activeModelName(s)))
      applyTheme(s.theme)
    }
    sync()
    return useSettingsStore.subscribe(sync)
  }, [])
  return label
}

export default App

// حفظ سازگاری نوع پروایدر برای importهای آینده
export type { ProviderKind }
