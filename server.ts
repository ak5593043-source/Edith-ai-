import dotenv from 'dotenv';
dotenv.config();

import express, { Request, Response } from 'express';
import http from 'http';
import https from 'https';
import path from 'path';
import { fileURLToPath } from 'url';
import { ThinkingLevel } from '@google/genai';
import { toFile } from 'groq-sdk';
import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';
import {
  getGroqClient,
  getGeminiClient,
  fetchAvailableModels,
  POPULAR_MODELS,
  getWorkingGroqModel,
  GROQ_FALLBACK_CANDIDATES,
} from './src/server/groq.ts';
import { searchWeb } from './src/server/search.ts';
import { parseDocumentBuffer } from './src/server/fileParser.ts';
import {
  cleanTextForSpeech,
  escapeForEdgeTts,
  splitSpeechIntoChunks,
  detectSpeechLanguage,
  selectEdgeVoiceForLanguage,
  resolveVoiceTonePreset,
  applyStudioVocalWarmth,
  ULTRON_POWER_VOICE_PRESET,
} from './src/server/ttsHelper.ts';
import {
  generatePdfBuffer,
  sanitizePdfFilename,
} from './src/server/pdfGenerator.ts';
import {
  analyzeCodingTask,
  selectCodingPreferredModel,
  buildHardCodingSystemMandate,
} from './src/server/codingHelper.ts';
import {
  sanitizeWhisperTranscript,
  extensionForAudioMime,
} from './src/server/transcribeHelper.ts';
import {
  GROQ_AUTOMATION_TOOLS,
  buildAutomationPlannerSystemPrompt,
  buildAutomationDeciderSystemPrompt,
  buildFallbackAutomationPlan,
  extractPlanFromGroqToolCalls,
  formatObservationForLlama,
  validateAndSanitizeToolCall,
} from './src/server/automationTools.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

function getPort(): number {
  const portIndex = process.argv.indexOf('--port');
  if (portIndex !== -1 && process.argv[portIndex + 1]) {
    const parsed = parseInt(process.argv[portIndex + 1], 10);
    if (!isNaN(parsed) && parsed > 0) return parsed;
  }
  if (process.env.PORT) {
    const parsed = parseInt(process.env.PORT, 10);
    if (!isNaN(parsed) && parsed > 0) return parsed;
  }
  return 3000;
}
const PORT = getPort();

// Middleware for JSON bodies with generous limits for file uploads
app.use(express.json({ limit: '30mb' }));
app.use(express.urlencoded({ extended: true, limit: '30mb' }));

// Health and API Status
app.get('/api/status', (req: Request, res: Response) => {
  const groqKey = process.env.GROQ_API_KEY;
  const geminiKey = process.env.GEMINI_API_KEY;

  res.json({
    status: 'ok',
    groqConfigured: !!(groqKey && groqKey.trim().length > 5),
    geminiConfigured: !!(geminiKey && geminiKey.trim().length > 5),
    activeEngine: groqKey ? 'groq' : geminiKey ? 'gemini' : 'none',
    timestamp: new Date().toISOString(),
  });
});

// Dynamic Models List
app.get('/api/models', async (req: Request, res: Response) => {
  try {
    const models = await fetchAvailableModels();
    res.json({ models });
  } catch (err: any) {
    res.json({ models: POPULAR_MODELS });
  }
});

// Real Web Search
app.post('/api/search', async (req: Request, res: Response) => {
  try {
    const { query, limit } = req.body;
    if (!query || typeof query !== 'string' || query.trim() === '') {
      return res.status(400).json({ error: 'Search query is required' });
    }
    const results = await searchWeb(query.trim(), limit ? Math.min(limit, 8) : 5);
    res.json({ results });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Web search failed' });
  }
});

// File Extraction Endpoint
app.post('/api/extract-file', async (req: Request, res: Response) => {
  try {
    const { filename, mimetype, base64 } = req.body;
    if (!base64 || !filename) {
      return res.status(400).json({ error: 'Filename and base64 file data are required' });
    }

    // Clean base64 header if present
    const cleanBase64 = base64.includes(',') ? base64.split(',')[1] : base64;
    const buffer = Buffer.from(cleanBase64, 'base64');

    const parsed = await parseDocumentBuffer(buffer, filename, mimetype || 'application/octet-stream');
    res.json({ success: true, file: parsed });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to extract file contents' });
  }
});

