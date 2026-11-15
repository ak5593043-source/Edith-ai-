import { Conversation, UserSettings, DEFAULT_SETTINGS } from '../types/chat.ts';

const CONVERSATIONS_KEY = 'jarvis_conversations_v1';
const ACTIVE_CONV_KEY = 'jarvis_active_conv_v1';
const SETTINGS_KEY = 'jarvis_settings_v1';

export function loadConversations(): Conversation[] {
  try {
    const raw =
      localStorage.getItem(CONVERSATIONS_KEY) ||
      localStorage.getItem('edith_guest_conversations_v1');
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.error('Failed to load conversations from localStorage:', err);
    return [];
  }
}

export function saveConversations(conversations: Conversation[]): void {
  try {
    localStorage.setItem(CONVERSATIONS_KEY, JSON.stringify(conversations));
  } catch (err) {
    console.error('Failed to save conversations to localStorage:', err);
  }
}

export function loadActiveConversationId(): string | null {
  try {
    return (
      localStorage.getItem(ACTIVE_CONV_KEY) ||
      localStorage.getItem('edith_guest_active_conv_v1')
    );
  } catch {
    return null;
  }
}

export function saveActiveConversationId(id: string | null): void {
  try {
    if (id) {
      localStorage.setItem(ACTIVE_CONV_KEY, id);
    } else {
      localStorage.removeItem(ACTIVE_CONV_KEY);
    }
  } catch (err) {
    console.error('Failed to save active conversation id:', err);
  }
}

export function loadSettings(): UserSettings {
  try {
    const raw =
      localStorage.getItem(SETTINGS_KEY) ||
      localStorage.getItem('edith_guest_settings_v1');
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw);
    const merged: UserSettings = { ...DEFAULT_SETTINGS, ...parsed };
    // Auto-migrate stale legacy 8b default to stronger 70b default
    if (merged.model === 'llama-3.1-8b-instant') {
      merged.model = DEFAULT_SETTINGS.model;
    }
    // Auto-migrate legacy Swara/girl voice settings to ULTRON commanding male voice
    if (!merged.voiceURI || merged.voiceURI === 'hi-IN-SwaraNeural' || merged.voiceURI === 'en-IN-NeerjaNeural') {
      merged.voiceURI = DEFAULT_SETTINGS.voiceURI;
      merged.selectedVoiceId = DEFAULT_SETTINGS.selectedVoiceId;
    }
    if (
      !merged.voiceTone ||
      !(['commanding-deep', 'confident-bold', 'razor-sharp'] as string[]).includes(merged.voiceTone)
    ) {
      merged.voiceTone = 'commanding-deep';
    }
    return merged;
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings: UserSettings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch (err) {
    console.error('Failed to save settings:', err);
  }
}

export function createNewConversation(model = DEFAULT_SETTINGS.model): Conversation {
  const now = Date.now();
  return {
    id: `conv_${now}_${Math.random().toString(36).substring(2, 7)}`,
    title: 'New Conversation',
    createdAt: now,
    updatedAt: now,
    messages: [],
    model,
  };
}

export function generateTitleFromMessage(content: string): string {
  if (!content) return 'New Conversation';
  const clean = content.replace(/[#*`_>]/g, '').trim().split('\n')[0];
  if (clean.length <= 40) return clean;
  return clean.substring(0, 37) + '...';
}
