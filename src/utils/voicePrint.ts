export interface VoicePrintProfile {
  id: string;
  label: string;
  createdAt: number;
  fundamentalHz: number;
  spectralProfile: number[]; // 16-band L2-normalized vocal formant/timbre vector
  energyThreshold: number;
  sampleCount: number;
}

export interface VoiceMatchResult {
  matched: boolean;
  score: number; // 0..100
  cosineSimilarity: number; // 0..1
  pitchDiffRatio: number;
}

const BAND_COUNT = 16;

/**
 * Computes root-mean-square amplitude of a PCM audio frame.
 */
export function computeRms(samples: Float32Array): number {
  if (!samples || samples.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) {
    sum += samples[i] * samples[i];
  }
  return Math.sqrt(sum / samples.length);
}

/**
 * Estimates fundamental vocal pitch (F0 in Hz) using normalized autocorrelation.
 * Valid human speaking range: ~75 Hz to 350 Hz. Returns null for silence or unvoiced noise.
 */
export function estimatePitchHz(samples: Float32Array, sampleRate = 48000): number | null {
  if (!samples || samples.length < 512) return null;

  const rms = computeRms(samples);
  if (rms < 0.012) return null;

  const minLag = Math.max(20, Math.floor(sampleRate / 350));
  const maxLag = Math.min(Math.floor(samples.length / 2), Math.floor(sampleRate / 75));
  if (maxLag <= minLag) return null;

  // Remove DC offset
  let mean = 0;
  for (let i = 0; i < samples.length; i++) mean += samples[i];
  mean /= samples.length;

  const corrs = new Float32Array(maxLag + 1);
  let bestLag = -1;
  let bestCorr = 0;

  for (let lag = minLag; lag <= maxLag; lag++) {
    let num = 0;
    let denA = 0;
    let denB = 0;
    const limit = samples.length - lag;

    for (let i = 0; i < limit; i++) {
      const a = samples[i] - mean;
      const b = samples[i + lag] - mean;
      num += a * b;
      denA += a * a;
      denB += b * b;
    }

    const denom = Math.sqrt(denA * denB);
    const corr = denom > 1e-8 ? num / denom : 0;
    corrs[lag] = corr;
    if (corr > bestCorr) {
      bestCorr = corr;
      bestLag = lag;
    }
  }

  if (bestLag <= 0 || bestCorr < 0.42) {
    return null;
  }

  // Octave-error guard: pick the first strong local peak (true fundamental F0 rather than 2*T subharmonic)
  const threshold = Math.max(0.55, bestCorr * 0.92);
  let chosenLag = bestLag;
  for (let lag = minLag + 1; lag < maxLag; lag++) {
    if (corrs[lag] >= threshold && corrs[lag] >= corrs[lag - 1] && corrs[lag] >= corrs[lag + 1]) {
      chosenLag = lag;
      break;
    }
  }

  return Number((sampleRate / chosenLag).toFixed(1));
}

/**
 * Compresses an FFT magnitude spectrum (uint8 0..255 or float magnitudes)
 * into a 16-band L2-normalized vocal formant/timbre vector.
 */
export function computeSpectralFingerprint(fftMagnitudes: ArrayLike<number>): number[] {
  const len = fftMagnitudes?.length || 0;
  const bands = new Array<number>(BAND_COUNT).fill(0);
  if (len === 0) return bands;

  // Focus on lower/mid vocal frequencies (~first 45% of Nyquist bins) where pitch/formants live
  const usableBins = Math.max(BAND_COUNT, Math.floor(len * 0.45));
  const binsPerBand = usableBins / BAND_COUNT;

  for (let b = 0; b < BAND_COUNT; b++) {
    const start = Math.floor(b * binsPerBand);
    const end = Math.max(start + 1, Math.min(len, Math.floor((b + 1) * binsPerBand)));
    let sum = 0;
    for (let k = start; k < end; k++) {
      sum += fftMagnitudes[k] || 0;
    }
    bands[b] = sum / (end - start);
  }

  return l2Normalize(bands);
}

export function l2Normalize(vec: number[]): number[] {
  let normSq = 0;
  for (let i = 0; i < vec.length; i++) {
    normSq += vec[i] * vec[i];
  }
  const norm = Math.sqrt(normSq);
  if (norm < 1e-8) return vec.map(() => 0);
  return vec.map((v) => Number((v / norm).toFixed(5)));
}

export function cosineSimilarity(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n === 0) return 0;
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  const denom = Math.sqrt(magA * magB);
  if (denom < 1e-8) return 0;
  return Math.max(0, Math.min(1, dot / denom));
}

/**
 * Builds a persistent acoustic VoicePrintProfile from recorded microphone frames.
 */