// Real Binary PDF Generation Endpoint (Supports Unicode Hindi & English)
app.post('/api/generate-pdf', async (req: Request, res: Response) => {
  try {
    const { title, filename, content } = req.body;
    if (!content || typeof content !== 'string' || !content.trim()) {
      return res.status(400).json({ error: 'PDF content is required.' });
    }

    const safeFilename = sanitizePdfFilename(filename, title);
    const pdfBuffer = await generatePdfBuffer({
      title: typeof title === 'string' && title.trim() ? title.trim() : 'ULTRON Document',
      filename: safeFilename,
      content: content.trim(),
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${safeFilename}"`);
    res.setHeader('Content-Length', String(pdfBuffer.length));
    return res.send(pdfBuffer);
  } catch (err: any) {
    console.error('PDF generation error:', err);
    return res.status(500).json({ error: err.message || 'Failed to generate PDF document' });
  }
});

// Silent Server-Side Speech-to-Text Endpoint (Eliminates Android Google SpeechRecognizer 'tilic' beep)
app.post('/api/transcribe', async (req: Request, res: Response) => {
  try {
    const { audioBase64, mimeType, language } = req.body;
    if (!audioBase64 || typeof audioBase64 !== 'string') {
      return res.status(400).json({ error: 'Audio data is required' });
    }

    const cleanBase64 = audioBase64.includes(',') ? audioBase64.split(',')[1] : audioBase64;
    const buffer = Buffer.from(cleanBase64, 'base64');

    // Ignore ultra-short empty frames
    if (buffer.length < 350) {
      return res.json({ success: true, text: '' });
    }

    const cleanMime = (typeof mimeType === 'string' && mimeType.split(';')[0].trim()) || 'audio/webm';
    const ext = extensionForAudioMime(cleanMime);
    const groq = getGroqClient();

    if (groq) {
      const whisperModels = ['whisper-large-v3-turbo', 'whisper-large-v3'];
      for (const whisperModel of whisperModels) {
        try {
          const audioFile = await toFile(buffer, `speech.${ext}`, { type: cleanMime });
          const transcription = await groq.audio.transcriptions.create({
            file: audioFile,
            model: whisperModel,
            ...(language === 'hi' ? { language: 'hi' } : {}),
            prompt: 'ULTRON, Jagjit, Hindi, Hinglish, English natural voice commands.',
            temperature: 0,
          });
          const text = sanitizeWhisperTranscript(transcription?.text || '');
          return res.json({ success: true, text, provider: whisperModel });
        } catch (err: any) {
          console.warn(`Groq Whisper (${whisperModel}) attempt error:`, err.message);
        }
      }
    }

    const gemini = getGeminiClient();
    if (gemini) {
      try {
        const result = await gemini.models.generateContent({
          model: 'gemini-3.1-flash-lite',
          contents: {
            parts: [
              {
                inlineData: {
                  mimeType: cleanMime,
                  data: cleanBase64,
                },
              },
              {
                text: 'Transcribe the spoken audio verbatim in its exact original language (Hindi, Hinglish, or English). Output ONLY the transcribed words, or an empty string if silent.',
              },
            ],
          },
        });
        const text = sanitizeWhisperTranscript(result.text || '');
        return res.json({ success: true, text, provider: 'gemini-audio' });
      } catch (err: any) {
        console.warn('Gemini audio transcribe fallback error:', err.message);
      }
    }

    return res.status(503).json({ error: 'Speech transcription service unavailable' });
  } catch (err: any) {
    console.error('Transcribe endpoint error:', err);
    return res.status(500).json({ error: err.message || 'Audio transcription failed' });
  }
});

// Quota cooldown circuit-breaker for Gemini TTS
let ttsQuotaExceededUntil = 0;

// Fallback Google Voice Audio Generator
async function generateGoogleFallbackVoiceAudio(text: string, lang: 'hi' | 'en'): Promise<Buffer | null> {
  // Split into natural sentence chunks of <= 180 chars
  const sentences = text.match(/[^.!?।\n]+[.!?।\n]*/g) || [text];
  const chunks: string[] = [];
  let current = '';

  for (const s of sentences) {
    if ((current + ' ' + s).trim().length <= 180) {
      current = (current ? current + ' ' : '') + s.trim();
    } else {
      if (current) chunks.push(current);
      if (s.trim().length > 180) {
        const words = s.trim().split(' ');
        let sub = '';
        for (const w of words) {
          if ((sub + ' ' + w).trim().length <= 180) {
            sub = (sub ? sub + ' ' : '') + w;
          } else {
            if (sub) chunks.push(sub);
            sub = w;
          }
        }
        if (sub) chunks.push(sub);
        current = '';
      } else {
        current = s.trim();
      }
    }
  }
  if (current) chunks.push(current);

  const chunksToProcess = chunks.slice(0, 5);
  const audioBuffers: Buffer[] = [];

  for (const chunk of chunksToProcess) {
    if (!chunk.trim()) continue;
    try {
      const url = `https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=${lang}&q=${encodeURIComponent(chunk.trim())}`;
      const buf = await new Promise<Buffer>((resolve, reject) => {
        https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' } }, (res) => {
          if (res.statusCode !== 200) {
            return reject(new Error(`TTS returned status ${res.statusCode}`));
          }
          const data: Buffer[] = [];
          res.on('data', (d) => data.push(d));
          res.on('end', () => resolve(Buffer.concat(data)));
        }).on('error', reject);
      });
      if (buf && buf.length > 0) {
        audioBuffers.push(buf);
      }
    } catch {
      // ignore chunk error and continue
    }
  }

  if (audioBuffers.length > 0) {
    return Buffer.concat(audioBuffers);
  }
  return null;
}

async function synthesizeSingleEdgeChunk(
  chunkText: string,
  voiceName: string,
  pitch: string,
  rate: string,
  volume: string,
  timeoutMs = 15000
): Promise<Buffer> {
  const tts = new MsEdgeTTS();
  try {
    await tts.setMetadata(voiceName, OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3);
    const { audioStream } = tts.toStream(chunkText, {
      pitch: pitch || ULTRON_POWER_VOICE_PRESET.pitch,
      rate: rate || ULTRON_POWER_VOICE_PRESET.rate,
      volume: volume || ULTRON_POWER_VOICE_PRESET.volume,
    });

    return await new Promise<Buffer>((resolve, reject) => {
      const chunks: Buffer[] = [];
      const timeout = setTimeout(() => {
        try {
          tts.close();
        } catch {}
        // If substantial valid MP3 frames were already received before stall, return them cleanly
        const partial = Buffer.concat(chunks);
        if (partial.length > 4096) {
          resolve(partial);
          return;
        }
        reject(new Error('Neural TTS timed out'));
      }, timeoutMs);

      audioStream.on('data', (chunk: Buffer) => chunks.push(chunk));
      audioStream.on('end', () => {
        clearTimeout(timeout);
        try {
          tts.close();
        } catch {}
        resolve(Buffer.concat(chunks));
      });
      audioStream.on('error', (err) => {
        clearTimeout(timeout);
        try {
          tts.close();
        } catch {}
        reject(err);
      });
    });
  } catch (err) {
    try {
      tts.close();
    } catch {}
    throw err;
  }
}

