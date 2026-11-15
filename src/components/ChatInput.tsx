import React, { useRef, useEffect } from 'react';
import {
  Paperclip,
  Mic,
  MicOff,
  ArrowUp,
  Square,
  Globe,
  X,
  Loader2,
  FileText,
  Image as ImageIcon,
  FileSpreadsheet,
  Music,
  Video,
  Archive,
  Code2,
  File,
  AudioLines,
} from 'lucide-react';
import { AttachedFile } from '../types/chat.ts';

interface ChatInputProps {
  input: string;
  setInput: (value: string) => void;
  onSend: () => void;
  onStop: () => void;
  isStreaming: boolean;
  isListening: boolean;
  onToggleListening: () => void;
  onPauseVoiceForTyping?: () => void;
  isWebSearchActive: boolean;
  onToggleWebSearch: () => void;
  attachedFiles: AttachedFile[];
  onAddFiles: (files: FileList) => void;
  onRemoveFile: (fileId: string) => void;
  isUploadingFile: boolean;
  uploadError: string | null;
  onClearUploadError: () => void;
  onOpenSphere?: () => void;
  transcript?: string;
  interimTranscript?: string;
}

const UNIVERSAL_ACCEPT_TYPES = [
  // Documents
  '.pdf', '.doc', '.docx', '.txt', '.rtf', '.odt', '.md',
  // Spreadsheets
  '.xls', '.xlsx', '.csv', '.ods',
  // Presentations
  '.ppt', '.pptx', '.odp',
  // Data
  '.json', '.xml', '.yaml', '.yml', '.html', '.htm',
  // Images
  'image/*', '.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.tiff', '.tif', '.svg',
  // Audio
  'audio/*', '.mp3', '.wav', '.m4a', '.aac', '.ogg', '.flac',
  // Video
  'video/*', '.mp4', '.mov', '.webm', '.mkv', '.avi',
  // Archives
  '.zip', '.tar', '.gz',
  // Code
  '.js', '.ts', '.jsx', '.tsx', '.py', '.java', '.c', '.cpp', '.h', '.hpp', '.css', '.sql', '.php', '.sh', '.go', '.rs', '.rb',
].join(',');

