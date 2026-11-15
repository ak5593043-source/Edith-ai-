import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractDeviceActions,
  extractDeviceAction,
  buildAndroidIntentUrl,
  splitMultiStepClauses,
} from './actionDispatcher';

test('extractDeviceActions parses multiple explicit [ACTION:{...}] tags and strips them cleanly', () => {
  const response = [
    'Main aapke liye WhatsApp aur YouTube dono open kar rahi hoon.',
    '[ACTION:{"type":"whatsapp_message","appName":"WhatsApp","title":"WhatsApp Jagjit","target":"919876543210","message":"Hi Jagjit","appUrl":"whatsapp://send?phone=919876543210&text=Hi","webUrl":"https://wa.me/919876543210?text=Hi","androidPackage":"com.whatsapp"}]',
    '[ACTION:{"type":"youtube_search","appName":"YouTube","title":"YouTube: Lo-fi Study","target":"Lo-fi Study","appUrl":"vnd.youtube://results?search_query=Lo-fi","webUrl":"https://www.youtube.com/results?search_query=Lo-fi","androidPackage":"com.google.android.youtube"}]',
  ].join('\n');

  const { cleanText, actions } = extractDeviceActions(response, false);
  assert.equal(cleanText, 'Main aapke liye WhatsApp aur YouTube dono open kar rahi hoon.');
  assert.equal(actions.length, 2);
  assert.equal(actions[0].type, 'whatsapp_message');
  assert.equal(actions[1].type, 'youtube_search');
  assert.equal(actions[0].androidPackage, 'com.whatsapp');
  assert.equal(actions[1].androidPackage, 'com.google.android.youtube');
});

test('extractDeviceActions infers 5+ step mobile command pipelines including inherited verbs and quoted messages', () => {
  const cmd =
    '1. WhatsApp par 9876543210 ko msg: "Kal milte hain, aur ready rehna" bhejo\n2. YouTube par Arijit Singh songs chalao\n3. Instagram reels kholo\n4. Spotify par lo-fi music bajao\n5. Google Maps par India Gate ka rasta dikhao';
  const { actions } = extractDeviceActions(cmd);

  assert.equal(actions.length, 5);
  assert.equal(actions[0].type, 'whatsapp_message');
  assert.ok(actions[0].webUrl.includes('9876543210'));
  assert.ok(actions[0].message?.includes('Kal milte hain, aur ready rehna'));
  assert.equal(actions[1].type, 'youtube_search');
  assert.equal(actions[2].type, 'instagram_reels');
  assert.equal(actions[3].type, 'spotify_play');
  assert.equal(actions[4].type, 'maps_search');
});

test('extractDeviceActions supports comma/and app lists with launch verb inheritance', () => {
  const cmd = 'open YouTube, Instagram, Spotify and Telegram';
  const clauses = splitMultiStepClauses(cmd);
  assert.equal(clauses.length, 4);

  const { actions } = extractDeviceActions(cmd);
  assert.equal(actions.length, 4);
  assert.deepEqual(
    actions.map((a) => a.type),
    ['youtube_search', 'instagram_open', 'spotify_play', 'telegram_open']
  );
});

test('extractDeviceAction supports Phone Call, Google Maps directions, and Instagram Reels', () => {
  const callRes = extractDeviceAction('9876543210 par call karo');
  assert.equal(callRes.action?.type, 'call_phone');
  assert.equal(callRes.action?.appUrl, 'tel:9876543210');

  const mapsRes = extractDeviceAction('Google Maps par India Gate ka rasta dikhao');
  assert.equal(mapsRes.action?.type, 'maps_search');
  assert.ok(mapsRes.action?.webUrl.includes('maps/dir/?api=1&destination=India%20Gate'));

  const instaRes = extractDeviceAction('Instagram reels chalao');
  assert.equal(instaRes.action?.type, 'instagram_reels');
});

test('buildAndroidIntentUrl generates valid Android Chrome intent:// deep links with browser fallback', () => {
  const intent = buildAndroidIntentUrl(
    'com.google.android.youtube',
    'https://www.youtube.com/results?search_query=music'
  );
  assert.ok(intent.startsWith('intent://www.youtube.com/results?search_query=music#Intent;'));
  assert.ok(intent.includes('package=com.google.android.youtube;'));
  assert.ok(intent.includes('S.browser_fallback_url=https%3A%2F%2Fwww.youtube.com'));
});
