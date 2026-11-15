const SUPERSCRIPT_MAP: Record<string, string> = {
  '0': '⁰',
  '1': '¹',
  '2': '²',
  '3': '³',
  '4': '⁴',
  '5': '⁵',
  '6': '⁶',
  '7': '⁷',
  '8': '⁸',
  '9': '⁹',
  '+': '⁺',
  '-': '⁻',
  '=': '⁼',
  '(': '⁽',
  ')': '⁾',
  a: 'ᵃ',
  b: 'ᵇ',
  c: 'ᶜ',
  d: 'ᵈ',
  e: 'ᵉ',
  f: 'ᶠ',
  g: 'ᵍ',
  h: 'ʰ',
  i: 'ⁱ',
  j: 'ʲ',
  k: 'ᵏ',
  l: 'ˡ',
  m: 'ᵐ',
  n: 'ⁿ',
  o: 'ᵒ',
  p: 'ᵖ',
  r: 'ʳ',
  s: 'ˢ',
  t: 'ᵗ',
  u: 'ᵘ',
  v: 'ᵛ',
  w: 'ʷ',
  x: 'ˣ',
  y: 'ʸ',
  z: 'ᶻ',
};

const SUBSCRIPT_MAP: Record<string, string> = {
  '0': '₀',
  '1': '₁',
  '2': '₂',
  '3': '₃',
  '4': '₄',
  '5': '₅',
  '6': '₆',
  '7': '₇',
  '8': '₈',
  '9': '₉',
  '+': '₊',
  '-': '₋',
  '=': '₌',
  '(': '₍',
  ')': '₎',
  a: 'ₐ',
  e: 'ₑ',
  h: 'ₕ',
  i: 'ᵢ',
  j: 'ⱼ',
  k: 'ₖ',
  l: 'ₗ',
  m: 'ₘ',
  n: 'ₙ',
  o: 'ₒ',
  p: 'ₚ',
  r: 'ᵣ',
  s: 'ₛ',
  t: 'ₜ',
  u: 'ᵤ',
  v: 'ᵥ',
  x: 'ₓ',
};

