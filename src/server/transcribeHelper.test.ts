import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeWhisperTranscript, extensionForAudioMime } from './transcribeHelper.ts';

test('sanitizeWhisperTranscript removes silence artifacts and preserves real speech', () => {
  assert.equal(sanitizeWhisperTranscript('Thank you.'), '');
  assert.equal(sanitizeWhisperTranscript('  [Music]  '), '');
  assert.equal(sanitizeWhisperTranscript('Thanks for watching.'), '');
  assert.equal(
    sanitizeWhisperTranscript('  EDITH WhatsApp par message bhejo  '),
    'EDITH WhatsApp par message bhejo'
  );
});

test('extensionForAudioMime maps browser recording mime types accurately', () => {
  assert.equal(extensionForAudioMime('audio/webm;codecs=opus'), 'webm');
  assert.equal(extensionForAudioMime('audio/mp4'), 'm4a');
  assert.equal(extensionForAudioMime('audio/ogg;codecs=opus'), 'ogg');
  assert.equal(extensionForAudioMime(undefined), 'webm');
});