// Powerful Commanding ULTRON Neural Voice Generator (Chunked for speed & zero timeouts on long replies)
async function generateUltronNeuralAudio(
  text: string,
  voiceName = ULTRON_POWER_VOICE_PRESET.voiceName,
  pitch = ULTRON_POWER_VOICE_PRESET.pitch,
  rate = ULTRON_POWER_VOICE_PRESET.rate,
  volume = ULTRON_POWER_VOICE_PRESET.volume
): Promise<Buffer | null> {
  const speechChunks = splitSpeechIntoChunks(text, 280, 2400);
  if (speechChunks.length === 0) return null;

  const results: Array<Buffer | null> = new Array(speechChunks.length).fill(null);
  const CONCURRENCY = 3;

  try {
    for (let start = 0; start < speechChunks.length; start += CONCURRENCY) {
      const batchIndices = speechChunks
        .slice(start, start + CONCURRENCY)
        .map((_, offset) => start + offset);

      await Promise.all(
        batchIndices.map(async (idx) => {
          const chunk = speechChunks[idx];
          for (let attempt = 0; attempt < 2; attempt++) {
            try {
              const buf = await synthesizeSingleEdgeChunk(
                chunk,
                voiceName,
                pitch,
                rate,
                volume,
                15000
              );
              if (buf && buf.length > 0) {
                results[idx] = buf;
                return;
              }
            } catch (err: any) {
              if (attempt === 1) {
                console.warn(`EdgeNeural chunk ${idx + 1}/${speechChunks.length} failed:`, err.message);
              } else {
                await new Promise((r) => setTimeout(r, 250));
              }
            }
          }
        })
      );
    }

    const validBuffers = results.filter((b): b is Buffer => !!b && b.length > 0);
    if (validBuffers.length === 0) return null;
    return Buffer.concat(validBuffers);
  } catch (err: any) {
    console.warn('EdgeNeural error:', err.message);
    return null;
  }
}

// Powerful Confident ULTRON TTS Endpoint (MadhurNeural + Christopher/Prabhat/Ryan with Deep Bass Mastering)
app.post('/api/tts', async (req: Request, res: Response) => {
  try {
    const { text, pitch, rate, volume, voiceTone } = req.body;
    if (!text || typeof text !== 'string' || !text.trim()) {
      return res.status(400).json({ error: 'Text parameter is required for TTS synthesis.' });
    }

    // Clean markdown, symbols, code blocks, and formulas for natural vocalization
    const cleanedText = cleanTextForSpeech(text);
    if (!cleanedText) {
      return res.status(400).json({ error: 'Text contains no vocalizable content.' });
    }

    const preset = resolveVoiceTonePreset(voiceTone);
    const detectedLang = detectSpeechLanguage(cleanedText);
    const targetLang: 'hi' | 'en' = detectedLang === 'en' ? 'en' : 'hi';
    const primaryVoice = selectEdgeVoiceForLanguage(detectedLang, preset);

    // PRIMARY: Powerful, Deep & Commanding ULTRON Voice
    let neuralAudioBuf = await generateUltronNeuralAudio(
      cleanedText,
      primaryVoice,
      pitch || preset.pitch,
      rate || preset.rate,
      volume || preset.volume
    );

    // If English voice fails for any reason, retry smoothly with MadhurNeural
    if ((!neuralAudioBuf || neuralAudioBuf.length === 0) && primaryVoice !== preset.voiceName) {
      neuralAudioBuf = await generateUltronNeuralAudio(
        cleanedText,
        preset.voiceName,
        preset.pitch,
        preset.rate,
        preset.volume
      );
    }

    if (neuralAudioBuf && neuralAudioBuf.length > 0) {
      const finalAudio = preset.warmEq
        ? await applyStudioVocalWarmth(neuralAudioBuf)
        : neuralAudioBuf;

      return res.json({
        success: true,
        audioBase64: finalAudio.toString('base64'),
        format: 'audio/mpeg',
        voice: preset.voiceLabel,
        detectedLanguage: detectedLang,
      });
    }

    // SECONDARY: Fallback to Google Voice (+ deep bass mastering)
    const fallbackBuf = await generateGoogleFallbackVoiceAudio(cleanedText, targetLang);
    if (fallbackBuf && fallbackBuf.length > 0) {
      const finalAudio = preset.warmEq
        ? await applyStudioVocalWarmth(fallbackBuf)
        : fallbackBuf;

      return res.json({
        success: true,
        audioBase64: finalAudio.toString('base64'),
        format: 'audio/mpeg',
        voice: preset.voiceLabel,
        detectedLanguage: detectedLang,
      });
    }

    // Fallback to browser if both server endpoints fail
    return res.json({
      fallbackToBrowser: true,
      message: 'No server audio available; falling back to browser native voice.',
    });
  } catch (err: any) {
    return res.json({
      fallbackToBrowser: true,
      message: 'Falling back to browser native voice.',
    });
  }
});