export function buildVoicePrintProfile(
  timeFrames: Float32Array[],
  fftFrames: ArrayLike<number>[],
  sampleRate = 48000,
  label = 'My Voice Print'
): VoicePrintProfile {
  const pitches: number[] = [];
  const spectralAcc = new Array<number>(BAND_COUNT).fill(0);
  let validSpectralCount = 0;
  let maxRms = 0;

  for (let i = 0; i < timeFrames.length; i++) {
    const frame = timeFrames[i];
    const rms = computeRms(frame);
    if (rms > maxRms) maxRms = rms;
    if (rms < 0.015) continue;

    const pitch = estimatePitchHz(frame, sampleRate);
    if (pitch !== null) {
      pitches.push(pitch);
    }

    const fft = fftFrames[i];
    if (fft && fft.length > 0) {
      const vec = computeSpectralFingerprint(fft);
      const hasEnergy = vec.some((v) => v > 0);
      if (hasEnergy) {
        for (let b = 0; b < BAND_COUNT; b++) {
          spectralAcc[b] += vec[b];
        }
        validSpectralCount++;
      }
    }
  }

  if (validSpectralCount < 3 || pitches.length < 2) {
    throw new Error(
      'Voice sample was too quiet or short. Please speak "Hi ULTRON" clearly for 2-3 seconds near the mic.'
    );
  }

  // Use median fundamental frequency for outlier resistance
  pitches.sort((a, b) => a - b);
  const medianPitch = pitches[Math.floor(pitches.length / 2)];
  const avgSpectral = l2Normalize(spectralAcc.map((v) => v / validSpectralCount));

  return {
    id: `vp_${Date.now()}`,
    label: label.trim() || 'My Voice Print',
    createdAt: Date.now(),
    fundamentalHz: Number(medianPitch.toFixed(1)),
    spectralProfile: avgSpectral,
    energyThreshold: Number(Math.max(0.015, Math.min(0.08, maxRms * 0.25)).toFixed(4)),
    sampleCount: validSpectralCount,
  };
}

/**
 * Compares live microphone acoustic features against a saved VoicePrintProfile.
 */
export function compareVoicePrints(
  enrolled: VoicePrintProfile,
  candidatePitchHz: number | null,
  candidateSpectrum: number[]
): VoiceMatchResult {
  const cos = cosineSimilarity(enrolled.spectralProfile, candidateSpectrum);

  let pitchFactor = 0.85; // neutral weight if pitch wasn't resolvable on short syllable
  let pitchDiffRatio = 0;

  if (candidatePitchHz && candidatePitchHz > 50 && enrolled.fundamentalHz > 50) {
    pitchDiffRatio = Math.abs(candidatePitchHz - enrolled.fundamentalHz) / enrolled.fundamentalHz;
    // Allow +-28% natural intonation swing while penalizing sharp speaker F0 shifts
    pitchFactor = Math.max(0, Math.min(1, 1 - Math.max(0, pitchDiffRatio - 0.1) / 0.45));
  }

  const combined = cos * 0.72 + pitchFactor * 0.28;
  const score = Math.round(combined * 100);

  return {
    matched: score >= 68,
    score,
    cosineSimilarity: Number(cos.toFixed(3)),
    pitchDiffRatio: Number(pitchDiffRatio.toFixed(3)),
  };
}

const WAKE_WORD_REGEX =
  /\b(?:hi+|hey+|hello+|ok(?:ay)?|suno|hii+|oye)\s*,?\s*(?:u\.?l\.?t\.?r\.?o\.?n\.?|ultron|altron|oltron|ultra|अल्ट्रॉन|अल्ट्रान|अल्ट्रा)\b|\b(?:अल्ट्रॉन|अल्ट्रान|ultron)\s+(?:suno|sun|open|kholo|batao|help)\b|(?:हाय|हे|हेलो|ओके|सुनो)\s*,?\s*(?:अल्ट्रॉन|अल्ट्रान)/i;

/**
 * Detects whether a speech transcript contains the "Hi ULTRON" wake phrase
 * across English, Hindi (Devanagari), and Hinglish STT variations.
 */
export function matchesWakeWord(transcript: string): boolean {
  if (!transcript || !transcript.trim()) return false;
  return WAKE_WORD_REGEX.test(transcript.trim());
}

/**
 * Extracts any spoken command that followed immediately after "Hi ULTRON"
 * (e.g., "Hi ULTRON WhatsApp kholo" -> "WhatsApp kholo").
 */
export function extractCommandAfterWakeWord(transcript: string): string {
  if (!transcript) return '';
  const cleaned = transcript
    .replace(WAKE_WORD_REGEX, ' ')
    .replace(/^[\s,.:;!?-]+/, '')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned;
}
