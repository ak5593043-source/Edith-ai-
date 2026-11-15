import type { VoicePrintProfile } from '../utils/voicePrint.ts';

export interface AttachedFile {
  id: string;
  name: string;
  type: string;
  size: number;
  text?: string;
  isImage?: boolean;
  base64Data?: string;
  category?: 'document' | 'spreadsheet' | 'presentation' | 'data' | 'image' | 'audio' | 'video' | 'archive' | 'code' | 'other';
  metadata?: Record<string, any>;
}

export interface SearchSource {
  title: string;
  url: string;
  snippet: string;
}

export type DeviceActionType =
  | 'instagram_reels'
  | 'instagram_message'
  | 'instagram_open'
  | 'whatsapp_message'
  | 'youtube_search'
  | 'spotify_play'
  | 'maps_search'
  | 'telegram_open'
  | 'snapchat_open'
  | 'facebook_open'
  | 'call_phone'
  | 'sms_message'
  | 'email_compose'
  | 'chrome_search'
  | 'open_url';

export interface DeviceAction {
  id: string;
  type: DeviceActionType;
  title: string;
  appName?: string;
  target?: string;
  message?: string;
  appUrl: string;
  webUrl: string;
  androidPackage?: string;
  executed?: boolean;
}

export type TaskStepType = 'app' | 'pdf' | 'search' | 'answer' | 'custom';
export type TaskStepStatus = 'pending' | 'running' | 'completed' | 'skipped';

export interface TaskStep {
  id: string;
  order: number;
  title: string;
  detail?: string;
  type: TaskStepType;
  status: TaskStepStatus;
  action?: DeviceAction;
}

export interface TaskPlan {
  id: string;
  goal: string;
  steps: TaskStep[];
}

export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  attachedFiles?: AttachedFile[];
  sources?: SearchSource[];
  isStreaming?: boolean;
  error?: string;
  modelUsed?: string;
  action?: DeviceAction;
  actions?: DeviceAction[];
  taskPlan?: TaskPlan;
}

export interface Conversation {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: Message[];
  model?: string;
}

export type VoiceTonePreset = 'commanding-deep' | 'confident-bold' | 'razor-sharp';

export interface UserSettings {
  model: string;
  language: 'auto' | 'en' | 'hi' | 'hinglish';
  voiceURI: string;
  selectedVoiceId?: string;
  voiceTone?: VoiceTonePreset;
  voiceRate: number;
  voicePitch: number;
  voiceVolume?: number;
  preferNeuralVoice: boolean;
  autoSpeak: boolean;
  wakeWordEnabled?: boolean;
  voicePrint?: VoicePrintProfile | null;
  automationEnabled?: boolean;
  webSearchDefault: boolean;
  customInstructions: string;
  memories: string[];
}

export const DEFAULT_SETTINGS: UserSettings = {
  model: 'llama-3.3-70b-versatile',
  language: 'auto',
  voiceURI: 'hi-IN-MadhurNeural',
  selectedVoiceId: 'hi-IN-MadhurNeural',
  voiceTone: 'commanding-deep',
  voiceRate: 1.0,
  voicePitch: 0.9,
  voiceVolume: 1.0,
  preferNeuralVoice: true,
  autoSpeak: false,
  wakeWordEnabled: false,
  voicePrint: null,
  automationEnabled: false,
  webSearchDefault: false,
  customInstructions: '',
  memories: [],
};
