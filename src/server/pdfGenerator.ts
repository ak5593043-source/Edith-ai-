import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import katex from 'katex';
import PDFDocument from 'pdfkit';
import {
  extractTopLevelFraction,
  formatInlineMathInText,
  formatMathExpression,
} from './mathPdfFormatter.ts';
import { repairLatexControlChars } from '../utils/pdfParser.ts';

const execFileAsync = promisify(execFile);

export interface PdfGenerationInput {
  title?: string;
  filename?: string;
  content: string;
  author?: string;
}

const FONT_PATHS = {
  sansRegular: '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
  sansBold: '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
  notoRegular: '/usr/share/fonts/truetype/noto/NotoSans-Regular.ttf',
  notoBold: '/usr/share/fonts/truetype/noto/NotoSans-Bold.ttf',
  devaRegular: '/usr/share/fonts/truetype/noto/NotoSansDevanagari-Regular.ttf',
  devaBold: '/usr/share/fonts/truetype/noto/NotoSansDevanagari-Bold.ttf',
  mathRegular: '/usr/share/fonts/truetype/noto/NotoSansMath-Regular.ttf',
  monoRegular: '/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf',
};

function findChromiumPdfBinary(): string | null {
  const candidates = [
    process.env.CHROMIUM_PATH,
    '/ms-playwright/chromium_headless_shell-1247/chrome-headless-shell-linux64/chrome-headless-shell',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome',
  ].filter(Boolean) as string[];

  for (const bin of candidates) {
    if (fs.existsSync(bin)) return bin;
  }

  // Dynamic lookup inside /ms-playwright if version folder shifts
  try {
    if (fs.existsSync('/ms-playwright')) {
      for (const dir of fs.readdirSync('/ms-playwright')) {
        const shell = path.join('/ms-playwright', dir, 'chrome-headless-shell-linux64', 'chrome-headless-shell');
        if (fs.existsSync(shell)) return shell;
        const chrome = path.join('/ms-playwright', dir, 'chrome-linux', 'chrome');
        if (fs.existsSync(chrome)) return chrome;
      }
    }
  } catch {
    // ignore scan errors
  }

  return null;
}

