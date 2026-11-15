import { spawn } from 'node:child_process';
import fs from 'node:fs';

export type VoiceTonePresetKey = 'commanding-deep' | 'confident-bold' | 'razor-sharp';

export interface TtsVoicePreset {
  voiceName: string;
  englishVoiceName: string;
  voiceLabel: string;
  pitch: string;
  rate: string;
  volume: string;
  warmEq: boolean;
}

// Default: Powerful, Commanding, Deep & Confident ULTRON Voice (Heavy Presence)
export const ULTRON_POWER_VOICE_PRESET: TtsVoicePreset = {
  voiceName: 'hi-IN-MadhurNeural',
  englishVoiceName: 'en-US-ChristopherNeural',
  voiceLabel: 'ULTRON · Commanding Deep Power',
  pitch: '-14Hz',
  rate: '-4%',
  volume: '+0%',
  warmEq: true,
};

export const EDITH_WARM_VOICE_PRESET = ULTRON_POWER_VOICE_PRESET;

export function resolveVoiceTonePreset(tone?: string): TtsVoicePreset {
  switch (tone) {
    case 'confident-bold':
      return {
        ...ULTRON_POWER_VOICE_PRESET,
        englishVoiceName: 'en-IN-PrabhatNeural',
        voiceLabel: 'ULTRON · Confident Indian Baritone',
        pitch: '-10Hz',
        rate: '-1%',
        warmEq: true,
      };
    case 'razor-sharp':
      return {
        ...ULTRON_POWER_VOICE_PRESET,
        englishVoiceName: 'en-GB-RyanNeural',
        voiceLabel: 'ULTRON · Razor Sharp Executive',
        pitch: '-6Hz',
        rate: '+2%',
        warmEq: true,
      };
    case 'commanding-deep':
    default:
      return ULTRON_POWER_VOICE_PRESET;
  }
}

/**
 * Cleans markdown, LaTeX, code blocks, and action/PDF tags so TTS speaks smoothly and naturally.
 */