export const ChatInput: React.FC<ChatInputProps> = ({
  input,
  setInput,
  onSend,
  onStop,
  isStreaming,
  isListening,
  onToggleListening,
  onPauseVoiceForTyping,
  isWebSearchActive,
  onToggleWebSearch,
  attachedFiles,
  onAddFiles,
  onRemoveFile,
  isUploadingFile,
  uploadError,
  onClearUploadError,
  onOpenSphere,
  transcript = '',
  interimTranscript = '',
}) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const liveSpeech = (transcript ? `${transcript} ` : '') + (interimTranscript || '');
  const displayText = isListening && liveSpeech ? liveSpeech : input;

  // Auto-resize textarea height asynchronously on animation frame so Android keyboard typing never stutters
  useEffect(() => {
    const rafId = requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (!el) return;
      el.style.height = 'auto';
      const scrollHeight = el.scrollHeight;
      el.style.height = `${Math.min(Math.max(scrollHeight, 24), 160)}px`;
    });
    return () => cancelAnimationFrame(rafId);
  }, [displayText]);

  const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const nextValue = e.target.value;
    if (isListening && onPauseVoiceForTyping) {
      onPauseVoiceForTyping();
    }
    setInput(nextValue);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (!isStreaming && (displayText.trim() || attachedFiles.length > 0)) {
        if (isListening) {
          if (onPauseVoiceForTyping) onPauseVoiceForTyping();
          else onToggleListening();
        }
        onSend();
      }
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      onAddFiles(e.target.files);
      e.target.value = ''; // Reset input to allow re-uploading same file
    }
  };

  const canSubmit = (displayText.trim().length > 0 || attachedFiles.length > 0) && !isUploadingFile;

  const getFileIcon = (file: AttachedFile) => {
    if (file.isImage && file.base64Data) {
      return (
        <img
          src={file.base64Data}
          alt={file.name}
          className="h-5 w-5 rounded-full object-cover border border-white/20"
        />
      );
    }
    const cat = file.category;
    switch (cat) {
      case 'spreadsheet':
        return <FileSpreadsheet className="h-3.5 w-3.5 text-emerald-400" />;
      case 'audio':
        return <Music className="h-3.5 w-3.5 text-purple-400" />;
      case 'video':
        return <Video className="h-3.5 w-3.5 text-rose-400" />;
      case 'archive':
        return <Archive className="h-3.5 w-3.5 text-amber-400" />;
      case 'code':
        return <Code2 className="h-3.5 w-3.5 text-cyan-400" />;
      case 'image':
        return <ImageIcon className="h-3.5 w-3.5 text-blue-400" />;
      case 'presentation':
        return <FileText className="h-3.5 w-3.5 text-orange-400" />;
      case 'document':
      case 'data':
      default:
        return <File className="h-3.5 w-3.5 text-blue-400" />;
    }
  };

  const formatFileSize = (bytes: number) => {
    if (bytes >= 1024 * 1024) {
      return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    }
    return `${(bytes / 1024).toFixed(1)} KB`;
  };

  return (
    <div className="w-full max-w-2xl mx-auto px-3 sm:px-6 pb-3 sm:pb-6 pt-1">
      {/* Upload error banner */}
      {uploadError && (
        <div className="mb-2.5 flex items-center justify-between rounded-2xl bg-red-950/50 border border-red-800/80 px-4 py-2 text-xs text-red-200 backdrop-blur-md shadow-lg">
          <span>{uploadError}</span>
          <button onClick={onClearUploadError} className="text-red-400 hover:text-white">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Attached Files Floating Island Chips */}
      {attachedFiles.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5 px-2">
          {attachedFiles.map((file) => (
            <div
              key={file.id}
              className="flex items-center gap-2 rounded-full bg-[#121215] border border-white/10 px-3 py-1 text-xs text-white shadow-lg backdrop-blur-md"
            >
              {getFileIcon(file)}
              <div className="flex flex-col text-left">
                <span className="max-w-[130px] sm:max-w-[180px] truncate font-medium text-[11px]">
                  {file.name}
                </span>
                <span className="text-[9px] text-[#71717A] leading-none">
                  {formatFileSize(file.size)}
                </span>
              </div>
              <button
                type="button"
                onClick={() => onRemoveFile(file.id)}
                aria-label={`Remove ${file.name}`}
                className="rounded-full p-0.5 text-[#8E8E93] hover:text-white transition-colors"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}

          {isUploadingFile && (
            <div className="flex items-center gap-1.5 rounded-full bg-[#121215] border border-white/10 px-3 py-1 text-xs text-[#8E8E93]">
              <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-400" />
              <span className="text-[11px]">Processing file...</span>
            </div>
          )}
        </div>
      )}

      {/* iPhone Dynamic Island Ultra-Curved Capsule Container */}
      <div
        className={`relative flex flex-col rounded-[42px] sm:rounded-[50px] bg-[#070709] border transition-all duration-300 shadow-[0_16px_50px_rgba(0,0,0,0.85),0_0_20px_rgba(0,0,0,0.9)] ${
          isListening
            ? 'border-blue-500/80 shadow-[0_20px_60px_rgba(0,0,0,0.9),0_0_35px_rgba(59,130,246,0.35)] ring-1 ring-blue-500/30'
            : isStreaming
            ? 'border-blue-500/50 shadow-[0_20px_60px_rgba(0,0,0,0.9),0_0_25px_rgba(59,130,246,0.2)]'
            : 'border-white/10 focus-within:border-blue-500/60 focus-within:shadow-[0_20px_60px_rgba(0,0,0,0.95),0_0_30px_rgba(59,130,246,0.25)]'
        }`}
      >
        {/* Hidden File Input supporting all technical formats */}
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept={UNIVERSAL_ACCEPT_TYPES}
          className="hidden"
          onChange={handleFileChange}
        />

        {/* Text Area */}
        <textarea
          ref={textareaRef}
          value={displayText}
          onChange={handleTextChange}
          onKeyDown={handleKeyDown}
          placeholder={isListening ? "Listening silently... Speak your command (pause or tap Mic to send)" : "Command ULTRON, upload files, or ask anything..."}
          rows={1}
          aria-label="Message ULTRON"
          className="w-full resize-none bg-transparent px-5 pt-3.5 pb-1.5 text-sm sm:text-[15px] text-white placeholder-[#636366] outline-none max-h-40 min-h-[42px] leading-relaxed select-text"
        />

        {/* Dynamic Island Integrated Controls Bar */}
        <div className="flex items-center justify-between px-3.5 pb-2.5 pt-0.5">
          {/* Left tools: Attachment & Web search */}
          <div className="flex items-center gap-1 sm:gap-1.5">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              title="Upload Universal Files (PDF, Word, Excel, PPT, Audio, Video, Archives, Code, Images)"
              aria-label="Attach file"
              disabled={isUploadingFile}
              className="flex h-8 w-8 items-center justify-center rounded-full text-[#8E8E93] hover:bg-[#1a1a1f] hover:text-white transition-all disabled:opacity-40"
            >
              {isUploadingFile ? (
                <Loader2 className="h-4 w-4 animate-spin text-blue-400" />
              ) : (
                <Paperclip className="h-4 w-4" />
              )}
            </button>

            <button
              type="button"
              onClick={onToggleWebSearch}
              title={isWebSearchActive ? 'Web search enabled' : 'Toggle live web search'}
              aria-label="Toggle live web search"
              className={`flex h-7 items-center gap-1.5 rounded-full px-2.5 text-[11px] font-medium transition-all ${
                isWebSearchActive
                  ? 'bg-blue-950/60 text-blue-400 border border-blue-600/50 shadow-sm shadow-blue-950'
                  : 'text-[#8E8E93] hover:bg-[#1a1a1f] hover:text-white border border-transparent'
              }`}
            >
              <Globe className="h-3 w-3" />
              <span className="hidden sm:inline">Search</span>
            </button>

            {onOpenSphere && (
              <button
                type="button"
                onClick={onOpenSphere}
                title="Open ULTRON Voice Mode"
                aria-label="Open ULTRON Voice Mode"
                className="flex h-7 items-center gap-1.5 rounded-full px-2.5 text-[11px] font-medium text-blue-300 bg-[#121620] border border-blue-500/35 hover:bg-[#1a2233] hover:border-blue-400/60 transition-all"
              >
                <AudioLines className="h-3 w-3 text-blue-400" />
                <span className="hidden sm:inline">Voice Mode</span>
              </button>
            )}
          </div>

          {/* Right tools: Voice mic & Send / Stop */}
          <div className="flex items-center gap-1.5">
            {/* Dynamic Sound Wave Visualizer when Listening */}
            {isListening && (
              <div className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-blue-950/60 border border-blue-500/50 animate-pulse">
                <span className="w-0.5 h-2 bg-blue-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                <span className="w-0.5 h-3.5 bg-blue-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                <span className="w-0.5 h-5 bg-blue-300 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                <span className="w-0.5 h-2.5 bg-blue-400 rounded-full animate-bounce" style={{ animationDelay: '450ms' }} />
                <span className="text-[10px] text-blue-300 font-medium pl-1">Listening</span>
              </div>
            )}

            {/* Microphone Button */}
            <button
              type="button"
              onClick={onToggleListening}
              title={isListening ? 'Stop listening' : 'Start voice input'}
              aria-label={isListening ? 'Stop listening' : 'Start voice input'}
              className={`flex h-8 w-8 items-center justify-center rounded-full transition-all ${
                isListening
                  ? 'bg-red-600 text-white shadow-lg shadow-red-900/50 scale-105'
                  : 'text-[#8E8E93] hover:bg-[#1a1a1f] hover:text-white'
              }`}
            >
              {isListening ? (
                <MicOff className="h-4 w-4" />
              ) : (
                <Mic className="h-4 w-4" />
              )}
            </button>

            {/* Send / Stop Generation Button */}
            {isStreaming ? (
              <button
                type="button"
                onClick={onStop}
                title="Stop generation"
                aria-label="Stop generation"
                className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-600 hover:bg-blue-500 text-white transition-all shadow-md shadow-blue-900/40 active:scale-95"
              >
                <Square className="h-3 w-3 fill-white" />
              </button>
            ) : (
              <button
                type="button"
                onClick={onSend}
                disabled={!canSubmit}
                title="Send message"
                aria-label="Send message"
                className={`flex h-8 w-8 items-center justify-center rounded-full transition-all active:scale-95 ${
                  canSubmit
                    ? 'bg-blue-600 hover:bg-blue-500 text-white shadow-lg shadow-blue-600/30'
                    : 'bg-[#1a1a1f] text-[#48484a] cursor-not-allowed'
                }`}
              >
                <ArrowUp className="h-4 w-4 stroke-[2.5]" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
