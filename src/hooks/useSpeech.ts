import { useState, useEffect, useRef, useCallback } from 'react';
import { classifySpeechError, combineSpeechTranscript } from '../utils/inputHelpers.ts';

export type PlaybackState = 'idle' | 'loading' | 'playing' | 'paused';

export interface VerifiedVoice {
  id: string;
  name: string;
  lang: string;
  isFemale: boolean;
  isNeural: boolean;
  provider: 'gemini' | 'browser' | 'edge';
  voiceURI?: string;
}

export function detectLanguage(text: string): 'hi' | 'hinglish' | 'en' {
  if (!text) return 'en';
  if (/[\u0900-\u097F]/.test(text)) {
    return 'hi';
  }
  const hinglishTokens =
    /\b(kya|hai|hain|batao|kaise|kaisa|kaisi|haan|nahi|mera|meri|mere|mujhe|hum|aap|tum|theek|shukriya|dost|namaste|achha|accha|karo|karna|raha|rahi|samajh|suno|bhai|bolo|khol|bana|likho)\b/i;
  if (hinglishTokens.test(text)) {
    return 'hinglish';
  }
  return 'en';
}

function selectSupportedRecorderMime(): string {
  if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') {
    return '';
  }
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4',
    'audio/ogg;codecs=opus',
  ];
  for (const mime of candidates) {
    if (MediaRecorder.isTypeSupported(mime)) {
      return mime;
    }
  }
  return '';
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve((reader.result as string) || '');
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

