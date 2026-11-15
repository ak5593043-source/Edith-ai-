import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDocumentBuffer } from './fileParser.ts';
import JSZip from 'jszip';

test('parseDocumentBuffer extracts plain text properly', async () => {
  const content = 'Hello JARVIS, this is a test document with data: 42.';
  const buffer = Buffer.from(content, 'utf-8');
  const result = await parseDocumentBuffer(buffer, 'test.txt', 'text/plain');

  assert.equal(result.name, 'test.txt');
  assert.equal(result.text, content);
  assert.equal(result.size, buffer.length);
  assert.equal(result.category, 'other');
});

test('parseDocumentBuffer formats image files as base64 preview', async () => {
  const buffer = Buffer.from('fake-image-bytes');
  const result = await parseDocumentBuffer(buffer, 'photo.png', 'image/png');

  assert.equal(result.name, 'photo.png');
  assert.equal(result.isImage, true);
  assert.equal(result.category, 'image');
  assert.ok(result.base64Data?.startsWith('data:image/png;base64,'));
});

test('parseDocumentBuffer processes spreadsheets (CSV) with Markdown table preview', async () => {
  const csvContent = 'Name,Role,Score\nTony Stark,Iron Man,100\nPeter Parker,Spider-Man,95\n';
  const buffer = Buffer.from(csvContent, 'utf-8');
  const result = await parseDocumentBuffer(buffer, 'data.csv', 'text/csv');

  assert.equal(result.name, 'data.csv');
  assert.equal(result.category, 'spreadsheet');
  assert.ok(result.text.includes('| Name | Role | Score |'));
  assert.ok(result.text.includes('Tony Stark'));
});

test('parseDocumentBuffer inspects ZIP archives safely', async () => {
  const zip = new JSZip();
  zip.file('readme.txt', 'Welcome to JARVIS archive intelligence test.');
  zip.file('config.json', '{"version": "2.0"}');
  const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' });

  const result = await parseDocumentBuffer(zipBuffer, 'project.zip', 'application/zip');
  assert.equal(result.name, 'project.zip');
  assert.equal(result.category, 'archive');
  assert.ok(result.text.includes('Total Files in Archive: 2'));
  assert.ok(result.text.includes('readme.txt'));
  assert.ok(result.text.includes('Welcome to JARVIS'));
});

test('parseDocumentBuffer parses YAML data files', async () => {
  const yamlContent = 'assistant:\n  name: JARVIS\n  version: 2.0\n';
  const buffer = Buffer.from(yamlContent, 'utf-8');
  const result = await parseDocumentBuffer(buffer, 'config.yaml', 'application/x-yaml');

  assert.equal(result.category, 'data');
  assert.ok(result.text.includes('JARVIS'));
  assert.ok(result.text.includes('Parsed Data Structure'));
});

test('parseDocumentBuffer formats code files with line numbers and language tag', async () => {
  const codeContent = 'function compute() {\n  return 42;\n}';
  const buffer = Buffer.from(codeContent, 'utf-8');
  const result = await parseDocumentBuffer(buffer, 'main.ts', 'text/plain');

  assert.equal(result.category, 'code');
  assert.ok(result.text.includes('```ts'));
  assert.ok(result.text.includes('compute()'));
});
