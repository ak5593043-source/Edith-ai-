import * as pdfParseModule from 'pdf-parse';
import mammoth from 'mammoth';
import * as XLSX from 'xlsx';
import JSZip from 'jszip';
import yaml from 'yaml';
import { getGeminiClient } from './groq.ts';

const pdfParse = (pdfParseModule as any).default || pdfParseModule;

export interface ParsedDocument {
  name: string;
  type: string;
  text: string;
  size: number;
  category: 'document' | 'spreadsheet' | 'presentation' | 'data' | 'image' | 'audio' | 'video' | 'archive' | 'code' | 'other';
  isImage?: boolean;
  base64Data?: string;
  metadata?: Record<string, any>;
}

// Security limits
const MAX_ZIP_FILES = 80;
const MAX_ZIP_UNCOMPRESSED_BYTES = 25 * 1024 * 1024; // 25MB
const MAX_PREVIEW_TABLE_ROWS = 40;

/**
 * Universal file parser supporting documents, spreadsheets, presentations, data,
 * images, audio (with neural speech-to-text), video, archives, and code files.
 */
export async function parseDocumentBuffer(
  buffer: Buffer,
  filename: string,
  mimetype: string
): Promise<ParsedDocument> {
  const size = buffer.length;
  const lowerName = filename.toLowerCase();
  const ext = lowerName.split('.').pop() || '';

  // 1. IMAGES
  if (
    mimetype.startsWith('image/') ||
    ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'tiff', 'tif', 'svg'].includes(ext)
  ) {
    const safeMime = mimetype && mimetype.startsWith('image/') ? mimetype : `image/${ext === 'svg' ? 'svg+xml' : ext}`;
    const base64Data = `data:${safeMime};base64,${buffer.toString('base64')}`;
    return {
      name: filename,
      type: safeMime,
      category: 'image',
      text: `[Attached Image: ${filename} (${(size / 1024).toFixed(1)} KB, format: ${ext.toUpperCase()})]`,
      size,
      isImage: true,
      base64Data,
      metadata: { extension: ext, sizeInBytes: size },
    };
  }

  // 2. AUDIO (MP3, WAV, M4A, AAC, OGG, FLAC) -> Transcribe via Gemini
  if (
    mimetype.startsWith('audio/') ||
    ['mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac', 'weba'].includes(ext)
  ) {
    const audioMime = mimetype && mimetype.startsWith('audio/') ? mimetype : `audio/${ext === 'mp3' ? 'mpeg' : ext}`;
    let transcript = '';
    let transcriptionStatus = 'Pending transcription';

    try {
      const gemini = getGeminiClient();
      if (gemini) {
        const audioPart = {
          inlineData: {
            mimeType: audioMime,
            data: buffer.toString('base64'),
          },
        };
        const response = await gemini.models.generateContent({
          model: 'gemini-3.5-transcribe',
          contents: {
            parts: [
              audioPart,
              { text: 'Transcribe this audio verbatim in its original spoken language (Hindi, English, or Hinglish). Do not add commentary.' },
            ],
          },
        });
        transcript = response.text?.trim() || '';
        transcriptionStatus = transcript ? 'Transcribed successfully' : 'No speech detected in audio';
      } else {
        transcriptionStatus = 'Gemini transcription key not configured; attached as audio reference';
      }
    } catch (err: any) {
      console.warn('Audio transcription failed:', err.message);
      transcriptionStatus = `Transcription note: ${err.message || 'Could not automatically transcribe speech'}`;
    }

    const displayText = transcript
      ? `[Audio Transcription for ${filename}]:\n\n"${transcript}"`
      : `[Attached Audio File: ${filename} (${(size / 1024).toFixed(1)} KB, format: ${ext.toUpperCase()})]\nStatus: ${transcriptionStatus}`;

    return {
      name: filename,
      type: audioMime,
      category: 'audio',
      text: displayText,
      size,
      metadata: {
        extension: ext,
        transcriptionStatus,
        hasTranscript: !!transcript,
      },
    };
  }

  // 3. VIDEO (MP4, MOV, WEBM, MKV, AVI)
  if (
    mimetype.startsWith('video/') ||
    ['mp4', 'mov', 'webm', 'mkv', 'avi'].includes(ext)
  ) {
    const videoMime = mimetype && mimetype.startsWith('video/') ? mimetype : `video/${ext}`;
    return {
      name: filename,
      type: videoMime,
      category: 'video',
      text: `[Attached Video File: ${filename} (${(size / (1024 * 1024)).toFixed(2)} MB, container: ${ext.toUpperCase()})]\nULTRON is ready to discuss this video file, answer questions regarding its content, and guide you with video production, scripting, or analysis.`,
      size,
      metadata: { extension: ext, sizeInMB: (size / (1024 * 1024)).toFixed(2) },
    };
  }

  // 4. SPREADSHEETS (XLS, XLSX, CSV, ODS)
  if (
    ['xlsx', 'xls', 'csv', 'ods'].includes(ext) ||
    mimetype.includes('spreadsheet') ||
    mimetype.includes('excel') ||
    mimetype === 'text/csv'
  ) {
    try {
      const workbook = XLSX.read(buffer, { type: 'buffer' });
      const sheetSummaries: string[] = [];

      for (const sheetName of workbook.SheetNames) {
        const sheet = workbook.Sheets[sheetName];
        if (!sheet) continue;

        // Convert sheet to json array of objects or arrays
        const rows: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
        if (rows.length === 0) {
          sheetSummaries.push(`### Sheet: ${sheetName} (Empty)`);
          continue;
        }

        const totalRows = rows.length;
        const totalCols = rows[0]?.length || 0;
        const previewRows = rows.slice(0, MAX_PREVIEW_TABLE_ROWS);

        // Build Markdown table representation
        let mdTable = '';
        if (previewRows.length > 0) {
          const headerRow = previewRows[0];
          mdTable += `| ${headerRow.map((h: any) => String(h || '').replace(/\|/g, '\\|')).join(' | ')} |\n`;
          mdTable += `| ${headerRow.map(() => '---').join(' | ')} |\n`;

          for (let r = 1; r < previewRows.length; r++) {
            const row = previewRows[r];
            const padded = headerRow.map((_: any, idx: number) => String(row[idx] ?? '').replace(/\|/g, '\\|'));
            mdTable += `| ${padded.join(' | ')} |\n`;
          }
        }

        const note = totalRows > MAX_PREVIEW_TABLE_ROWS ? `\n*(Showing first ${MAX_PREVIEW_TABLE_ROWS} of ${totalRows} total rows)*` : '';
        sheetSummaries.push(`### Sheet: "${sheetName}" (${totalRows} rows, ${totalCols} columns)\n\n${mdTable}${note}`);
      }

      const combinedText = `[Spreadsheet Analysis for ${filename}]\n\n${sheetSummaries.join('\n\n---\n\n')}`;
      return {
        name: filename,
        type: mimetype || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        category: 'spreadsheet',
        text: combinedText,
        size,
        metadata: { sheetCount: workbook.SheetNames.length, sheets: workbook.SheetNames },
      };
    } catch (err: any) {
      throw new Error(`Failed to parse spreadsheet (${filename}): ${err.message}`);
    }
  }

  // 5. PRESENTATIONS (PPTX, ODP, PPT)
  if (['pptx', 'odp'].includes(ext)) {
    try {
      const zip = await JSZip.loadAsync(buffer);
      const slideTexts: string[] = [];

      if (ext === 'pptx') {
        // Find slide xml files: ppt/slides/slide1.xml, slide2.xml, etc.
        const slideFiles = Object.keys(zip.files)
          .filter((f) => /^ppt\/slides\/slide\d+\.xml$/i.test(f))
          .sort((a, b) => {
            const numA = parseInt(a.replace(/\D/g, ''), 10) || 0;
            const numB = parseInt(b.replace(/\D/g, ''), 10) || 0;
            return numA - numB;
          });

        for (let i = 0; i < slideFiles.length; i++) {
          const xml = await zip.files[slideFiles[i]].async('text');
          // Match all <a:t>...</a:t> text nodes in PPTX
          const matches = xml.match(/<a:t[^>]*>([\s\S]*?)<\/a:t>/g) || [];
          const text = matches
            .map((m) => m.replace(/<[^>]+>/g, '').trim())
            .filter(Boolean)
            .join(' ');
          slideTexts.push(`### Slide ${i + 1}\n${text || '[Slide with shapes or media only]'}`);
        }
      } else if (ext === 'odp') {
        // OpenDocument Presentation content.xml
        const contentXmlFile = zip.file('content.xml');
        if (contentXmlFile) {
          const xml = await contentXmlFile.async('text');
          const paragraphs = (xml.match(/<text:p[^>]*>([\s\S]*?)<\/text:p>/g) || [])
            .map((p) => p.replace(/<[^>]+>/g, '').trim())
            .filter(Boolean);
          slideTexts.push(paragraphs.join('\n\n'));
        }
      }

      const presentationContent = slideTexts.length > 0
        ? slideTexts.join('\n\n')
        : `[Presentation file parsed: ${filename} - No extractable text found in slides]`;

      return {
        name: filename,
        type: mimetype || 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        category: 'presentation',
        text: `[Presentation Deck: ${filename}]\n\n${presentationContent}`,
        size,
        metadata: { slideCount: slideTexts.length },
      };
    } catch (err: any) {
      throw new Error(`Failed to parse presentation (${filename}): ${err.message}`);
    }
  }

  // 6. ARCHIVES (ZIP, TAR, GZ)
  if (['zip'].includes(ext)) {
    try {
      const zip = await JSZip.loadAsync(buffer);
      const fileList = Object.keys(zip.files);
      let totalUncompressed = 0;
      const entries: string[] = [];
      const extractedSnippets: string[] = [];

      for (let i = 0; i < Math.min(fileList.length, MAX_ZIP_FILES); i++) {
        const relativePath = fileList[i];
        // Protect against directory traversal attacks
        if (relativePath.includes('..') || relativePath.startsWith('/') || relativePath.startsWith('\\')) {
          continue;
        }

        const entry = zip.files[relativePath];
        entries.push(entry.dir ? `${relativePath} (directory)` : `${relativePath} (${(entry.comment?.length || 0)} bytes)`);

        // If file is a readable text / code file and total uncompressed size limit not exceeded
        if (!entry.dir && /\.(txt|md|json|js|ts|py|html|css|xml|csv|yaml|yml|sql)$/i.test(relativePath)) {
          if (totalUncompressed < MAX_ZIP_UNCOMPRESSED_BYTES) {
            const content = await entry.async('text');
            totalUncompressed += content.length;
            const snippet = content.slice(0, 3000);
            extractedSnippets.push(`--- File: ${relativePath} ---\n${snippet}${content.length > 3000 ? '\n...[truncated]' : ''}`);
          }
        }
      }

      const archiveReport = `[Archive Inspector: ${filename}]\n\n` +
        `Total Files in Archive: ${fileList.length}\n` +
        `File Tree:\n${entries.slice(0, 40).map((e) => `- ${e}`).join('\n')}` +
        (fileList.length > 40 ? `\n...and ${fileList.length - 40} more files` : '') +
        (extractedSnippets.length > 0 ? `\n\nExtracted Content Preview:\n\n${extractedSnippets.join('\n\n')}` : '');

      return {
        name: filename,
        type: 'application/zip',
        category: 'archive',
        text: archiveReport,
        size,
        metadata: { totalFiles: fileList.length },
      };
    } catch (err: any) {
      throw new Error(`Failed to inspect ZIP archive: ${err.message}`);
    }
  }

  // 7. PDF DOCUMENTS
  if (mimetype === 'application/pdf' || ext === 'pdf') {
    try {
      const data = await pdfParse(buffer);
      const text = data.text ? data.text.trim() : '';
      return {
        name: filename,
        type: 'application/pdf',
        category: 'document',
        text: text || '[Empty PDF document or contains only scanned images without selectable text]',
        size,
        metadata: { numPages: data.numpages, info: data.info },
      };
    } catch (err: any) {
      throw new Error(`Failed to parse PDF document (${filename}): ${err.message}`);
    }
  }

  // 8. WORD (.docx) & OPENDOCUMENT (.odt)
  if (
    mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    ext === 'docx'
  ) {
    try {
      const result = await mammoth.extractRawText({ buffer });
      return {
        name: filename,
        type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        category: 'document',
        text: result.value.trim() || '[Empty Word document]',
        size,
      };
    } catch (err: any) {
      throw new Error(`Failed to parse DOCX document: ${err.message}`);
    }
  }

  if (ext === 'odt') {
    try {
      const zip = await JSZip.loadAsync(buffer);
      const contentXml = zip.file('content.xml');
      if (contentXml) {
        const xml = await contentXml.async('text');
        const text = (xml.match(/<text:[ph][^>]*>([\s\S]*?)<\/text:[ph]>/g) || [])
          .map((t) => t.replace(/<[^>]+>/g, '').trim())
          .filter(Boolean)
          .join('\n\n');
        return {
          name: filename,
          type: 'application/vnd.oasis.opendocument.text',
          category: 'document',
          text: text || '[Empty ODT document]',
          size,
        };
      }
    } catch (err: any) {
      throw new Error(`Failed to parse ODT document: ${err.message}`);
    }
  }

  // 9. RICH TEXT FORMAT (.rtf)
  if (ext === 'rtf' || mimetype === 'application/rtf') {
    try {
      const rawRtf = buffer.toString('utf-8');
      // Simple regex stripper for RTF tags
      const cleaned = rawRtf
        .replace(/\\par[d]?/g, '\n')
        .replace(/\\[a-zA-Z0-9\-]+ ?/g, '')
        .replace(/[{}]/g, '')
        .trim();
      return {
        name: filename,
        type: 'application/rtf',
        category: 'document',
        text: cleaned || '[Empty RTF document]',
        size,
      };
    } catch (err: any) {
      throw new Error(`Failed to parse RTF: ${err.message}`);
    }
  }

  // 10. YAML & JSON DATA FORMATS
  if (['yaml', 'yml'].includes(ext)) {
    try {
      const rawText = buffer.toString('utf-8');
      const parsedObj = yaml.parse(rawText);
      const formattedJson = JSON.stringify(parsedObj, null, 2);
      return {
        name: filename,
        type: 'application/x-yaml',
        category: 'data',
        text: `[YAML Data File: ${filename}]\n\`\`\`yaml\n${rawText}\n\`\`\`\n\nParsed Data Structure (JSON equivalent):\n\`\`\`json\n${formattedJson}\n\`\`\``,
        size,
      };
    } catch (err: any) {
      // Return as raw text if YAML parsing errors
      return {
        name: filename,
        type: 'application/x-yaml',
        category: 'data',
        text: buffer.toString('utf-8'),
        size,
      };
    }
  }

  if (ext === 'json' || mimetype === 'application/json') {
    try {
      const rawText = buffer.toString('utf-8');
      const parsedObj = JSON.parse(rawText);
      const prettyJson = JSON.stringify(parsedObj, null, 2);
      return {
        name: filename,
        type: 'application/json',
        category: 'data',
        text: `[JSON Data File: ${filename}]\n\`\`\`json\n${prettyJson}\n\`\`\``,
        size,
      };
    } catch {
      return {
        name: filename,
        type: 'application/json',
        category: 'data',
        text: buffer.toString('utf-8'),
        size,
      };
    }
  }

  // 11. HTML / XML
  if (['html', 'htm', 'xml'].includes(ext) || mimetype.includes('html') || mimetype.includes('xml')) {
    const rawText = buffer.toString('utf-8');
    return {
      name: filename,
      type: mimetype || `text/${ext}`,
      category: 'data',
      text: `[Source: ${filename}]\n\`\`\`${ext}\n${rawText}\n\`\`\``,
      size,
    };
  }

  // 12. CODE FILES (JS, TS, JSX, TSX, PY, JAVA, C, CPP, CSS, SQL, PHP, SH, GO, RS, RB)
  const codeExtensions = ['js', 'ts', 'jsx', 'tsx', 'py', 'java', 'c', 'cpp', 'h', 'hpp', 'css', 'sql', 'php', 'sh', 'go', 'rs', 'rb'];
  if (codeExtensions.includes(ext)) {
    const rawCode = buffer.toString('utf-8');
    const lines = rawCode.split('\n').length;
    return {
      name: filename,
      type: mimetype || 'text/plain',
      category: 'code',
      text: `[Source Code File: ${filename} (${lines} lines)]\n\`\`\`${ext}\n${rawCode}\n\`\`\``,
      size,
      metadata: { lines, extension: ext },
    };
  }

  // 13. FALLBACK: Plain Text & Markdown
  try {
    const text = buffer.toString('utf-8');
    return {
      name: filename,
      type: mimetype || 'text/plain',
      category: ext === 'md' ? 'document' : 'other',
      text,
      size,
    };
  } catch (err: any) {
    throw new Error(`Failed to decode file contents as text: ${err.message}`);
  }
}
