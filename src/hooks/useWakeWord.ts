import { useState, useEffect, useRef, useCallback } from 'react';
import {
  VoicePrintProfile,
  estimatePitchHz,
  computeSpectralFingerprint,
  buildVoicePrintProfile,
  compareVoicePrints,
  matchesWakeWord,
  extractCommandAfterWakeWord,
} from '../utils/voicePrint.ts';

export type WakeStatus = 'off' | 'standby' | 'matched' | 'mismatch' | 'denied-mic' | 'unsupported';

/**
 * Silent helper retained as no-op so wake activation never plays an unwanted chime or tilic sound.
 */
export function playWakeChime(): void {
  // Intentionally silent
}

/**
 * Captures 2.8 seconds of live microphone audio to build an acoustic VoicePrintProfile
 * or test speaker match against an existing profile.
 */
export async function captureMicrophoneVoiceFrames(
  durationMs = 2800,
  onProgress?: (pct: number, liveLevel: number) => void
): Promise<{
  timeFrames: Float32Array[];
  fftFrames: Uint8Array[];
  sampleRate: number;
}> {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
    throw new Error('Microphone access is not supported in this browser.');
  }

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
  });

  const AudioCtx =
    window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new AudioCtx();
  if (ctx.state === 'suspended') {
    await ctx.resume().catch(() => {});
  }
  const source = ctx.createMediaStreamSource(stream);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 2048;
  analyser.smoothingTimeConstant = 0.35;
  source.connect(analyser);

  const timeFrames: Float32Array[] = [];
  const fftFrames: Uint8Array[] = [];
  const startedAt = Date.now();

  return new Promise((resolve) => {
    const timer = setInterval(() => {
      const elapsed = Date.now() - startedAt;
      const pct = Math.min(100, Math.round((elapsed / durationMs) * 100));

      const timeBuf = new Float32Array(analyser.fftSize);
      const fftBuf = new Uint8Array(analyser.frequencyBinCount);
      analyser.getFloatTimeDomainData(timeBuf);
      analyser.getByteFrequencyData(fftBuf);

      timeFrames.push(timeBuf);
      fftFrames.push(fftBuf);

      let peak = 0;
      for (let i = 0; i < timeBuf.length; i += 4) {
        const abs = Math.abs(timeBuf[i]);
        if (abs > peak) peak = abs;
      }
      onProgress?.(pct, Math.min(1, peak * 4.5));

      if (elapsed >= durationMs) {
        clearInterval(timer);
        stream.getTracks().forEach((t) => t.stop());
        ctx.close().catch(() => {});
        resolve({
          timeFrames,
          fftFrames,
          sampleRate: ctx.sampleRate || 48000,
        });
      }
    }, 100);
  });
}

export async function enrollUserVoicePrint(
  label = 'My Voice Print',
  onProgress?: (pct: number, liveLevel: number) => void
): Promise<VoicePrintProfile> {
  const { timeFrames, fftFrames, sampleRate } = await captureMicrophoneVoiceFrames(2800, onProgress);
  return buildVoicePrintProfile(timeFrames, fftFrames, sampleRate, label);
}

