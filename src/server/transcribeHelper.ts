const WHISPER_SILENCE_ARTIFACTS = new Set([
  'thank you',
  'thank you.',
  'thanks for watching',
  'thanks for watching.',
  'thank you for watching',
  'thank you for watching.',
  'you',
  'you.',
  'bye',
  'bye.',
  '...',
  'subtitles by the amara.org community',
]);

/**
 * Strips known Whisper hallucination artifacts on silent audio clips and trims whitespace.
 */
export function sanitizeWhisperTranscript(rawText: string): string {
  const cleaned = (rawText || '')
    .replace(/\[(?:music|silence|applause|blank_audio|inaudible)\]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!cleaned) return '';
  if (WHISPER_SILENCE_ARTIFACTS.has(cleaned.toLowerCase())) {
    return '';
  }
  return cleaned;
}

/**
 * Maps browser MediaRecorder MIME strings to clean file extensions for Whisper uploads.
 */
export function extensionForAudioMime(mimeType?: string): string {
  const lower = (mimeType || '').toLowerCase();
  if (lower.includes('mp4') || lower.includes('m4a') || lower.includes('aac')) return 'm4a';
  if (lower.includes('ogg')) return 'ogg';
  if (lower.includes('wav')) return 'wav';
  if (lower.includes('mpeg') || lower.includes('mp3')) return 'mp3';
  return 'webm';
}
