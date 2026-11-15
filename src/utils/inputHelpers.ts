export interface SpeechErrorResolution {
  isTerminal: boolean;
  shouldRetry: boolean;
  userMessage: string | null;
}

/**
 * Classifies Web SpeechRecognition error codes so the microphone hook never gets
 * stuck in a frozen listening loop on desktop or mobile browsers.
 */
export function classifySpeechError(errorCode: string): SpeechErrorResolution {
  switch (errorCode) {
    case 'not-allowed':
    case 'service-not-allowed':
      return {
        isTerminal: true,
        shouldRetry: false,
        userMessage: 'Microphone permission denied. Please allow mic access in browser settings.',
      };
    case 'audio-capture':
      return {
        isTerminal: true,
        shouldRetry: false,
        userMessage: 'Microphone hardware is busy or unavailable. Close other audio apps and tap Mic again.',
      };
    case 'network':
      return {
        isTerminal: true,
        shouldRetry: false,
        userMessage: 'Voice recognition network error. Check your internet connection or type below.',
      };
    case 'aborted':
      return {
        isTerminal: true,
        shouldRetry: false,
        userMessage: null,
      };
    case 'no-speech':
      return {
        isTerminal: false,
        shouldRetry: true,
        userMessage: null,
      };
    default:
      return {
        isTerminal: true,
        shouldRetry: false,
        userMessage: null,
      };
  }
}

/**
 * Combines finalized and interim speech transcripts cleanly without stray extra whitespace.
 */
export function combineSpeechTranscript(finalChunk: string, interimChunk: string): string {
  const f = finalChunk.trim();
  const i = interimChunk.trim();
  if (f && i) return `${f} ${i}`;
  return f || i;
}