export async function verifyUserVoiceSample(
  enrolled: VoicePrintProfile,
  onProgress?: (pct: number, liveLevel: number) => void
) {
  const { timeFrames, fftFrames, sampleRate } = await captureMicrophoneVoiceFrames(2400, onProgress);
  const candidate = buildVoicePrintProfile(timeFrames, fftFrames, sampleRate, 'Live Test');
  return compareVoicePrints(enrolled, candidate.fundamentalHz, candidate.spectralProfile);
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve((reader.result as string) || '');
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

/**
 * Purely silent Web Audio + MediaRecorder wake-word standby hook.
 * Never calls browser SpeechRecognition so Android never plays YouTube-style "tilic" beeps.
 */
export function useWakeWord(options: {
  enabled: boolean;
  isMainListening: boolean;
  isAssistantSpeaking: boolean;
  isStreaming: boolean;
  language?: string;
  voicePrint?: VoicePrintProfile | null;
  onWakeTriggered: (inlineCommand: string) => void;
}) {
  const [wakeStatus, setWakeStatus] = useState<WakeStatus>('off');
  const [lastMatchScore, setLastMatchScore] = useState<number | null>(null);

  const onWakeRef = useRef(options.onWakeTriggered);
  onWakeRef.current = options.onWakeTriggered;
  const voicePrintRef = useRef(options.voicePrint);
  voicePrintRef.current = options.voicePrint;
  const languageRef = useRef(options.language);
  languageRef.current = options.language;

  const micStreamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const ringBufferRef = useRef<Array<{ pitch: number | null; spectrum: number[]; rms: number }>>([]);
  const samplerTimerRef = useRef<any>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const activeShouldRunRef = useRef(false);
  const lastTriggerAtRef = useRef(0);

  const stopStandby = useCallback(() => {
    activeShouldRunRef.current = false;
    if (samplerTimerRef.current) {
      clearInterval(samplerTimerRef.current);
      samplerTimerRef.current = null;
    }
    if (recorderRef.current) {
      try {
        recorderRef.current.ondataavailable = null;
        recorderRef.current.onstop = null;
        if (recorderRef.current.state !== 'inactive') {
          recorderRef.current.stop();
        }
      } catch {}
      recorderRef.current = null;
    }
    if (micStreamRef.current) {
      micStreamRef.current.getTracks().forEach((t) => t.stop());
      micStreamRef.current = null;
    }
    if (audioCtxRef.current) {
      audioCtxRef.current.close().catch(() => {});
      audioCtxRef.current = null;
    }
  }, []);

  useEffect(() => {
    const shouldStandby =
      options.enabled &&
      !options.isMainListening &&
      !options.isAssistantSpeaking &&
      !options.isStreaming;

    if (!options.enabled) {
      stopStandby();
      setWakeStatus('off');
      return;
    }

    if (!shouldStandby) {
      stopStandby();
      return;
    }

    if (
      typeof navigator === 'undefined' ||
      !navigator.mediaDevices?.getUserMedia ||
      typeof MediaRecorder === 'undefined'
    ) {
      setWakeStatus('unsupported');
      return;
    }

    let cancelled = false;
    activeShouldRunRef.current = true;
    setWakeStatus('standby');

    const startSilentStandby = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });

        if (cancelled || !activeShouldRunRef.current) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }

        micStreamRef.current = stream;

        const AudioCtx =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        const ctx = new AudioCtx();
        if (ctx.state === 'suspended') {
          await ctx.resume().catch(() => {});
        }
        if (cancelled || !activeShouldRunRef.current) {
          ctx.close().catch(() => {});
          return;
        }
        audioCtxRef.current = ctx;
        const source = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 2048;
        source.connect(analyser);

        const timeBuf = new Float32Array(analyser.fftSize);
        const fftBuf = new Uint8Array(analyser.frequencyBinCount);

        let speakingActive = false;
        let speechStartedAt = 0;
        let lastLoudAt = 0;
        let checkingClip = false;
        let phraseChunks: BlobPart[] = [];

        const mime = MediaRecorder.isTypeSupported?.('audio/webm') ? 'audio/webm' : '';
        const startPhraseRecorder = () => {
          if (cancelled || !activeShouldRunRef.current || !micStreamRef.current) return;
          phraseChunks = [];
          try {
            const rec = mime
              ? new MediaRecorder(micStreamRef.current, { mimeType: mime })
              : new MediaRecorder(micStreamRef.current);
            rec.ondataavailable = (ev: BlobEvent) => {
              if (ev.data && ev.data.size > 0) {
                phraseChunks.push(ev.data);
              }
            };
            rec.onstop = async () => {
              const collected = [...phraseChunks];
              phraseChunks = [];
              if (cancelled || !activeShouldRunRef.current || collected.length === 0) {
                checkingClip = false;
                return;
              }
              const blob = new Blob(collected, { type: rec.mimeType || 'audio/webm' });
              if (blob.size < 900) {
                checkingClip = false;
                return;
              }

              try {
                const base64 = await blobToDataUrl(blob);
                const res = await fetch('/api/transcribe', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    audioBase64: base64,
                    mimeType: rec.mimeType || 'audio/webm',
                    language: languageRef.current,
                  }),
                });
                const data = res.ok ? await res.json() : null;
                const spokenText = (data?.text || '').trim();

                if (spokenText && matchesWakeWord(spokenText)) {
                  const vp = voicePrintRef.current;
                  if (vp && ringBufferRef.current.length >= 2) {
                    const validPitches = ringBufferRef.current
                      .map((f) => f.pitch)
                      .filter((p): p is number => p !== null);
                    const avgPitch =
                      validPitches.length > 0
                        ? validPitches.reduce((a, b) => a + b, 0) / validPitches.length
                        : null;
                    const avgSpec = new Array<number>(vp.spectralProfile.length).fill(0);
                    for (const f of ringBufferRef.current) {
                      for (let b = 0; b < avgSpec.length; b++) {
                        avgSpec[b] += f.spectrum[b] || 0;
                      }
                    }
                    const scoreRes = compareVoicePrints(vp, avgPitch, avgSpec);
                    setLastMatchScore(scoreRes.score);
                    if (scoreRes.score < 52) {
                      setWakeStatus('mismatch');
                      setTimeout(() => {
                        if (activeShouldRunRef.current) setWakeStatus('standby');
                      }, 1500);
                      checkingClip = false;
                      return;
                    }
                  }

                  lastTriggerAtRef.current = Date.now();
                  const inlineCmd = extractCommandAfterWakeWord(spokenText);
                  setWakeStatus('matched');
                  stopStandby();
                  onWakeRef.current(inlineCmd);
                  return;
                }
              } catch {
                // Ignore background standby check error silently
              } finally {
                checkingClip = false;
              }
            };
            recorderRef.current = rec;
            rec.start(200);
          } catch {
            checkingClip = false;
          }
        };

        samplerTimerRef.current = setInterval(() => {
          if (cancelled || !activeShouldRunRef.current) return;
          analyser.getFloatTimeDomainData(timeBuf);
          analyser.getByteFrequencyData(fftBuf);

          let sumSq = 0;
          for (let i = 0; i < timeBuf.length; i++) sumSq += timeBuf[i] * timeBuf[i];
          const rms = Math.sqrt(sumSq / timeBuf.length);
          const now = Date.now();

          if (rms > 0.0095) {
            const pitch = estimatePitchHz(timeBuf, ctx.sampleRate || 48000);
            const spectrum = computeSpectralFingerprint(fftBuf);
            ringBufferRef.current.push({ pitch, spectrum, rms });
            if (ringBufferRef.current.length > 14) {
              ringBufferRef.current.shift();
            }

            if (!speakingActive && !checkingClip && now - lastTriggerAtRef.current > 2500) {
              speakingActive = true;
              speechStartedAt = now;
              lastLoudAt = now;
              startPhraseRecorder();
            } else if (speakingActive) {
              lastLoudAt = now;
            }
          }

          if (speakingActive) {
            const quietMs = now - lastLoudAt;
            const totalMs = now - speechStartedAt;
            if (quietMs >= 650 || totalMs >= 2600) {
              speakingActive = false;
              checkingClip = true;
              if (recorderRef.current && recorderRef.current.state !== 'inactive') {
                try {
                  recorderRef.current.stop();
                } catch {
                  checkingClip = false;
                }
              } else {
                checkingClip = false;
              }
            }
          }
        }, 110);
      } catch (err: any) {
        if (err?.name === 'NotAllowedError' || err?.name === 'PermissionDeniedError') {
          setWakeStatus('denied-mic');
        } else {
          setWakeStatus('unsupported');
        }
        stopStandby();
      }
    };

    void startSilentStandby();

    return () => {
      cancelled = true;
      stopStandby();
    };
  }, [
    options.enabled,
    options.isMainListening,
    options.isAssistantSpeaking,
    options.isStreaming,
    stopStandby,
  ]);

  return {
    wakeStatus,
    lastMatchScore,
  };
}