export function cleanTextForSpeech(rawText: string): string {
  if (!rawText || typeof rawText !== 'string') return '';

  return rawText
    // Strip internal device action & PDF payloads
    .replace(/\[ACTION:[\s\S]*?\]/g, '')
    .replace(/\[PDF:[\s\S]*?\]/g, '')
    // Replace code blocks gently
    .replace(/```[\s\S]*?```/g, ' code snippet ')
    .replace(/`([^`]+)`/g, '$1')
    // Make formulas concise instead of reading raw LaTeX backslashes aloud
    .replace(/\$\$([\s\S]*?)\$\$/g, ' formula ')
    .replace(/\$([^$]+)\$/g, '$1')
    // Keep link text, drop URLs
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    // Strip markdown formatting symbols
    .replace(/[*#_~>|]/g, ' ')
    // Normalize excessive whitespace & newlines into natural sentence pauses
    .replace(/\n{2,}/g, '. ')
    .replace(/\n+/g, ', ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Escapes/strips characters that can break or stall XML/SSML synthesis inside Edge TTS
 * while preserving full Hindi Devanagari, Latin, numbers, and natural punctuation.
 */
export function escapeForEdgeTts(text: string): string {
  return text
    // Remove control chars, zero-width chars, and non-BMP emojis that can stall Edge SSML streams
    .replace(/[\u0000-\u001F\u007F\u200B-\u200F\uFEFF]/g, ' ')
    .replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, ' ')
    .replace(/&/g, ' and ')
    .replace(/</g, ' ')
    .replace(/>/g, ' ')
    .replace(/"/g, '')
    .replace(/'/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Splits cleaned speech text into natural sentence-bounded chunks so Edge Neural TTS
 * synthesizes each chunk in ~1s and never times out on long AI responses.
 */
export function splitSpeechIntoChunks(
  text: string,
  maxChunkChars = 280,
  maxTotalChars = 2400
): string[] {
  const safe = escapeForEdgeTts(text);
  if (!safe) return [];

  const clipped = safe.length > maxTotalChars
    ? safe.slice(0, maxTotalChars).replace(/[,;\s]+\S*$/, '').trim()
    : safe;

  const sentences = clipped.match(/[^.!?।\n]+[.!?।\n]*/g) || [clipped];
  const chunks: string[] = [];
  let current = '';

  for (const rawSentence of sentences) {
    const s = rawSentence.trim();
    if (!s) continue;

    if (s.length > maxChunkChars) {
      if (current) {
        chunks.push(current);
        current = '';
      }
      const words = s.split(/\s+/);
      let sub = '';
      for (const w of words) {
        if ((sub ? `${sub} ${w}` : w).length <= maxChunkChars) {
          sub = sub ? `${sub} ${w}` : w;
        } else {
          if (sub) chunks.push(sub);
          sub = w.length > maxChunkChars ? w.slice(0, maxChunkChars) : w;
        }
      }
      if (sub) current = sub;
      continue;
    }

    const candidate = current ? `${current} ${s}` : s;
    if (candidate.length <= maxChunkChars) {
      current = candidate;
    } else {
      if (current) chunks.push(current);
      current = s;
    }
  }

  if (current) chunks.push(current);
  return chunks.filter((c) => c.trim().length > 0);
}

/**
 * Detects whether text is Hindi (Devanagari), Hinglish, or English.
 */
export function detectSpeechLanguage(text: string): 'hi' | 'hinglish' | 'en' {
  if (!text) return 'en';
  if (/[\u0900-\u097F]/.test(text)) {
    return 'hi';
  }
  const hasHinglishTokens =
    /\b(kya|hai|hain|batao|kaise|kaisa|kaisi|haan|nahi|nhi|mera|meri|mere|mujhe|hum|aap|tum|theek|shukriya|dost|namaste|achha|accha|karo|karna|raha|rahi|samajh|pyar|pyari|jaan|baba|yaar|sun|suno|dekho|bolo|banao|pdf|kholo|chalao)\b/i.test(
      text
    );
  return hasHinglishTokens ? 'hinglish' : 'en';
}

/**
 * Selects the deepest, most commanding neural voice for the detected language.
 */
export function selectEdgeVoiceForLanguage(
  lang: 'hi' | 'hinglish' | 'en',
  preset: TtsVoicePreset = ULTRON_POWER_VOICE_PRESET
): string {
  return lang === 'en' ? preset.englishVoiceName : preset.voiceName;
}

const FFMPEG_BIN = '/usr/bin/ffmpeg';

/**
 * Applies heavy cinematic sub-bass chest authority, crisp presence, and punchy compression
 * using ffmpeg so ULTRON's voice sounds commanding, confident, and heavyweight.
 */
export async function applyStudioVocalWarmth(inputMp3: Buffer): Promise<Buffer> {
  if (!inputMp3 || inputMp3.length === 0) return inputMp3;
  if (!fs.existsSync(FFMPEG_BIN)) return inputMp3;

  return new Promise<Buffer>((resolve) => {
    const filterChain = [
      'highpass=f=55',
      'equalizer=f=115:width_type=h:width=90:g=4.8',
      'equalizer=f=240:width_type=h:width=140:g=2.8',
      'equalizer=f=3200:width_type=h:width=1200:g=1.8',
      'equalizer=f=6800:width_type=h:width=1800:g=-1.5',
      'acompressor=threshold=-16dB:ratio=2.8:attack=8:release=110:makeup=2.2',
      'alimiter=limit=0.96',
    ].join(',');

    const proc = spawn(
      FFMPEG_BIN,
      [
        '-hide_banner',
        '-loglevel',
        'error',
        '-f',
        'mp3',
        '-i',
        'pipe:0',
        '-af',
        filterChain,
        '-codec:a',
        'libmp3lame',
        '-b:a',
        '128k',
        '-f',
        'mp3',
        'pipe:1',
      ],
      { stdio: ['pipe', 'pipe', 'ignore'] }
    );

    const outChunks: Buffer[] = [];
    let settled = false;

    const finish = (buf: Buffer) => {
      if (settled) return;
      settled = true;
      resolve(buf);
    };

    const timer = setTimeout(() => {
      try {
        proc.kill('SIGKILL');
      } catch {}
      finish(inputMp3);
    }, 10000);

    proc.stdout.on('data', (chunk: Buffer) => outChunks.push(chunk));
    proc.on('error', () => {
      clearTimeout(timer);
      finish(inputMp3);
    });
    proc.on('close', (code) => {
      clearTimeout(timer);
      const out = Buffer.concat(outChunks);
      if (code === 0 && out.length > 500) {
        finish(out);
      } else {
        finish(inputMp3);
      }
    });

    try {
      proc.stdin.write(inputMp3);
      proc.stdin.end();
    } catch {
      clearTimeout(timer);
      finish(inputMp3);
    }
  });
}
