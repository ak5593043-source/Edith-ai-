import test from 'node:test';
import assert from 'node:assert/strict';
import {
  analyzeCodingTask,
  selectCodingPreferredModel,
  buildHardCodingSystemMandate,
} from './codingHelper.ts';

test('analyzeCodingTask detects casual non-coding prompts cleanly', () => {
  const res = analyzeCodingTask([
    { role: 'user', content: 'Aaj ka mausam kaisa hai aur tumhara naam kya hai?' },
  ]);
  assert.equal(res.isCoding, false);
  assert.equal(res.isHardCoding, false);
  assert.equal(res.taskType, 'none');
});

test('analyzeCodingTask identifies hard DSA & architecture problems', () => {
  const dsa = analyzeCodingTask([
    {
      role: 'user',
      content: 'Implement an O(1) thread-safe LRU Cache in TypeScript with doubly linked list and hash map.',
    },
  ]);
  assert.equal(dsa.isCoding, true);
  assert.equal(dsa.isHardCoding, true);
  assert.equal(dsa.taskType, 'dsa');
  assert.ok(dsa.languageHints.includes('TypeScript'));
  assert.ok(dsa.recommendedTemperature <= 0.3);

  const arch = analyzeCodingTask([
    {
      role: 'user',
      content: 'Design a distributed token bucket rate limiter in Node.js with Redis concurrency safety.',
    },
  ]);
  assert.equal(arch.isCoding, true);
  assert.equal(arch.isHardCoding, true);
  assert.equal(arch.taskType, 'architecture');
});

test('analyzeCodingTask detects debugging prompts with stack traces', () => {
  const dbg = analyzeCodingTask([
    {
      role: 'user',
      content:
        'Fix this React bug TypeError: Cannot read properties of undefined (reading map)\n```tsx\n{items.map(x => <div>{x}</div>)}\n```',
    },
  ]);
  assert.equal(dbg.isCoding, true);
  assert.equal(dbg.isHardCoding, true);
  assert.equal(dbg.taskType, 'debug');
});

test('selectCodingPreferredModel upgrades weak 8b model automatically for coding', () => {
  const hardAnalysis = analyzeCodingTask([
    { role: 'user', content: 'Solve 0/1 Knapsack using Dynamic Programming in C++' },
  ]);
  assert.equal(selectCodingPreferredModel('llama-3.1-8b-instant', hardAnalysis), 'openai/gpt-oss-120b');
  assert.equal(selectCodingPreferredModel('gemini-4-hydrogen', hardAnalysis), 'gemini-4-hydrogen');
  assert.equal(selectCodingPreferredModel('llama-3.3-70b-versatile', hardAnalysis), 'llama-3.3-70b-versatile');
});

test('buildHardCodingSystemMandate enforces zero-TODO complete runnable code', () => {
  const analysis = analyzeCodingTask([
    { role: 'user', content: 'Write PostgreSQL recursive CTE query for org chart hierarchy' },
  ]);
  const mandate = buildHardCodingSystemMandate(analysis);
  assert.ok(mandate.includes('ZERO PLACEHOLDERS RULE'));
  assert.ok(mandate.includes('SQL'));
});
