import { Groq } from 'groq-sdk';
import { GoogleGenAI } from '@google/genai';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ModelOption {
  id: string;
  name: string;
  description: string;
  supportsVision?: boolean;
  provider?: 'groq' | 'gemini';
}

export const POPULAR_MODELS: ModelOption[] = [
  {
    id: 'llama-3.3-70b-versatile',
    name: 'Llama 3.3 70B Versatile (Recommended)',
    description: 'High-accuracy coding, debugging, reasoning & multilingual replies',
    provider: 'groq',
  },
  {
    id: 'openai/gpt-oss-120b',
    name: 'GPT-OSS 120B (Pro Architecture)',
    description: '120B flagship architecture for hard coding, system design & algorithms',
    provider: 'groq',
  },
  {
    id: 'gemini-4-hydrogen',
    name: 'Gemini 4 Hydrogen (Deep Thinking + Vision)',
    description: 'Deep step-by-step code architecture, debugging & multimodal vision',
    supportsVision: true,
    provider: 'gemini',
  },
  {
    id: 'deepseek-r1-distill-llama-70b',
    name: 'DeepSeek R1 Distill 70B',
    description: 'Chain-of-thought mathematical, DSA & logical problem solving',
    provider: 'groq',
  },
  {
    id: 'llama-3.1-8b-instant',
    name: 'Llama 3.1 8B Instant',
    description: 'Ultra-fast lightweight replies for casual chat',
    provider: 'groq',
  },
  {
    id: 'llama-3.2-11b-vision-preview',
    name: 'Llama 3.2 11B Vision',
    description: 'Multimodal vision and document comprehension model',
    supportsVision: true,
    provider: 'groq',
  },
];

export function getGroqClient(): Groq | null {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey || apiKey.trim() === '') {
    return null;
  }
  return new Groq({ apiKey });
}

export function getGeminiClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey.trim() === '') {
    return null;
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

export async function fetchAvailableModels(): Promise<ModelOption[]> {
  const groq = getGroqClient();
  if (!groq) {
    return POPULAR_MODELS;
  }

  try {
    const list = await groq.models.list();
    const groqIds = new Set(list.data.map((m: any) => m.id));

    // Preserve Gemini models alongside active Groq models
    const available = POPULAR_MODELS.filter((m) => m.provider === 'gemini' || groqIds.has(m.id));

    // Add any remaining Groq models
    for (const m of list.data) {
      if (!available.some((item) => item.id === m.id) && (m as any).active !== false) {
        available.push({
          id: m.id,
          name: m.id,
          description: `Groq active model (${m.owned_by || 'open'})`,
          supportsVision: m.id.includes('vision'),
          provider: 'groq',
        });
      }
    }

    return available.length > 0 ? available : POPULAR_MODELS;
  } catch (err: any) {
    console.warn('Failed to fetch dynamic Groq models list:', err.message);
    return POPULAR_MODELS;
  }
}

export const GROQ_FALLBACK_CANDIDATES = [
  'openai/gpt-oss-120b',
  'llama-3.3-70b-versatile',
  'deepseek-r1-distill-llama-70b',
  'llama3-70b-8192',
  'llama-3.1-8b-instant',
  'mixtral-8x7b-32768',
  'gemma2-9b-it',
];

export async function getWorkingGroqModel(groq: Groq, preferredModel: string): Promise<string> {
  try {
    const list = await groq.models.list();
    const availableIds = new Set(list.data.map((m: any) => m.id));

    if (availableIds.has(preferredModel)) {
      return preferredModel;
    }

    for (const candidate of GROQ_FALLBACK_CANDIDATES) {
      if (availableIds.has(candidate)) {
        return candidate;
      }
    }

    if (list.data.length > 0) {
      return list.data[0].id;
    }
  } catch (err: any) {
    console.warn('Failed to resolve dynamic Groq model:', err.message);
  }

  return preferredModel || 'llama-3.1-8b-instant';
}
