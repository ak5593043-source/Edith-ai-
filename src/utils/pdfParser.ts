export interface PdfPayload {
  filename: string;
  title: string;
  content: string;
}

/**
 * Repairs ASCII control characters that JSON.parse accidentally produces when
 * an LLM forgets to double-escape LaTeX commands inside JSON strings
 * (e.g., "\frac" -> \x0c+"rac", "\beta" -> \x08+"eta", "\theta" -> \t+"heta",
 * "\right" -> \r+"ight", "\nabla" -> \n+"abla", "\neq" -> \n+"eq", "\nu" -> \n+"u").
 */
export function repairLatexControlChars(text: string): string {
  if (!text) return '';

  const restoreNonNewlineControls = (input: string): string =>
    input
      .replace(/\x0c(?=[a-zA-Z])/g, '\\f')
      .replace(/\x08(?=[a-zA-Z])/g, '\\b')
      .replace(
        /\r(?=(?:ight|ho|angle|lceil|rceil|lfloor|rfloor|vert|rightarrow|leftarrow|Rightarrow|Leftarrow|m(?![a-zA-Z])|aisebox))/g,
        '\\r'
      )
      .replace(
        /\t(?=(?:heta|imes|ext[a-zA-Z]*|au|an[h]?|o(?![a-zA-Z])|op|riangle|herefore|ilde|frac|dot|vec|heta))/g,
        '\\t'
      );

  const restoreNewlineInMath = (mathBody: string): string =>
    mathBody.replace(
      /\n(?=(?:abla|eq|e(?=\s|[^a-zA-Z])|otin|exists|u(?![a-zA-Z])|atural(?![a-zA-Z])|eg(?![a-zA-Z])|rightarrow|leftarrow|leq(?![a-zA-Z])|geq(?![a-zA-Z])|less(?![a-zA-Z])|gtr(?![a-zA-Z])|approx(?![a-zA-Z])|cong(?![a-zA-Z])|mid(?![a-zA-Z])|sim(?![a-zA-Z])))/g,
      '\\n'
    );

  let out = restoreNonNewlineControls(text);

  // Restore corrupted \n LaTeX commands inside $$...$$ and $...$ math delimiters
  out = out.replace(/\$\$([^$]{1,2000})\$\$/g, (_m, body) => `$$${restoreNewlineInMath(body)}$$`);
  out = out.replace(/\$([^$\n]*\n(?:abla|eq|e(?=\s|[^a-zA-Z])|otin|exists|u(?![a-zA-Z])|eg(?![a-zA-Z])|leq|geq|rightarrow|leftarrow|sim|cong)[^$]*)\$/g, (m, body) => {
    const fixed = restoreNewlineInMath(body);
    return fixed === body ? m : `$${fixed}$`;
  });
  out = out.replace(/\\\[([\s\S]{1,2000}?)\\\]/g, (_m, body) => `\\[${restoreNewlineInMath(body)}\\]`);
  out = out.replace(/\\\(([\s\S]{1,800}?)\\\)/g, (_m, body) => `\\(${restoreNewlineInMath(body)}\\)`);

  // Also restore unambiguous corrupted \n tokens anywhere (e.g. unwrapped formula lines)
  out = out.replace(/\n(?=(?:abla|eq|otin|leq|geq|rightarrow|leftarrow)(?![a-zA-Z]))/g, '\\n');
  out = out.replace(/([a-zA-Z0-9)\]} \t+\-=<>*/(,\[{])\n(?=(?:eq|u|exists)(?![a-zA-Z]))/g, '$1\\n');

  return out;
}

/**
 * Repairs unescaped backslashes and raw newlines inside a JSON object literal
 * so LaTeX formulas (\sqrt, \alpha, \pi, \frac, \nabla, \neq, \sum, etc.) parse cleanly.
 */
