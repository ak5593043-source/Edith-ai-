import React, { useState, useEffect } from 'react';
import {
  X,
  Cpu,
  Mic,
  Brain,
  Info,
  Check,
  Plus,
  Trash2,
  Volume2,
  Globe,
  Sparkles,
  RefreshCw,
  Play,
  Square,
  Pause,
  Fingerprint,
  ShieldCheck,
  Radio,
  Bot,
} from 'lucide-react';
import { UserSettings, VoiceTonePreset } from '../types/chat.ts';
import { POPULAR_MODELS, ModelOption } from '../server/groq.ts';
import { VerifiedVoice, PlaybackState } from '../hooks/useSpeech.ts';
import { enrollUserVoicePrint, verifyUserVoiceSample } from '../hooks/useWakeWord.ts';
import { EdithLogo } from './EdithLogo.tsx';
import { AutomationWorkspace, AutomationWorkspaceProps } from './AutomationPanel.tsx';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  settings: UserSettings;
  onSaveSettings: (settings: UserSettings) => void;
  verifiedVoices: VerifiedVoice[];
  onTestVoice: (text: string, voiceId?: string) => void;
  onStopTestVoice: () => void;
  playbackState?: PlaybackState;
  systemStatus: {
    groqConfigured: boolean;
    geminiConfigured: boolean;
    activeEngine: string;
  };
  onRefreshStatus: () => void;
  onClearAllConversations?: () => void;
  initialTab?: 'model' | 'voice' | 'automation' | 'memory' | 'about';
  automation?: AutomationWorkspaceProps;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  settings,
  onSaveSettings,
  verifiedVoices,
  onTestVoice,
  onStopTestVoice,
  playbackState = 'idle',
  systemStatus,
  onRefreshStatus,
  onClearAllConversations,
  initialTab = 'model',
  automation,
}) => {
  const [activeTab, setActiveTab] = useState<'model' | 'voice' | 'automation' | 'memory' | 'about'>(initialTab);
  const [localSettings, setLocalSettings] = useState<UserSettings>({ ...settings });
  const [newMemory, setNewMemory] = useState('');
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [confirmClearMemories, setConfirmClearMemories] = useState(false);
  const [confirmClearAllChats, setConfirmClearAllChats] = useState(false);
  const [clearChatsDone, setClearChatsDone] = useState(false);
  const [playingVoiceId, setPlayingVoiceId] = useState<string | null>(null);
  const [vpStatus, setVpStatus] = useState<'idle' | 'recording' | 'testing' | 'error'>('idle');
  const [vpProgress, setVpProgress] = useState(0);
  const [vpLevel, setVpLevel] = useState(0);
  const [vpMessage, setVpMessage] = useState<string | null>(null);
  const wasOpenRef = React.useRef(false);

  useEffect(() => {
    if (playbackState === 'idle') {
      setPlayingVoiceId(null);
    }
  }, [playbackState]);

  useEffect(() => {
    if (isOpen && !wasOpenRef.current) {
      if (initialTab) setActiveTab(initialTab);
      setLocalSettings({ ...settings });
      setConfirmClearMemories(false);
      setConfirmClearAllChats(false);
      setClearChatsDone(false);
      setSaveSuccess(false);
      setPlayingVoiceId(null);
      setVpMessage(null);
    }
    wasOpenRef.current = isOpen;
  }, [isOpen, settings, initialTab]);

  if (!isOpen) return null;

  const handleSave = () => {
    onSaveSettings(localSettings);
    setSaveSuccess(true);
    setTimeout(() => {
      setSaveSuccess(false);
      onClose();
    }, 600);
  };

  const handleClearChatsTrigger = () => {
    if (confirmClearAllChats) {
      if (onClearAllConversations) {
        onClearAllConversations();
        setClearChatsDone(true);
        setTimeout(() => setClearChatsDone(false), 3000);
      }
      setConfirmClearAllChats(false);
    } else {
      setConfirmClearAllChats(true);
      setTimeout(() => setConfirmClearAllChats(false), 3500);
    }
  };

  const handleAddMemory = () => {
    if (newMemory.trim()) {
      setLocalSettings((prev) => ({
        ...prev,
        memories: [...prev.memories, newMemory.trim()],
      }));
      setNewMemory('');
    }
  };

  const handleRemoveMemory = (index: number) => {
    setLocalSettings((prev) => ({
      ...prev,
      memories: prev.memories.filter((_, i) => i !== index),
    }));
  };

  const handleClearMemories = () => {
    if (confirmClearMemories) {
      setLocalSettings((prev) => ({ ...prev, memories: [] }));
      setConfirmClearMemories(false);
    } else {
      setConfirmClearMemories(true);
      setTimeout(() => setConfirmClearMemories(false), 3000);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-3 sm:p-4">
      <div className="flex flex-col w-full max-w-2xl max-h-[85vh] rounded-2xl bg-[#111111] border border-[#262626] shadow-2xl overflow-hidden">
        {/* Modal Header */}
        <div className="flex items-center justify-between border-b border-[#262626] px-5 py-3.5 bg-[#000000]">
          <div className="flex items-center gap-2.5">
            <EdithLogo size="md" />
            <div>
              <h2 className="text-sm sm:text-base font-semibold text-white tracking-wide">ULTRON Settings</h2>
              <span className="text-[11px] text-blue-400 font-semibold tracking-wide">Developed by Jagjit</span>
            </div>
          </div>

          <button
            onClick={onClose}
            aria-label="Close settings"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-[#A1A1AA] hover:bg-[#171717] hover:text-white transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="flex overflow-x-auto border-b border-[#262626] bg-[#0d0d0d] px-3">
          <button
            type="button"
            onClick={() => setActiveTab('model')}
            className={`flex shrink-0 whitespace-nowrap items-center gap-2 border-b-2 px-3 py-2.5 text-xs font-medium transition-colors ${
              activeTab === 'model'
                ? 'border-white text-white'
                : 'border-transparent text-[#71717A] hover:text-[#A1A1AA]'
            }`}
          >
            <Cpu className="h-3.5 w-3.5" />
            <span>AI Model</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('voice')}
            className={`flex shrink-0 whitespace-nowrap items-center gap-2 border-b-2 px-3 py-2.5 text-xs font-medium transition-colors ${
              activeTab === 'voice'
                ? 'border-white text-white'
                : 'border-transparent text-[#71717A] hover:text-[#A1A1AA]'
            }`}
          >
            <Mic className="h-3.5 w-3.5" />
            <span>Commanding Voice</span>
          </button>

          {automation && (
            <button
              type="button"
              data-testid="settings-tab-automation"
              onClick={() => setActiveTab('automation')}
              className={`flex shrink-0 whitespace-nowrap items-center gap-2 border-b-2 px-3 py-2.5 text-xs font-medium transition-colors ${
                activeTab === 'automation'
                  ? 'border-white text-white'
                  : 'border-transparent text-[#71717A] hover:text-[#A1A1AA]'
              }`}
            >
              <Bot className="h-3.5 w-3.5" />
              <span>Automation</span>
              {automation.automationEnabled && (
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
              )}
            </button>
          )}

          <button
            type="button"
            onClick={() => setActiveTab('memory')}
            className={`flex shrink-0 whitespace-nowrap items-center gap-2 border-b-2 px-3 py-2.5 text-xs font-medium transition-colors ${
              activeTab === 'memory'
                ? 'border-white text-white'
                : 'border-transparent text-[#71717A] hover:text-[#A1A1AA]'
            }`}
          >
            <Brain className="h-3.5 w-3.5" />
            <span>Memory & Instructions</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('about')}
            className={`flex shrink-0 whitespace-nowrap items-center gap-2 border-b-2 px-3 py-2.5 text-xs font-medium transition-colors ${
              activeTab === 'about'
                ? 'border-white text-white'
                : 'border-transparent text-[#71717A] hover:text-[#A1A1AA]'
            }`}
          >
            <Info className="h-3.5 w-3.5" />
            <span>Status & About</span>
          </button>
        </div>

        {/* Tab Content Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5 text-xs text-[#A1A1AA]">
          {/* TAB 1: MODEL */}
          {activeTab === 'model' && (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-white mb-1.5">
                  Groq Intelligence Model
                </label>
                <p className="text-[#71717A] mb-3">
                  Select the underlying Groq high-speed LLM powering ULTRON responses.
                </p>

                <div className="space-y-2">
                  {POPULAR_MODELS.map((modelOption: ModelOption) => {
                    const isSelected = localSettings.model === modelOption.id;
                    return (
                      <div
                        key={modelOption.id}
                        onClick={() => setLocalSettings((prev) => ({ ...prev, model: modelOption.id }))}
                        className={`flex items-start justify-between rounded-xl p-3 border cursor-pointer transition-all ${
                          isSelected
                            ? 'bg-[#171717] border-white text-white'
                            : 'bg-[#0d0d0d] border-[#262626] hover:border-[#3f3f46] text-[#A1A1AA]'
                        }`}
                      >
                        <div className="space-y-0.5">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-xs text-white">{modelOption.name}</span>
                            {modelOption.supportsVision && (
                              <span className="rounded bg-blue-950/60 border border-blue-800 px-1.5 py-0.2 text-[10px] text-blue-400">
                                Vision
                              </span>
                            )}
                          </div>
                          <p className="text-[11px] text-[#71717A]">{modelOption.description}</p>
                          <span className="font-mono text-[10px] text-[#52525B]">{modelOption.id}</span>
                        </div>

                        {isSelected && <Check className="h-4 w-4 text-white shrink-0 mt-0.5" />}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Default Web Search */}
              <div className="flex items-center justify-between rounded-xl bg-[#171717] border border-[#262626] p-3.5">
                <div>
                  <span className="font-medium text-white block">Default Live Web Search</span>
                  <span className="text-[11px] text-[#71717A]">
                    Automatically query DuckDuckGo and Wikipedia for up-to-date facts
                  </span>
                </div>
                <input
                  type="checkbox"
                  checked={localSettings.webSearchDefault}
                  onChange={(e) =>
                    setLocalSettings((prev) => ({ ...prev, webSearchDefault: e.target.checked }))
                  }
                  className="h-4 w-4 rounded accent-white bg-[#262626] border-[#3f3f46]"
                />
              </div>
            </div>
          )}

          {/* TAB 2: NATURAL FEMALE VOICE & LANGUAGE */}
          {activeTab === 'voice' && (
            <div className="space-y-5">
              {/* Single Dedicated ULTRON Powerful Commanding Voice Card */}
              <div className="rounded-2xl bg-[#121624] border border-blue-500/60 p-4 space-y-3 shadow-[0_0_25px_rgba(59,130,246,0.18)]">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="flex items-start gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-blue-600/25 border border-blue-400/60 text-blue-300 shadow-[0_0_12px_rgba(59,130,246,0.35)]">
                      <Mic className="h-5 w-5" />
                    </div>
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-bold text-white text-base">
                          ULTRON Commanding Power Voice
                        </span>
                        <span className="rounded-full bg-blue-950/80 text-blue-300 border border-blue-600/60 px-2.5 py-0.5 text-[10px] font-bold shadow-sm">
                          Deep &amp; Confident Baritone
                        </span>
                      </div>
                      <p className="text-xs text-[#A1A1AA] leading-relaxed">
                        दमदार, भारी और आत्मविश्वास से भरी (commanding &amp; bold) आवाज़ — हिंदी, हिंग्लिश और इंग्लिश में दमदार और सटीक संवाद।
                      </p>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      if (playingVoiceId === 'hi-IN-MadhurNeural' && playbackState !== 'idle') {
                        onStopTestVoice();
                        setPlayingVoiceId(null);
                      } else {
                        setPlayingVoiceId('hi-IN-MadhurNeural');
                        onTestVoice(
                          'नमस्ते जगजीत! मैं अल्ट्रॉन हूँ — पूरा सिस्टम मेरे कंट्रोल में है। बताइए, आज क्या करना है?',
                          'hi-IN-MadhurNeural'
                        );
                      }
                    }}
                    title="Play or stop voice sample"
                    className="flex items-center gap-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white px-3.5 py-2 text-xs font-semibold shadow-md shadow-blue-900/50 transition-all shrink-0 self-end sm:self-center active:scale-95"
                  >
                    {playingVoiceId === 'hi-IN-MadhurNeural' && playbackState !== 'idle' ? (
                      <>
                        <Square className="h-3.5 w-3.5 fill-white text-white animate-pulse" />
                        <span>Stop Sample</span>
                      </>
                    ) : (
                      <>
                        <Volume2 className="h-3.5 w-3.5" />
                        <span>Test Voice</span>
                      </>
                    )}
                  </button>
                </div>

                {/* Commanding Voice Intensity Preset Selector */}
                <div className="pt-2 border-t border-white/10">
                  <span className="block text-[11px] font-medium text-white mb-2">
                    Commanding Voice Authority Tone
                  </span>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    {(
                      [
                        { id: 'commanding-deep', label: 'Commanding Deep', desc: 'Bhari bass & heavy authority' },
                        { id: 'confident-bold', label: 'Confident Bold', desc: 'Strong Indian baritone' },
                        { id: 'razor-sharp', label: 'Razor Sharp', desc: 'Fast & decisive executive' },
                      ] as Array<{ id: VoiceTonePreset; label: string; desc: string }>
                    ).map((opt) => {
                      const active = (localSettings.voiceTone || 'commanding-deep') === opt.id;
                      return (
                        <button
                          key={opt.id}
                          type="button"
                          onClick={() =>
                            setLocalSettings((prev) => ({ ...prev, voiceTone: opt.id }))
                          }
                          className={`rounded-xl border px-3 py-2 text-left transition-all ${
                            active
                              ? 'bg-blue-600/20 border-blue-400 text-white'
                              : 'bg-[#0d1018] border-white/10 text-[#A1A1AA] hover:text-white'
                          }`}
                        >
                          <div className="text-xs font-semibold">{opt.label}</div>
                          <div className="text-[10px] text-[#8E8E93]">{opt.desc}</div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* Speech Speed & Volume Controls */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <div className="flex justify-between text-white font-medium mb-1">
                    <span>Speech Speed</span>
                    <span className="text-blue-400">{localSettings.voiceRate}x</span>
                  </div>
                  <input
                    type="range"
                    min="0.75"
                    max="1.5"
                    step="0.05"
                    value={localSettings.voiceRate}
                    onChange={(e) =>
                      setLocalSettings((prev) => ({ ...prev, voiceRate: parseFloat(e.target.value) }))
                    }
                    className="w-full accent-blue-500"
                  />
                  <div className="flex justify-between text-[10px] text-[#71717A] mt-0.5">
                    <span>0.75x (Slower)</span>
                    <span>1.0x (Normal)</span>
                    <span>1.5x (Faster)</span>
                  </div>
                </div>

                <div>
                  <div className="flex justify-between text-white font-medium mb-1">
                    <span>Speech Volume</span>
                    <span className="text-blue-400">
                      {Math.round((localSettings.voiceVolume ?? 1.0) * 100)}%
                    </span>
                  </div>
                  <input
                    type="range"
                    min="0.1"
                    max="1.0"
                    step="0.05"
                    value={localSettings.voiceVolume ?? 1.0}
                    onChange={(e) =>
                      setLocalSettings((prev) => ({ ...prev, voiceVolume: parseFloat(e.target.value) }))
                    }
                    className="w-full accent-blue-500"
                  />
                  <div className="flex justify-between text-[10px] text-[#71717A] mt-0.5">
                    <span>10%</span>
                    <span>50%</span>
                    <span>100%</span>
                  </div>
                </div>
              </div>

              {/* Voice Automation Flags */}
              <div className="space-y-2 pt-2 border-t border-[#262626]">
                <div className="flex items-center justify-between rounded-xl bg-[#171717] border border-[#262626] p-3">
                  <div>
                    <span className="font-medium text-white block">Auto-speak AI Responses</span>
                    <span className="text-[11px] text-[#71717A]">
                      Synchronize voice playback automatically as soon as answers finish streaming
                    </span>
                  </div>
                  <input
                    type="checkbox"
                    checked={localSettings.autoSpeak}
                    onChange={(e) =>
                      setLocalSettings((prev) => ({ ...prev, autoSpeak: e.target.checked }))
                    }
                    className="h-4 w-4 rounded accent-blue-500 bg-[#262626] border-[#3f3f46]"
                  />
                </div>

                {/* Personal Voice Print + "Hi ULTRON" Wake-Word Auto-Listen Card */}
                <div className="rounded-2xl bg-[#10141f] border border-emerald-500/40 p-4 space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-start gap-2.5">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-emerald-600/20 border border-emerald-500/40 text-emerald-300">
                        <Fingerprint className="h-4.5 w-4.5" />
                      </div>
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-semibold text-white text-sm">
                            Personal Voice Print &amp; &ldquo;Hi ULTRON&rdquo; Wake Mic
                          </span>
                          {localSettings.voicePrint && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-950/80 border border-emerald-700/60 px-2 py-0.5 text-[10px] font-semibold text-emerald-300">
                              <ShieldCheck className="h-3 w-3" />
                              Saved ({localSettings.voicePrint.fundamentalHz} Hz)
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] text-[#A1A1AA] mt-0.5 leading-relaxed">
                          Apni aawaj ka Voice Print record karein — jab bhi &ldquo;Hi ULTRON&rdquo; bologe, ULTRON Voice Mic automatically on ho jayega.
                        </p>
                      </div>
                    </div>

                    <input
                      type="checkbox"
                      aria-label="Enable Hi ULTRON wake word"
                      checked={!!localSettings.wakeWordEnabled}
                      onChange={(e) =>
                        setLocalSettings((prev) => ({ ...prev, wakeWordEnabled: e.target.checked }))
                      }
                      className="h-4 w-4 rounded accent-emerald-500 bg-[#262626] border-[#3f3f46] shrink-0"
                    />
                  </div>

                  {/* Progress / Live Meter when Recording or Testing */}
                  {(vpStatus === 'recording' || vpStatus === 'testing') && (
                    <div className="rounded-xl bg-black/50 border border-blue-500/30 p-3 space-y-2">
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="text-blue-300 font-medium">
                          {vpStatus === 'recording'
                            ? 'Speak now: "Hi ULTRON, main tumhara boss bol raha hoon"'
                            : 'Say "Hi ULTRON" to test Voice Print match...'}
                        </span>
                        <span className="font-mono text-white">{vpProgress}%</span>
                      </div>
                      <div className="h-2 w-full rounded-full bg-[#1a1a22] overflow-hidden">
                        <div
                          className="h-full bg-gradient-to-r from-blue-500 to-emerald-400 transition-all duration-100"
                          style={{ width: `${Math.max(vpProgress, Math.round(vpLevel * 100))}%` }}
                        />
                      </div>
                    </div>
                  )}

                  {vpMessage && vpStatus !== 'recording' && vpStatus !== 'testing' && (
                    <div
                      className={`rounded-lg px-3 py-2 text-[11px] border ${
                        vpStatus === 'error'
                          ? 'bg-red-950/40 border-red-800/60 text-red-300'
                          : 'bg-emerald-950/40 border-emerald-800/60 text-emerald-300'
                      }`}
                    >
                      {vpMessage}
                    </div>
                  )}

                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    <button
                      type="button"
                      disabled={vpStatus === 'recording' || vpStatus === 'testing'}
                      onClick={async () => {
                        setVpStatus('recording');
                        setVpProgress(0);
                        setVpMessage(null);
                        try {
                          const profile = await enrollUserVoicePrint('My Voice Print', (pct, lvl) => {
                            setVpProgress(pct);
                            setVpLevel(lvl);
                          });
                          const nextSettings: UserSettings = {
                            ...localSettings,
                            voicePrint: profile,
                            wakeWordEnabled: true,
                          };
                          setLocalSettings(nextSettings);
                          onSaveSettings(nextSettings);
                          setVpStatus('idle');
                          setVpMessage(
                            `Voice Print saved (${profile.fundamentalHz} Hz)! "Hi ULTRON" wake-word is now ON.`
                          );
                        } catch (err: any) {
                          setVpStatus('error');
                          setVpMessage(err.message || 'Could not record microphone voice sample.');
                        }
                      }}
                      className="flex items-center gap-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white px-3 py-1.5 text-xs font-semibold transition-colors"
                    >
                      <Radio className="h-3.5 w-3.5" />
                      <span>
                        {localSettings.voicePrint ? 'Re-record Voice Print (3s)' : 'Record My Voice Print (3s)'}
                      </span>
                    </button>

                    {localSettings.voicePrint && (
                      <>
                        <button
                          type="button"
                          disabled={vpStatus === 'recording' || vpStatus === 'testing'}
                          onClick={async () => {
                            if (!localSettings.voicePrint) return;
                            setVpStatus('testing');
                            setVpProgress(0);
                            setVpMessage(null);
                            try {
                              const match = await verifyUserVoiceSample(
                                localSettings.voicePrint,
                                (pct, lvl) => {
                                  setVpProgress(pct);
                                  setVpLevel(lvl);
                                }
                              );
                              setVpStatus('idle');
                              setVpMessage(
                                match.matched
                                  ? `Voice Print Matched! (${match.score}% confidence)`
                                  : `Voice did not match strongly (${match.score}%). Try closer to mic or re-record.`
                              );
                            } catch (err: any) {
                              setVpStatus('error');
                              setVpMessage(err.message || 'Voice match test failed.');
                            }
                          }}
                          className="flex items-center gap-1.5 rounded-lg bg-blue-600/20 hover:bg-blue-600/30 border border-blue-500/40 text-blue-300 px-3 py-1.5 text-xs font-medium transition-colors"
                        >
                          <ShieldCheck className="h-3.5 w-3.5" />
                          <span>Test Match</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => {
                            const nextSettings: UserSettings = {
                              ...localSettings,
                              voicePrint: null,
                              wakeWordEnabled: false,
                            };
                            setLocalSettings(nextSettings);
                            onSaveSettings(nextSettings);
                            setVpMessage('Voice Print deleted.');
                            setVpStatus('idle');
                          }}
                          className="flex items-center gap-1 rounded-lg bg-red-950/40 hover:bg-red-900/50 border border-red-800/60 text-red-300 px-2.5 py-1.5 text-xs transition-colors"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          <span>Delete Voice Print</span>
                        </button>
                      </>
                    )}
                  </div>
                </div>

              </div>
            </div>
          )}

          {/* TAB 2B: AUTOMATION */}
          {activeTab === 'automation' && automation && (
            <AutomationWorkspace
              {...automation}
              automationEnabled={Boolean(localSettings.automationEnabled)}
              onToggleAutomation={(enabled) => {
                setLocalSettings((prev) => ({ ...prev, automationEnabled: enabled }));
                automation.onToggleAutomation(enabled);
              }}
            />
          )}

          {/* TAB 3: MEMORY & CUSTOM INSTRUCTIONS */}
          {activeTab === 'memory' && (
            <div className="space-y-4">
              <div>
                <label className="block font-medium text-white mb-1">Custom System Instructions</label>
                <p className="text-[#71717A] mb-2">
                  Define your preferences or persona rules (e.g. &quot;I am a software engineer, prefer TypeScript examples&quot;).
                </p>
                <textarea
                  rows={3}
                  value={localSettings.customInstructions}
                  onChange={(e) =>
                    setLocalSettings((prev) => ({ ...prev, customInstructions: e.target.value }))
                  }
                  placeholder="e.g. Call me Tony. Be concise and prioritize code examples."
                  className="w-full rounded-xl bg-[#171717] border border-[#262626] p-3 text-xs text-white placeholder-[#71717A] outline-none focus:border-[#52525B]"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="font-medium text-white">Saved Personal Memories</label>
                  {localSettings.memories.length > 0 && (
                    <button
                      type="button"
                      onClick={handleClearMemories}
                      className={`text-[11px] transition-colors ${
                        confirmClearMemories
                          ? 'text-red-300 font-semibold underline'
                          : 'text-red-400 hover:underline'
                      }`}
                    >
                      {confirmClearMemories ? 'Click again to confirm clear' : 'Clear All Memories'}
                    </button>
                  )}
                </div>

                {/* Add new memory */}
                <div className="flex items-center gap-2 mb-3">
                  <input
                    type="text"
                    value={newMemory}
                    onChange={(e) => setNewMemory(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleAddMemory();
                      }
                    }}
                    placeholder="Remember that I work as a Python backend engineer..."
                    className="flex-1 rounded-lg bg-[#171717] border border-[#262626] px-3 py-2 text-xs text-white placeholder-[#71717A] outline-none focus:border-[#52525B]"
                  />
                  <button
                    type="button"
                    onClick={handleAddMemory}
                    className="flex items-center gap-1 rounded-lg bg-white text-black px-3 py-2 text-xs font-semibold hover:bg-neutral-200"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    <span>Add</span>
                  </button>
                </div>

                {/* Memory list */}
                {localSettings.memories.length === 0 ? (
                  <p className="text-[11px] text-[#71717A] italic py-2">
                    No personal memories saved yet. ULTRON only saves long-term facts you specify here.
                  </p>
                ) : (
                  <div className="space-y-1.5 max-h-48 overflow-y-auto">
                    {localSettings.memories.map((mem, idx) => (
                      <div
                        key={idx}
                        className="flex items-center justify-between rounded-lg bg-[#171717] border border-[#262626] px-3 py-2 text-xs text-[#EDEDED]"
                      >
                        <span className="truncate pr-2">{mem}</span>
                        <button
                          type="button"
                          onClick={() => handleRemoveMemory(idx)}
                          className="text-[#71717A] hover:text-red-400 p-1"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Conversation History & Chat Deletion Controls */}
              <div className="pt-4 border-t border-[#262626]">
                <h4 className="font-medium text-white mb-1">Chat History & Deletion</h4>
                <p className="text-[#71717A] mb-3">
                  Delete saved conversations and clean up local chat data anytime.
                </p>
                <div className="flex items-center justify-between rounded-xl bg-[#171717] border border-[#262626] p-3">
                  <div>
                    <span className="font-medium text-white block">Delete All Chats</span>
                    <span className="text-[11px] text-[#71717A]">
                      {clearChatsDone ? 'All conversations deleted!' : 'Remove all conversation history stored on this device'}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={handleClearChatsTrigger}
                    className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                      confirmClearAllChats
                        ? 'bg-red-600 text-white'
                        : clearChatsDone
                        ? 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                        : 'bg-red-950/40 text-red-400 border border-red-800/80 hover:bg-red-900/40'
                    }`}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    <span>{confirmClearAllChats ? 'Click to Confirm Delete' : clearChatsDone ? 'Cleared!' : 'Clear All Chats'}</span>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* TAB 4: ABOUT & SYSTEM STATUS */}
          {activeTab === 'about' && (
            <div className="space-y-4">
              {/* Creator Card: Developed by Jagjit */}
              <div className="rounded-xl bg-gradient-to-r from-blue-950/40 via-[#171717] to-blue-950/20 border border-blue-800/60 p-4 space-y-2 shadow-lg shadow-blue-950/30">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-600 text-white font-bold text-xs shadow-md shadow-blue-500/30">
                      J
                    </div>
                    <div>
                      <h3 className="text-sm font-bold text-white tracking-wide">Developed by Jagjit</h3>
                      <p className="text-[11px] text-blue-400 font-medium">Personal AI Edition & Lead Architect</p>
                    </div>
                  </div>
                  <span className="text-[10px] font-semibold uppercase px-2 py-0.5 rounded-full bg-blue-950/80 border border-blue-700/80 text-blue-300">
                    Official
                  </span>
                </div>
                <p className="text-[11px] text-[#D4D4D8] leading-relaxed pt-1">
                  Engineered with Groq lightning-speed LLM processing, multilingual Hindi & Hinglish natural voice comprehension, universal file intelligence system, and AMOLED minimalism.
                </p>
              </div>

              <div className="rounded-xl bg-[#171717] border border-[#262626] p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-white">API Engine Connectivity</span>
                  <button
                    onClick={onRefreshStatus}
                    className="flex items-center gap-1 text-[11px] text-blue-400 hover:text-blue-300"
                  >
                    <RefreshCw className="h-3 w-3" />
                    <span>Refresh</span>
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-3 pt-1">
                  <div className="rounded-lg bg-[#111111] border border-[#262626] p-2.5">
                    <span className="text-[10px] text-[#71717A] uppercase block font-mono">Groq API</span>
                    <span
                      className={`font-semibold text-xs ${
                        systemStatus.groqConfigured ? 'text-emerald-400' : 'text-amber-400'
                      }`}
                    >
                      {systemStatus.groqConfigured ? 'Connected & Active' : 'Fallback / Not Set'}
                    </span>
                  </div>

                  <div className="rounded-lg bg-[#111111] border border-[#262626] p-2.5">
                    <span className="text-[10px] text-[#71717A] uppercase block font-mono">Gemini Fallback & Voice</span>
                    <span
                      className={`font-semibold text-xs ${
                        systemStatus.geminiConfigured ? 'text-blue-400' : 'text-zinc-500'
                      }`}
                    >
                      {systemStatus.geminiConfigured ? 'Online (Ready)' : 'Inactive'}
                    </span>
                  </div>
                </div>

                <div className="text-[11px] text-[#71717A] leading-relaxed">
                  ULTRON connects directly through server-side secret handling. Secrets are never exposed to browser client code.
                </div>
              </div>

              <div className="rounded-xl bg-[#171717] border border-[#262626] p-4 space-y-2">
                <h3 className="font-semibold text-white">About ULTRON</h3>
                <p className="text-[11px] text-[#A1A1AA] leading-relaxed">
                  ULTRON is a powerful, ultra-fast, minimal AMOLED personal AI assistant engineered for high-throughput responses, universal file &amp; real PDF creation, animated Voice Mode, multi-step automation, and commanding baritone neural voice synthesis.
                </p>
                <div className="pt-2 text-[10px] font-mono text-blue-400/80">
                  Developed by Jagjit • Architecture: Express + Vite + Groq Cloud + ULTRON Voice
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="flex items-center justify-between border-t border-[#262626] bg-[#000000] px-5 py-3">
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-blue-400 font-medium">
              Developed by Jagjit
            </span>
            {saveSuccess && (
              <span className="text-[11px] text-green-400 font-medium">
                • Settings Saved!
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="rounded-lg px-3 py-1.5 text-xs text-[#A1A1AA] hover:bg-[#171717] hover:text-white transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              className="rounded-lg bg-blue-600 hover:bg-blue-500 text-white px-4 py-1.5 text-xs font-semibold transition-colors shadow-md shadow-blue-900/30"
            >
              Save Preferences
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
