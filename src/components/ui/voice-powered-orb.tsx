"use client";

import { useEffect, useRef, type FC } from "react";
import { Renderer, Program, Mesh, Triangle, Vec3, type OGLRenderingContext } from "ogl";
import { cn } from "@/lib/utils";

interface VoicePoweredOrbProps {
  className?: string;
  hue?: number;
  enableVoiceControl?: boolean;
  voiceSensitivity?: number;
  maxRotationSpeed?: number;
  maxHoverIntensity?: number;
  onVoiceDetected?: (detected: boolean) => void;
}

export const VoicePoweredOrb: FC<VoicePoweredOrbProps> = ({
  className,
  hue = 0,
  enableVoiceControl = true,
  voiceSensitivity = 1.5,
  maxRotationSpeed = 1.2,
  maxHoverIntensity = 0.8,
  onVoiceDetected,
}) => {
  const ctnDom = useRef<HTMLDivElement>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const microphoneRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const dataArrayRef = useRef<Uint8Array<ArrayBuffer> | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);

  const vert = /* glsl */ `
    precision highp float;
    attribute vec2 position;
    attribute vec2 uv;
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = vec4(position, 0.0, 1.0);
    }
  `;

  const frag = /* glsl */ `
    precision highp float;

    uniform float iTime;
    uniform vec3 iResolution;
    uniform float hue;
    uniform float hover;
    uniform float rot;
    uniform float hoverIntensity;
    uniform float uVoice;
    uniform float uPulse;
    varying vec2 vUv;

    vec3 hash33(vec3 p3) {
      p3 = fract(p3 * vec3(0.1031, 0.11369, 0.13787));
      p3 += dot(p3, p3.yxz + 19.19);
      return -1.0 + 2.0 * fract(vec3(
        p3.x + p3.y,
        p3.x + p3.z,
        p3.y + p3.z
      ) * p3.zyx);
    }

    float snoise3(vec3 p) {
      const float K1 = 0.333333333;
      const float K2 = 0.166666667;
      vec3 i = floor(p + (p.x + p.y + p.z) * K1);
      vec3 d0 = p - (i - (i.x + i.y + i.z) * K2);
      vec3 e = step(vec3(0.0), d0 - d0.yzx);
      vec3 i1 = e * (1.0 - e.zxy);
      vec3 i2 = 1.0 - e.zxy * (1.0 - e);
      vec3 d1 = d0 - (i1 - K2);
      vec3 d2 = d0 - (i2 - K1);
      vec3 d3 = d0 - 0.5;
      vec4 h = max(0.6 - vec4(
        dot(d0, d0),
        dot(d1, d1),
        dot(d2, d2),
        dot(d3, d3)
      ), 0.0);
      vec4 n = h * h * h * h * vec4(
        dot(d0, hash33(i)),
        dot(d1, hash33(i + i1)),
        dot(d2, hash33(i + i2)),
        dot(d3, hash33(i + 1.0))
      );
      return dot(vec4(31.316), n);
    }

    // نویز چنداکتاوه برای جزئیات بیشتر سطح
    float fbm(vec3 p) {
      float v = 0.0;
      float a = 0.5;
      for (int i = 0; i < 5; i++) {
        v += a * snoise3(p);
        p *= 2.03;
        a *= 0.5;
      }
      return v;
    }

    float light1(float intensity, float attenuation, float dist) {
      return intensity / (1.0 + dist * attenuation);
    }

    // پالت کسینوسی پُررنگ RGB (زنده و آر جی بی)
    vec3 cosPal(float t) {
      return 0.55 + 0.45 * cos(6.28318 * (vec3(1.0, 1.0, 1.0) * t + vec3(0.0, 0.33, 0.67)));
    }

    vec4 extractAlpha(vec3 colorIn) {
      float a = max(max(colorIn.r, colorIn.g), colorIn.b);
      return vec4(colorIn.rgb / (a + 1e-5), a);
    }

    const float innerRadius = 0.6;
    const float noiseScale = 0.65;

    vec4 draw(vec2 uv) {
      float ang = atan(uv.y, uv.x);
      float len = length(uv);
      float inv = len > 0.0 ? 1.0 / len : 0.0;

      // سطح متلاطم چندلایه + اعوجاج با صدا
      float n = fbm(vec3(uv * noiseScale * 1.7, iTime * 0.4));
      float r0 = mix(innerRadius, 1.0, 0.5 + 0.5 * sin(n * 3.14159));
      r0 += uVoice * 0.06 * sin(ang * 6.0 + iTime * 4.0);
      float d0 = distance(uv, r0 * inv * uv);
      float v0 = light1(1.0, 9.0, d0);
      v0 *= smoothstep(r0 * 1.06, r0, len);

      // چرخش رنگ با زمان + صدا -> طیف زندهٔ RGB
      float hueT = hue / 360.0 + iTime * 0.03 + uVoice * 0.7 + n * 0.05;
      vec3 base = cosPal(hueT);
      vec3 col = base * v0;

      // هالهٔ درخشان واکنش‌دهنده به صدا
      float glow = exp(-len * 2.2) * (0.22 + uVoice * 0.95);
      col += cosPal(hueT + 0.2) * glow;

      // رینگ‌های موج (ripple) متحرک
      float ripple = 0.5 + 0.5 * sin(len * 16.0 - iTime * 5.0);
      col += cosPal(hueT + 0.5) * smoothstep(0.85, 1.0, ripple) * (0.12 + uVoice * 0.85) * smoothstep(r0, 1.0, len);

      // جرقه‌های RGB (sparkle)
      float sp = pow(max(snoise3(vec3(uv * 26.0, iTime * 1.2)), 0.0), 8.0);
      col += vec3(1.0) * sp * (0.35 + uVoice);

      // پالس انفجاری روی شنیدن ناگهانی صدا
      col += cosPal(hueT + 0.8) * uPulse * smoothstep(0.95, 1.0, abs(sin(len * 6.0 - iTime * 2.0)));

      col = clamp(col, 0.0, 1.0);
      return extractAlpha(col);
    }

    vec4 mainImage(vec2 fragCoord) {
      vec2 center = iResolution.xy * 0.5;
      float size = min(iResolution.x, iResolution.y);
      vec2 uv = (fragCoord - center) / size * 2.0;

      float angle = rot;
      float s = sin(angle);
      float c = cos(angle);
      uv = vec2(c * uv.x - s * uv.y, s * uv.x + c * uv.y);

      uv.x += hover * hoverIntensity * 0.1 * sin(uv.y * 10.0 + iTime);
      uv.y += hover * hoverIntensity * 0.1 * sin(uv.x * 10.0 + iTime);

      return draw(uv);
    }

    void main() {
      vec2 fragCoord = vUv * iResolution.xy;
      vec4 col = mainImage(fragCoord);
      gl_FragColor = vec4(col.rgb * col.a, col.a);
    }
  `;

  // Voice analysis function
  const analyzeAudio = () => {
    if (!analyserRef.current || !dataArrayRef.current) return 0;

    analyserRef.current.getByteFrequencyData(dataArrayRef.current);

    let sum = 0;
    for (let i = 0; i < dataArrayRef.current.length; i++) {
      const value = dataArrayRef.current[i] / 255;
      sum += value * value;
    }
    const rms = Math.sqrt(sum / dataArrayRef.current.length);

    const level = Math.min(rms * voiceSensitivity * 3.0, 1);
    return level;
  };

  const stopMicrophone = () => {
    try {
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach(track => track.stop());
        mediaStreamRef.current = null;
      }
      if (microphoneRef.current) {
        microphoneRef.current.disconnect();
        microphoneRef.current = null;
      }
      if (analyserRef.current) {
        analyserRef.current.disconnect();
        analyserRef.current = null;
      }
      if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
        audioContextRef.current.close();
        audioContextRef.current = null;
      }
      dataArrayRef.current = null;
    } catch (error) {
      console.warn('Error stopping microphone:', error);
    }
  };

  const initMicrophone = async () => {
    try {
      stopMicrophone();
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, sampleRate: 44100 },
      });
      mediaStreamRef.current = stream;
      audioContextRef.current = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
      if (audioContextRef.current.state === 'suspended') await audioContextRef.current.resume();
      analyserRef.current = audioContextRef.current.createAnalyser();
      microphoneRef.current = audioContextRef.current.createMediaStreamSource(stream);
      analyserRef.current.fftSize = 512;
      analyserRef.current.smoothingTimeConstant = 0.3;
      analyserRef.current.minDecibels = -90;
      analyserRef.current.maxDecibels = -10;
      microphoneRef.current.connect(analyserRef.current);
      dataArrayRef.current = new Uint8Array(analyserRef.current.frequencyBinCount);
      return true;
    } catch (error) {
      console.warn("Microphone access denied or not available:", error);
      return false;
    }
  };

  useEffect(() => {
    const container = ctnDom.current;
    if (!container) return;

    let rendererInstance: Renderer | null = null;
    let glContext: OGLRenderingContext | null = null;
    let rafId: number;
    let program: Program | null = null;
    // نگه‌داری ارجاع به هندلر resize تا در بلوک catch هم بتوان حذفش کرد
    let resizeHandler: (() => void) | null = null;

    try {
      rendererInstance = new Renderer({
        alpha: true,
        premultipliedAlpha: false,
        antialias: true,
        dpr: window.devicePixelRatio || 1,
      });
      glContext = rendererInstance.gl;
      glContext.clearColor(0, 0, 0, 0);
      glContext.enable(glContext.BLEND);
      glContext.blendFunc(glContext.SRC_ALPHA, glContext.ONE_MINUS_SRC_ALPHA);

      while (container.firstChild) container.removeChild(container.firstChild);
      container.appendChild(glContext.canvas as HTMLCanvasElement);

      const geometry = new Triangle(glContext);
      program = new Program(glContext, {
        vertex: vert,
        fragment: frag,
        uniforms: {
          iTime: { value: 0 },
          iResolution: { value: new Vec3(glContext.canvas.width, glContext.canvas.height, 1) },
          hue: { value: hue },
          hover: { value: 0 },
          rot: { value: 0 },
          hoverIntensity: { value: 0 },
          uVoice: { value: 0 },
          uPulse: { value: 0 },
        },
      });

      const mesh = new Mesh(glContext, { geometry, program });

      const resize = () => {
        if (!container || !rendererInstance || !glContext) return;
        const dpr = window.devicePixelRatio || 1;
        const width = container.clientWidth;
        const height = container.clientHeight;
        if (width === 0 || height === 0) return;
        rendererInstance.setSize(width * dpr, height * dpr);
        (glContext.canvas as HTMLCanvasElement).style.width = width + "px";
        (glContext.canvas as HTMLCanvasElement).style.height = height + "px";
        program?.uniforms.iResolution.value.set(glContext.canvas.width, glContext.canvas.height, 1);
      };
      window.addEventListener("resize", resize);
      resizeHandler = resize;
      resize();

      let lastTime = 0;
      let currentRot = 0;
      let lastLevel = 0;
      let pulse = 0;
      const baseRotationSpeed = 0.3;
      let isMicrophoneInitialized = false;

      if (enableVoiceControl) {
        initMicrophone().then((success) => { isMicrophoneInitialized = success; });
      } else {
        stopMicrophone();
        isMicrophoneInitialized = false;
      }

      const update = (t: number) => {
        rafId = requestAnimationFrame(update);
        if (!program) return;
        const dt = (t - lastTime) * 0.001;
        lastTime = t;
        program.uniforms.iTime.value = t * 0.001;
        program.uniforms.hue.value = hue;

        if (enableVoiceControl && isMicrophoneInitialized) {
          const level = analyzeAudio();
          // پالس انفجاری روی جهش ناگهانی صدا
          if (level - lastLevel > 0.07) pulse = 1.0;
          else pulse *= 0.9;
          lastLevel = level;

          if (onVoiceDetected) onVoiceDetected(level > 0.1);

          const voiceRotationSpeed = baseRotationSpeed + (level * maxRotationSpeed * 2.0);
          if (level > 0.05) currentRot += dt * voiceRotationSpeed;

          program.uniforms.uVoice.value = level;
          program.uniforms.uPulse.value = pulse;
          program.uniforms.hover.value = Math.min(level * 2.0, 1.0);
          program.uniforms.hoverIntensity.value = Math.min(level * maxHoverIntensity * 0.8, maxHoverIntensity);
        } else {
          program.uniforms.uVoice.value = 0;
          program.uniforms.uPulse.value = 0;
          program.uniforms.hover.value = 0;
          program.uniforms.hoverIntensity.value = 0;
          if (onVoiceDetected) onVoiceDetected(false);
        }

        program.uniforms.rot.value = currentRot;
        if (rendererInstance && glContext) {
          glContext.clear(glContext.COLOR_BUFFER_BIT | glContext.DEPTH_BUFFER_BIT);
          rendererInstance.render({ scene: mesh });
        }
      };

      rafId = requestAnimationFrame(update);

      return () => {
        cancelAnimationFrame(rafId);
        window.removeEventListener("resize", resize);
        if (container && glContext && glContext.canvas) {
          try {
            const canvasEl = glContext.canvas as HTMLCanvasElement;
            if (container.contains(canvasEl)) container.removeChild(canvasEl);
          } catch (error) {
            console.warn("Canvas cleanup error:", error);
          }
        }
        stopMicrophone();
        glContext?.getExtension("WEBGL_lose_context")?.loseContext();
      };
    } catch (error) {
      console.error("Error initializing Voice Powered Orb:", error);
      // حذف شنونده‌ای که ممکن است قبل از خطا اضافه شده باشد — جلوگیری از نشت حافظه
      if (resizeHandler) window.removeEventListener("resize", resizeHandler);
      if (container && container.firstChild) container.removeChild(container.firstChild);
      return undefined;
    }
  }, [hue, enableVoiceControl, voiceSensitivity, maxRotationSpeed, maxHoverIntensity, vert, frag]);

  useEffect(() => {
    let isMounted = true;
    const handleMicrophoneState = async () => {
      if (enableVoiceControl) {
        await initMicrophone();
        if (!isMounted) return;
      } else {
        stopMicrophone();
      }
    };
    handleMicrophoneState();
    return () => { isMounted = false; };
  }, [enableVoiceControl]);

  return (
    <div ref={ctnDom} className={cn("w-full h-full relative", className)} />
  );
};