function repairJsonCandidate(rawJson: string): string {
  let out = '';
  let inString = false;
  let i = 0;

  while (i < rawJson.length) {
    const ch = rawJson[i];

    if (!inString) {
      if (ch === '"') {
        inString = true;
      }
      out += ch;
      i++;
      continue;
    }

    // Inside a JSON string
    if (ch === '"') {
      inString = false;
      out += ch;
      i++;
      continue;
    }

    if (ch === '\n') {
      out += '\\n';
      i++;
      continue;
    }
    if (ch === '\r') {
      i++;
      continue;
    }
    if (ch === '\t') {
      out += '\\t';
      i++;
      continue;
    }

    if (ch === '\\') {
      const next = rawJson[i + 1];
      if (next === undefined) {
        out += '\\\\';
        i++;
        continue;
      }

      // Already escaped JSON special chars or unicode escape
      if (next === '"' || next === '\\' || next === '/') {
        out += ch + next;
        i += 2;
        continue;
      }

      if (next === 'u' && /^[0-9a-fA-F]{4}/.test(rawJson.slice(i + 2, i + 6))) {
        out += rawJson.slice(i, i + 6);
        i += 6;
        continue;
      }

      // Check for single-backslash LaTeX commands masquerading as \f, \b, \r, \t, \n
      const rest = rawJson.slice(i + 1);
      if (
        (next === 'f' && /^(?:frac|forall|flat|fbox)/.test(rest)) ||
        (next === 'b' && /^(?:beta|begin|binom|bar|big|bot|bullet|bmatrix|bmod|boldsymbol)/.test(rest)) ||
        (next === 'r' && /^(?:right|rho|rangle|lceil|rceil|rfloor|rightarrow|rm(?![a-zA-Z])|aisebox)/.test(rest)) ||
        (next === 't' && /^(?:theta|times|text|tau|tan|to(?![a-zA-Z])|top|triangle|therefore|tilde|tfrac)/.test(rest)) ||
        (next === 'n' && /^(?:nabla|neq(?![a-zA-Z])|ne(?=\s|[^a-zA-Z])|nu(?![a-zA-Z])|notin(?![a-zA-Z])|nexists(?![a-zA-Z])|natural(?![a-zA-Z])|neg(?![a-zA-Z])|nleq(?![a-zA-Z])|ngeq(?![a-zA-Z])|nrightarrow|nleftarrow|nsim(?![a-zA-Z]))/.test(rest))
      ) {
        out += '\\\\' + next;
        i += 2;
        continue;
      }

      if (next === 'n' || next === 'r' || next === 't' || next === 'b' || next === 'f') {
        out += ch + next;
        i += 2;
        continue;
      }

      // Any other backslash (e.g., \sqrt, \alpha, \pi, \sum, \int, \Delta, \cdot, \$, \%)
      out += '\\\\' + next;
      i += 2;
      continue;
    }

    out += ch;
    i++;
  }

  return out;
}

/**
 * Balanced-brace scanner to locate [PDF:{...}] even when content inside contains
 * LaTeX braces (\frac{a}{b}), exponents (x^{2}), or code blocks ({ ... }).
 */
function findBalancedPdfTag(text: string): { fullMatch: string; jsonStr: string; startIndex: number } | null {
  const startMatch = /\[PDF:\s*\{/i.exec(text);
  if (!startMatch) return null;

  const tagStart = startMatch.index;
  const jsonStart = tagStart + startMatch[0].length - 1; // index of '{'

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = jsonStart; i < text.length; i++) {
    const ch = text[i];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
    } else if (ch === '{') {
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0) {
        // Consume optional stray closing braces (e.g. from LLM emitting }}]) and closing ']'
        let endIdx = i + 1;
        while (endIdx < text.length && /[\s}]/.test(text[endIdx])) {
          endIdx++;
        }
        if (text[endIdx] === ']') {
          endIdx++;
        } else {
          // Rewind non-whitespace if no ']' followed
          endIdx = i + 1;
          while (endIdx < text.length && /\s/.test(text[endIdx])) {
            endIdx++;
          }
        }
        return {
          fullMatch: text.slice(tagStart, endIdx),
          jsonStr: text.slice(jsonStart, i + 1),
          startIndex: tagStart,
        };
      }
    }
  }

  return null;
}

/**
 * Last-resort field extractor when model JSON had unescaped quotes inside content.
 */
function fallbackExtractFields(jsonStr: string): Partial<PdfPayload> | null {
  const filenameMatch = jsonStr.match(/"filename"\s*:\s*"([^"]*)"/);
  const titleMatch = jsonStr.match(/"title"\s*:\s*"([^"]*)"/);
  const contentKeyMatch = /"content"\s*:\s*"/.exec(jsonStr);
  if (!contentKeyMatch) return null;

  const start = contentKeyMatch.index + contentKeyMatch[0].length;
  const lastQuote = jsonStr.lastIndexOf('"');
  const rawContent = lastQuote > start ? jsonStr.slice(start, lastQuote) : jsonStr.slice(start);
  const unescaped = rawContent
    .replace(/\\n/g, '\n')
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, '\\');

  return {
    filename: filenameMatch?.[1],
    title: titleMatch?.[1],
    content: unescaped,
  };
}