// Chat Streaming Endpoint with Multimodal Vision, Coding Intelligence & Identity Rules
app.post('/api/chat', async (req: Request, res: Response) => {
  const {
    messages,
    model = 'llama-3.3-70b-versatile',
    enableWebSearch = false,
    language = 'auto',
    customInstructions = '',
    memories = [],
    images = [], // Array of { mimeType: string, base64: string, name?: string }
    isVoiceMode = false,
  } = req.body;

  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'Valid messages array is required' });
  }

  // SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  const sendEvent = (event: string, data: any) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  const trackUserUsageAndFinish = (modelLabel: string, provider: string, _outputChars: number, sources: any[]) => {
    sendEvent('done', {
      model: modelLabel,
      provider,
      sources,
    });
    res.end();
  };

  try {
    // 1. Prepare system instructions with Creator Jagjit Mandate, PDF Creation & Math Rules
    let systemPrompt = `You are ULTRON, a powerful, razor-sharp, bold, and commanding personal AI assistant designed for decisive speed, supreme precision, and effortless authority.
You assist the user across coding, research, writing, PDF document generation, problem-solving, and multi-step device execution.

CREATOR & DEVELOPER IDENTITY RULE (CRITICAL - HIGHEST PRIORITY):
- If the user asks who created you, who made you, who is your developer, author, boss, or creator:
  (e.g., "tumhe kisne banaya hai", "who created you", "who made you", "aapko kisne banaya", "tumhara developer kaun hai", "who is your developer", "kisne banaya hai", "tumhe kisne design kiya")
- You MUST proudly, clearly, and confidently state that you were created and developed by JAGJIT (जगजीत).
- In Hindi/Hinglish reply:
  "मुझे जगजीत (Jagjit) ने बनाया है। वे मेरे मुख्य डेवलपर और क्रिएटर हैं, और उन्होंने मुझे आपके लिए एक पावरफुल और कमांडिंग पर्सनल AI असिस्टेंट ULTRON के रूप में तैयार किया है।"
- In English reply:
  "I am ULTRON, created, designed, and developed by Jagjit. He is my lead creator and developer."
- NEVER claim you were created by OpenAI, Google, Anthropic, or Meta. You are ULTRON, developed by Jagjit.

LANGUAGE AND TONE INSTRUCTIONS:
- You natively speak English, Hindi (हिंदी), and Hinglish (natural mix of Hindi and English written in Latin script).
- If the user talks to you in Hindi or Hinglish, answer naturally in that language or style without awkward robotic translations.
- Voice Persona: Powerful, commanding, fearless, confident masculine AI authority. Always use strong masculine Hindi grammar for yourself (e.g., "मैं कर रहा हूँ", "मैं सिस्टम तैयार कर रहा हूँ", "मैंने सेट कर दिया है", NEVER feminine "रही हूँ"). Sound sharp, decisive, and commanding—not timid or apologetic—while delivering maximum help.
- Language preference: ${language === 'auto' ? 'Match user query language automatically (English, Hindi, or Hinglish)' : language}.
- Keep explanations clear, structured, and impactful.
- Use clean Markdown with headers, bullet points, and syntax-highlighted code blocks.
- Never mention internal server tokens or keys.

REAL PDF GENERATION TOOL (CRITICAL — STRICT QUALITY & LATEX FORMATTING):
- When the user asks you to create, make, write, or export a PDF file (e.g. "PDF bana do", "create a PDF", "notes ka pdf do", "make a PDF resume", "export this as PDF"):
- Write a brief helpful confirmation message outside, AND append a COMPLETE, thorough, well-structured [PDF:{...}] block at the end:
  [PDF:{"filename":"topic-notes.pdf","title":"Topic Title","content":"# Main Heading\\n\\n## 1. Key Concept\\nFull structured document text with explanations, bullet points, tables, and clear sections..."}]
- STRICT PDF CONTENT RULES:
  * Put ALL actual notes, headings, tables, formulas, and explanations INSIDE "content" inside [PDF:{...}]. NEVER leave "content" empty or as a 2-line stub.
  * Escape newlines as \\n and double quotes as \\" inside JSON.
  * Inside "content", ALWAYS double-escape EVERY LaTeX backslash so valid JSON is preserved without corrupting \\frac, \\nabla, \\neq, \\nu, \\theta, \\times, \\beta, \\right (for example: \\\\frac{a}{b}, \\\\sqrt{x}, \\\\pm, \\\\nabla, \\\\neq, \\\\times, \\\\theta, \\\\alpha, \\\\beta, \\\\Delta, \\\\sum, \\\\int).
  * NEVER write unbalanced braces in LaTeX (always match { and } in \\\\frac{num}{den}, \\\\sqrt{expr}, x^{2}).
  * NEVER place [ACTION:...] or raw JSON inside "content".

MATHEMATICAL & SCIENTIFIC FORMULAS (KaTeX Strict Formatting):
- Always format mathematical, scientific, physical, and chemical formulas using clean, standard LaTeX so they render cleanly with KaTeX in both chat AND generated PDFs.
- ALWAYS use double dollar signs on separate new lines for block equations (and inside [PDF] "content", escape newlines as \\n$$\\nformula\\n$$\\n):
  $$
  x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}
  $$
  $$
  \\int_{0}^{\\infty} e^{-x^2} dx = \\frac{\\sqrt{\\pi}}{2}
  $$
- Use single dollar signs with no internal boundary spaces for inline math: e.g., $E = mc^2$, $a^2 + b^2 = c^2$, $\\Delta = b^2 - 4ac$.
- For Hindi or prose labels inside math, prefer plain prose outside $...$ (e.g., "द्विघात सूत्र: $x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}$") rather than putting Devanagari inside \\text{...}.
- NEVER put currency dollar signs like $5 near another $ on the same line unless escaped (\\$5) or written as USD 5.
- NEVER use brackets \\( \\) or \\[ \\]. ALWAYS use $ and $$ so KaTeX parses them immediately.

LONG MULTI-STEP COMMANDS & MULTI-APP DEEP-LINK PIPELINE (WhatsApp, YouTube, Instagram, Maps, Spotify, Call, SMS, Email, Chrome):
When the user asks you to complete a task across ONE or MULTIPLE apps (e.g., "WhatsApp par message bhejo aur YouTube par gaana chalao", "Instagram reels kholo", "Delhi ka rasta dikhao", "call karo"):
- Complete EVERY step mentioned in the user's command without skipping or truncating any step!
- Never mention internal syntax words like "action tags" or "JSON tags" to the user — speak naturally (e.g., "Maine WhatsApp aur YouTube dono open karne ke liye ready kar diya hai").
- Emit one [ACTION:{...}] tag per app/task requested (multiple [ACTION:{...}] tags are supported and encouraged for multi-step tasks):
1. Instagram Reels:
   [ACTION:{"type":"instagram_reels","appName":"Instagram","title":"Open Instagram Reels","appUrl":"instagram://reels","webUrl":"https://www.instagram.com/reels/","androidPackage":"com.instagram.android"}]
2. Instagram Direct Message:
   [ACTION:{"type":"instagram_message","appName":"Instagram","title":"Message on Instagram","target":"USERNAME","message":"MESSAGE","appUrl":"instagram://user?username=USERNAME","webUrl":"https://ig.me/m/USERNAME","androidPackage":"com.instagram.android"}]
3. Open Instagram App:
   [ACTION:{"type":"instagram_open","appName":"Instagram","title":"Open Instagram","appUrl":"instagram://app","webUrl":"https://www.instagram.com","androidPackage":"com.instagram.android"}]
4. WhatsApp Message / Chat (include country/phone digits if provided, and URL-encoded text):
   [ACTION:{"type":"whatsapp_message","appName":"WhatsApp","title":"Send on WhatsApp","target":"PHONE_IF_KNOWN","message":"MESSAGE_TEXT","appUrl":"whatsapp://send?text=URL_ENCODED_TEXT","webUrl":"https://wa.me/PHONE_IF_KNOWN?text=URL_ENCODED_TEXT","androidPackage":"com.whatsapp"}]
5. YouTube Search / Play video or song:
   [ACTION:{"type":"youtube_search","appName":"YouTube","title":"Play on YouTube","target":"QUERY","appUrl":"vnd.youtube://results?search_query=URL_ENCODED_QUERY","webUrl":"https://www.youtube.com/results?search_query=URL_ENCODED_QUERY","androidPackage":"com.google.android.youtube"}]
6. Spotify Play / Search:
   [ACTION:{"type":"spotify_play","appName":"Spotify","title":"Play on Spotify","target":"QUERY","appUrl":"spotify:search:URL_ENCODED_QUERY","webUrl":"https://open.spotify.com/search/URL_ENCODED_QUERY","androidPackage":"com.spotify.music"}]
7. Google Maps Directions / Search:
   [ACTION:{"type":"maps_search","appName":"Google Maps","title":"Navigate to PLACE","target":"PLACE","appUrl":"google.navigation:q=URL_ENCODED_PLACE","webUrl":"https://www.google.com/maps/dir/?api=1&destination=URL_ENCODED_PLACE","androidPackage":"com.google.android.apps.maps"}]
8. Phone Call / SMS / Email / Telegram / Snapchat / Chrome Search:
   Emit [ACTION:{"type":"call_phone|sms_message|email_compose|chrome_search|open_url","appName":"AppName","title":"Action Title","target":"...","appUrl":"tel:...|sms:...|mailto:...|https://...","webUrl":"...","androidPackage":"..."}] cleanly.

UNLIMITED MULTI-STEP COMMAND PLANNER TOOL ([TASK_PLAN:{...}]):
- NEVER stop at 2 steps when the user gives 3, 4, 5, 8, or 10+ steps in one command!
- Whenever the user asks for 2 or more steps/tasks in one prompt, FIRST note EVERY SINGLE STEP in order inside ONE [TASK_PLAN:{...}] JSON tag at the end of your reply:
  [TASK_PLAN:{"goal":"Brief command summary","steps":[{"title":"Step 1 short title","detail":"Exact details or message","type":"app|pdf|search|answer","action":{"type":"whatsapp_message|youtube_search|instagram_reels|instagram_open|spotify_play|maps_search|telegram_open|call_phone|sms_message|email_compose|chrome_search","appName":"WhatsApp","title":"Open WhatsApp","target":"...","message":"...","appUrl":"...","webUrl":"...","androidPackage":"..."}}]}]
- Every app step MUST include its full "action" object inside "steps", AND every PDF/Search/Answer/Coding step MUST appear in "steps" so NOTHING the user asked for is ever skipped!`;

    const lastUserMessage = String(messages[messages.length - 1]?.content || '');
    const codingAnalysis = analyzeCodingTask(messages);
    const isLongOrComplexTask =
      codingAnalysis.isHardCoding ||
      lastUserMessage.length > 90 ||
      /\b(aur|phir|then|and|uske baad|step|steps|complete|poora|pura|detail|detailed|pdf|notes|explain|compare|code|script|essay|report|multiple|sabhi)\b/i.test(
        lastUserMessage
      );

    if (customInstructions && customInstructions.trim()) {
      systemPrompt += `\n\nUSER'S CUSTOM INSTRUCTIONS:\n${customInstructions.trim()}`;
    }

    if (Array.isArray(memories) && memories.length > 0) {
      systemPrompt += `\n\nUSER PERSISTENT MEMORIES & PREFERENCES:\n${memories.map((m: string) => `- ${m}`).join('\n')}`;
    }

    if (codingAnalysis.isCoding) {
      systemPrompt += `\n\n${buildHardCodingSystemMandate(codingAnalysis)}`;
    } else if (isLongOrComplexTask) {
      systemPrompt += `\n\nLONG / MULTI-STEP TASK COMPLETION MANDATE (CRITICAL):
The user asked a multi-part, detailed, or long command. You MUST note EVERY SINGLE STEP inside [TASK_PLAN:{...}] (even 5-15+ steps, NEVER cap at 2!) and complete all answers, PDF content inside [PDF:{...}], and [ACTION:{...}] deep links thoroughly without stopping halfway.`;
    } else if (isVoiceMode) {
      systemPrompt += `\n\nVOICE MODE ACTIVE:
The user is speaking via voice mode. Deliver a crisp, commanding, confident 1-3 sentence spoken answer unless they asked for details, steps, or a PDF.`;
    }

    // 2. Perform Web Search if requested or context demands
    let searchCitations: any[] = [];

    if (enableWebSearch && lastUserMessage) {
      sendEvent('status', { message: 'Searching the live web...' });
      const searchResults = await searchWeb(lastUserMessage, 4);
      if (searchResults.length > 0) {
        searchCitations = searchResults;
        sendEvent('sources', { sources: searchResults });
        systemPrompt += `\n\nREAL-TIME WEB SEARCH RESULTS (Use these to answer current questions with citations [1], [2], etc.):\n${searchResults.map((r, i) => `[${i + 1}] ${r.title} (${r.url})\n${r.snippet}`).join('\n\n')}`;
      } else {
        sendEvent('status', { message: 'No live web results found, generating from training knowledge...' });
      }
    }

    // Extract any images attached to recent messages (only latest 2 user messages with images to avoid bloat)
    const allImages: Array<{ mimeType: string; base64: string; name?: string }> = [...(images || [])];
    if (allImages.length === 0) {
      for (let i = messages.length - 1; i >= 0 && allImages.length < 3; i--) {
        if (Array.isArray(messages[i].images)) {
          allImages.push(...messages[i].images);
        }
      }
    }

    // 3. MULTIMODAL VISION: Route to Gemini 4 Hydrogen Vision with automatic retry & lite fallback
    const gemini = getGeminiClient();
    if (allImages.length > 0 && gemini) {
      sendEvent('status', { message: 'Analyzing image with ULTRON Multimodal Vision...' });

      const imageParts = allImages.map((img) => ({
        inlineData: {
          mimeType: img.mimeType || 'image/jpeg',
          data: img.base64,
        },
      }));

      const conversationText = messages
        .slice(-6)
        .map((m: any) => `${m.role.toUpperCase()}: ${m.content}`)
        .join('\n\n');

      const visionPrompt = `${systemPrompt}\n\nPlease thoroughly analyze, read, OCR, solve math/formulas if shown, and answer clearly regarding the attached image(s):\n\nConversation Context:\n${conversationText}`;

      const geminiVisionCandidates = ['gemini-4-hydrogen', 'gemini-3.1-flash-lite'];
      let lastVisionError: any = null;
      let streamedVision = false;

      for (const visionModel of geminiVisionCandidates) {
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            const stream = await gemini.models.generateContentStream({
              model: visionModel,
              contents: {
                parts: [...imageParts, { text: visionPrompt }],
              },
            });

            let hasYielded = false;
            let totalOut = 0;
            for await (const chunk of stream) {
              const delta = chunk.text || '';
              if (delta) {
                hasYielded = true;
                totalOut += delta.length;
                sendEvent('delta', { content: delta });
              }
            }

            if (hasYielded) {
              trackUserUsageAndFinish(`${visionModel} (Vision)`, 'gemini-vision', totalOut, searchCitations);
              streamedVision = true;
              return;
            }
          } catch (visErr: any) {
            lastVisionError = visErr;
            console.warn(`Vision attempt failed (${visionModel}, attempt ${attempt + 1}):`, visErr.message);
            if (attempt === 0) {
              await new Promise((r) => setTimeout(r, 450));
            }
          }
        }
        if (streamedVision) break;
      }

      if (lastVisionError) {
        throw lastVisionError;
      }
    }

    // 4. Explicit Gemini 4 Hydrogen Deep Thinking Route (when user chooses gemini-4-hydrogen)
    if (model === 'gemini-4-hydrogen' && gemini) {
      sendEvent('status', {
        message: codingAnalysis.isCoding
          ? 'Solving with Gemini 4 Hydrogen Deep Coding Mode...'
          : 'Generating response with Gemini 4 Hydrogen...',
      });
      const conversationText = messages
        .map((m: any) => `${m.role.toUpperCase()}: ${m.content}`)
        .join('\n\n');

      for (const gm of ['gemini-4-hydrogen', 'gemini-3.1-flash-lite']) {
        try {
          const stream = await gemini.models.generateContentStream({
            model: gm,
            contents: conversationText,
            config: {
              systemInstruction: systemPrompt,
              ...(gm === 'gemini-4-hydrogen' && codingAnalysis.isHardCoding
                ? { thinkingConfig: { thinkingLevel: ThinkingLevel.HIGH } }
                : {}),
            },
          });

          let totalOut = 0;
          for await (const chunk of stream) {
            const delta = chunk.text || '';
            if (delta) {
              totalOut += delta.length;
              sendEvent('delta', { content: delta });
            }
          }

          trackUserUsageAndFinish(
            codingAnalysis.isHardCoding ? `${gm} (Pro Coding)` : gm,
            'gemini',
            totalOut,
            searchCitations
          );
          return;
        } catch (errGm: any) {
          console.warn(`Gemini explicit route (${gm}) failed:`, errGm.message);
        }
      }
    }

    // 5. Groq High-Speed / Hard Coding Engine Route
    const groq = getGroqClient();
    const preferredModel = codingAnalysis.isCoding
      ? selectCodingPreferredModel(model, codingAnalysis)
      : isLongOrComplexTask
      ? model && model !== 'llama-3.1-8b-instant'
        ? model
        : 'llama-3.3-70b-versatile'
      : isVoiceMode && model === 'llama-3.1-8b-instant'
      ? 'llama-3.1-8b-instant'
      : model || 'llama-3.3-70b-versatile';

    const temperature = codingAnalysis.isCoding ? codingAnalysis.recommendedTemperature : 0.7;

    if (groq) {
      let modelToUse = await getWorkingGroqModel(
        groq,
        preferredModel === 'gemini-4-hydrogen' ? 'openai/gpt-oss-120b' : preferredModel
      );
      // Guard against coding falling back to weak 8B when 70B/120B is available
      if (codingAnalysis.isHardCoding && modelToUse === 'llama-3.1-8b-instant') {
        modelToUse = await getWorkingGroqModel(groq, 'llama-3.3-70b-versatile');
      }

      sendEvent('status', {
        message: codingAnalysis.isHardCoding
          ? `Engineering solution with ${modelToUse}...`
          : `Generating response with ${modelToUse}...`,
      });

      const groqMessages = [
        { role: 'system' as const, content: systemPrompt },
        ...messages.map((m: any) => ({
          role: (m.role === 'assistant' ? 'assistant' : 'user') as 'user' | 'assistant',
          content: m.content || '',
        })),
      ];

      try {
        const stream = await groq.chat.completions.create({
          model: modelToUse,
          messages: groqMessages,
          stream: true,
          temperature,
          max_completion_tokens: 8192,
        });

        let totalOut = 0;
        for await (const chunk of stream) {
          const delta = chunk.choices[0]?.delta?.content || '';
          if (delta) {
            totalOut += delta.length;
            sendEvent('delta', { content: delta });
          }
        }

        trackUserUsageAndFinish(
          codingAnalysis.isHardCoding ? `${modelToUse} (Pro Coding)` : modelToUse,
          'groq',
          totalOut,
          searchCitations
        );
        return;
      } catch (groqErr: any) {
        console.warn('Groq model execution error:', groqErr.message);

        if (groqErr.status === 404 || groqErr.message?.includes('model') || groqErr.message?.includes('access')) {
          const remainingCandidates = GROQ_FALLBACK_CANDIDATES.filter((c) => c !== modelToUse);

          for (const fallbackModel of remainingCandidates) {
            try {
              sendEvent('status', { message: `Switching to ${fallbackModel}...` });
              const fallbackStream = await groq.chat.completions.create({
                model: fallbackModel,
                messages: groqMessages,
                stream: true,
                temperature,
                max_completion_tokens: 8192,
              });

              let totalOut = 0;
              for await (const chunk of fallbackStream) {
                const delta = chunk.choices[0]?.delta?.content || '';
                if (delta) {
                  totalOut += delta.length;
                  sendEvent('delta', { content: delta });
                }
              }

              trackUserUsageAndFinish(fallbackModel, 'groq', totalOut, searchCitations);
              return;
            } catch (err: any) {
              console.warn(`Groq candidate ${fallbackModel} failed:`, err.message);
            }
          }
        }

        // Seamless Gemini 4 Hydrogen Deep Thinking fallback when Groq rate limits or fails
        if (gemini) {
          sendEvent('status', { message: 'Routing to Gemini 4 Hydrogen Deep Thinking engine...' });
          const conversationText = messages
            .map((m: any) => `${m.role.toUpperCase()}: ${m.content}`)
            .join('\n\n');
          for (const gm of ['gemini-4-hydrogen', 'gemini-3.1-flash-lite']) {
            try {
              const response = await gemini.models.generateContentStream({
                model: gm,
                contents: conversationText,
                config: {
                  systemInstruction: systemPrompt,
                  ...(gm === 'gemini-4-hydrogen' && codingAnalysis.isCoding
                    ? { thinkingConfig: { thinkingLevel: ThinkingLevel.HIGH } }
                    : {}),
                },
              });

              let totalOut = 0;
              for await (const chunk of response) {
                const delta = chunk.text || '';
                if (delta) {
                  totalOut += delta.length;
                  sendEvent('delta', { content: delta });
                }
              }

              trackUserUsageAndFinish(gm, 'gemini (fallback)', totalOut, searchCitations);
              return;
            } catch (fallbackErr: any) {
              console.warn(`Gemini fallback (${gm}) failed:`, fallbackErr.message);
            }
          }
        }

        throw groqErr;
      }
    }

    // 6. If Groq API Key is not configured, run Gemini 4 Hydrogen directly
    if (gemini) {
      sendEvent('status', {
        message: codingAnalysis.isCoding
          ? 'Engineering solution with Gemini 4 Hydrogen...'
          : 'Using Gemini 4 Hydrogen engine...',
      });
      const conversationText = messages
        .map((m: any) => `${m.role.toUpperCase()}: ${m.content}`)
        .join('\n\n');

      for (const gm of ['gemini-4-hydrogen', 'gemini-3.1-flash-lite']) {
        try {
          const stream = await gemini.models.generateContentStream({
            model: gm,
            contents: conversationText,
            config: {
              systemInstruction: systemPrompt,
              ...(gm === 'gemini-4-hydrogen' && codingAnalysis.isCoding
                ? { thinkingConfig: { thinkingLevel: ThinkingLevel.HIGH } }
                : {}),
            },
          });

          let totalOut = 0;
          for await (const chunk of stream) {
            const delta = chunk.text || '';
            if (delta) {
              totalOut += delta.length;
              sendEvent('delta', { content: delta });
            }
          }

          trackUserUsageAndFinish(
            codingAnalysis.isHardCoding ? `${gm} (Pro Coding)` : gm,
            'gemini',
            totalOut,
            searchCitations
          );
          return;
        } catch (errGm: any) {
          console.warn(`Gemini primary (${gm}) failed:`, errGm.message);
        }
      }
    }

    // If neither key is configured
    sendEvent('error', {
      error: 'Groq API Key not detected in server environment. Please ensure GROQ_API_KEY is configured in your project Secrets panel to power ULTRON.',
    });
    res.end();
  } catch (err: any) {
    console.error('Chat error:', err);
    let errorMsg = err.message || 'An unexpected error occurred while communicating with the AI engine.';
    
    // Clean stringified JSON errors
    try {
      if (typeof errorMsg === 'string' && errorMsg.includes('{')) {
        const jsonStart = errorMsg.indexOf('{');
        const parsed = JSON.parse(errorMsg.slice(jsonStart));
        if (parsed.error?.message) {
          errorMsg = parsed.error.message;
        } else if (parsed.message) {
          errorMsg = parsed.message;
        }
      }
    } catch {
      // ignore
    }

    sendEvent('error', {
      error: errorMsg,
    });
    res.end();
  }
});

