import test from 'node:test';
import assert from 'node:assert/strict';
import {
  estimatePitchHz,
  computeSpectralFingerprint,
  buildVoicePrintProfile,
  compareVoicePrints,
  matchesWakeWord,
  extractCommandAfterWakeWord,
} from './voicePrint';

function makeHarmonicVoiceWave(freqHz: number, sampleRate = 48000, length = 2048, amplitude = 0.25): Float32Array {
  const arr = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    const t = i / sampleRate;
    arr[i] =
      amplitude *
      (0.7 * Math.sin(2 * Math.PI * freqHz * t) +
        0.22 * Math.sin(2 * Math.PI * freqHz * 2 * t) +
        0.08 * Math.sin(2 * Math.PI * freqHz * 3 * t));
  }
  return arr;
}

function makeSpectrumFromPeaks(peaks: number[]): Float32Array {
  const bins = new Float32Array(128);
  for (let i = 0; i < bins.length; i++) {
    bins[i] = peaks[i % peaks.length];
  }
  return bins;
}

test('estimatePitchHz accurately detects synthetic human fundamental frequencies and rejects silence', () => {
  const silence = new Float32Array(2048);
  assert.equal(estimatePitchHz(silence, 48000), null);

  const maleVoice = makeHarmonicVoiceWave(132, 48000, 2048);
  const estMale = estimatePitchHz(maleVoice, 48000);
  assert.ok(estMale && Math.abs(estMale - 132) < 4);

  const femaleVoice = makeHarmonicVoiceWave(225, 48000, 2048);
  const estFemale = estimatePitchHz(femaleVoice, 48000);
  assert.ok(estFemale && Math.abs(estFemale - 225) < 6);
});

test('buildVoicePrintProfile & compareVoicePrints match the same speaker and reject mismatched speaker profiles', () => {
  const sr = 48000;
  const jagjitFrames = Array.from({ length: 6 }, () => makeHarmonicVoiceWave(135, sr));
  const jagjitSpectrum = makeSpectrumFromPeaks([180, 160, 130, 90, 50, 25, 15, 10]);
  const jagjitFfts = Array.from({ length: 6 }, () => jagjitSpectrum);

  const profile = buildVoicePrintProfile(jagjitFrames, jagjitFfts, sr, 'Jagjit');
  assert.ok(Math.abs(profile.fundamentalHz - 135) < 5);
  assert.equal(profile.spectralProfile.length, 16);

  // Same speaker speaks slightly naturally varied (+4 Hz)
  const sameSpeakerMatch = compareVoicePrints(
    profile,
    139,
    computeSpectralFingerprint(makeSpectrumFromPeaks([175, 158, 128, 92, 52, 26, 16, 11]))
  );
  assert.equal(sameSpeakerMatch.matched, true);
  assert.ok(sameSpeakerMatch.score >= 85);

  // Different speaker with much higher pitch & shifted vocal formant envelope
  const otherSpeakerMatch = compareVoicePrints(
    profile,
    255,
    computeSpectralFingerprint(makeSpectrumFromPeaks([10, 15, 20, 40, 140, 200, 180, 150]))
  );
  assert.equal(otherSpeakerMatch.matched, false);
  assert.ok(otherSpeakerMatch.score < 68);
});

test('matchesWakeWord detects "Hi ULTRON" in English, Hinglish, and Hindi including common STT variants', () => {
  assert.equal(matchesWakeWord('Hi ULTRON'), true);
  assert.equal(matchesWakeWord('hey ultron please open whatsapp'), true);
  assert.equal(matchesWakeWord('Hello Altron, aaj ka mausam batao'), true);
  assert.equal(matchesWakeWord('hi ultra youtube chalao'), true);
  assert.equal(matchesWakeWord('हाय अल्ट्रॉन'), true);
  assert.equal(matchesWakeWord('हे अल्ट्रॉन गूगल मैप्स खोलो'), true);
  assert.equal(matchesWakeWord('Hello world how are you'), false);
});

test('extractCommandAfterWakeWord preserves any spoken follow-up command cleanly', () => {
  assert.equal(
    extractCommandAfterWakeWord('Hi ULTRON, WhatsApp par Jagjit ko hello bhejo'),
    'WhatsApp par Jagjit ko hello bhejo'
  );
  assert.equal(extractCommandAfterWakeWord('Hi ULTRON'), '');
});
