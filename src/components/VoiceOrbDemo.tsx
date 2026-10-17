"use client";

import { useState } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { VoicePoweredOrb } from "@/components/ui/voice-powered-orb";
import { Button } from "@/components/ui/button";
import { Mic, MicOff } from "lucide-react";

export function VoiceOrbDemo({ open, onClose }: { open: boolean; onClose: () => void }): React.JSX.Element {
  const [isRecording, setIsRecording] = useState(false);
  const [voiceDetected, setVoiceDetected] = useState(false);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="glass-strong beam-border max-w-xl gap-0 overflow-hidden rounded-[1.8rem] p-0" style={{ background: 'var(--bg-base)' }}>
        <header className="flex items-center gap-2 border-b px-4 py-3" style={{ borderColor: 'var(--glass-border)' }}>
          <span className="text-lg">🔮</span>
          <span className="text-sm font-bold">اورب صوتی (WebGL)</span>
          <button onClick={onClose} className="mr-auto rounded-xl p-2 glass-hover" style={{ color: 'var(--text-secondary)' }}><MicOff size={16} /></button>
        </header>

        <div className="flex flex-col items-center gap-6 px-6 py-6">
          <div className="relative h-80 w-80">
            <VoicePoweredOrb
              enableVoiceControl={isRecording}
              className="rounded-2xl overflow-hidden shadow-2xl"
              onVoiceDetected={setVoiceDetected}
              hue={210}
            />
          </div>

          <Button
            onClick={() => setIsRecording((r) => !r)}
            variant={isRecording ? "destructive" : "default"}
            size="lg"
            className="gap-2 px-8"
          >
            {isRecording ? (
              <><MicOff className="h-5 w-5" /> توقف ضبط</>
            ) : (
              <><Mic className="h-5 w-5" /> شروع ضبط</>
            )}
          </Button>

          <p className="text-center text-sm" style={{ color: 'var(--text-secondary)' }}>
            دکمه را بزن تا کنترل صدا فعال شود. حرف بزن تا اورب با حرکات ظریف به صدایت واکنش نشان دهد
            {voiceDetected ? " — صدا شنیده شد ✅" : ""}
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