const LATEX_SYMBOLS: Array<[RegExp, string | ((...args: string[]) => string)]> = [
  [/\\(?:left|right)\s*([()[\]{}|.])/g, (_m, d) => (d === '.' ? '' : d)],
  [/\\text\s*\{([^{}]*)\}/g, '$1'],
  [/\\mathrm\s*\{([^{}]*)\}/g, '$1'],
  [/\\mathbf\s*\{([^{}]*)\}/g, '$1'],
  [/\\mathit\s*\{([^{}]*)\}/g, '$1'],
  [/\\operatorname\s*\{([^{}]*)\}/g, '$1'],
  [/\\boxed\s*\{([^{}]*)\}/g, '[ $1 ]'],
  [/\\circ/g, '°'],
  [/\\degree/g, '°'],
  [/\\alpha/g, 'α'],
  [/\\beta/g, 'β'],
  [/\\gamma/g, 'γ'],
  [/\\Gamma/g, 'Γ'],
  [/\\delta/g, 'δ'],
  [/\\Delta/g, 'Δ'],
  [/\\epsilon|\\varepsilon/g, 'ε'],
  [/\\zeta/g, 'ζ'],
  [/\\eta/g, 'η'],
  [/\\theta|\\vartheta/g, 'θ'],
  [/\\Theta/g, 'Θ'],
  [/\\iota/g, 'ι'],
  [/\\kappa/g, 'κ'],
  [/\\lambda/g, 'λ'],
  [/\\Lambda/g, 'Λ'],
  [/\\mu/g, 'μ'],
  [/\\nu/g, 'ν'],
  [/\\xi/g, 'ξ'],
  [/\\pi|\\varpi/g, 'π'],
  [/\\Pi/g, 'Π'],
  [/\\rho|\\varrho/g, 'ρ'],
  [/\\sigma|\\varsigma/g, 'σ'],
  [/\\Sigma/g, 'Σ'],
  [/\\tau/g, 'τ'],
  [/\\upsilon/g, 'υ'],
  [/\\phi|\\varphi/g, 'φ'],
  [/\\Phi/g, 'Φ'],
  [/\\chi/g, 'χ'],
  [/\\psi/g, 'ψ'],
  [/\\Psi/g, 'Ψ'],
  [/\\omega/g, 'ω'],
  [/\\Omega/g, 'Ω'],
  [/\\pm/g, '±'],
  [/\\mp/g, '∓'],
  [/\\times/g, '×'],
  [/\\div/g, '÷'],
  [/\\cdot/g, '·'],
  [/\\ast/g, '∗'],
  [/\\leq|\\le/g, '≤'],
  [/\\geq|\\ge/g, '≥'],
  [/\\neq|\\ne/g, '≠'],
  [/\\approx/g, '≈'],
  [/\\equiv/g, '≡'],
  [/\\propto/g, '∝'],
  [/\\sim/g, '∼'],
  [/\\infty/g, '∞'],
  [/\\iint/g, '∬'],
  [/\\iiint/g, '∭'],
  [/\\oint/g, '∮'],
  [/\\int/g, '∫'],
  [/\\sum/g, '∑'],
  [/\\prod/g, '∏'],
  [/\\partial/g, '∂'],
  [/\\nabla/g, '∇'],
  [/\\forall/g, '∀'],
  [/\\exists/g, '∃'],
  [/\\notin/g, '∉'],
  [/\\in/g, '∈'],
  [/\\subseteq/g, '⊆'],
  [/\\subset/g, '⊂'],
  [/\\supseteq/g, '⊇'],
  [/\\supset/g, '⊃'],
  [/\\cup/g, '∪'],
  [/\\cap/g, '∩'],
  [/\\emptyset|\\varnothing/g, '∅'],
  [/\\Rightarrow/g, '⇒'],
  [/\\Leftarrow/g, '⇐'],
  [/\\Leftrightarrow/g, '⇔'],
  [/\\xrightarrow\s*\{([^{}]*)\}/g, '─[$1]→'],
  [/\\rightarrow|\\to/g, '→'],
  [/\\leftarrow|\\gets/g, '←'],
  [/\\leftrightarrow/g, '↔'],
  [/\\uparrow/g, '↑'],
  [/\\downarrow/g, '↓'],
  [/\\therefore/g, '∴'],
  [/\\because/g, '∵'],
  [/\\perp/g, '⊥'],
  [/\\parallel/g, '∥'],
  [/\\angle/g, '∠'],
  [/\\triangle/g, '△'],
  [/\\prime/g, '′'],
  [/\\dots|\\cdots|\\ldots/g, '…'],
  [/\\(sin|cos|tan|cot|sec|csc|arcsin|arccos|arctan|sinh|cosh|tanh|log|ln|exp|lim|max|min|det|gcd|mod)\b/g, '$1'],
  [/\\quad|\\qquad|\\,/g, ' '],
  [/\\;|\\:/g, ' '],
  [/\\!/g, ''],
  [/\\%/g, '%'],
];

function extractBraceGroup(str: string, openBraceIdx: number): { content: string; endIndex: number } | null {
  if (str[openBraceIdx] !== '{') return null;
  let depth = 0;
  for (let i = openBraceIdx; i < str.length; i++) {
    if (str[i] === '{') depth++;
    else if (str[i] === '}') {
      depth--;
      if (depth === 0) {
        return {
          content: str.slice(openBraceIdx + 1, i),
          endIndex: i,
        };
      }
    }
  }
  return null;
}

function toSuperscript(text: string): string {
  const converted = text.split('').map((ch) => SUPERSCRIPT_MAP[ch] ?? ch).join('');
  // If any alphanumerics weren't mapped, fall back to clean ^(...) form
  if (converted !== text && !/[A-Z]/.test(converted) && converted.split('').every((ch, i) => SUPERSCRIPT_MAP[text[i]] || /\s/.test(ch))) {
    return converted;
  }
  return text.length === 1 && SUPERSCRIPT_MAP[text] ? SUPERSCRIPT_MAP[text] : `^(${text})`;
}