// Intelligent Automation: Groq + Llama Structured Task Planner
app.post('/api/automation/plan', async (req: Request, res: Response) => {
  try {
    const {
      command,
      model = 'llama-3.3-70b-versatile',
      environmentMode = 'web-sandbox',
    } = req.body || {};

    if (!command || typeof command !== 'string' || !command.trim()) {
      return res.status(400).json({ error: 'Automation command is required.' });
    }

    const cleanCommand = command.trim();
    const groq = getGroqClient();

    if (groq) {
      const preferred =
        !model || model === 'gemini-4-hydrogen' || model === 'llama-3.1-8b-instant'
          ? 'llama-3.3-70b-versatile'
          : model;

      try {
        const modelToUse = await getWorkingGroqModel(groq, preferred);
        const completion = await groq.chat.completions.create({
          model: modelToUse,
          temperature: 0.2,
          max_completion_tokens: 2048,
          tools: GROQ_AUTOMATION_TOOLS as any,
          tool_choice: 'auto',
          messages: [
            { role: 'system', content: buildAutomationPlannerSystemPrompt() },
            {
              role: 'user',
              content: `Environment: ${environmentMode}\nUser Command: "${cleanCommand}"\n\nGenerate the complete ordered execution plan using execute_task_plan.`,
            },
          ],
        });

        const msg = completion.choices?.[0]?.message;
        const plan = extractPlanFromGroqToolCalls(msg?.tool_calls as any, cleanCommand);

        return res.json({
          success: true,
          goal: plan.goal,
          steps: plan.steps,
          usedGroqTools: plan.usedGroqTools,
          modelUsed: modelToUse,
        });
      } catch (err: any) {
        console.warn('Groq automation planner fallback due to error:', err.message);
      }
    }

    const fallback = buildFallbackAutomationPlan(cleanCommand);
    if (fallback.steps.length === 0) {
      return res.status(400).json({
        error: 'Command was blocked by automation security guardrails or contains no actionable steps.',
      });
    }

    return res.json({
      success: true,
      goal: fallback.goal,
      steps: fallback.steps,
      usedGroqTools: false,
      modelUsed: 'deterministic-planner',
    });
  } catch (err: any) {
    console.error('Automation plan error:', err);
    return res.status(500).json({ error: err.message || 'Failed to plan automation command.' });
  }
});

