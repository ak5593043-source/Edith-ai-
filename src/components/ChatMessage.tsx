import React, { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import {
  Copy,
  Check,
  Volume2,
  Square,
  Play,
  Pause,
  RotateCw,
  Edit3,
  ExternalLink,
  AlertCircle,
  FileText,
  Image as ImageIcon,
  FileSpreadsheet,
  Music,
  Video,
  Archive,
  Code2,
  File,
  Loader2,
  FileDown,
  X,
} from 'lucide-react';
import { Message, AttachedFile, SearchSource, TaskPlan } from '../types/chat.ts';
import { DeviceActionCard } from './DeviceActionCard.tsx';
import { PdfActionCard } from './PdfActionCard.tsx';
import { TaskPipelineCard } from './TaskPipelineCard.tsx';
import { EdithLogo } from './EdithLogo.tsx';
import { extractDeviceActions } from '../utils/actionDispatcher.ts';
import { extractTaskPlan, stripRawTaskPlanTags } from '../utils/commandPlanner.ts';
import { extractPdfPayload, isPdfRequestPrompt, downloadRealPdf, stripRawPdfTags } from '../utils/pdfParser.ts';

interface ChatMessageProps {
  message: Message;
  previousUserPrompt?: string;
  isStreaming?: boolean;
  onRegenerate?: () => void;
  onEditMessage?: (newContent: string) => void;
  onPlay?: (text: string, messageId: string) => void;
  onPause?: () => void;
  onResume?: () => void;
  onStop?: () => void;
  playbackState?: 'idle' | 'loading' | 'playing' | 'paused';
  activeSpeakingId?: string | null;
  onUpdateTaskPlan?: (plan: TaskPlan) => void;
}

export const ChatMessage: React.FC<ChatMessageProps> = ({
  message,
  previousUserPrompt = '',
  isStreaming,
  onRegenerate,
  onEditMessage,
  onPlay,
  onPause,
  onResume,
  onStop,
  playbackState = 'idle',
  activeSpeakingId,
  onUpdateTaskPlan,
}) => {
  const [copied, setCopied] = useState(false);
  const [isExportingPdf, setIsExportingPdf] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState(message.content);
  const [previewImage, setPreviewImage] = useState<{ src: string; name: string } | null>(null);

  const isUser = message.role === 'user';
  const isThisMessageSpeaking = activeSpeakingId === message.id;
  const isPlayingNow = isThisMessageSpeaking && playbackState === 'playing';
  const isPausedNow = isThisMessageSpeaking && playbackState === 'paused';
  const isLoadingAudio = isThisMessageSpeaking && playbackState === 'loading';

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy message:', err);
    }
  };

  const handleSaveEdit = () => {
    if (editContent.trim() && onEditMessage) {
      onEditMessage(editContent.trim());
      setIsEditing(false);
    }
  };

  const handleCancelEdit = () => {
    setEditContent(message.content);
    setIsEditing(false);
  };

  const getFileBadgeIcon = (file: AttachedFile) => {
    if (file.isImage && file.base64Data) {
      return (
        <img
          src={file.base64Data}
          alt={file.name}
          className="h-9 w-9 rounded object-cover border border-[#262626]"
        />
      );
    }
    const cat = file.category;
    switch (cat) {
      case 'spreadsheet':
        return <FileSpreadsheet className="h-4 w-4 text-emerald-400" />;
      case 'audio':
        return <Music className="h-4 w-4 text-purple-400" />;
      case 'video':
        return <Video className="h-4 w-4 text-rose-400" />;
      case 'archive':
        return <Archive className="h-4 w-4 text-amber-400" />;
      case 'code':
        return <Code2 className="h-4 w-4 text-cyan-400" />;
      case 'presentation':
        return <FileText className="h-4 w-4 text-orange-400" />;
      case 'image':
        return <ImageIcon className="h-4 w-4 text-blue-400" />;
      default:
        return <File className="h-4 w-4 text-blue-400" />;
    }
  };

  return (
    <div
      className={`group w-full py-4 sm:py-5 px-3 sm:px-6 transition-colors ${
        isUser ? 'flex justify-end' : 'flex justify-start bg-[#0a0a0a]/50'
      }`}
    >
      <div className={`flex w-full max-w-3xl gap-3 sm:gap-4 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}>
        {/* Avatar */}
        <div className="shrink-0 pt-0.5">
          {isUser ? (
            <div className="flex h-7 w-7 sm:h-8 sm:w-8 items-center justify-center rounded-full bg-[#1e293b] border border-blue-900/40 text-xs font-semibold text-blue-200 shadow-sm">
              U
            </div>
          ) : (
            <EdithLogo size="sm" animated={!!isStreaming} />
          )}
        </div>

        {/* Message Content Container */}
        <div className={`flex flex-col min-w-0 max-w-[85%] sm:max-w-[88%] ${isUser ? 'items-end' : 'items-start'}`}>
          {/* User Attached Files Preview */}
          {message.attachedFiles && message.attachedFiles.length > 0 && (
            <div className="mb-2.5 flex flex-wrap gap-2">
              {message.attachedFiles.map((file: AttachedFile) => (
                <div
                  key={file.id}
                  onClick={() => {
                    if (file.isImage && file.base64Data) {
                      setPreviewImage({ src: file.base64Data, name: file.name });
                    }
                  }}
                  className={`flex items-center gap-2 rounded-xl bg-[#171717] border border-[#262626] p-2 pr-3.5 text-xs text-[#A1A1AA] shadow-sm ${
                    file.isImage && file.base64Data ? 'cursor-pointer hover:border-blue-500/50 transition-colors' : ''
                  }`}
                >
                  {getFileBadgeIcon(file)}
                  <div className="flex flex-col overflow-hidden text-left">
                    <span className="font-medium text-white truncate max-w-[140px] sm:max-w-[200px]">
                      {file.name}
                    </span>
                    <span className="text-[10px] text-[#71717A]">
                      {(file.size / 1024).toFixed(1)} KB {file.category ? `• ${file.category}` : ''}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* User message edit mode */}
          {isEditing ? (
            <div className="w-full flex flex-col gap-2 rounded-xl bg-[#171717] border border-[#262626] p-3 text-sm">
              <textarea
                value={editContent}
                onChange={(e) => setEditContent(e.target.value)}
                rows={3}
                className="w-full resize-none bg-transparent text-white outline-none focus:ring-0 placeholder-[#71717A]"
              />
              <div className="flex justify-end gap-2 pt-1 border-t border-[#262626]">
                <button
                  onClick={handleCancelEdit}
                  className="rounded px-2.5 py-1 text-xs text-[#A1A1AA] hover:bg-[#262626] hover:text-white"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSaveEdit}
                  className="rounded bg-white px-3 py-1 text-xs font-medium text-black hover:bg-neutral-200"
                >
                  Save & Submit
                </button>
              </div>
            </div>
          ) : isUser ? (
            /* User Bubble with sleek iOS capsule curvature and balanced responsive typography */
            <div className="rounded-[20px] bg-[#1a1a1f] border border-white/8 px-4 sm:px-5 py-2.5 sm:py-3 text-[15px] sm:text-[16px] text-white leading-relaxed whitespace-pre-wrap break-words shadow-sm">
              {message.content}
            </div>
          ) : (
            /* ULTRON Response (Markdown + KaTeX Formula support) */
            <div className="w-full text-[15px] sm:text-[16px] leading-relaxed text-[#EDEDED] overflow-x-hidden">
              {/* Error message card */}
              {message.error ? (
                <div className="rounded-xl border border-red-900/60 bg-red-950/20 p-3.5 text-xs text-red-300 flex flex-col gap-2">
                  <div className="flex items-center gap-2 font-medium">
                    <AlertCircle className="h-4 w-4 shrink-0 text-red-400" />
                    <span>Communication Error</span>
                  </div>
                  <p className="text-red-200/90 leading-relaxed text-sm">{message.error}</p>
                  {onRegenerate && (
                    <button
                      onClick={onRegenerate}
                      className="self-start flex items-center gap-1.5 rounded bg-red-900/40 hover:bg-red-900/60 border border-red-800/80 px-2.5 py-1 text-xs font-medium text-white transition-colors mt-1"
                    >
                      <RotateCw className="h-3 w-3" />
                      Retry Generation
                    </button>
                  )}
                </div>
              ) : (
                <div className="prose prose-invert max-w-none break-words text-[15px] sm:text-[16px] leading-relaxed prose-p:my-2.5 prose-p:text-[15px] sm:prose-p:text-[16px] prose-p:leading-relaxed prose-li:text-[15px] sm:prose-li:text-[16px] prose-headings:text-white prose-headings:font-semibold prose-headings:tracking-tight prose-h1:text-xl sm:prose-h1:text-2xl prose-h2:text-lg sm:prose-h2:text-xl prose-h3:text-base sm:prose-h3:text-lg prose-strong:text-white prose-strong:font-semibold prose-code:text-neutral-200 prose-code:bg-[#171717] prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded prose-code:text-[13.5px] sm:prose-code:text-[14px] prose-code:before:content-none prose-code:after:content-none prose-pre:bg-[#111111] prose-pre:border prose-pre:border-[#262626] prose-pre:p-0 prose-pre:rounded-xl prose-ul:my-2.5 prose-ol:my-2.5 prose-li:my-1 prose-a:text-blue-400 prose-a:underline hover:prose-a:text-blue-300">
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm, [remarkMath, { singleDollarTextMath: true }]]}
                    rehypePlugins={[[rehypeKatex, { throwOnError: false, strict: false }]]}
                    components={{
                      pre: ({ children }) => {
                        const codeChild = children as any;
                        const className = String(codeChild?.props?.className || '');
                        const langMatch = className.match(/language-([a-zA-Z0-9_+-]+)/);
                        const langLabel = langMatch ? langMatch[1] : 'Code';
                        return (
                          <div className="relative my-3 rounded-lg border border-[#262626] bg-[#111111] overflow-hidden">
                            <div className="flex items-center justify-between border-b border-[#262626] bg-[#171717] px-3.5 py-1.5 text-xs text-[#A1A1AA]">
                              <span className="font-mono text-[11px] uppercase tracking-wider">{langLabel}</span>
                              <button
                                type="button"
                                onClick={async (e) => {
                                  const btn = e.currentTarget;
                                  try {
                                    const extractText = (node: any): string => {
                                      if (typeof node === 'string') return node;
                                      if (Array.isArray(node)) return node.map(extractText).join('');
                                      if (node?.props?.children) return extractText(node.props.children);
                                      return '';
                                    };
                                    const codeText = extractText(codeChild?.props?.children);
                                    await navigator.clipboard.writeText(codeText);
                                    const labelEl = btn.querySelector('span');
                                    if (labelEl) {
                                      labelEl.textContent = 'Copied!';
                                      setTimeout(() => {
                                        labelEl.textContent = 'Copy';
                                      }, 1800);
                                    }
                                  } catch (err) {
                                    console.error(err);
                                  }
                                }}
                                className="flex items-center gap-1 hover:text-white transition-colors"
                              >
                                <Copy className="h-3 w-3" />
                                <span>Copy</span>
                              </button>
                            </div>
                            <pre className="p-3.5 overflow-x-auto text-sm leading-relaxed text-[#EDEDED] font-mono">
                              {children}
                            </pre>
                          </div>
                        );
                      },
                    }}
                  >
                    {(() => {
                      const { cleanText: noActionText } = extractDeviceActions(message.content || '', false);
                      const cleanText = stripRawTaskPlanTags(stripRawPdfTags(noActionText));
                      // Preprocess bracket notations into KaTeX-compatible dollar delimiters
                      return cleanText
                        .replace(/\\\[([\s\S]*?)\\\]/g, '\n\n$$\n$1\n$$\n\n')
                        .replace(/\\\(([\s\S]*?)\\\)/g, '$$$1$$');
                    })()}
                  </ReactMarkdown>

                  {/* Pulsing cursor while streaming */}
                  {isStreaming && (
                    <span className="inline-block h-4 w-1.5 ml-1 bg-blue-400 animate-pulse" />
                  )}

                  {/* Multi-Step Command Note & Sequential Execution Card OR Single Device Action Card */}
                  {(() => {
                    if (isStreaming) return null;
                    const { actions: parsedActions } = extractDeviceActions(message.content || '');
                    const resolvedActions =
                      message.actions && message.actions.length > 0
                        ? message.actions
                        : message.action
                        ? [message.action]
                        : parsedActions;

                    const { plan: extractedPlan } = extractTaskPlan(
                      message.content || '',
                      previousUserPrompt,
                      resolvedActions
                    );
                    const resolvedPlan = message.taskPlan || extractedPlan;

                    if (resolvedPlan && resolvedPlan.steps.length >= 2) {
                      return (
                        <TaskPipelineCard
                          plan={resolvedPlan}
                          onPlanUpdate={onUpdateTaskPlan}
                          onTriggerPdfDownload={async () => {
                            const { cleanText: noActionText } = extractDeviceActions(message.content || '', false);
                            const noPlanText = stripRawTaskPlanTags(noActionText);
                            const { cleanText, pdf } = extractPdfPayload(noPlanText);
                            if (pdf) {
                              await downloadRealPdf(pdf);
                            } else if (cleanText.trim().length > 20) {
                              await downloadRealPdf({
                                title: resolvedPlan.goal || 'ULTRON Document',
                                filename: 'ultron-notes.pdf',
                                content: cleanText,
                              });
                            }
                          }}
                        />
                      );
                    }

                    if (resolvedActions.length === 0) return null;

                    return (
                      <div className="space-y-2 mt-2">
                        {resolvedActions.map((act, index) => (
                          <DeviceActionCard
                            key={act.id || `${message.id}-act-${index}`}
                            action={act}
                            autoExecuted={!!act.executed}
                            stepNumber={index + 1}
                            totalSteps={resolvedActions.length}
                          />
                        ))}
                      </div>
                    );
                  })()}

                  {/* Real Downloadable PDF Card (when AI outputs [PDF:...] or user asked to make a PDF) */}
                  {(() => {
                    if (isStreaming) return null;
                    const { cleanText: noActionText } = extractDeviceActions(message.content || '', false);
                    const { cleanText, pdf } = extractPdfPayload(stripRawTaskPlanTags(noActionText));
                    if (pdf) {
                      const effectiveContent =
                        pdf.content.trim().length < 90 && cleanText.trim().length > pdf.content.trim().length * 2
                          ? cleanText.trim()
                          : pdf.content;
                      return <PdfActionCard pdf={{ ...pdf, content: effectiveContent }} />;
                    }
                    if (isPdfRequestPrompt(previousUserPrompt) && cleanText.trim().length > 20) {
                      const firstHeading = cleanText.match(/^#\s+(.+)$/m)?.[1]?.trim();
                      const title = firstHeading || previousUserPrompt.slice(0, 48).trim() || 'ULTRON Document';
                      return (
                        <PdfActionCard
                          pdf={{
                            title,
                            filename: `${title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'ultron-document'}.pdf`,
                            content: cleanText,
                          }}
                        />
                      );
                    }
                    return null;
                  })()}
                </div>
              )}

              {/* Live Web Search Citations */}
              {message.sources && message.sources.length > 0 && (
                <div className="mt-3.5 pt-3 border-t border-[#262626]/60">
                  <span className="text-[11px] font-medium text-[#71717A] tracking-wider uppercase block mb-2">
                    Verified Web Sources
                  </span>
                  <div className="flex flex-wrap gap-2">
                    {message.sources.map((src: SearchSource, idx: number) => {
                      let hostname = '';
                      try {
                        hostname = new URL(src.url).hostname.replace(/^www\./, '');
                      } catch {
                        hostname = 'web';
                      }

                      return (
                        <a
                          key={idx}
                          href={src.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          title={`${src.title}\n${src.snippet}`}
                          className="flex items-center gap-1.5 rounded-lg bg-[#111111] hover:bg-[#171717] border border-[#262626] px-2.5 py-1 text-xs text-[#A1A1AA] hover:text-white transition-colors max-w-xs truncate"
                        >
                          <span className="flex h-3.5 w-3.5 items-center justify-center rounded-full bg-[#262626] text-[9px] font-medium text-white">
                            {idx + 1}
                          </span>
                          <span className="truncate">{src.title || hostname}</span>
                          <ExternalLink className="h-2.5 w-2.5 shrink-0 opacity-60" />
                        </a>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Message Action Toolbar with Complete Natural Voice Controls */}
          {!isEditing && (
            <div
              className={`mt-2 flex items-center gap-1 text-[#71717A] opacity-90 sm:opacity-0 group-hover:opacity-100 transition-opacity ${
                isUser ? 'justify-end' : 'justify-start'
              }`}
            >
              {isUser ? (
                <button
                  onClick={() => setIsEditing(true)}
                  title="Edit message"
                  aria-label="Edit message"
                  className="flex h-7 w-7 items-center justify-center rounded hover:bg-[#171717] hover:text-white transition-colors"
                >
                  <Edit3 className="h-3.5 w-3.5" />
                </button>
              ) : (
                <>
                  <button
                    onClick={handleCopy}
                    title={copied ? 'Copied' : 'Copy message'}
                    aria-label="Copy message"
                    className="flex h-7 w-7 items-center justify-center rounded hover:bg-[#171717] hover:text-white transition-colors"
                  >
                    {copied ? <Check className="h-3.5 w-3.5 text-green-400" /> : <Copy className="h-3.5 w-3.5" />}
                  </button>

                  {/* Play / Pause / Resume / Stop Voice Controls */}
                  {onPlay && (
                    <div className="flex items-center gap-1 bg-[#121215] border border-white/5 rounded-full px-1.5 py-0.5">
                      {isLoadingAudio ? (
                        <div className="flex items-center gap-1 px-1.5 py-0.5 text-[10px] text-blue-400">
                          <Loader2 className="h-3 w-3 animate-spin" />
                          <span className="hidden sm:inline">Synthesizing...</span>
                        </div>
                      ) : isPlayingNow ? (
                        <>
                          <button
                            onClick={() => onPause && onPause()}
                            title="Pause speech"
                            aria-label="Pause speech"
                            className="flex h-6 w-6 items-center justify-center rounded-full bg-blue-600 text-white hover:bg-blue-500 transition-colors shadow-sm"
                          >
                            <Pause className="h-3 w-3 fill-white" />
                          </button>
                          <button
                            onClick={() => onStop && onStop()}
                            title="Stop speech"
                            aria-label="Stop speech"
                            className="flex h-6 w-6 items-center justify-center rounded-full hover:bg-[#262626] text-red-400 hover:text-red-300 transition-colors"
                          >
                            <Square className="h-2.5 w-2.5 fill-current" />
                          </button>
                          <div className="flex items-center gap-0.5 px-1">
                            <span className="w-0.5 h-2 bg-blue-400 rounded-full animate-bounce" />
                            <span className="w-0.5 h-3 bg-blue-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                            <span className="w-0.5 h-2 bg-blue-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                          </div>
                        </>
                      ) : isPausedNow ? (
                        <>
                          <button
                            onClick={() => onResume && onResume()}
                            title="Resume speech"
                            aria-label="Resume speech"
                            className="flex h-6 w-6 items-center justify-center rounded-full bg-blue-600 text-white hover:bg-blue-500 transition-colors shadow-sm"
                          >
                            <Play className="h-3 w-3 fill-white ml-0.5" />
                          </button>
                          <button
                            onClick={() => onStop && onStop()}
                            title="Stop speech"
                            aria-label="Stop speech"
                            className="flex h-6 w-6 items-center justify-center rounded-full hover:bg-[#262626] text-red-400 hover:text-red-300 transition-colors"
                          >
                            <Square className="h-2.5 w-2.5 fill-current" />
                          </button>
                          <span className="text-[10px] text-amber-400 px-1">Paused</span>
                        </>
                      ) : (
                        <button
                          onClick={() => onPlay(message.content, message.id)}
                          title="Read aloud with ULTRON Voice"
                          aria-label="Read aloud with ULTRON Voice"
                          className="flex items-center gap-1 px-1.5 py-0.5 rounded-full hover:bg-[#1a1a1f] text-[#A1A1AA] hover:text-white transition-colors"
                        >
                          <Volume2 className="h-3.5 w-3.5 text-blue-400" />
                          <span className="text-[11px] hidden sm:inline">Listen</span>
                        </button>
                      )}
                    </div>
                  )}

                  {onRegenerate && (
                    <button
                      onClick={onRegenerate}
                      title="Regenerate response"
                      aria-label="Regenerate response"
                      className="flex h-7 w-7 items-center justify-center rounded hover:bg-[#171717] hover:text-white transition-colors"
                    >
                      <RotateCw className="h-3.5 w-3.5" />
                    </button>
                  )}

                  {!isStreaming && message.content && !message.error && (
                    <button
                      type="button"
                      disabled={isExportingPdf}
                      onClick={async () => {
                        if (isExportingPdf) return;
                        setIsExportingPdf(true);
                        try {
                          const { cleanText: noActionText } = extractDeviceActions(message.content || '', false);
                          const { cleanText, pdf } = extractPdfPayload(stripRawTaskPlanTags(noActionText));
                          const fallbackTitle = cleanText.split('\n')[0]?.replace(/^#+\s*/, '').slice(0, 48) || 'ULTRON Document';
                          const effectivePdf = pdf
                            ? {
                                ...pdf,
                                content:
                                  pdf.content.trim().length < 90 && cleanText.trim().length > pdf.content.trim().length * 2
                                    ? cleanText.trim()
                                    : pdf.content,
                              }
                            : {
                                title: fallbackTitle,
                                filename: 'ultron-response.pdf',
                                content: cleanText,
                              };
                          await downloadRealPdf(effectivePdf);
                        } catch (err) {
                          console.error('PDF export failed:', err);
                        } finally {
                          setIsExportingPdf(false);
                        }
                      }}
                      title="Save response as real PDF"
                      aria-label="Save response as PDF"
                      className="flex items-center gap-1 px-1.5 py-0.5 rounded hover:bg-[#171717] text-[#A1A1AA] hover:text-white transition-colors disabled:opacity-50"
                    >
                      {isExportingPdf ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-400" />
                      ) : (
                        <FileDown className="h-3.5 w-3.5 text-blue-400" />
                      )}
                      <span className="text-[11px] hidden sm:inline">PDF</span>
                    </button>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Full-Screen Attached Image Preview Lightbox */}
      {previewImage && (
        <div
          onClick={() => setPreviewImage(null)}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-md p-4"
        >
          <button
            type="button"
            onClick={() => setPreviewImage(null)}
            aria-label="Close image preview"
            className="absolute top-4 right-4 flex h-9 w-9 items-center justify-center rounded-full bg-white/10 hover:bg-white/20 text-white"
          >
            <X className="h-5 w-5" />
          </button>
          <img
            src={previewImage.src}
            alt={previewImage.name}
            onClick={(e) => e.stopPropagation()}
            className="max-h-[85vh] max-w-[92vw] rounded-2xl object-contain border border-white/15 shadow-2xl"
          />
        </div>
      )}
    </div>
  );
};