function toSubscript(text: string): string {
  const converted = text.split('').map((ch) => SUBSCRIPT_MAP[ch] ?? ch).join('');
  if (converted !== text && converted.split('').every((ch, i) => SUBSCRIPT_MAP[text[i]] || /\s/.test(ch))) {
    return converted;
  }
  return text.length === 1 && SUBSCRIPT_MAP[text] ? SUBSCRIPT_MAP[text] : `_${text}`;
}

function replaceLatexRootsAndFractions(expr: string, keepSingleTopFractionAsInline = true): string {
  let out = expr;

  // Replace \sqrt[n]{x} and \sqrt{x}
  let guard = 0;
  while (/\\sqrt/.test(out) && guard++ < 25) {
    const idx = out.search(/\\sqrt/);
    if (idx === -1) break;
    let cursor = idx + 5;
    while (cursor < out.length && /\s/.test(out[cursor])) cursor++;

    let rootIndex = '';
    if (out[cursor] === '[') {
      const closeBracket = out.indexOf(']', cursor);
      if (closeBracket !== -1) {
        rootIndex = out.slice(cursor + 1, closeBracket).trim();
        cursor = closeBracket + 1;
        while (cursor < out.length && /\s/.test(out[cursor])) cursor++;
      }
    }

    const group = extractBraceGroup(out, cursor);
    if (!group) break;
    const inner = replaceLatexRootsAndFractions(group.content, true).trim();
    const radical = rootIndex === '3' ? '∛' : rootIndex === '4' ? '∜' : rootIndex ? `${toSuperscript(rootIndex)}√` : '√';
    const wrapped = inner.length <= 2 && /^[a-zA-Z0-9]+$/.test(inner) ? `${radical}${inner}` : `${radical}(${inner})`;
    out = out.slice(0, idx) + wrapped + out.slice(group.endIndex + 1);
  }

  // Replace \frac{a}{b}, \dfrac{a}{b}, \tfrac{a}{b}
  guard = 0;
  while (/\\[dt]?frac/.test(out) && guard++ < 25) {
    const match = out.match(/\\[dt]?frac/);
    if (!match || match.index === undefined) break;
    const idx = match.index;
    let cursor = idx + match[0].length;
    while (cursor < out.length && /\s/.test(out[cursor])) cursor++;
    const numGroup = extractBraceGroup(out, cursor);
    if (!numGroup) break;
    cursor = numGroup.endIndex + 1;
    while (cursor < out.length && /\s/.test(out[cursor])) cursor++;
    const denGroup = extractBraceGroup(out, cursor);
    if (!denGroup) break;

    if (!keepSingleTopFractionAsInline) {
      break;
    }

    const num = replaceLatexRootsAndFractions(numGroup.content, true).trim();
    const den = replaceLatexRootsAndFractions(denGroup.content, true).trim();
    const numTxt = /[+\-\s*/]/.test(num) ? `(${num})` : num;
    const denTxt = /[+\-\s*/]/.test(den) ? `(${den})` : den;
    out = out.slice(0, idx) + `${numTxt} / ${denTxt}` + out.slice(denGroup.endIndex + 1);
  }

  return out;
}

/**
 * Formats a LaTeX math string into clean, publication-grade Unicode math typography.
 */
export function formatMathExpression(rawLatex: string): string {
  if (!rawLatex) return '';
  let text = rawLatex.trim();

  // Strip surrounding $ / $$ / \[ \] / \( \) if passed in directly
  text = text
    .replace(/^\$\$([\s\S]*)\$\$$/, '$1')
    .replace(/^\$([\s\S]*)\$$/, '$1')
    .replace(/^\\\[([\s\S]*)\\\]$/, '$1')
    .replace(/^\\\(([\s\S]*)\\\)$/, '$1')
    .trim();

  text = replaceLatexRootsAndFractions(text, true);

  for (const [pattern, replacement] of LATEX_SYMBOLS) {
    text = text.replace(pattern, replacement as any);
  }

  // Convert superscripts ^{...} or ^x
  text = text.replace(/\^\{([^{}]+)\}/g, (_m, inner) => toSuperscript(inner.trim()));
  text = text.replace(/\^([a-zA-Z0-9+\-=()])/g, (_m, ch) => toSuperscript(ch));

  // Convert subscripts _{...} or _x
  text = text.replace(/_\{([^{}]+)\}/g, (_m, inner) => toSubscript(inner.trim()));
  text = text.replace(/_([a-zA-Z0-9+\-=()])/g, (_m, ch) => toSubscript(ch));

  // Remove any leftover pure LaTeX group braces
  text = text.replace(/\{([^{}]+)\}/g, '$1');
  text = text.replace(/\s+/g, ' ').trim();
  return text;
}

