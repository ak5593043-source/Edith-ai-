import test from 'node:test';
import assert from 'node:assert/strict';
import { searchWeb } from './search.ts';

test('searchWeb returns results or handles offline/empty query safely', async () => {
  const emptyResults = await searchWeb('', 3);
  assert.ok(Array.isArray(emptyResults), 'Should return an array');

  // Query real information
  const results = await searchWeb('Artificial Intelligence', 3);
  assert.ok(Array.isArray(results), 'Should return an array of search results');
  // If online, results will have title and url
  if (results.length > 0) {
    assert.ok(typeof results[0].title === 'string');
    assert.ok(typeof results[0].url === 'string');
    assert.ok(results[0].url.startsWith('http'));
  }
});