export function sanitizePdfFilename(rawName?: string, fallbackTitle?: string): string {
  const base = (rawName || fallbackTitle || 'ultron-document')
    .replace(/\.pdf$/i, '')
    .replace(/[^a-zA-Z0-9_\-\s]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .toLowerCase();

  const safe = base.length > 0 ? base.slice(0, 64) : 'ultron-document';
  return `${safe}.pdf`;
}

export function containsDevanagari(text: string): boolean {
  return /[\u0900-\u097F]/.test(text);
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const LATEX_COMMAND_HINT_REGEX =
  /\\(?:frac|dfrac|tfrac|sqrt|sum|int|oint|prod|lim|partial|nabla|pm|mp|times|div|cdot|leq|le|geq|ge|neq|ne|approx|equiv|alpha|beta|gamma|delta|epsilon|theta|lambda|mu|nu|pi|rho|sigma|tau|phi|psi|omega|Delta|Gamma|Theta|Lambda|Sigma|Omega|binom|vec|hat|bar|overline|underline)\b/;

function normalizeLatexForKatex(rawLatex: string): string {
  let expr = repairLatexControlChars(rawLatex || '').trim();
  if (!expr) return '';

  // Normalize common Unicode math chars that LLMs mix into LaTeX blocks
  expr = expr
    .replace(/\\degree\b/g, '^{\\circ}')
    .replace(/\\implies\b/g, '\\Rightarrow ')
    .replace(/\\iff\b/g, '\\Leftrightarrow ')
    .replace(/²/g, '^{2}')
    .replace(/³/g, '^{3}')
    .replace(/°/g, '^{\\circ}')
    .replace(/±/g, '\\pm ')
    .replace(/×/g, '\\times ')
    .replace(/÷/g, '\\div ')
    .replace(/≤/g, '\\le ')
    .replace(/≥/g, '\\ge ')
    .replace(/≠/g, '\\neq ')
    .replace(/≈/g, '\\approx ')
    .replace(/∞/g, '\\infty ');

  // Balance mildly missing trailing closing braces (common in generated LaTeX)
  let depth = 0;
  for (let i = 0; i < expr.length; i++) {
    if (expr[i] === '\\') {
      i++;
      continue;
    }
    if (expr[i] === '{') depth++;
    else if (expr[i] === '}' && depth > 0) depth--;
  }
  if (depth > 0 && depth <= 2) {
    expr += '}'.repeat(depth);
  }

  return expr;
}

function isLikelyInlineMath(rawExpr: string, charAfterClosingDollar: string): boolean {
  const trimmed = rawExpr.trim();
  if (!trimmed) return false;
  // Pure number e.g. $500 or $19.99 is currency
  if (/^\d+(?:[.,]\d+)?$/.test(trimmed)) return false;

  const hasExplicitLatexSyntax = /[\\^_{}]/.test(trimmed);
  // Currency span e.g. "$5 to $10" -> next char right after second '$' is a digit
  if (charAfterClosingDollar && /\d/.test(charAfterClosingDollar) && !hasExplicitLatexSyntax) {
    return false;
  }
  // Multi-word English prose caught between two currency $ signs without math operators/LaTeX
  if (
    /[a-zA-Z]{3,}\s+[a-zA-Z]{2,}\s+[a-zA-Z]{3,}/.test(trimmed) &&
    !/[\\^_{}=<>]/.test(trimmed)
  ) {
    return false;
  }
  return true;
}

function renderKatexSafe(latex: string, displayMode: boolean): string {
  const normalized = normalizeLatexForKatex(latex);
  if (!normalized) return '';
  try {
    return katex.renderToString(normalized, {
      displayMode,
      throwOnError: true,
      strict: false,
      output: 'html',
      macros: {
        '\\degree': '^\\circ',
        '\\R': '\\mathbb{R}',
        '\\N': '\\mathbb{N}',
        '\\Z': '\\mathbb{Z}',
        '\\Q': '\\mathbb{Q}',
        '\\C': '\\mathbb{C}',
      },
    });
  } catch {
    const cleanUnicode = formatMathExpression(normalized);
    return `<span class="math-fallback">${escapeHtml(cleanUnicode || normalized)}</span>`;
  }
}

/**
 * Renders inline Markdown formatting + inline KaTeX math ($...$, $$...$$, \(...\), bare LaTeX) into safe HTML.
 */
export function renderInlineMarkdownToHtml(rawLine: string): string {
  if (!rawLine) return '';

  const mathTokens: string[] = [];
  const pushMath = (expr: string, display = false): string => {
    const idx = mathTokens.length;
    mathTokens.push(renderKatexSafe(expr, display));
    return `@@MATH_${idx}@@`;
  };

  // Protect escaped literal dollar signs (\$5) before math tokenization
  let tokenized = rawLine.replace(/\\\$/g, '@@ESCAPED_DOLLAR@@');

  // Tokenize inline $$...$$, \[...\], \(...\) first
  tokenized = tokenized
    .replace(/\$\$([\s\S]+?)\$\$/g, (_m, expr) => pushMath(expr, false))
    .replace(/\\\[([\s\S]+?)\\\]/g, (_m, expr) => pushMath(expr, false))
    .replace(/\\\(([\s\S]+?)\\\)/g, (_m, expr) => pushMath(expr, false))
    .replace(/\$([^$\n]+?)\$/g, (full, expr, offset: number, whole: string) => {
      const charAfter = whole[offset + full.length] || '';
      if (!isLikelyInlineMath(expr, charAfter)) {
        return full;
      }
      return pushMath(expr, false);
    });

  // Fallback for unwrapped LaTeX equations embedded inside a text line (e.g. "Formula: x = \frac{1}{2}")
  if (!tokenized.includes('`') && !tokenized.includes('@@MATH_') && LATEX_COMMAND_HINT_REGEX.test(tokenized)) {
    const colonIdx = tokenized.lastIndexOf(':');
    if (colonIdx !== -1 && colonIdx < tokenized.length - 3) {
      const prefix = tokenized.slice(0, colonIdx + 1);
      const rhs = tokenized.slice(colonIdx + 1).trim();
      if (LATEX_COMMAND_HINT_REGEX.test(rhs)) {
        tokenized = `${prefix} ${pushMath(rhs, false)}`;
      }
    } else if (!/[a-zA-Z]{4,}\s+[a-zA-Z]{4,}\s+[a-zA-Z]{4,}/.test(tokenized.replace(/\\[a-zA-Z]+/g, ''))) {
      tokenized = pushMath(tokenized, false);
    }
  }

  // Tokenize inline code spans
  const codeTokens: string[] = [];
  tokenized = tokenized.replace(/`([^`]+)`/g, (_m, code) => {
    const idx = codeTokens.length;
    codeTokens.push(`<code class="inline-code">${escapeHtml(code)}</code>`);
    return `@@CODE_${idx}@@`;
  });

  // Escape raw HTML in regular prose
  let html = escapeHtml(tokenized);

  // Links [label](url)
  html = html.replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '<a href="$2">$1</a>');
  // Bold **...** and __...__
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/__([^_]+)__/g, '<strong>$1</strong>');
  // Italic *...*
  html = html.replace(/\*([^*\n]+)\*/g, '<em>$1</em>');

  // Restore escaped $, code spans, and KaTeX HTML tokens
  html = html.replace(/@@ESCAPED_DOLLAR@@/g, '$');
  html = html.replace(/@@CODE_(\d+)@@/g, (_m, idx) => codeTokens[Number(idx)] || '');
  html = html.replace(/@@MATH_(\d+)@@/g, (_m, idx) => mathTokens[Number(idx)] || '');

  return html;
}

/**
 * Converts rich Markdown + LaTeX + Code + Tables into printable publication HTML.
 */
export function buildPrintablePdfHtml(input: PdfGenerationInput): string {
  const title = (input.title || 'ULTRON Document').trim();
  const rawContent = repairLatexControlChars((input.content || '').trim());

  // Strip internal [ACTION:...] and [PDF:...] tags and normalize \[...\] / bare LaTeX blocks into $$...$$
  const cleanedContent = rawContent
    .replace(/\[ACTION:[\s\S]*$/g, (m) => (m.endsWith(']') ? '' : m))
    .replace(/\[ACTION:[\s\S]*?\]/g, '')
    .replace(/\[PDF:[\s\S]*$/g, '')
    .replace(/\\\[([\s\S]*?)\\\]/g, '\n$$\n$1\n$$\n')
    .replace(
      /(?<!\$\$\s*)(\\begin\{(?:aligned|align\*?|gather\*?|cases|matrix|pmatrix|bmatrix|vmatrix|equation\*?)\}[\s\S]*?\\end\{(?:aligned|align\*?|gather\*?|cases|matrix|pmatrix|bmatrix|vmatrix|equation\*?)\})(?!\s*\$\$)/g,
      '\n$$\n$1\n$$\n'
    )
    .trim();

  const lines = cleanedContent.split(/\r?\n/);
  const htmlBlocks: string[] = [];

  let inCodeBlock = false;
  let codeLang = '';
  let codeLines: string[] = [];

  let inMathBlock = false;
  let mathLines: string[] = [];

  let tableLines: string[] = [];
  let listType: 'ul' | 'ol' | null = null;
  let listItems: string[] = [];

  const flushList = () => {
    if (listType && listItems.length > 0) {
      htmlBlocks.push(`<${listType}>${listItems.join('')}</${listType}>`);
    }
    listType = null;
    listItems = [];
  };

  const flushTable = () => {
    if (tableLines.length === 0) return;
    const dataRows = tableLines
      .filter((l) => !/^\|?\s*[:\-| ]+\s*\|?$/.test(l.trim()))
      .map((l) =>
        l
          .trim()
          .replace(/^\|/, '')
          .replace(/\|$/, '')
          .split('|')
          .map((c) => renderInlineMarkdownToHtml(c.trim()))
      )
      .filter((r) => r.length > 0);

    if (dataRows.length > 0) {
      const [header, ...body] = dataRows;
      const thead = `<thead><tr>${header.map((c) => `<th>${c}</th>`).join('')}</tr></thead>`;
      const tbody = body.length
        ? `<tbody>${body
            .map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`)
            .join('')}</tbody>`
        : '';
      htmlBlocks.push(`<table class="doc-table">${thead}${tbody}</table>`);
    }
    tableLines = [];
  };

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    const trimmed = line.trim();

    if (inMathBlock) {
      if (trimmed.endsWith('$$')) {
        const lastPart = trimmed.slice(0, -2).trim();
        if (lastPart) mathLines.push(lastPart);
        const latex = mathLines.join('\n').trim();
        if (latex) {
          htmlBlocks.push(`<div class="formula-card">${renderKatexSafe(latex, true)}</div>`);
        }
        inMathBlock = false;
        mathLines = [];
      } else {
        mathLines.push(rawLine);
      }
      continue;
    }

    if (inCodeBlock) {
      if (trimmed.startsWith('```')) {
        htmlBlocks.push(
          `<div class="code-card">${
            codeLang ? `<div class="code-lang">${escapeHtml(codeLang)}</div>` : ''
          }<pre><code>${escapeHtml(codeLines.join('\n'))}</code></pre></div>`
        );
        inCodeBlock = false;
        codeLang = '';
        codeLines = [];
      } else {
        codeLines.push(rawLine);
      }
      continue;
    }

    if (trimmed.startsWith('```')) {
      flushList();
      flushTable();
      inCodeBlock = true;
      codeLang = trimmed.slice(3).trim();
      codeLines = [];
      continue;
    }

    // Single-line $$ ... $$ block
    if (trimmed.startsWith('$$') && trimmed.endsWith('$$') && trimmed.length > 4 && trimmed.indexOf('$$', 2) === trimmed.length - 2) {
      flushList();
      flushTable();
      const latex = trimmed.slice(2, -2).trim();
      htmlBlocks.push(`<div class="formula-card">${renderKatexSafe(latex, true)}</div>`);
      continue;
    }

    // Multi-line $$ block open (only when no closing $$ exists on this line)
    if (trimmed.startsWith('$$') && trimmed.indexOf('$$', 2) === -1) {
      flushList();
      flushTable();
      inMathBlock = true;
      const firstPart = trimmed.slice(2).trim();
      mathLines = firstPart ? [firstPart] : [];
      continue;
    }

    // Table accumulation
    if (trimmed.startsWith('|') && trimmed.includes('|')) {
      flushList();
      tableLines.push(trimmed);
      continue;
    } else {
      flushTable();
    }

    if (!trimmed) {
      flushList();
      continue;
    }

    // Horizontal rule
    if (/^[-*_]{3,}$/.test(trimmed)) {
      flushList();
      htmlBlocks.push('<hr class="section-rule" />');
      continue;
    }

    // Headings
    const hMatch = trimmed.match(/^(#{1,4})\s+(.+)$/);
    if (hMatch) {
      flushList();
      const level = Math.min(4, hMatch[1].length);
      htmlBlocks.push(`<h${level}>${renderInlineMarkdownToHtml(hMatch[2])}</h${level}>`);
      continue;
    }

    // Blockquote
    if (trimmed.startsWith('> ')) {
      flushList();
      htmlBlocks.push(`<blockquote>${renderInlineMarkdownToHtml(trimmed.slice(2))}</blockquote>`);
      continue;
    }

    // Unordered list
    if (/^[-*•]\s+/.test(trimmed)) {
      if (listType !== 'ul') {
        flushList();
        listType = 'ul';
      }
      listItems.push(`<li>${renderInlineMarkdownToHtml(trimmed.replace(/^[-*•]\s+/, ''))}</li>`);
      continue;
    }

    // Ordered list
    if (/^\d+\.\s+/.test(trimmed)) {
      if (listType !== 'ol') {
        flushList();
        listType = 'ol';
      }
      listItems.push(`<li>${renderInlineMarkdownToHtml(trimmed.replace(/^\d+\.\s+/, ''))}</li>`);
      continue;
    }

    // Paragraph
    flushList();
    htmlBlocks.push(`<p>${renderInlineMarkdownToHtml(trimmed)}</p>`);
  }

  if (inMathBlock && mathLines.length > 0) {
    htmlBlocks.push(`<div class="formula-card">${renderKatexSafe(mathLines.join('\n'), true)}</div>`);
  }
  if (inCodeBlock && codeLines.length > 0) {
    htmlBlocks.push(`<div class="code-card"><pre><code>${escapeHtml(codeLines.join('\n'))}</code></pre></div>`);
  }
  flushList();
  flushTable();

  // Inline local KaTeX CSS with resolved font URLs
  let katexCss = '';
  const katexCssPath = path.resolve(process.cwd(), 'node_modules/katex/dist/katex.min.css');
  const katexFontsDir = path.resolve(process.cwd(), 'node_modules/katex/dist/fonts');
  if (fs.existsSync(katexCssPath)) {
    katexCss = fs.readFileSync(katexCssPath, 'utf8').replace(
      /url\((['"]?)fonts\//g,
      (_m, q) => `url(${q}file://${katexFontsDir}/`
    );
  }

  const fontFaces: string[] = [];
  if (fs.existsSync(FONT_PATHS.notoRegular)) {
    fontFaces.push(`@font-face { font-family: 'EdithSans'; src: url('file://${FONT_PATHS.notoRegular}') format('truetype'); font-weight: 400; }`);
  }
  if (fs.existsSync(FONT_PATHS.notoBold)) {
    fontFaces.push(`@font-face { font-family: 'EdithSans'; src: url('file://${FONT_PATHS.notoBold}') format('truetype'); font-weight: 700; }`);
  }
  if (fs.existsSync(FONT_PATHS.devaRegular)) {
    fontFaces.push(`@font-face { font-family: 'EdithDeva'; src: url('file://${FONT_PATHS.devaRegular}') format('truetype'); font-weight: 400; }`);
  }
  if (fs.existsSync(FONT_PATHS.devaBold)) {
    fontFaces.push(`@font-face { font-family: 'EdithDeva'; src: url('file://${FONT_PATHS.devaBold}') format('truetype'); font-weight: 700; }`);
  }
  if (fs.existsSync(FONT_PATHS.monoRegular)) {
    fontFaces.push(`@font-face { font-family: 'EdithMono'; src: url('file://${FONT_PATHS.monoRegular}') format('truetype'); font-weight: 400; }`);
  }

  const dateLabel = new Date().toLocaleDateString('en-IN', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });

  return `<!doctype html>
<html lang="hi">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(title)}</title>
<style>
${fontFaces.join('\n')}
${katexCss}

@page {
  size: A4;
  margin: 16mm 15mm 18mm 15mm;
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  padding: 0;
  color: #1e293b;
  background: #ffffff;
  font-family: 'EdithSans', 'EdithDeva', 'Noto Sans', 'Noto Sans Devanagari', 'DejaVu Sans', sans-serif;
  font-size: 11.2pt;
  line-height: 1.62;
  -webkit-font-smoothing: antialiased;
}

.doc-header {
  border-bottom: 1.5px solid #cbd5e1;
  padding-bottom: 10px;
  margin-bottom: 18px;
}

.doc-title {
  margin: 0 0 4px 0;
  font-size: 20pt;
  font-weight: 700;
  color: #0f172a;
  line-height: 1.25;
}

.doc-meta {
  font-size: 9pt;
  color: #64748b;
}

h1 { font-size: 15.5pt; color: #0f172a; margin: 18px 0 8px 0; font-weight: 700; break-after: avoid; }
h2 { font-size: 13.5pt; color: #0f172a; margin: 15px 0 6px 0; font-weight: 700; break-after: avoid; }
h3 { font-size: 11.8pt; color: #1e293b; margin: 12px 0 5px 0; font-weight: 700; break-after: avoid; }
h4 { font-size: 11pt; color: #334155; margin: 10px 0 4px 0; font-weight: 700; break-after: avoid; }

p {
  margin: 0 0 9px 0;
  word-wrap: break-word;
}

ul, ol {
  margin: 6px 0 11px 0;
  padding-left: 22px;
}

li {
  margin: 4px 0;
}

blockquote {
  margin: 10px 0;
  padding: 8px 12px;
  border-left: 3.5px solid #3b82f6;
  background: #f8fafc;
  color: #334155;
  border-radius: 0 6px 6px 0;
}

.formula-card {
  margin: 12px 0;
  padding: 11px 14px;
  background: #f8fafc;
  border-left: 3.5px solid #2563eb;
  border-radius: 6px;
  text-align: center;
  break-inside: avoid;
  overflow-x: auto;
}

.math-fallback {
  font-family: 'EdithSans', 'DejaVu Sans', serif;
  font-style: italic;
  color: #0f172a;
}

.katex-display {
  margin: 0.25em 0 !important;
}

.inline-code {
  font-family: 'EdithMono', 'DejaVu Sans Mono', monospace;
  font-size: 9.5pt;
  background: #f1f5f9;
  color: #0f172a;
  padding: 1px 5px;
  border-radius: 4px;
  border: 1px solid #e2e8f0;
}

.code-card {
  margin: 11px 0;
  background: #0f172a;
  color: #f8fafc;
  border-radius: 8px;
  overflow: hidden;
  break-inside: avoid;
}

.code-lang {
  background: #1e293b;
  color: #94a3b8;
  font-family: 'EdithMono', monospace;
  font-size: 8.5pt;
  padding: 4px 10px;
  text-transform: uppercase;
}

.code-card pre {
  margin: 0;
  padding: 10px 12px;
  font-family: 'EdithMono', 'DejaVu Sans Mono', monospace;
  font-size: 9pt;
  line-height: 1.48;
  white-space: pre-wrap;
  word-break: break-word;
}

.doc-table {
  width: 100%;
  border-collapse: collapse;
  margin: 12px 0;
  font-size: 10pt;
}

.doc-table th,
.doc-table td {
  border: 1px solid #cbd5e1;
  padding: 7px 9px;
  text-align: left;
  vertical-align: top;
}

.doc-table thead th {
  background: #e2e8f0;
  color: #0f172a;
  font-weight: 700;
}

.doc-table tbody tr:nth-child(even) td {
  background: #f8fafc;
}

.doc-table tr {
  break-inside: avoid;
}

.section-rule {
  border: none;
  border-top: 1px solid #cbd5e1;
  margin: 14px 0;
}

.doc-footer {
  margin-top: 22px;
  padding-top: 8px;
  border-top: 1px solid #e2e8f0;
  text-align: center;
  font-size: 8.5pt;
  color: #94a3b8;
}
</style>
</head>
<body>
  <div class="doc-header">
    <h1 class="doc-title">${renderInlineMarkdownToHtml(title)}</h1>
    <div class="doc-meta">Generated by ULTRON • ${escapeHtml(dateLabel)}</div>
  </div>
  <main>
    ${htmlBlocks.join('\n')}
  </main>
  <div class="doc-footer">ULTRON Personal AI Assistant • Developed by Jagjit</div>
</body>
</html>`;
}

/**
 * Fallback PDFKit generator if Chromium headless binary is unavailable.
 */
async function generatePdfBufferFallback(input: PdfGenerationInput): Promise<Buffer> {
  const title = formatInlineMathInText((input.title || 'ULTRON Document').trim())
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1');
  const content = (input.content || '').trim();
  const author = input.author || 'ULTRON (Developed by Jagjit)';

  return new Promise<Buffer>((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: 'A4',
        margins: { top: 52, bottom: 52, left: 52, right: 52 },
        bufferPages: true,
        info: { Title: title, Author: author, Creator: 'ULTRON Personal AI Assistant' },
      });
      const chunks: Buffer[] = [];
      doc.on('data', (c: Buffer) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      if (fs.existsSync(FONT_PATHS.sansRegular)) doc.registerFont('Sans', FONT_PATHS.sansRegular);
      if (fs.existsSync(FONT_PATHS.sansBold)) doc.registerFont('SansBold', FONT_PATHS.sansBold);
      if (fs.existsSync(FONT_PATHS.devaRegular)) doc.registerFont('Deva', FONT_PATHS.devaRegular);

      const useDeva = containsDevanagari(content + title) && fs.existsSync(FONT_PATHS.devaRegular);
      const bodyFont = useDeva ? 'Deva' : fs.existsSync(FONT_PATHS.sansRegular) ? 'Sans' : 'Helvetica';
      const boldFont = fs.existsSync(FONT_PATHS.sansBold) && !useDeva ? 'SansBold' : bodyFont;

      doc.font(boldFont).fontSize(18).fillColor('#0F172A').text(title);
      doc.moveDown(0.5);

      const cleaned = content
        .replace(/\[ACTION:[\s\S]*?\]/g, '')
        .replace(/\[PDF:[\s\S]*$/g, '')
        .replace(/\\\[([\s\S]*?)\\\]/g, '\n$$\n$1\n$$\n');

      for (const rawLine of cleaned.split(/\r?\n/)) {
        const trimmed = rawLine.trim();
        if (!trimmed) {
          doc.moveDown(0.35);
          continue;
        }
        if (trimmed.startsWith('$$') && trimmed.endsWith('$$') && trimmed.length > 4) {
          const stacked = extractTopLevelFraction(trimmed.slice(2, -2));
          const expr = stacked
            ? `${stacked.prefix ? stacked.prefix + ' ' : ''}(${stacked.numerator}) / (${stacked.denominator})${stacked.suffix ? ' ' + stacked.suffix : ''}`
            : formatMathExpression(trimmed);
          doc.font(bodyFont).fontSize(11).fillColor('#0F172A').text(expr, { indent: 12, lineGap: 3 });
          continue;
        }
        const formatted = formatInlineMathInText(trimmed)
          .replace(/\*\*([^*]+)\*\*/g, '$1')
          .replace(/`([^`]+)`/g, '$1');
        doc.font(bodyFont).fontSize(11).fillColor('#1F2937').text(formatted, { lineGap: 3.5 });
      }
      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Generates a real binary PDF buffer using Chromium + KaTeX + Noto HarfBuzz text shaping
 * (with automatic PDFKit fallback), supporting complex Hindi, English, Code, Tables, and Math.
 */
export async function generatePdfBuffer(input: PdfGenerationInput): Promise<Buffer> {
  const title = (input.title || 'ULTRON Document').trim();
  const content = (input.content || '').trim();

  if (!content) {
    throw new Error('PDF content cannot be empty.');
  }

  const chromiumBin = findChromiumPdfBinary();
  if (chromiumBin) {
    const tmpId = `ultron-pdf-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const htmlPath = path.join(os.tmpdir(), `${tmpId}.html`);
    const pdfPath = path.join(os.tmpdir(), `${tmpId}.pdf`);

    try {
      const html = buildPrintablePdfHtml({ ...input, title, content });
      fs.writeFileSync(htmlPath, html, 'utf8');

      await execFileAsync(
        chromiumBin,
        [
          '--headless',
          '--no-sandbox',
          '--disable-gpu',
          '--disable-dev-shm-usage',
          `--print-to-pdf=${pdfPath}`,
          '--no-pdf-header-footer',
          `file://${htmlPath}`,
        ],
        { timeout: 15000 }
      );

      if (fs.existsSync(pdfPath)) {
        const pdfBytes = fs.readFileSync(pdfPath);
        if (pdfBytes.length > 500 && pdfBytes.subarray(0, 5).toString('utf8') === '%PDF-') {
          return pdfBytes;
        }
      }
    } catch (err: any) {
      console.warn('Chromium PDF render fallback triggered:', err.message);
    } finally {
      try { if (fs.existsSync(htmlPath)) fs.unlinkSync(htmlPath); } catch {}
      try { if (fs.existsSync(pdfPath)) fs.unlinkSync(pdfPath); } catch {}
    }
  }

  return generatePdfBufferFallback({ ...input, title, content });
}