export interface StackedFractionBlock {
  prefix: string;
  numerator: string;
  denominator: string;
  suffix: string;
}

/**
 * Extracts a clean visual stacked fraction when a block equation has a primary
 * top-level `lhs = \frac{numerator}{denominator} suffix` structure.
 */
export function extractTopLevelFraction(rawLatex: string): StackedFractionBlock | null {
  const trimmed = rawLatex
    .trim()
    .replace(/^\$\$([\s\S]*)\$\$$/, '$1')
    .replace(/^\\\[([\s\S]*)\\\]$/, '$1')
    .trim();

  const fracMatch = trimmed.match(/\\[dt]?frac/);
  if (!fracMatch || fracMatch.index === undefined) return null;

  const idx = fracMatch.index;
  let cursor = idx + fracMatch[0].length;
  while (cursor < trimmed.length && /\s/.test(trimmed[cursor])) cursor++;
  const numGroup = extractBraceGroup(trimmed, cursor);
  if (!numGroup) return null;

  cursor = numGroup.endIndex + 1;
  while (cursor < trimmed.length && /\s/.test(trimmed[cursor])) cursor++;
  const denGroup = extractBraceGroup(trimmed, cursor);
  if (!denGroup) return null;

  const prefixRaw = trimmed.slice(0, idx);
  const suffixRaw = trimmed.slice(denGroup.endIndex + 1);

  // Only stack if prefix and suffix do NOT themselves contain additional \frac calls
  if (/\\[dt]?frac/.test(prefixRaw) || /\\[dt]?frac/.test(suffixRaw)) {
    return null;
  }

  return {
    prefix: formatMathExpression(prefixRaw),
    numerator: formatMathExpression(numGroup.content),
    denominator: formatMathExpression(denGroup.content),
    suffix: formatMathExpression(suffixRaw),
  };
}

/**
 * Replaces inline math spans (`$...$`, `\(...\)`) and chemical/formula patterns
 * inside body paragraphs with clean formatted Unicode math text.
 */
export function formatInlineMathInText(line: string): string {
  if (!line) return '';
  let out = line;

  // Replace \(...\)
  out = out.replace(/\\\(([\s\S]*?)\\\)/g, (_m, expr) => formatMathExpression(expr));
  // Replace inline $...$ (avoid matching currency like $50 or $ 50)
  out = out.replace(/\$([^\s$][^$\n]*?[^\s$]?)\$/g, (m, expr) => {
    // Skip pure currency numbers like $500 or $12.99
    if (/^\d+(?:[.,]\d+)?$/.test(expr.trim())) {
      return m;
    }
    return formatMathExpression(expr);
  });

  // Also tidy un-wrapped LaTeX tokens that sometimes appear inside Markdown lines
  if (/\\(?:frac|sqrt|alpha|beta|theta|pi|Delta|sum|int|times|div|pm|leq|geq|neq|approx|rightarrow)/.test(out)) {
    out = formatMathExpression(out);
  }

  // Convert bare chemical/math subscripts/superscripts like H_2O or x^2 when safe
  out = out.replace(/\b([A-Za-z0-9)])\^([0-9+\-n]+)\b/g, (_m, base, exp) => `${base}${toSuperscript(exp)}`);
  out = out.replace(/\b([A-Za-z])_([0-9]+)\b/g, (_m, base, sub) => `${base}${toSubscript(sub)}`);

  return out;
}