export function useSpeech(options?: {
  language?: string;
  voiceURI?: string;
  voiceTone?: string;
  rate?: number;
  pitch?: number;
  volume?: number;
  preferNeuralVoice?: boolean;
  onTranscriptComplete?: (transcript: string) => void;
}) {
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [interimTranscript, setInterimTranscript] = useState('');
  const [playbackState, setPlaybackState] = useState<PlaybackState>('idle');
  const [activeMessageId, setActiveMessageId] = useState<string | null>(null);
  const [speechSupported, setSpeechSupported] = useState({ stt: false, tts: false });
  const [speechError, setSpeechError] = useState<string | null>(null);

  const [verifiedVoices, setVerifiedVoices] = useState<VerifiedVoice[]>([]);
  const [activeVoiceName, setActiveVoiceName] = useState<string>(
    'ULTRON · Commanding Deep Power'
  );

  // Audio playback & real-time DotSphere analyzer refs
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceNodeRef = useRef<MediaElementAudioSourceNode | null>(null);
  const freqBufferRef = useRef<Uint8Array<ArrayBuffer> | null>(null);
  const playbackStateRef = useRef<PlaybackState>('idle');
  playbackStateRef.current = playbackState;

  // Silent MediaRecorder + Web Audio VAD capture refs (zero Android SpeechRecognizer 'tilic' chime!)
  const isListeningRef = useRef<boolean>(false);
  isListeningRef.current = isListening;
  const micStreamRef = useRef<MediaStream | null>(null);
  const micAudioCtxRef = useRef<AudioContext | null>(null);
  const micLevelRef = useRef<number>(0);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<BlobPart[]>([]);
  const vadTimerRef = useRef<any>(null);
  const maxCaptureTimerRef = useRef<any>(null);
  const captureCancelledRef = useRef<boolean>(false);
  const speechDetectedRef = useRef<boolean>(false);
  const lastSpeechAtRef = useRef<number>(0);
  const captureStartedAtRef = useRef<number>(0);
  const listenSeqRef = useRef<number>(0);

  const onCompleteRef = useRef(options?.onTranscriptComplete);
  onCompleteRef.current = options?.onTranscriptComplete;
  const languageRef = useRef(options?.language);
  languageRef.current = options?.language;
  const currentEndCallbackRef = useRef<(() => void) | null>(null);

  const rate = options?.rate ?? 1.0;
  const pitch = options?.pitch ?? 1.0;
  const volume = options?.volume ?? 1.0;
  const preferNeural = options?.preferNeuralVoice ?? true;

  const teardownSilentCapture = useCallback(() => {
    if (vadTimerRef.current) {
      clearInterval(vadTimerRef.current);
      vadTimerRef.current = null;
    }
    if (maxCaptureTimerRef.current) {
      clearTimeout(maxCaptureTimerRef.current);
      maxCaptureTimerRef.current = null;
    }
    if (recorderRef.current) {
      try {
        recorderRef.current.ondataavailable = null;
        recorderRef.current.onstop = null;
        recorderRef.current.onerror = null;
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
    if (micAudioCtxRef.current) {
      micAudioCtxRef.current.close().catch(() => {});
      micAudioCtxRef.current = null;
    }
    micLevelRef.current = 0;
  }, []);

  // Initialize Voices & Audio Element
  useEffect(() => {
    const hasSTT =
      typeof navigator !== 'undefined' &&
      !!navigator.mediaDevices?.getUserMedia &&
      typeof MediaRecorder !== 'undefined';
    const hasTTS = typeof window !== 'undefined' && 'speechSynthesis' in window;

    setSpeechSupported({ stt: hasSTT, tts: hasTTS });

    const updateVerifiedVoices = () => {
      const voiceList: VerifiedVoice[] = [
        {
          id: 'hi-IN-MadhurNeural',
          name: 'ULTRON · Commanding Deep Power',
          lang: 'Hindi / Hinglish / English',
          isFemale: false,
          isNeural: true,
          provider: 'edge',
          voiceURI: 'hi-IN-MadhurNeural',
        },
      ];

      if (hasTTS) {
        const browserVoices = window.speechSynthesis.getVoices();
        for (const v of browserVoices) {
          const lowerName = v.name.toLowerCase();
          const isFemale =
            lowerName.includes('female') ||
            lowerName.includes('samantha') ||
            lowerName.includes('victoria') ||
            lowerName.includes('zira') ||
            lowerName.includes('karen') ||
            lowerName.includes('moira') ||
            lowerName.includes('tessa') ||
            lowerName.includes('veena') ||
            lowerName.includes('swara') ||
            lowerName.includes('heera') ||
            lowerName.includes('leena') ||
            lowerName.includes('neerja') ||
            lowerName.includes('jenny') ||
            lowerName.includes('hindi') ||
            v.lang.startsWith('hi');

          const isNeural =
            lowerName.includes('natural') ||
            lowerName.includes('neural') ||
            lowerName.includes('google') ||
            lowerName.includes('online');

          voiceList.push({
            id: `browser-${v.voiceURI || v.name}-${v.lang}`,
            name: `${v.name} (${v.lang})`,
            lang: v.lang,
            isFemale,
            isNeural,
            provider: 'browser',
            voiceURI: v.voiceURI,
          });
        }
      }

      setVerifiedVoices(voiceList);
    };

    updateVerifiedVoices();
    if (hasTTS) {
      window.speechSynthesis.onvoiceschanged = updateVerifiedVoices;
    }

    const audio = new Audio();
    audio.crossOrigin = 'anonymous';
    audioRef.current = audio;

    audio.onended = () => {
      setPlaybackState('idle');
      setActiveMessageId(null);
      if (currentEndCallbackRef.current) {
        currentEndCallbackRef.current();
        currentEndCallbackRef.current = null;
      }
    };

    audio.onerror = (e) => {
      console.warn('Audio element error:', e);
      setPlaybackState('idle');
      setActiveMessageId(null);
      if (currentEndCallbackRef.current) {
        const cb = currentEndCallbackRef.current;
        currentEndCallbackRef.current = null;
        cb();
      }
    };

    return () => {
      captureCancelledRef.current = true;
      teardownSilentCapture();
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.src = '';
      }
      if (audioCtxRef.current) {
        try {
          audioCtxRef.current.close();
        } catch {}
      }
      if (hasTTS && window.speechSynthesis.speaking) {
        window.speechSynthesis.cancel();
      }
    };
  }, [teardownSilentCapture]);

  // Wire Web Audio AnalyserNode once per audio element for real-time voice reactivity
  const ensureAudioAnalyser = useCallback(() => {
    try {
      const audio = audioRef.current;
      if (!audio || typeof window === 'undefined') return;
      const AudioContextCtor =
        window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextCtor) return;

      if (!audioCtxRef.current) {
        audioCtxRef.current = new AudioContextCtor();
      }
      if (audioCtxRef.current.state === 'suspended') {
        audioCtxRef.current.resume().catch(() => {});
      }
      if (!sourceNodeRef.current) {
        const source = audioCtxRef.current.createMediaElementSource(audio);
        const analyser = audioCtxRef.current.createAnalyser();
        analyser.fftSize = 64;
        analyser.smoothingTimeConstant = 0.65;
        source.connect(analyser);
        analyser.connect(audioCtxRef.current.destination);
        sourceNodeRef.current = source;
        analyserRef.current = analyser;
        freqBufferRef.current = new Uint8Array(analyser.frequencyBinCount) as Uint8Array<ArrayBuffer>;
      }
    } catch {
      // Fallback safely to smooth voice cadence if AudioContext is restricted
    }
  }, []);

  // Returns normalized 0..1 live voice amplitude (both while ULTRON speaks AND while user speaks into Mic!)
  const getAudioLevel = useCallback((): number => {
    if (isListeningRef.current) {
      return micLevelRef.current;
    }

    if (playbackStateRef.current !== 'playing') {
      return 0;
    }

    if (analyserRef.current && freqBufferRef.current && audioRef.current && !audioRef.current.paused) {
      analyserRef.current.getByteFrequencyData(freqBufferRef.current);
      let sum = 0;
      const bins = Math.min(16, freqBufferRef.current.length);
      for (let i = 1; i < bins; i++) {
        sum += freqBufferRef.current[i];
      }
      const avg = sum / Math.max(1, bins - 1);
      const normalized = Math.min(1, avg / 115);
      if (normalized > 0.02) {
        return normalized;
      }
    }

    const now = performance.now() / 1000;
    const cadence =
      0.42 + 0.3 * Math.sin(now * 11.5) + 0.2 * Math.sin(now * 5.7) + 0.08 * Math.cos(now * 19);
    return Math.max(0.08, Math.min(0.92, cadence));
  }, []);

  const speakWithBrowserNative = useCallback(
    (text: string, targetLang: 'hi' | 'hinglish' | 'en', onEnd?: () => void) => {
      if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
        setSpeechError('Text-to-speech is not supported on this browser.');
        setPlaybackState('idle');
        return;
      }

      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = rate;
      utterance.pitch = Math.min(pitch, 0.85);
      utterance.volume = volume;

      const allVoices = window.speechSynthesis.getVoices();
      let chosenVoice: SpeechSynthesisVoice | undefined;

      if (options?.voiceURI) {
        chosenVoice = allVoices.find((v) => v.voiceURI === options.voiceURI);
      }

      if (!chosenVoice) {
        if (targetLang === 'hi' || targetLang === 'hinglish') {
          chosenVoice =
            allVoices.find(
              (v) =>
                v.lang.startsWith('hi') &&
                (v.name.toLowerCase().includes('male') ||
                  v.name.toLowerCase().includes('madhur') ||
                  v.name.toLowerCase().includes('prabhat') ||
                  v.name.toLowerCase().includes('google'))
            ) ||
            allVoices.find((v) => v.lang.startsWith('hi')) ||
            allVoices.find((v) => v.name.toLowerCase().includes('hindi'));
        }

        if (!chosenVoice) {
          chosenVoice =
            allVoices.find(
              (v) =>
                (v.name.includes('Christopher') ||
                  v.name.includes('Guy') ||
                  v.name.includes('Ryan') ||
                  v.name.includes('David') ||
                  v.name.includes('Daniel') ||
                  v.name.includes('Alex') ||
                  v.name.includes('Prabhat') ||
                  v.name.toLowerCase().includes('male')) &&
                v.lang.startsWith('en')
            ) ||
            allVoices.find((v) => v.lang.startsWith('en'));
        }
      }

      if (chosenVoice) {
        utterance.voice = chosenVoice;
        setActiveVoiceName(chosenVoice.name);
      }

      utterance.onstart = () => {
        setPlaybackState('playing');
      };

      utterance.onend = () => {
        setPlaybackState('idle');
        setActiveMessageId(null);
        if (onEnd) onEnd();
      };

      utterance.onerror = (e) => {
        console.warn('Browser TTS error:', e);
        setPlaybackState('idle');
        setActiveMessageId(null);
        if (e.error !== 'interrupted' && e.error !== 'canceled' && onEnd) {
          onEnd();
        }
      };

      window.speechSynthesis.speak(utterance);
    },
    [options?.voiceURI, rate, pitch, volume]
  );

  const play = useCallback(
    async (text: string, messageId?: string, onEnd?: () => void, customVoiceURI?: string) => {
      const strippedActions = text.replace(/\[ACTION:\s*\{[\s\S]*?\}\s*\]/gi, '');
      const cleanText = strippedActions
        .replace(/\[PDF:\s*\{[\s\S]*$/gi, '')
        .replace(/```[\s\S]*?```/g, ' code snippet ')
        .replace(/`([^`]+)`/g, '$1')
        .replace(/\$\$[\s\S]*?\$\$/g, ' formula ')
        .replace(/\$([^$]+)\$/g, '$1')
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
        .replace(/[*#_~>]/g, '')
        .trim();

      if (!cleanText) return;

      const detectedLang = detectLanguage(cleanText);

      if (audioRef.current) {
        audioRef.current.pause();
      }
      if (typeof window !== 'undefined' && window.speechSynthesis) {
        window.speechSynthesis.cancel();
      }

      setPlaybackState('loading');
      if (messageId) {
        setActiveMessageId(messageId);
      }
      currentEndCallbackRef.current = onEnd || null;

      if (preferNeural) {
        try {
          const res = await fetch('/api/tts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              text: cleanText,
              voiceName: customVoiceURI || options?.voiceURI || 'hi-IN-MadhurNeural',
              voiceTone: options?.voiceTone || 'commanding-deep',
            }),
          });

          if (res.ok) {
            const data = await res.json();
            if (data.success && data.audioBase64) {
              const format = data.format || 'audio/mpeg';
              const audioSrc = `data:${format};base64,${data.audioBase64}`;
              if (audioRef.current) {
                ensureAudioAnalyser();
                audioRef.current.src = audioSrc;
                audioRef.current.playbackRate = rate;
                audioRef.current.volume = volume;
                setActiveVoiceName(data.voice || 'ULTRON · Commanding Deep Power');
                await audioRef.current.play();
                setPlaybackState('playing');
                return;
              }
            } else if (data.fallbackToBrowser) {
              speakWithBrowserNative(cleanText, detectedLang, onEnd);
              return;
            }
          }
        } catch {
          // Seamlessly fall back to browser native voice
        }
      }

      speakWithBrowserNative(cleanText, detectedLang, onEnd);
    },
    [preferNeural, rate, volume, options?.voiceURI, options?.voiceTone, ensureAudioAnalyser, speakWithBrowserNative]
  );

  const pause = useCallback(() => {
    if (audioRef.current && !audioRef.current.paused) {
      audioRef.current.pause();
      setPlaybackState('paused');
      return;
    }
    if (typeof window !== 'undefined' && window.speechSynthesis?.speaking) {
      window.speechSynthesis.pause();
      setPlaybackState('paused');
    }
  }, []);

  const resume = useCallback(() => {
    if (audioRef.current && audioRef.current.paused && audioRef.current.src) {
      audioRef.current
        .play()
        .then(() => {
          setPlaybackState('playing');
        })
        .catch((err) => {
          console.warn('Resume audio error:', err);
        });
      return;
    }
    if (typeof window !== 'undefined' && window.speechSynthesis?.paused) {
      window.speechSynthesis.resume();
      setPlaybackState('playing');
    }
  }, []);

  const stop = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    setPlaybackState('idle');
    setActiveMessageId(null);
    currentEndCallbackRef.current = null;
  }, []);

  const finalizeAndTranscribe = useCallback(
    async (chunks: BlobPart[], mimeType: string) => {
      if (captureCancelledRef.current) return;
      const blob = new Blob(chunks, { type: mimeType || 'audio/webm' });
      if (blob.size < 450) {
        setTranscript('');
        setInterimTranscript('');
        return;
      }

      try {
        setInterimTranscript('Processing voice...');
        const base64 = await blobToBase64(blob);
        if (captureCancelledRef.current) {
          setInterimTranscript('');
          return;
        }

        const res = await fetch('/api/transcribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            audioBase64: base64,
            mimeType: mimeType || 'audio/webm',
            language: languageRef.current,
          }),
        });

        setInterimTranscript('');
        if (!res.ok) {
          throw new Error('Could not transcribe voice audio.');
        }

        const data = await res.json();
        const spoken = combineSpeechTranscript('', data?.text || '');
        if (spoken && onCompleteRef.current && !captureCancelledRef.current) {
          setTranscript('');
          onCompleteRef.current(spoken);
        }
      } catch (err: any) {
        console.warn('Silent STT error:', err);
        setInterimTranscript('');
        setSpeechError('Could not process voice. Please speak clearly or type below.');
      }
    },
    []
  );

  const stopListening = useCallback(() => {
    if (vadTimerRef.current) {
      clearInterval(vadTimerRef.current);
      vadTimerRef.current = null;
    }
    if (maxCaptureTimerRef.current) {
      clearTimeout(maxCaptureTimerRef.current);
      maxCaptureTimerRef.current = null;
    }

    setIsListening(false);
    isListeningRef.current = false;
    micLevelRef.current = 0;

    const rec = recorderRef.current;
    recorderRef.current = null;

    if (rec && rec.state !== 'inactive') {
      try {
        rec.stop();
      } catch {
        teardownSilentCapture();
      }
    } else {
      teardownSilentCapture();
    }
  }, [teardownSilentCapture]);

  const cancelListening = useCallback(() => {
    listenSeqRef.current += 1;
    captureCancelledRef.current = true;
    recordedChunksRef.current = [];
    setIsListening(false);
    isListeningRef.current = false;
    setTranscript('');
    setInterimTranscript('');
    teardownSilentCapture();
  }, [teardownSilentCapture]);

  const startListening = useCallback(async () => {
    const seq = ++listenSeqRef.current;
    setSpeechError(null);
    setTranscript('');
    setInterimTranscript('');

    if (
      typeof navigator === 'undefined' ||
      !navigator.mediaDevices?.getUserMedia ||
      typeof MediaRecorder === 'undefined'
    ) {
      setIsListening(false);
      isListeningRef.current = false;
      setSpeechError('Microphone recording is not supported in this browser. Please type your message below.');
      return;
    }

    // Stop any playing TTS and previous capture cleanly without clobbering our new seq
    stop();
    captureCancelledRef.current = true;
    teardownSilentCapture();
    captureCancelledRef.current = false;
    speechDetectedRef.current = false;
    recordedChunksRef.current = [];
    captureStartedAtRef.current = Date.now();
    lastSpeechAtRef.current = Date.now();

    try {
      // Pure silent MediaDevices capture — completely eliminates YouTube/Google SpeechRecognizer 'tilic' sound!
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      if (captureCancelledRef.current || seq !== listenSeqRef.current) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }

      micStreamRef.current = stream;

      const mimeType = selectSupportedRecorderMime();
      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);

      const activeMime = recorder.mimeType || mimeType || 'audio/webm';
      recorder.ondataavailable = (ev: BlobEvent) => {
        if (ev.data && ev.data.size > 0) {
          recordedChunksRef.current.push(ev.data);
        }
      };

      recorder.onerror = () => {
        setIsListening(false);
        isListeningRef.current = false;
        teardownSilentCapture();
        setSpeechError('Microphone recording interrupted. Tap Mic again or type below.');
      };

      recorder.onstop = () => {
        const chunks = [...recordedChunksRef.current];
        recordedChunksRef.current = [];
        if (micStreamRef.current) {
          micStreamRef.current.getTracks().forEach((t) => t.stop());
          micStreamRef.current = null;
        }
        if (micAudioCtxRef.current) {
          micAudioCtxRef.current.close().catch(() => {});
          micAudioCtxRef.current = null;
        }
        micLevelRef.current = 0;

        if (!captureCancelledRef.current && chunks.length > 0) {
          void finalizeAndTranscribe(chunks, activeMime);
        }
      };

      recorderRef.current = recorder;
      recorder.start(250);
      setIsListening(true);
      isListeningRef.current = true;

      // Live Web Audio analyser for DotSphere reactivity + automatic end-of-speech silence stop
      try {
        const AudioCtx =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        if (AudioCtx) {
          const ctx = new AudioCtx();
          if (ctx.state === 'suspended') {
            await ctx.resume().catch(() => {});
          }
          if (captureCancelledRef.current || seq !== listenSeqRef.current) {
            ctx.close().catch(() => {});
            return;
          }
          micAudioCtxRef.current = ctx;
          const src = ctx.createMediaStreamSource(stream);
          const analyser = ctx.createAnalyser();
          analyser.fftSize = 512;
          analyser.smoothingTimeConstant = 0.5;
          src.connect(analyser);

          const timeData = new Float32Array(analyser.fftSize);
          vadTimerRef.current = setInterval(() => {
            if (!isListeningRef.current || captureCancelledRef.current) return;
            analyser.getFloatTimeDomainData(timeData);
            let sumSq = 0;
            for (let i = 0; i < timeData.length; i++) {
              sumSq += timeData[i] * timeData[i];
            }
            const rms = Math.sqrt(sumSq / timeData.length);
            const normalizedLevel = Math.min(1, rms * 5.8);
            micLevelRef.current = normalizedLevel;

            const now = Date.now();
            if (rms > 0.0095) {
              speechDetectedRef.current = true;
              lastSpeechAtRef.current = now;
            } else if (speechDetectedRef.current && now - lastSpeechAtRef.current >= 2200) {
              // Natural pause after speaking -> auto-stop silently & transcribe
              stopListening();
            } else if (!speechDetectedRef.current && now - captureStartedAtRef.current >= 14000) {
              // Auto-close idle mic after 14s of complete silence
              cancelListening();
            }
          }, 90);
        }
      } catch {
        // Still works seamlessly if AudioContext is restricted — user taps Mic again to send
      }

      // Hard safety ceiling (75s long command limit)
      maxCaptureTimerRef.current = setTimeout(() => {
        if (isListeningRef.current) {
          stopListening();
        }
      }, 75000);
    } catch (err: any) {
      console.warn('Silent mic start error:', err);
      teardownSilentCapture();
      setIsListening(false);
      isListeningRef.current = false;

      const errCode =
        err?.name === 'NotAllowedError' || err?.name === 'PermissionDeniedError'
          ? 'not-allowed'
          : err?.name === 'NotFoundError' || err?.name === 'DevicesNotFoundError'
          ? 'audio-capture'
          : 'audio-capture';
      const resolved = classifySpeechError(errCode);
      setSpeechError(
        resolved.userMessage || 'Could not access microphone. Allow mic permission or type below.'
      );
    }
  }, [stop, teardownSilentCapture, finalizeAndTranscribe, stopListening, cancelListening]);

  return {
    isListening,
    transcript,
    interimTranscript,
    startListening,
    stopListening,
    cancelListening,
    playbackState,
    activeMessageId,
    activeVoiceName,
    getAudioLevel,
    play,
    pause,
    resume,
    stop,
    verifiedVoices,
    speechSupported,
    speechError,
    clearError: () => setSpeechError(null),
  };
}