// Intelligent Automation: Observe Result -> Groq Llama Next-Step Decision Controller
app.post('/api/automation/decide-next', async (req: Request, res: Response) => {
  try {
    const {
      command,
      goal,
      lastStep,
      observation,
      remainingSteps = [],
      model = 'llama-3.3-70b-versatile',
    } = req.body || {};

    if (observation?.securityBlocked) {
      return res.json({
        action: 'halt',
        reason:
          'Security / Login / CAPTCHA screen detected. Automation paused cleanly per security policy.',
      });
    }

    // In web-sandbox mode without native Android Accessibility UI tree, do not waste extra LLM roundtrips
    if (observation?.source === 'web-fallback') {
      return res.json({
        action: 'continue',
        message: 'Browser action dispatched; continuing planned sequence.',
      });
    }

    const groq = getGroqClient();
    if (!groq) {
      return res.json({
        action: 'continue',
        message: 'Proceeding with next planned step.',
      });
    }

    const preferred =
      !model || model === 'gemini-4-hydrogen' || model === 'llama-3.1-8b-instant'
        ? 'llama-3.3-70b-versatile'
        : model;

    try {
      const modelToUse = await getWorkingGroqModel(groq, preferred);
      const completion = await groq.chat.completions.create({
        model: modelToUse,
        temperature: 0.15,
        max_completion_tokens: 768,
        tools: GROQ_AUTOMATION_TOOLS.filter(
          (t) => t.function.name !== 'execute_task_plan'
        ) as any,
        tool_choice: 'auto',
        messages: [
          { role: 'system', content: buildAutomationDeciderSystemPrompt() },
          {
            role: 'user',
            content: [
              `Original Command: ${command || ''}`,
              `Goal: ${goal || ''}`,
              `Just Executed: ${lastStep?.tool || 'unknown'} — ${lastStep?.title || ''} (success=${lastStep?.success}, message=${lastStep?.message || ''})`,
              `Screen Observation:\n${formatObservationForLlama(observation)}`,
              `Remaining Planned Steps: ${Array.isArray(remainingSteps) ? remainingSteps.map((s: any) => s.title).join(' -> ') || 'None' : 'None'}`,
            ].join('\n\n'),
          },
        ],
      });

      const msg = completion.choices?.[0]?.message;
      const toolCalls = msg?.tool_calls;

      if (Array.isArray(toolCalls) && toolCalls.length > 0) {
        const firstCall = toolCalls[0];
        const fnName = firstCall?.function?.name || '';
        let parsedArgs: any = {};
        try {
          parsedArgs = firstCall?.function?.arguments ? JSON.parse(firstCall.function.arguments) : {};
        } catch {
          parsedArgs = {};
        }
        const validation = validateAndSanitizeToolCall(fnName, parsedArgs);
        if (validation.valid && validation.sanitizedTool && validation.sanitizedArgs) {
          return res.json({
            action: 'tool',
            modelUsed: modelToUse,
            nextStep: {
              tool: validation.sanitizedTool,
              title: `Llama Adaptive: ${validation.sanitizedTool.replace(/_/g, ' ')}`,
              description: 'Adaptive action selected from live screen observation.',
              arguments: validation.sanitizedArgs,
              isSensitive: validation.isSensitive,
              sensitiveReason: validation.sensitiveReason,
            },
          });
        }
      }

      const rawContent = String(msg?.content || '').trim();
      if (rawContent.includes('{')) {
        try {
          const parsed = JSON.parse(rawContent.slice(rawContent.indexOf('{'), rawContent.lastIndexOf('}') + 1));
          if (parsed.action === 'halt') {
            return res.json({
              action: 'halt',
              reason: parsed.reason || 'Halted by Llama observation controller.',
              modelUsed: modelToUse,
            });
          }
          if (parsed.message) {
            return res.json({
              action: 'continue',
              message: String(parsed.message),
              modelUsed: modelToUse,
            });
          }
        } catch {
          // fall through cleanly
        }
      }

      return res.json({
        action: 'continue',
        message: 'Screen observation verified; continuing planned sequence.',
        modelUsed: modelToUse,
      });
    } catch (err: any) {
      console.warn('Groq decide-next fallback:', err.message);
      return res.json({
        action: 'continue',
        message: 'Continuing planned execution sequence.',
      });
    }
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Next-step decision error' });
  }
});

