import test from 'node:test';
import assert from 'node:assert/strict';
import { generateTitleFromMessage, createNewConversation, loadSettings } from './storage.ts';
import { DEFAULT_SETTINGS } from '../types/chat.ts';

test('generateTitleFromMessage generates clean, concise conversation titles', () => {
  assert.equal(generateTitleFromMessage(''), 'New Conversation');
  assert.equal(generateTitleFromMessage('Hello ULTRON, what is the weather today?'), 'Hello ULTRON, what is the weather today?');

  const longText = 'This is a very long question that exceeds forty characters and should be truncated with an ellipsis';
  const title = generateTitleFromMessage(longText);
  assert.ok(title.endsWith('...'));
  assert.ok(title.length <= 40);

  const markdownText = '### How does React state work?';
  assert.equal(generateTitleFromMessage(markdownText), 'How does React state work?');
});

test('createNewConversation returns valid schema with default and custom models', () => {
  const convCustom = createNewConversation('openai/gpt-oss-120b');
  assert.ok(convCustom.id.startsWith('conv_'));
  assert.equal(convCustom.title, 'New Conversation');
  assert.equal(convCustom.model, 'openai/gpt-oss-120b');
  assert.deepEqual(convCustom.messages, []);

  const convDefault = createNewConversation();
  assert.equal(convDefault.model, DEFAULT_SETTINGS.model);
  assert.equal(convDefault.model, 'llama-3.3-70b-versatile');
});

test('loadSettings migrates legacy Swara/girl voice preferences to ULTRON commanding voice', () => {
  const prevStorage = (globalThis as any).localStorage;
  const mem = new Map<string, string>();
  (globalThis as any).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => mem.set(k, v),
    removeItem: (k: string) => mem.delete(k),
  };

  try {
    mem.set(
      'jarvis_settings_v1',
      JSON.stringify({
        voiceURI: 'hi-IN-SwaraNeural',
        voiceTone: 'sweet-warm',
        model: 'llama-3.1-8b-instant',
      })
    );
    const loaded = loadSettings();
    assert.equal(loaded.voiceURI, 'hi-IN-MadhurNeural');
    assert.equal(loaded.voiceTone, 'commanding-deep');
    assert.equal(loaded.model, 'llama-3.3-70b-versatile');
  } finally {
    (globalThis as any).localStorage = prevStorage;
  }
});
