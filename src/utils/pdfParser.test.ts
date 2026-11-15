import test from 'node:test';
import assert from 'node:assert/strict';
import { extractPdfPayload, isPdfRequestPrompt, repairLatexControlChars } from './pdfParser';

test('extractPdfPayload parses [PDF:{...}] JSON block and strips it from cleanText', () => {
  const raw =
    'Here is your Python study PDF.\n[PDF:{"filename":"python-notes.pdf","title":"Python Notes","content":"# Python\\n- Lists\\n- Dicts"}]';
  const { cleanText, pdf } = extractPdfPayload(raw);

  assert.equal(cleanText, 'Here is your Python study PDF.');
  assert.ok(pdf);
  assert.equal(pdf.filename, 'python-notes.pdf');
  assert.equal(pdf.title, 'Python Notes');
  assert.ok(pdf.content.includes('Lists'));
});

test('extractPdfPayload handles nested LaTeX braces like \\frac{a}{b}, \\sqrt{x^2+y^2}, and code {} inside content without truncation', () => {
  const raw =
    'Ye rahi aapki Maths formula sheet.\n\n[PDF:{"filename":"maths-formulas.pdf","title":"Maths & Code","content":"# Algebra Formulas\\n\\n$$\\nx = \\\\frac{-b \\\\pm \\\\sqrt{b^2 - 4ac}}{2a}\\n$$\\n\\n```js\\nfunction solve() { return { ok: true }; }\\n```"}]';
  const { cleanText, pdf } = extractPdfPayload(raw);

  assert.equal(cleanText, 'Ye rahi aapki Maths formula sheet.');
  assert.equal(cleanText.includes('[PDF:'), false);
  assert.ok(pdf);
  assert.equal(pdf.filename, 'maths-formulas.pdf');
  assert.ok(pdf.content.includes('\\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}'));
  assert.ok(pdf.content.includes('function solve() { return { ok: true }; }'));
});

test('extractPdfPayload repairs unescaped LaTeX backslashes and control chars emitted inside LLM JSON', () => {
  // Simulate LLM emitting single-backslash LaTeX inside JSON literal (e.g. \frac -> \f + rac, \sqrt invalid JSON escape)
  const raw =
    'Ready!\n[PDF:{"filename":"physics.pdf","title":"Physics","content":"# Physics Notes\nEnergy: $E = mc^2$\nFormula: $$\\frac{1}{2}mv^2 + \\sqrt{x} + \\beta + \\theta$$"}]';
  const { cleanText, pdf } = extractPdfPayload(raw);

  assert.equal(cleanText, 'Ready!');
  assert.ok(pdf);
  assert.ok(pdf.content.includes('\\frac{1}{2}'));
  assert.ok(pdf.content.includes('\\sqrt{x}'));
  assert.ok(pdf.content.includes('\\beta'));
  assert.ok(pdf.content.includes('\\theta'));
});

test('repairLatexControlChars restores control chars back into valid LaTeX commands including nabla, neq, nu, notin', () => {
  const broken =
    '\x0crac{1}{2} + \x08eta + \right + \theta + \nabla + \neq + \nu + \notin'
      .replace('\right', '\r' + 'ight')
      .replace('\theta', '\t' + 'heta')
      .replace('\nabla', '\n' + 'abla')
      .replace('\neq', '\n' + 'eq')
      .replace('\nu', '\n' + 'u')
      .replace('\notin', '\n' + 'otin');
  const fixed = repairLatexControlChars(broken);
  assert.ok(fixed.includes('\\frac{1}{2}'));
  assert.ok(fixed.includes('\\beta'));
  assert.ok(fixed.includes('\\right'));
  assert.ok(fixed.includes('\\theta'));
  assert.ok(fixed.includes('\\nabla'));
  assert.ok(fixed.includes('\\neq'));
  assert.ok(fixed.includes('\\nu'));
  assert.ok(fixed.includes('\\notin'));
});

test('extractPdfPayload recovers or strips truncated [PDF:{... without leaking raw JSON', () => {
  const raw =
    'Notes taiyar hain.\n[PDF:{"filename":"bio.pdf","title":"Biology","content":"# Biology Notes\\n- Cell division\\n- Mitochondria is the powerhouse';
  const { cleanText, pdf } = extractPdfPayload(raw);

  assert.equal(cleanText, 'Notes taiyar hain.');
  assert.equal(cleanText.includes('[PDF:'), false);
  assert.ok(pdf);
  assert.ok(pdf.content.includes('Mitochondria'));
});

test('isPdfRequestPrompt detects Hindi, Hinglish, and English PDF generation commands', () => {
  assert.equal(isPdfRequestPrompt('Python notes ka PDF bana do'), true);
  assert.equal(isPdfRequestPrompt('Create a PDF resume for me'), true);
  assert.equal(isPdfRequestPrompt('What is the capital of India?'), false);
});