/**
 * Strips complete or trailing partial [PDF:...] tags so raw JSON never leaks into visible UI or PDFs.
 */
export function stripRawPdfTags(text: string): string {
  if (!text) return '';
  let result = text;
  let guard = 0;
  while (guard++ < 5) {
    const found = findBalancedPdfTag(result);
    if (!found) break;
    result = (result.slice(0, found.startIndex) + result.slice(found.startIndex + found.fullMatch.length)).trim();
  }
  // Strip any truncated/incomplete trailing [PDF:{... still open at end of response
  result = result.replace(/\s*\[PDF:\s*\{[\s\S]*$/i, '').trim();
  return result;
}

/**
 * Extracts explicit [PDF:{...}] payload from assistant text using balanced-brace parsing
 * and returns cleaned text for rendering.
 */
export function extractPdfPayload(text: string): { cleanText: string; pdf: PdfPayload | null } {
  if (!text) return { cleanText: '', pdf: null };

  const found = findBalancedPdfTag(text);
  if (!found) {
    // Also clean any truncated/incomplete [PDF:{... that never closed properly
    const incompleteMatch = /\[PDF:\s*\{[\s\S]*$/i.exec(text);
    if (incompleteMatch) {
      const partial = fallbackExtractFields(incompleteMatch[0]);
      const cleanText = text.slice(0, incompleteMatch.index).trim();
      if (partial?.content && partial.content.trim().length > 20) {
        const title = (partial.title || 'ULTRON Document').trim();
        const rawFilename = (partial.filename || title).trim();
        const filename = rawFilename.toLowerCase().endsWith('.pdf')
          ? rawFilename
          : `${rawFilename.replace(/\s+/g, '-').toLowerCase()}.pdf`;
        return {
          cleanText,
          pdf: {
            filename,
            title: repairLatexControlChars(title),
            content: repairLatexControlChars(partial.content.trim()),
          },
        };
      }
      return { cleanText, pdf: null };
    }
    return { cleanText: text, pdf: null };
  }

  const cleanText = stripRawPdfTags(text);

  let parsed: any = null;
  try {
    parsed = JSON.parse(found.jsonStr);
  } catch {
    try {
      parsed = JSON.parse(repairJsonCandidate(found.jsonStr));
    } catch {
      parsed = fallbackExtractFields(found.jsonStr);
    }
  }

  if (!parsed) {
    return { cleanText, pdf: null };
  }

  const rawTitle = typeof parsed.title === 'string' && parsed.title.trim() ? parsed.title.trim() : 'ULTRON Document';
  const title = repairLatexControlChars(rawTitle);

  const rawFilename =
    typeof parsed.filename === 'string' && parsed.filename.trim()
      ? parsed.filename.trim()
      : title;
  const filename = rawFilename.toLowerCase().endsWith('.pdf')
    ? rawFilename
    : `${rawFilename.replace(/[^a-zA-Z0-9_\-\s]/g, '').trim().replace(/\s+/g, '-').toLowerCase() || 'ultron-document'}.pdf`;

  let content =
    typeof parsed.content === 'string' && parsed.content.trim()
      ? repairLatexControlChars(parsed.content.trim())
      : cleanText;

  // Guard against double-escaped newlines still lingering after fallback parse
  if (content.includes('\\n') && !content.includes('\n')) {
    content = content.replace(/\\n/g, '\n');
  }

  if (!content) {
    return { cleanText, pdf: null };
  }

  return {
    cleanText,
    pdf: { filename, title, content },
  };
}

/**
 * Checks whether a user prompt is requesting PDF creation/export.
 */
export function isPdfRequestPrompt(prompt: string): boolean {
  if (!prompt) return false;
  return /(\bpdf\b.*\b(banao|bana|banado|banaye|create|make|generate|export|chahiye|do|taiyar|likh|bhej)\b|\b(create|make|generate|export|write|convert|prepare)\b.*\bpdf\b|\bpdf\s*(file|document|notes|sheet|report)\b)/i.test(
    prompt
  );
}

/**
 * Triggers a browser download of a real binary PDF generated by /api/generate-pdf.
 */
export async function downloadRealPdf(payload: PdfPayload): Promise<void> {
  const response = await fetch('/api/generate-pdf', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to generate PDF file');
  }

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = payload.filename.endsWith('.pdf') ? payload.filename : `${payload.filename}.pdf`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}
