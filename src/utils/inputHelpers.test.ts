import test from 'node:test';
import assert from 'node:assert/strict';
import { classifySpeechError, combineSpeechTranscript } from './inputHelpers.ts';

test('classifySpeechError treats not-allowed and audio-capture as terminal so mic never hangs', () => {
  const denied = classifySpeechError('not-allowed');
  assert.equal(denied.isTerminal, true);
  assert.equal(denied.shouldRetry, false);
  assert.ok(denied.userMessage && denied.userMessage.includes('permission'));

  const hwBusy = classifySpeechError('audio-capture');
  assert.equal(hwBusy.isTerminal, true);
  assert.equal(hwBusy.shouldRetry, false);
  assert.ok(hwBusy.userMessage);
});

test('classifySpeechError allows retry on transient no-speech and quietly stops on aborted', () => {
  const noSpeech = classifySpeechError('no-speech');
  assert.equal(noSpeech.isTerminal, false);
  assert.equal(noSpeech.shouldRetry, true);
  assert.equal(noSpeech.userMessage, null);

  const aborted = classifySpeechError('aborted');
  assert.equal(aborted.isTerminal, true);
  assert.equal(aborted.shouldRetry, false);
  assert.equal(aborted.userMessage, null);
});

test('combineSpeechTranscript merges final and interim phrases cleanly', () => {
  assert.equal(combineSpeechTranscript('hello', 'world'), 'hello world');
  assert.equal(combineSpeechTranscript('  hello  ', ''), 'hello');
  assert.equal(combineSpeechTranscript('', '  world  '), 'world');
  assert.equal(combineSpeechTranscript('', ''), '');
});
