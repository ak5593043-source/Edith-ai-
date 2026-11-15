import React from 'react';
import { Mic, MicOff, Volume2, X, AudioLines, MessageSquare, Sparkles } from 'lucide-react';
import { PlaybackState } from '../hooks/useSpeech.ts';
import { DotSphere } from './DotSphere.tsx';

interface JarvisSphereProps {
  isActive: boolean;
  isListening: boolean;
  isStreaming: boolean;
  playbackState: PlaybackState;
  transcript: string;
  interimTranscript: string;
  lastAssistantMessage: string;
  activeVoiceName: string;
  wakeWordEnabled?: boolean;
  hasVoicePrint?: boolean;
  getAudioLevel: () => number;
  onToggleListening: () => void;
  onClose: () => void;
  onTestVoice?: () => void;
  onSendCustomPrompt?: (prompt: string) => void;
}

export const JarvisSphere: React.FC<JarvisSphereProps> = ({
  isActive,
  isListening,
  isStreaming,
  playbackState,
  transcript,
  interimTranscript,
  lastAssistantMessage,
  activeVoiceName,
  wakeWordEnabled = false,
  hasVoicePrint = false,
  getAudioLevel,
  onToggleListening,
  onClose,
  onTestVoice,
}) => {
  if (!isActive) return null;

  const isSpeaking = playbackState === 'playing';
  const isLoadingAudio = playbackState === 'loading';
  const isThinking = isStreaming && !isSpeaking;
  const hasSpokenText = Boolean((transcript + ' ' + interimTranscript).trim());

  return (
    <div
      data-testid="voice-mode-stage"
      className="absolute inset-0 z-40 flex flex-col items-center justify-between bg-[#000000] p-4 sm:p-6 overflow-hidden select-none"
    >
      {/* Clean Neutral AMOLED Ambient Gradient */}
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_42%,rgba(59,130,246,0.08),transparent_68%)] pointer-events-none" />

      {/* Top Header Controls */}
      <div className="relative z-10 w-full max-w-2xl flex items-center justify-between pt-2">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[#121620] border border-blue-500/40 text-blue-400">
            <AudioLines className="h-4 w-4" />
          </div>
          <div>
            <span className="font-semibold text-sm tracking-wider text-white block">
              ULTRON · Voice Assistant
            </span>
            <p className="text-[11px] text-[#A1A1AA] font-normal">
              {wakeWordEnabled
                ? hasVoicePrint
                  ? 'Hi ULTRON + Voice Print Active'
                  : 'Hi ULTRON Wake Standby Active'
                : 'Commanding & Confident Voice'}
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={onClose}
          title="Exit Voice Mode"
          aria-label="Exit Voice Mode"
          className="flex h-9 w-9 items-center justify-center rounded-full bg-[#171717] hover:bg-[#262626] border border-[#333] text-[#A1A1AA] hover:text-white transition-colors"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Center Voice-Reactive 3D Dot Sphere Stage */}
      <div className="relative z-10 flex flex-col items-center justify-center my-auto w-full max-w-md">
        <div className="relative flex flex-col items-center justify-center">
          <DotSphere
            playbackState={playbackState}
            isListening={isListening}
            isStreaming={isStreaming}
            getAudioLevel={getAudioLevel}
            onTapSphere={onToggleListening}
          />

          {/* Live Status Indicator */}
          <div className="mt-2 flex items-center gap-2 px-3.5 py-1 rounded-full bg-[#0e1017]/90 border border-white/10 backdrop-blur-md shadow-lg">
            <span
              className={`h-2 w-2 rounded-full ${
                isSpeaking
                  ? 'bg-blue-400 animate-ping'
                  : isLoadingAudio
                  ? 'bg-indigo-400 animate-pulse'
                  : isListening
                  ? 'bg-sky-400 animate-pulse'
                  : isThinking
                  ? 'bg-amber-400 animate-pulse'
                  : 'bg-emerald-400'
              }`}
            />
            <span className="text-xs font-medium text-white tracking-wide">
              {isSpeaking
                ? 'ULTRON Speaking...'
                : isLoadingAudio
                ? 'Preparing voice...'
                : isListening
                ? 'Listening (long command ready)...'
                : isThinking
                ? 'Completing your task...'
                : 'Ready • Tap mic or sphere to speak'}
            </span>
          </div>
        </div>

        {/* Live Subtitles / Transcript Display */}
        <div className="w-full mt-4 text-center px-4 max-h-32 overflow-y-auto">
          {isListening && (interimTranscript || transcript) ? (
            <div className="space-y-1">
              <span className="text-[10px] uppercase font-mono text-blue-400 tracking-wider">
                Listening
              </span>
              <p className="text-sm sm:text-base text-white font-medium leading-relaxed">
                &ldquo;{transcript}{' '}
                <span className="text-blue-300 animate-pulse">{interimTranscript}</span>&rdquo;
              </p>
            </div>
          ) : isSpeaking && lastAssistantMessage ? (
            <div className="space-y-1">
              <span className="text-[10px] uppercase font-mono text-blue-400 tracking-wider">
                ULTRON
              </span>
              <p className="text-xs sm:text-sm text-[#D4D4D8] leading-relaxed line-clamp-3">
                &ldquo;{lastAssistantMessage}&rdquo;
              </p>
            </div>
          ) : (
            <p className="text-xs sm:text-sm text-[#71717A]">
              Speak naturally in Hindi, Hinglish, or English — even long multi-step commands.
            </p>
          )}
        </div>
      </div>

      {/* Bottom Control Bar */}
      <div className="relative z-10 w-full max-w-2xl pb-3 flex flex-col items-center gap-3">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2.5 w-full rounded-2xl sm:rounded-full bg-[#0e0e14]/95 border border-white/10 px-4 sm:px-5 py-2.5 backdrop-blur-xl shadow-[0_12px_40px_rgba(0,0,0,0.85)]">
          <div className="flex items-center gap-2 min-w-0">
            <Volume2 className="h-4 w-4 text-blue-400 shrink-0" />
            <span className="text-xs font-medium text-white truncate max-w-[240px] sm:max-w-[230px]">
              {activeVoiceName || 'ULTRON · Commanding Deep Power'}
            </span>
          </div>

          <div className="flex flex-wrap items-center justify-center sm:justify-end gap-1.5 sm:gap-2 shrink-0">
            {onTestVoice && (
              <button
                type="button"
                onClick={onTestVoice}
                aria-label="Test ULTRON Voice"
                className="flex items-center gap-1.5 rounded-full bg-white/5 hover:bg-white/10 border border-white/10 px-2.5 sm:px-3 py-1.5 text-[11px] sm:text-xs font-medium text-[#E4E4E7] transition-colors whitespace-nowrap"
              >
                <Sparkles className="h-3.5 w-3.5 text-blue-400" />
                <span>Test Voice</span>
              </button>
            )}

            <button
              type="button"
              onClick={onToggleListening}
              className={`flex items-center gap-1.5 sm:gap-2 rounded-full px-3 sm:px-4 py-1.5 text-[11px] sm:text-xs font-semibold transition-all shadow-md whitespace-nowrap ${
                isListening
                  ? hasSpokenText
                    ? 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-emerald-900/40'
                    : 'bg-red-600 hover:bg-red-500 text-white shadow-red-900/40'
                  : 'bg-blue-600 hover:bg-blue-500 text-white shadow-blue-900/40'
              }`}
            >
              {isListening ? (
                <>
                  <MicOff className="h-3.5 w-3.5" />
                  <span>{hasSpokenText ? 'Send Now' : 'Stop & Send'}</span>
                </>
              ) : (
                <>
                  <Mic className="h-3.5 w-3.5" />
                  <span>Start Listening</span>
                </>
              )}
            </button>

            <button
              type="button"
              onClick={onClose}
              className="flex items-center gap-1.5 text-[11px] sm:text-xs text-[#A1A1AA] hover:text-white px-2.5 py-1.5 rounded-full hover:bg-white/5 transition-colors whitespace-nowrap"
            >
              <MessageSquare className="h-3.5 w-3.5" />
              <span>Chat View</span>
            </button>
          </div>
        </div>

        <span className="text-[10px] font-mono text-[#71717A]">
          Developed by Jagjit • ULTRON Voice Assistant
        </span>
      </div>
    </div>
  );
};