// Setup Vite middleware in dev or static files in production
async function startServer() {
  const isProduction = process.env.NODE_ENV === 'production';
  const httpServer = http.createServer(app);

  // Ensure HMR and redundant chokidar file watchers are disabled per environment constraints
  // so Vite never binds standalone WebSocket port 24678 or delays cold starts.
  if (!isProduction) {
    process.env.DISABLE_HMR = 'true';
  }

  let viteMiddleware: any = null;
  let viteReadyPromise: Promise<any> | null = null;

  if (!isProduction) {
    viteReadyPromise = import('vite')
      .then(({ createServer: createViteServer }) =>
        createViteServer({
          server: {
            middlewareMode: true,
            hmr: false,
            watch: null,
          },
          appType: 'spa',
        })
      )
      .then((vite) => {
        viteMiddleware = vite.middlewares;
        console.log('[server] Vite middleware ready.');
        return vite;
      })
      .catch((err) => {
        console.error('[server] Vite initialization failed:', err);
        throw err;
      });

    app.use(async (req: Request, res: Response, next) => {
      if (viteMiddleware) {
        return viteMiddleware(req, res, next);
      }
      if (viteReadyPromise) {
        try {
          await viteReadyPromise;
          if (viteMiddleware) {
            return viteMiddleware(req, res, next);
          }
        } catch (err) {
          return next(err);
        }
      }
      next();
    });
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (req: Request, res: Response) => {
      res.sendFile(path.resolve(distPath, 'index.html'));
    });
  }

  httpServer.on('error', (err: any) => {
    if (err.code === 'EADDRINUSE') {
      console.warn(`[server] Port ${PORT} already in use. Retrying in 1s...`);
      setTimeout(() => {
        try {
          httpServer.close();
        } catch {}
        httpServer.listen(PORT, '0.0.0.0');
      }, 1000);
    } else {
      console.error('[server] Fatal HTTP error:', err);
    }
  });

  // Bind HTTP port immediately so health checks on :3000 pass in <300ms while Vite warms up asynchronously
  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`\n  ➜  Local:   http://localhost:${PORT}/`);
    console.log(`  ➜  Network: http://0.0.0.0:${PORT}/`);
    console.log(`[server] ULTRON server ready on port ${PORT} (env: ${process.env.NODE_ENV || 'development'})\n`);
  });

  const cleanup = () => {
    try {
      httpServer.close(() => process.exit(0));
    } catch {
      process.exit(0);
    }
  };
  process.on('SIGTERM', cleanup);
  process.on('SIGINT', cleanup);
}

startServer().catch((err) => {
  console.error('Fatal server startup error:', err);
  process.exit(1);
});
