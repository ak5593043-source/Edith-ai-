import test from 'node:test';
import assert from 'node:assert/strict';
import {
  cleanTextForSpeech,
  escapeForEdgeTts,
  detectSpeechLanguage,
  selectEdgeVoiceForLanguage,
  resolveVoiceTonePreset,
  splitSpeechIntoChunks,
  ULTRON_POWER_VOICE_PRESET,
} from './ttsHelper';

test('cleanTextForSpeech strips markdown, code blocks, ACTION tags, and PDF tags cleanly', () => {
  const input =
    '# Hello\nHere is **bold** text and `code` and a [link](https://example.com).\n```js\nconst x = 1;\n```\n[ACTION:{"type":"instagram_open"}]\n[PDF:{"title":"Doc","content":"Hi"}]';
  const cleaned = cleanTextForSpeech(input);
  assert.equal(cleaned.includes('ACTION'), false);
  assert.equal(cleaned.includes('[PDF'), false);
  assert.equal(cleaned.includes('```'), false);
  assert.equal(cleaned.includes('**'), false);
  assert.equal(cleaned.includes('https://example.com'), false);
  assert.equal(cleaned.includes('bold'), true);
});

test('escapeForEdgeTts neutralizes XML/SSML reserved characters', () => {
  const result = escapeForEdgeTts(`Tom & Jerry <hello> "world" 'test' 😊`);
  assert.equal(result.includes('&'), false);
  assert.equal(result.includes('<'), false);
  assert.equal(result.includes('>'), false);
  assert.equal(result.includes('"'), false);
  assert.equal(result.includes("'"), false);
  assert.equal(result.includes('😊'), false);
});

test('splitSpeechIntoChunks splits long responses into compact <= 280 char sentence chunks', () => {
  const longText = 'नमस्ते जगजीत, यह एक टेस्ट वाक्य है। '.repeat(25);
  const chunks = splitSpeechIntoChunks(longText, 280, 2400);
  assert.ok(chunks.length >= 3);
  for (const c of chunks) {
    assert.ok(c.length <= 280, `Chunk exceeded 280 chars: ${c.length}`);
  }
});

test('detectSpeechLanguage accurately identifies Hindi, Hinglish, and English', () => {
  assert.equal(detectSpeechLanguage('नमस्ते जगजीत, मैं अल्ट्रॉन हूँ।'), 'hi');
  assert.equal(detectSpeechLanguage('Tum kaise ho aur kya kar rahe ho?'), 'hinglish');
  assert.equal(detectSpeechLanguage('Good morning, how is the weather today?'), 'en');
});

test('ULTRON_POWER_VOICE_PRESET uses powerful deep Madhur & Christopher commanding voices', () => {
  assert.equal(ULTRON_POWER_VOICE_PRESET.voiceName, 'hi-IN-MadhurNeural');
  assert.equal(ULTRON_POWER_VOICE_PRESET.englishVoiceName, 'en-US-ChristopherNeural');
  assert.equal(ULTRON_POWER_VOICE_PRESET.pitch, '-14Hz');
  assert.equal(ULTRON_POWER_VOICE_PRESET.warmEq, true);
  assert.equal(selectEdgeVoiceForLanguage('hi'), 'hi-IN-MadhurNeural');
  assert.equal(selectEdgeVoiceForLanguage('en'), 'en-US-ChristopherNeural');
  assert.equal(resolveVoiceTonePreset('confident-bold').englishVoiceName, 'en-IN-PrabhatNeural');
  assert.equal(resolveVoiceTonePreset('confident-bold').pitch, '-10Hz');
  assert.equal(resolveVoiceTonePreset('razor-sharp').englishVoiceName, 'en-GB-RyanNeural');
  assert.equal(resolveVoiceTonePreset('razor-sharp').pitch, '-6Hz');
});
