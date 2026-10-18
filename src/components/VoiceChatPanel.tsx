/**
 * VoiceChatPanel — نمونهٔ چت صوتی: اورب متحرک + سطح‌سنج میکروفون واقعی (Web Audio)
 * + تشخیص گفتار (SpeechRecognition) و ارسال خودکار به چت.
 * اگر میکروفون در دسترس نباشد، سطح رو شبیه‌سازی می‌کند (حالت نمایشی).
 */
import { useEffect, useRef, useState } from 'react'
import { useAui } from '@assistant-ui/react'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { VoiceOrb } from '@/components/VoiceOrb'
import { WakeWordDetector } from '@/lib/wakeWord'
import { useSettingsStore } from '@/stores/settingsStore'
import { Mic, Square, X, Radio } from 'lucide-react'

type VState = 'idle' | 'listening' | 'speaking'

interface AudioHandle { stream: MediaStream; ac: AudioContext }

export function VoiceChatPanel({ open, onClose }: { open: boolean; onClose: () => void }): React.JSX.Element | null {
  const aui = useAui()
  const [state, setState] = useState<VState>('idle')
  const [level, setLevel] = useState(0)
  const [text, setText] = useState('')
  const [hint, setHint] = useState('')
  const audioRef = useRef<AudioHandle | null>(null)
  const rafRef = useRef<number | null>(null)
  const recRef = useRef<{ stop?: () => void; onresult?: (e: unknown) => void; onend?: () => void; start?: () => void } | null>(null)
  const simRef = useRef<number | null>(null)
  const wakeRef = useRef<WakeWordDetector | null>(null)
  const [wakeOn, setWakeOn] = useState(false)
  const wakePhrase = useSettingsStore(s => s.wakePhrase)

  const cleanup = (): void => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    if (simRef.current) cancelAnimationFrame(simRef.current)
    audioRef.current?.stream.getTracks().forEach(t => t.stop())
    audioRef.current?.ac.close().catch(() => {})
    audioRef.current = null
    try { recRef.current?.stop?.() } catch { /* ignore */ }
    recRef.current = null
  }

  const simulate = (): void => {
    const loop = (): void => {
      setLevel(0.25 + Math.abs(Math.sin(performance.now() / 380)) * 0.55)
      simRef.current = requestAnimationFrame(loop)
    }
    loop()
  }

  const start = async (): Promise<void> => {
    setState('listening')
    setHint('')
    // سطح‌سنج واقعی میکروفون
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      const ac = new Ctx()
      const src = ac.createMediaStreamSource(stream)
      const an = ac.createAnalyser()
      an.fftSize = 256
      src.connect(an)
      const buf = new Uint8Array(an.frequencyBinCount)
      const loop = (): void => {
        an.getByteTimeDomainData(buf)
        let s = 0
        for (const v of buf) { const x = (v - 128) / 128; s += x * x }
        const rms = Math.sqrt(s / buf.length)
        setLevel(Math.min(1, rms * 2.4))
        rafRef.current = requestAnimationFrame(loop)
      }
      loop()
      audioRef.current = { stream, ac }
    } catch {
      setHint('میکروفون در دسترس نیست — حالت نمایشی (شبیه‌سازی)')
      simulate()
    }
    // تشخیص گفتار
    const SR = (window as unknown as { SpeechRecognition?: new () => unknown; webkitSpeechRecognition?: new () => unknown }).SpeechRecognition
      || (window as unknown as { webkitSpeechRecognition?: new () => unknown }).webkitSpeechRecognition
    if (!SR) { setHint(h => (h ? h : 'مرورگر از تشخیص گفتار پشتیبانی نمی‌کند')); return }
    const rec = new SR() as { lang: string; interimResults: boolean; continuous: boolean; onresult: (e: unknown) => void; onend: () => void; start: () => void }
    rec.lang = 'fa-IR'
    rec.interimResults = true
    rec.continuous = true
    rec.onresult = (e: unknown) => {
      const res = (e as { results: Array<Array<{ transcript: string }>> }).results
      let t = ''
      for (let i = 0; i < res.length; i++) t += res[i][0].transcript
      setText(t)
    }
    rec.onend = () => { if (state === 'listening') try { rec.start() } catch { /* ignore */ } }
    rec.start()
    recRef.current = rec
  }

  const stop = (): void => {
    cleanup()
    setState('idle')
    setLevel(0)
    if (text.trim()) {
      // متن تشخیص‌داده‌شده به موتور گفت‌وگو می‌رود — یعنی کانفیگ task «چت متنی»
      // (آداپتور AtlasChatAdapter). کانفیگ «چت صوتی» برای پایپ‌لاین اختصاصی
      // STT/TTS رزرو شده و فعلاً موتور واقعی ندارد.
      aui.thread.append(text.trim())
      setText('')
    }
  }

  const toggleWake = (): void => {
    if (wakeOn) {
      wakeRef.current?.stop()
      wakeRef.current = null
      setWakeOn(false)
      return
    }
    const det = new WakeWordDetector({
      phrase: wakePhrase,
      lang: 'fa-IR',
      onWake: () => {
        setHint('کلمهٔ بیدار شنیده شد — حالا بگو…')
        setWakeOn(false)
        wakeRef.current?.stop()
        wakeRef.current = null
        void start()
      },
    })
    void det.start()
    wakeRef.current = det
    setWakeOn(true)
  }

  useEffect(() => { if (!open) { cleanup(); wakeRef.current?.stop(); wakeRef.current = null; setWakeOn(false); setState('idle'); setLevel(0) } }, [open])
  useEffect(() => () => { cleanup(); wakeRef.current?.stop() }, [])

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="glass-strong beam-border top-[12%] max-w-md translate-y-0 gap-0 overflow-hidden rounded-[1.8rem] p-0" style={{ background: 'var(--bg-base)' }}>
        <header className="flex items-center gap-2 border-b px-4 py-3" style={{ borderColor: 'var(--glass-border)' }}>
          <span className="text-lg">🎙️</span>
          <span className="text-sm font-bold">چت صوتی</span>
          <button onClick={onClose} className="mr-auto rounded-xl p-2 glass-hover" style={{ color: 'var(--text-secondary)' }}><X size={16} /></button>
        </header>

        <div className="flex flex-col items-center gap-3 px-5 py-6">
          <VoiceOrb level={level} state={state} size={220} />
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
            {state === 'listening' ? 'در حال گوش دادن… بگو تا بنویسم' : state === 'speaking' ? 'در حال صحبت…' : 'برای شروع ضرب بزن'}
          </p>

          <div className="min-h-[2.5rem] w-full rounded-2xl px-3 py-2 text-center text-sm" style={{ background: 'var(--glass-bg)', color: 'var(--text-primary)' }}>
            {text || <span style={{ color: 'var(--text-secondary)' }}>متن گفتار اینجا ظاهر میشه…</span>}
          </div>
          {hint && <p className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>💡 {hint}</p>}

           <div className="mt-1 flex items-center gap-2">
            <button
              onClick={() => (state === 'idle' ? void start() : stop())}
              className="btn-gradient flex h-12 w-12 items-center justify-center rounded-full transition-transform hover:scale-110"
              title={state === 'idle' ? 'شروع' : 'توقف و ارسال'}
            >
              {state === 'idle' ? <Mic size={20} /> : <Square size={18} />}
            </button>
            <button
              onClick={toggleWake}
              className="flex h-10 items-center gap-1.5 rounded-full px-3 text-[11px] transition-colors"
              style={wakeOn ? { background: 'var(--accent)', color: '#fff' } : { background: 'var(--glass-bg)', color: 'var(--text-secondary)' }}
              title={`کلمهٔ بیدار: ${wakePhrase}`}
            >
              <Radio size={14} /> {wakeOn ? 'شنود کلمهٔ بیدار روشن' : 'کلمهٔ بیدار'}
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
