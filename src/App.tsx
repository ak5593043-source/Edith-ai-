import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Header } from './components/Header.tsx';
import { Sidebar } from './components/Sidebar.tsx';
import { ChatMessage } from './components/ChatMessage.tsx';
import { ChatInput } from './components/ChatInput.tsx';
import { EmptyState } from './components/EmptyState.tsx';
import { SettingsModal } from './components/SettingsModal.tsx';
import { JarvisSphere } from './components/JarvisSphere.tsx';
import { useSpeech } from './hooks/useSpeech.ts';
import { useWakeWord } from './hooks/useWakeWord.ts';
import { useOnlineStatus } from './hooks/useOnlineStatus.ts';
import {
  Conversation,
  Message,
  AttachedFile,
  UserSettings,
  SearchSource,
  TaskPlan,
  DeviceAction,
} from './types/chat.ts';
import {
  AutomationBridgeConfig,
  AutomationPermissionStatus,
  AutomationRun,
  SensitiveActionRequest,
} from './types/automation.ts';
import {
  loadConversations,
  saveConversations,
  saveActiveConversationId,
  loadSettings,
  saveSettings,
  createNewConversation,
  generateTitleFromMessage,
} from './utils/storage.ts';
import {
  AutomationEngineController,
  isAutomationCommandIntent,
  loadAutomationHistory,
  loadBridgeConfig,
  saveAutomationHistory,
  saveBridgeConfig,
} from './utils/automationEngine.ts';
import {
  BrowserAutomationDriver,
  ANDROID_ACCESSIBILITY_SETTINGS_INTENT,
} from './utils/automationBridge.ts';
import { extractDeviceActions, executeDeviceAction } from './utils/actionDispatcher.ts';
import { extractTaskPlan } from './utils/commandPlanner.ts';
import { optimizeImageFile, isImageFile } from './utils/imageOptimizer.ts';
import {
  ArrowDown,
  WifiOff,
  AlertTriangle,
  Volume2,
  Pause,
  Play,
  Square,
  Bot,
  ShieldCheck,
  ShieldAlert,
  Smartphone,
  X,
} from 'lucide-react';

function isAssistantQueryLaunch(): boolean {
  if (typeof window === 'undefined') return false;
  const params = new URLSearchParams(window.location.search);
  return params.get('assistant') === '1' || params.get('voice') === '1';
}

export default function App() {
  const [conversations, setConversations] = useState<Conversation[]>(() => loadConversations());
  // Always start with null on app launch so a fresh new chat is opened every time
  const [activeId, setActiveId] = useState<string | null>(null);
  const [settings, setSettings] = useState<UserSettings>(() => loadSettings());
  const [input, setInput] = useState('');
  const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([]);
  const [isUploadingFile, setIsUploadingFile] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [isWebSearchActive, setIsWebSearchActive] = useState<boolean>(settings.webSearchDefault);
  const [isStreaming, setIsStreaming] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsInitialTab, setSettingsInitialTab] = useState<'model' | 'voice' | 'automation' | 'memory' | 'about'>('model');
  const [sphereModeOpen, setSphereModeOpen] = useState<boolean>(() => isAssistantQueryLaunch());
  const sphereModeOpenRef = useRef(sphereModeOpen);
  sphereModeOpenRef.current = sphereModeOpen;
  const [showScrollBottom, setShowScrollBottom] = useState(false);

  // Automation System State
  const [bridgeConfig, setBridgeConfig] = useState<AutomationBridgeConfig>(() => loadBridgeConfig());
  const [automationHistory, setAutomationHistory] = useState<AutomationRun[]>(() =>
    loadAutomationHistory()
  );
  const [activeAutomationRun, setActiveAutomationRun] = useState<AutomationRun | null>(null);
  const [pendingSensitiveAction, setPendingSensitiveAction] =
    useState<SensitiveActionRequest | null>(null);
  const [automationPermissions, setAutomationPermissions] = useState<AutomationPermissionStatus>({
    mode: 'web-sandbox',
    bridgeReachable: false,
    accessibilityServiceEnabled: false,
    overlayPermissionGranted: false,
    browserIntentsSupported: typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent),
    notes:
      'Web Browser Sandbox: Safe URL & app intent launching supported. Connect ULTRON Android Companion for full native Accessibility UI automation.',
    lastCheckedAt: Date.now(),
  });
  const [accessibilityPromptOpen, setAccessibilityPromptOpen] = useState(false);
  const [accessibilityFeedback, setAccessibilityFeedback] = useState<string | null>(null);

  const automationEngineRef = useRef<AutomationEngineController>(new AutomationEngineController());
  const automationDriverRef = useRef<BrowserAutomationDriver>(
    new BrowserAutomationDriver(bridgeConfig)
  );

  const [systemStatus, setSystemStatus] = useState({
    groqConfigured: false,
    geminiConfigured: false,
    activeEngine: 'loading',
  });

  const abortControllerRef = useRef<AbortController | null>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const lastInputModeRef = useRef<'voice' | 'text'>('text');
  const isOnline = useOnlineStatus();

  // Commanding Power Voice Assistant Hook
  const {
    isListening,
    startListening,
    stopListening,
    cancelListening,
    transcript,
    interimTranscript,
    playbackState,
    activeMessageId,
    activeVoiceName,
    getAudioLevel,
    play,
    pause,
    resume,
    stop,
    verifiedVoices,
    speechError,
    clearError: clearSpeechError,
  } = useSpeech({
    language: settings.language,
    voiceURI: settings.voiceURI,
    voiceTone: settings.voiceTone || 'commanding-deep',
    rate: settings.voiceRate,
    pitch: settings.voicePitch,
    volume: settings.voiceVolume ?? 1.0,
    preferNeuralVoice: settings.preferNeuralVoice ?? true,
    onTranscriptComplete: (text) => {
      if (text && text.trim()) {
        const spokenCommand = text.trim();
        lastInputModeRef.current = 'voice';
        setInput('');
        setTimeout(() => {
          handleSendTrigger(spokenCommand, 'voice');
        }, 50);
      }
    },
  });

  // Keep a ref to latest trigger so wake-word standby always launches current command handler
  const triggerCommandRef = useRef<(cmd: string) => void>(() => {});
  const startListeningRef = useRef<() => void>(() => {});
  startListeningRef.current = startListening;

  // "Hi ULTRON" Wake-Word + Voice Print Auto-Listen Standby
  useWakeWord({
    enabled: !!settings.wakeWordEnabled,
    isMainListening: isListening,
    isAssistantSpeaking: playbackState !== 'idle',
    isStreaming,
    language: settings.language,
    voicePrint: settings.voicePrint,
    onWakeTriggered: (inlineCommand) => {
      setSphereModeOpen(true);
      if (inlineCommand && inlineCommand.trim().length >= 3) {
        triggerCommandRef.current(inlineCommand.trim());
      } else {
        setTimeout(() => {
          startListeningRef.current();
        }, 320);
      }
    },
  });

  const openVoiceModeWithMic = useCallback(() => {
    setSphereModeOpen(true);
    if (!isListening && playbackState === 'idle') {
      void startListening();
    }
  }, [isListening, playbackState, startListening]);

  // Auto-start voice listening immediately if launched via Power Button / Assistant Shortcut (/?assistant=1)
  useEffect(() => {
    if (isAssistantQueryLaunch()) {
      setSphereModeOpen(true);
      const timer = setTimeout(() => {
        startListeningRef.current();
      }, 280);
      return () => clearTimeout(timer);
    }
  }, []);

  // Fetch API status on load
  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/status');
      if (res.ok) {
        const data = await res.json();
        setSystemStatus({
          groqConfigured: data.groqConfigured,
          geminiConfigured: data.geminiConfigured,
          activeEngine: data.activeEngine,
        });
      }
    } catch (err) {
      console.warn('Status check error:', err);
    }
  }, []);

  const refreshAutomationPermissions = useCallback(
    async (explicit = false) => {
      automationDriverRef.current.updateConfig(bridgeConfig);
      const perms = await automationDriverRef.current.probePermissions(explicit);
      setAutomationPermissions(perms);
      return perms;
    },
    [bridgeConfig]
  );

  const handleRequestAccessibilityPermission = useCallback(async () => {
    automationDriverRef.current.updateConfig(bridgeConfig);
    const res = await automationDriverRef.current.requestAccessibilityPermission();
    setAccessibilityFeedback(res.message);
    setAutomationPermissions(res.permissions);
    if (res.permissions.accessibilityServiceEnabled) {
      setAccessibilityPromptOpen(false);
    }
    return res;
  }, [bridgeConfig]);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  useEffect(() => {
    if (settings.automationEnabled || (settingsOpen && settingsInitialTab === 'automation')) {
      refreshAutomationPermissions(false);
    }
  }, [settings.automationEnabled, settingsOpen, settingsInitialTab, refreshAutomationPermissions]);

  useEffect(() => {
    saveAutomationHistory(automationHistory);
  }, [automationHistory]);

  // Persist conversations
  useEffect(() => {
    saveConversations(conversations);
  }, [conversations]);

  // Persist active ID
  useEffect(() => {
    saveActiveConversationId(activeId);
  }, [activeId]);

  // Active conversation object
  const activeConversation = conversations.find((c) => c.id === activeId) || null;

  // Only reset if activeId points to a deleted conversation
  useEffect(() => {
    if (activeId && !conversations.some((c) => c.id === activeId)) {
      setActiveId(null);
    }
  }, [conversations, activeId]);

  // Auto-scroll handler
  const scrollToBottom = useCallback((smooth = true) => {
    messagesEndRef.current?.scrollIntoView({
      behavior: smooth ? 'smooth' : 'auto',
    });
  }, []);

  useEffect(() => {
    if (isStreaming) {
      scrollToBottom(false);
    }
  }, [activeConversation?.messages, isStreaming, scrollToBottom]);

  // Handle scroll detection for "Scroll to bottom" button
  const handleScroll = () => {
    if (chatContainerRef.current) {
      const { scrollTop, scrollHeight, clientHeight } = chatContainerRef.current;
      const atBottom = scrollHeight - scrollTop - clientHeight < 100;
      setShowScrollBottom(!atBottom);
    }
  };

  // Create new conversation
  const handleNewChat = () => {
    if (isStreaming && abortControllerRef.current) {
      abortControllerRef.current.abort();
      setIsStreaming(false);
    }
    stop();
    const newConv = createNewConversation(settings.model);
    setConversations((prev) => [newConv, ...prev]);
    setActiveId(newConv.id);
    setInput('');
    setAttachedFiles([]);
    setUploadError(null);
  };

  // Select conversation
  const handleSelectConversation = (id: string) => {
    if (isStreaming && abortControllerRef.current) {
      abortControllerRef.current.abort();
      setIsStreaming(false);
    }
    stop();
    setActiveId(id);
    setAttachedFiles([]);
  };

  // Rename conversation
  const handleRenameConversation = (id: string, newTitle: string) => {
    setConversations((prev) =>
      prev.map((c) => (c.id === id ? { ...c, title: newTitle, updatedAt: Date.now() } : c))
    );
  };

  // Delete conversation
  const handleDeleteConversation = (id: string) => {
    setConversations((prev) => {
      const updated = prev.filter((c) => c.id !== id);
      if (activeId === id) {
        setActiveId(updated.length > 0 ? updated[0].id : null);
      }
      return updated;
    });
  };

  // Clear all conversations
  const handleClearAllConversations = () => {
    if (isStreaming && abortControllerRef.current) {
      abortControllerRef.current.abort();
      setIsStreaming(false);
    }
    stop();
    setConversations([]);
    setActiveId(null);
    setInput('');
    setAttachedFiles([]);
    saveConversations([]);
    saveActiveConversationId(null);
  };

  // Delete current active conversation
  const handleDeleteCurrentChat = () => {
    if (!activeId) return;
    handleDeleteConversation(activeId);
  };

  // Fast Universal File Upload & Parsing (Instant in-browser image optimization + server document parser)
  const handleAddFiles = async (fileList: FileList) => {
    setIsUploadingFile(true);
    setUploadError(null);

    const filesArray = Array.from(fileList);

    try {
      await Promise.all(
        filesArray.map(async (file) => {
        if (file.size > 30 * 1024 * 1024) {
          setUploadError(`File "${file.name}" exceeds maximum allowed limit (30MB).`);
          return;
        }

        try {
          // Fast path for Images: compress/resize in-browser in <80ms with zero server upload wait
          if (isImageFile(file)) {
            const optimized = await optimizeImageFile(file);
            const newImage: AttachedFile = {
              id: `file_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
              name: optimized.name,
              type: optimized.type,
              size: optimized.size,
              category: 'image',
              isImage: true,
              base64Data: optimized.base64Data,
              text: `[Attached Image: ${optimized.name} (${(optimized.size / 1024).toFixed(1)} KB)]`,
              metadata: { width: optimized.width, height: optimized.height },
            };
            setAttachedFiles((prev) => [...prev, newImage]);
            return;
          }

          // Documents / Audio / Video / Code -> server parser
          const base64 = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as string);
            reader.onerror = reject;
            reader.readAsDataURL(file);
          });

          const res = await fetch('/api/extract-file', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              filename: file.name,
              mimetype: file.type,
              base64,
            }),
          });

          if (!res.ok) {
            const errData = await res.json().catch(() => ({}));
            throw new Error(errData.error || `Server failed to parse ${file.name}`);
          }

          const data = await res.json();
          const parsed = data.file;

          const newAttached: AttachedFile = {
            id: `file_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
            name: parsed.name,
            type: parsed.type,
            size: parsed.size,
            text: parsed.text,
            category: parsed.category,
            isImage: parsed.isImage,
            base64Data: parsed.base64Data,
            metadata: parsed.metadata,
          };

          setAttachedFiles((prev) => [...prev, newAttached]);
        } catch (err: any) {
          console.error('File extraction error:', err);
          setUploadError(`Failed to process "${file.name}": ${err.message}`);
          }
        })
      );
    } finally {
      setIsUploadingFile(false);
    }
  };

  const handleRemoveFile = (fileId: string) => {
    setAttachedFiles((prev) => prev.filter((f) => f.id !== fileId));
  };

  // Core stream communication with server
  const executeChatRequest = async (
    targetConvId: string,
    historyMessages: Message[],
    userMessage: Message
  ) => {
    setIsStreaming(true);
    const controller = new AbortController();
    abortControllerRef.current = controller;

    // Create placeholder assistant message
    const assistantMsgId = `asst_${Date.now()}`;
    const initialAssistantMsg: Message = {
      id: assistantMsgId,
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      isStreaming: true,
    };

    // Update conversation with user and empty assistant message
    setConversations((prev) =>
      prev.map((c) => {
        if (c.id === targetConvId) {
          const isFirstUserMessage = c.messages.length === 0;
          return {
            ...c,
            title: isFirstUserMessage ? generateTitleFromMessage(userMessage.content) : c.title,
            updatedAt: Date.now(),
            messages: [...historyMessages, userMessage, initialAssistantMsg],
          };
        }
        return c;
      })
    );

    let assistantContent = '';
    let sources: SearchSource[] = [];
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;

    try {
      // Build server request payload
      // Extract only relevant image payloads (current message first, or latest prior image for follow-ups)
      const imagesToSend: Array<{ mimeType: string; base64: string; name?: string }> = [];
      const currentImages = (userMessage.attachedFiles || []).filter((f) => f.isImage && f.base64Data);
      if (currentImages.length > 0) {
        for (const f of currentImages.slice(0, 4)) {
          const cleanBase64 = f.base64Data!.includes(',') ? f.base64Data!.split(',')[1] : f.base64Data!;
          imagesToSend.push({
            mimeType: f.type || 'image/jpeg',
            base64: cleanBase64,
            name: f.name,
          });
        }
      } else {
        // Check last user message in case user is asking a follow-up question about a recently uploaded photo
        for (let i = historyMessages.length - 1; i >= Math.max(0, historyMessages.length - 3); i--) {
          const prevImgs = (historyMessages[i].attachedFiles || []).filter((f) => f.isImage && f.base64Data);
          if (prevImgs.length > 0) {
            for (const f of prevImgs.slice(0, 2)) {
              const cleanBase64 = f.base64Data!.includes(',') ? f.base64Data!.split(',')[1] : f.base64Data!;
              imagesToSend.push({
                mimeType: f.type || 'image/jpeg',
                base64: cleanBase64,
                name: f.name,
              });
            }
            break;
          }
        }
      }

      const formattedMessages = [...historyMessages, userMessage].map((m) => {
        let textContent = m.content;
        if (m.attachedFiles && m.attachedFiles.length > 0) {
          const filesSummary = m.attachedFiles
            .map((f) => {
              if (f.isImage) {
                return `\n[ATTACHED IMAGE: ${f.name}]\n`;
              }
              return `\n[ATTACHED FILE: ${f.name} (${f.type}, category: ${f.category || 'file'})]\n${f.text || '[Document content]'}\n`;
            })
            .join('\n');
          textContent = `${textContent}\n\n${filesSummary}`;
        }
        return {
          role: m.role,
          content: textContent,
        };
      });

      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          messages: formattedMessages,
          model: settings.model,
          enableWebSearch: isWebSearchActive,
          language: settings.language,
          customInstructions: settings.customInstructions,
          memories: settings.memories,
          images: imagesToSend,
          isVoiceMode: sphereModeOpen || lastInputModeRef.current === 'voice',
        }),
      });

      if (!response.ok) {
        throw new Error(`Server returned HTTP ${response.status}`);
      }

      reader = response.body?.getReader();
      if (!reader) throw new Error('No readable response stream available.');

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n\n');
        buffer = lines.pop() || '';

        for (const block of lines) {
          if (!block.trim()) continue;

          let eventType = 'message';
          let eventData = '';

          const blockLines = block.split('\n');
          for (const line of blockLines) {
            if (line.startsWith('event: ')) {
              eventType = line.slice(7).trim();
            } else if (line.startsWith('data: ')) {
              eventData = line.slice(6);
            }
          }

          if (eventData) {
            try {
              const parsed = JSON.parse(eventData);

              if (eventType === 'delta' && parsed.content) {
                assistantContent += parsed.content;
                setConversations((prev) =>
                  prev.map((c) =>
                    c.id === targetConvId
                      ? {
                          ...c,
                          messages: c.messages.map((m) =>
                            m.id === assistantMsgId
                              ? { ...m, content: assistantContent, isStreaming: true }
                              : m
                          ),
                        }
                      : c
                  )
                );
              } else if (eventType === 'sources' && Array.isArray(parsed.sources)) {
                sources = parsed.sources;
                setConversations((prev) =>
                  prev.map((c) =>
                    c.id === targetConvId
                      ? {
                          ...c,
                          messages: c.messages.map((m) =>
                            m.id === assistantMsgId ? { ...m, sources } : m
                          ),
                        }
                      : c
                  )
                );
              } else if (eventType === 'done') {
                setConversations((prev) =>
                  prev.map((c) =>
                    c.id === targetConvId
                      ? {
                          ...c,
                          messages: c.messages.map((m) =>
                            m.id === assistantMsgId
                              ? {
                                  ...m,
                                  content: assistantContent,
                                  isStreaming: false,
                                  modelUsed: parsed.model,
                                  sources: sources.length > 0 ? sources : m.sources,
                                }
                              : m
                          ),
                        }
                      : c
                  )
                );

                // Auto-speak or voice input response with Commanding Power Voice
                const shouldVocalize =
                  settings.autoSpeak ||
                  sphereModeOpenRef.current ||
                  lastInputModeRef.current === 'voice';

                if (shouldVocalize && assistantContent) {
                  play(assistantContent, assistantMsgId, () => {
                    if (sphereModeOpenRef.current) {
                      setTimeout(() => {
                        startListeningRef.current();
                      }, 320);
                    }
                  });
                } else if (sphereModeOpenRef.current) {
                  setTimeout(() => {
                    startListeningRef.current();
                  }, 320);
                }

                // Resolve unlimited multi-step command plan + device actions
                const { actions: parsedActions } = extractDeviceActions(assistantContent, false);
                const { actions: inferredFromUser } =
                  parsedActions.length === 0
                    ? extractDeviceActions(userMessage.content || '', true)
                    : { actions: [] };
                const resolvedActions = parsedActions.length > 0 ? parsedActions : inferredFromUser;
                const { plan: resolvedPlan } = extractTaskPlan(
                  assistantContent,
                  userMessage.content || '',
                  resolvedActions
                );

                if (resolvedPlan) {
                  setConversations((prev) =>
                    prev.map((c) =>
                      c.id === targetConvId
                        ? {
                            ...c,
                            messages: c.messages.map((m) =>
                              m.id === assistantMsgId
                                ? {
                                    ...m,
                                    taskPlan: resolvedPlan,
                                    action: resolvedActions[0],
                                    actions: resolvedActions.length > 0 ? resolvedActions : undefined,
                                  }
                                : m
                            ),
                          }
                        : c
                    )
                  );
                } else if (resolvedActions.length > 0) {
                  setTimeout(async () => {
                    const launchRes = await executeDeviceAction(resolvedActions[0], false);
                    const updatedActions = resolvedActions.map((act, idx) => ({
                      ...act,
                      executed: idx === 0 ? launchRes.autoNavigated : false,
                    }));
                    setConversations((prev) =>
                      prev.map((c) =>
                        c.id === targetConvId
                          ? {
                              ...c,
                              messages: c.messages.map((m) =>
                                m.id === assistantMsgId
                                  ? {
                                      ...m,
                                      action: updatedActions[0],
                                      actions: updatedActions,
                                    }
                                  : m
                              ),
                            }
                          : c
                      )
                    );
                  }, 600);
                }
              } else if (eventType === 'error') {
                throw new Error(parsed.error || 'Server stream failed');
              }
            } catch (jsonErr: any) {
              if (eventType === 'error') throw jsonErr;
              console.warn('JSON parse warning:', jsonErr);
            }
          }
        }
      }
    } catch (err: any) {
      if (err.name === 'AbortError') {
        // User deliberately stopped generation
        setConversations((prev) =>
          prev.map((c) =>
            c.id === targetConvId
              ? {
                  ...c,
                  messages: c.messages.map((m) =>
                    m.id === assistantMsgId
                      ? {
                          ...m,
                          content: assistantContent ? `${assistantContent}\n\n*[Generation stopped]*` : '*[Generation stopped]*',
                          isStreaming: false,
                        }
                      : m
                  ),
                }
              : c
          )
        );
      } else {
        console.error('Chat generation error:', err);
        setConversations((prev) =>
          prev.map((c) =>
            c.id === targetConvId
              ? {
                  ...c,
                  messages: c.messages.map((m) =>
                    m.id === assistantMsgId
                      ? {
                          ...m,
                          error: err.message || 'Failed to communicate with ULTRON AI engine.',
                          isStreaming: false,
                        }
                      : m
                  ),
                }
              : c
          )
        );
      }
    } finally {
      if (reader) {
        reader.cancel().catch(() => {});
      }
      setIsStreaming(false);
      abortControllerRef.current = null;
    }
  };

  // Execute a command through the multi-step Automation Engine
  const handleRunAutomationCommand = useCallback(
    async (command: string, targetConvId?: string) => {
      const cleanCmd = command.trim();
      if (!cleanCmd) return;

      const finalRun = await automationEngineRef.current.runCommand({
        command: cleanCmd,
        model: settings.model,
        driver: automationDriverRef.current,
        config: bridgeConfig,
        onUpdate: (run, pending, perms) => {
          setActiveAutomationRun(run);
          setPendingSensitiveAction(pending);
          if (perms) setAutomationPermissions(perms);
        },
      });

      setAutomationHistory((prev) => [finalRun, ...prev.filter((r) => r.id !== finalRun.id)].slice(0, 30));

      if (finalRun.needsAccessibilityPermission && !automationPermissions.accessibilityServiceEnabled) {
        setAccessibilityFeedback(
          'Some UI steps (tap/type/scroll or Android Settings toggles) require Android Accessibility Service permission. Grant it below or use the quick Open links.'
        );
        setAccessibilityPromptOpen(true);
      }

      if (targetConvId) {
        const completedCount = finalRun.steps.filter((s) => s.status === 'completed').length;
        const summaryLines = [
          `**Automation ${finalRun.status.toUpperCase()}**: ${finalRun.goal}`,
          `Executed **${completedCount}/${finalRun.steps.length}** steps (${finalRun.mode === 'android-companion' ? 'Android Accessibility Companion' : 'Web Browser Sandbox'}).`,
          finalRun.error || finalRun.finalMessage || '',
        ].filter(Boolean);

        const launchActions = finalRun.steps
          .map((s) => s.launchAction)
          .filter((a): a is DeviceAction => Boolean(a));

        const taskPlanForMsg: TaskPlan | undefined =
          finalRun.steps.length >= 2
            ? {
                id: `plan_${finalRun.id}`,
                goal: finalRun.goal,
                steps: finalRun.steps.map((s) => ({
                  id: s.id,
                  order: s.order,
                  title: s.title,
                  detail: s.resultMessage || s.error,
                  type: s.tool === 'open_url' || s.tool === 'search_text' ? 'search' : 'app',
                  status:
                    s.status === 'completed' && !s.popupBlocked
                      ? 'completed'
                      : s.status === 'skipped'
                      ? 'skipped'
                      : 'pending',
                  action: s.launchAction,
                })),
              }
            : undefined;

        const autoMsg: Message = {
          id: `auto_res_${Date.now()}`,
          role: 'assistant',
          content: summaryLines.join('\n\n'),
          timestamp: Date.now(),
          modelUsed: finalRun.modelUsed || settings.model,
          action: launchActions[0],
          actions: launchActions.length > 0 ? launchActions : undefined,
          taskPlan: taskPlanForMsg,
        };

        setConversations((prev) =>
          prev.map((c) =>
            c.id === targetConvId
              ? { ...c, updatedAt: Date.now(), messages: [...c.messages, autoMsg] }
              : c
          )
        );
      }
    },
    [settings.model, bridgeConfig, automationPermissions.accessibilityServiceEnabled]
  );

  // Helper trigger to send message
  const handleSendTrigger = (customText?: string, source: 'voice' | 'text' = 'text') => {
    lastInputModeRef.current = source;
    const textToSend = (customText !== undefined ? customText : input).trim();
    if (!textToSend && attachedFiles.length === 0) return;

    let convId = activeId;
    let existingMessages: Message[] = [];

    // Ensure conversation exists
    if (!convId || !activeConversation) {
      const newConv = createNewConversation(settings.model);
      setConversations((prev) => [newConv, ...prev]);
      setActiveId(newConv.id);
      convId = newConv.id;
    } else {
      existingMessages = activeConversation.messages;
    }

    const userMessage: Message = {
      id: `user_${Date.now()}`,
      role: 'user',
      content: textToSend,
      timestamp: Date.now(),
      attachedFiles: [...attachedFiles],
    };

    setInput('');
    setAttachedFiles([]);
    setUploadError(null);

    // Route natural-language device/app commands through Automation Engine when Automation Mode is ON
    if (
      settings.automationEnabled &&
      userMessage.attachedFiles?.length === 0 &&
      isAutomationCommandIntent(textToSend)
    ) {
      setConversations((prev) =>
        prev.map((c) =>
          c.id === convId
            ? {
                ...c,
                title: c.messages.length === 0 ? generateTitleFromMessage(textToSend) : c.title,
                updatedAt: Date.now(),
                messages: [...existingMessages, userMessage],
              }
            : c
        )
      );
      handleRunAutomationCommand(textToSend, convId);
      return;
    }

    executeChatRequest(convId, existingMessages, userMessage);
  };
  triggerCommandRef.current = (cmd: string) => handleSendTrigger(cmd, 'voice');

  // Stop active generation
  const handleStop = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      setIsStreaming(false);
    }
  };

  // Regenerate last assistant response
  const handleRegenerate = (msgIndex: number) => {
    if (!activeConversation || isStreaming) return;
    const messages = activeConversation.messages;

    // Find the previous user message
    let userMsg: Message | null = null;
    let history: Message[] = [];

    for (let i = msgIndex - 1; i >= 0; i--) {
      if (messages[i].role === 'user') {
        userMsg = messages[i];
        history = messages.slice(0, i);
        break;
      }
    }

    if (userMsg) {
      executeChatRequest(activeConversation.id, history, userMsg);
    }
  };

  // Edit user message and re-submit
  const handleEditMessage = (msgIndex: number, newContent: string) => {
    if (!activeConversation || isStreaming) return;
    const history = activeConversation.messages.slice(0, msgIndex);
    const originalMsg = activeConversation.messages[msgIndex];

    const updatedUserMsg: Message = {
      ...originalMsg,
      content: newContent,
      timestamp: Date.now(),
    };

    executeChatRequest(activeConversation.id, history, updatedUserMsg);
  };

  // Save settings locally
  const handleSaveSettings = (newSettings: UserSettings) => {
    setSettings(newSettings);
    saveSettings(newSettings);
  };

  // Persist TaskPlan step state updates
  const handleUpdateTaskPlan = (convId: string, msgId: string, updatedPlan: TaskPlan) => {
    setConversations((prev) =>
      prev.map((c) =>
        c.id === convId
          ? {
              ...c,
              messages: c.messages.map((m) =>
                m.id === msgId ? { ...m, taskPlan: updatedPlan } : m
              ),
            }
          : c
      )
    );
  };

  const isAudioActive = playbackState === 'playing' || playbackState === 'paused' || playbackState === 'loading';

  return (
    <div className="flex h-screen w-full bg-[#000000] text-white overflow-hidden select-text">
      {/* Sidebar Navigation */}
      <Sidebar
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        conversations={conversations}
        activeId={activeId}
        onSelectConversation={handleSelectConversation}
        onNewChat={handleNewChat}
        onRenameConversation={handleRenameConversation}
        onDeleteConversation={handleDeleteConversation}
        onOpenSettings={() => {
          setSettingsInitialTab('model');
          setSettingsOpen(true);
        }}
        systemStatus={systemStatus}
        onClearAllConversations={handleClearAllConversations}
      />

      {/* Main Chat Workspace */}
      <div className="flex flex-1 flex-col h-full min-w-0 bg-[#000000] relative">
        {/* Top Header (Clean — Voice Print Wake & Automation live inside Settings) */}
        <Header
          currentModel={settings.model}
          isWebSearchActive={isWebSearchActive}
          onToggleWebSearch={() => setIsWebSearchActive((prev) => !prev)}
          onNewChat={handleNewChat}
          onOpenSidebar={() => setSidebarOpen(true)}
          onOpenSettings={() => {
            setSettingsInitialTab('model');
            setSettingsOpen(true);
          }}
          onDeleteCurrentChat={handleDeleteCurrentChat}
          canDeleteCurrent={!!activeConversation && activeConversation.messages.length > 0}
          onOpenSphere={openVoiceModeWithMic}
        />

        {/* Offline notification banner if network drops */}
        {!isOnline && (
          <div className="flex items-center justify-center gap-2 bg-amber-950/80 border-b border-amber-800 px-4 py-1.5 text-xs text-amber-200">
            <WifiOff className="h-3.5 w-3.5" />
            <span>You are currently offline. Viewing cached conversations.</span>
          </div>
        )}

        {/* Voice error notice */}
        {speechError && (
          <div className="flex items-center justify-between bg-red-950/80 border-b border-red-800 px-4 py-2 text-xs text-red-200">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 shrink-0 text-red-400" />
              <span>{speechError}</span>
            </div>
            <button onClick={clearSpeechError} className="font-semibold hover:underline">
              Dismiss
            </button>
          </div>
        )}

        {/* Floating Commanding Voice Playback Island */}
        {isAudioActive && (
          <div className="sticky top-0 z-30 flex items-center justify-between bg-[#0e111a]/95 border-b border-blue-500/30 px-4 py-2 backdrop-blur-md shadow-lg shadow-black/80">
            <div className="flex items-center gap-2.5">
              <div className="relative flex h-7 w-7 items-center justify-center rounded-full bg-blue-600/20 border border-blue-500/40 text-blue-400">
                <Volume2 className="h-4 w-4" />
                {playbackState === 'playing' && (
                  <span className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-blue-400 animate-ping" />
                )}
              </div>
              <div className="flex flex-col">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-semibold text-white">ULTRON Voice Playback</span>
                  <span className="text-[10px] text-blue-400 bg-blue-950/80 border border-blue-800 px-1.5 py-0.2 rounded-full">
                    {activeVoiceName}
                  </span>
                </div>
                <span className="text-[10px] text-[#A1A1AA]">
                  {playbackState === 'loading'
                    ? 'Synthesizing speech...'
                    : playbackState === 'playing'
                    ? 'Playing powerful commanding voice • Hindi / Hinglish / English'
                    : 'Paused'}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-1.5">
              {playbackState === 'playing' ? (
                <button
                  onClick={pause}
                  title="Pause speech"
                  className="flex h-7 w-7 items-center justify-center rounded-full bg-blue-600 hover:bg-blue-500 text-white transition-colors"
                >
                  <Pause className="h-3.5 w-3.5 fill-white" />
                </button>
              ) : (
                <button
                  onClick={resume}
                  title="Resume speech"
                  className="flex h-7 w-7 items-center justify-center rounded-full bg-blue-600 hover:bg-blue-500 text-white transition-colors"
                >
                  <Play className="h-3.5 w-3.5 fill-white ml-0.5" />
                </button>
              )}
              <button
                onClick={stop}
                title="Stop speech"
                className="flex h-7 w-7 items-center justify-center rounded-full bg-[#1a1a1f] hover:bg-[#262626] text-red-400 hover:text-white transition-colors"
              >
                <Square className="h-3 w-3 fill-current" />
              </button>
            </div>
          </div>
        )}

        {/* Chat Messages Scroll Container */}
        <div
          ref={chatContainerRef}
          onScroll={handleScroll}
          className="flex-1 overflow-y-auto overflow-x-hidden flex flex-col"
        >
          {!activeConversation || activeConversation.messages.length === 0 ? (
            /* Empty State Center Greeting */
            <EmptyState
              onSelectPrompt={(prompt, search) => {
                if (search !== undefined) setIsWebSearchActive(search);
                setInput(prompt);
                // focus input or directly send
                setTimeout(() => handleSendTrigger(prompt), 50);
              }}
            />
          ) : (
            /* Active Conversation Messages */
            <div className="flex flex-col py-4">
              {activeConversation.messages.map((message, idx) => (
                <ChatMessage
                  key={message.id ? `${message.id}-${idx}` : `msg-${idx}`}
                  message={message}
                  previousUserPrompt={
                    idx > 0 && activeConversation.messages[idx - 1]?.role === 'user'
                      ? activeConversation.messages[idx - 1].content
                      : ''
                  }
                  isStreaming={message.isStreaming}
                  onRegenerate={
                    message.role === 'assistant' ? () => handleRegenerate(idx) : undefined
                  }
                  onEditMessage={
                    message.role === 'user'
                      ? (newContent) => handleEditMessage(idx, newContent)
                      : undefined
                  }
                  onPlay={(text, id) => play(text, id)}
                  onPause={pause}
                  onResume={resume}
                  onStop={stop}
                  playbackState={playbackState}
                  activeSpeakingId={activeMessageId}
                  onUpdateTaskPlan={(updatedPlan) =>
                    handleUpdateTaskPlan(activeConversation.id, message.id, updatedPlan)
                  }
                />
              ))}
              <div ref={messagesEndRef} className="h-4" />
            </div>
          )}
        </div>

        {/* Scroll To Bottom Button */}
        {showScrollBottom && (
          <button
            onClick={() => scrollToBottom(true)}
            aria-label="Scroll to bottom"
            className="absolute bottom-24 right-6 z-20 flex h-9 w-9 items-center justify-center rounded-full bg-[#171717] hover:bg-[#262626] border border-[#262626] text-white shadow-xl transition-all"
          >
            <ArrowDown className="h-4 w-4" />
          </button>
        )}

        {/* Compact Live Automation Runner Strip when active */}
        {activeAutomationRun &&
          (activeAutomationRun.status === 'planning' ||
            activeAutomationRun.status === 'running' ||
            activeAutomationRun.status === 'observing' ||
            activeAutomationRun.status === 'awaiting_confirmation') && (
            <div
              data-testid="live-automation-strip"
              className="mx-auto w-full max-w-3xl px-3.5 sm:px-6 pb-1.5"
            >
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-[#0c1018] border border-blue-500/45 px-3 py-2 text-xs shadow-lg">
                <div className="flex items-center gap-2 min-w-0">
                  <Bot className="h-4 w-4 text-blue-400 animate-pulse shrink-0" />
                  <div className="min-w-0">
                    <div className="font-medium text-white truncate">
                      {pendingSensitiveAction
                        ? `Confirm: ${pendingSensitiveAction.title}`
                        : activeAutomationRun.steps[activeAutomationRun.currentStepIndex]?.title ||
                          activeAutomationRun.goal}
                    </div>
                    <div className="text-[10px] text-[#9CA3AF]">
                      {activeAutomationRun.status.toUpperCase()} • Step{' '}
                      {Math.max(1, activeAutomationRun.currentStepIndex + 1)}/
                      {Math.max(1, activeAutomationRun.steps.length)}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  {pendingSensitiveAction && (
                    <button
                      type="button"
                      onClick={() => automationEngineRef.current.respondToConfirmation(true)}
                      className="rounded-lg bg-amber-500 hover:bg-amber-400 text-black font-semibold px-2.5 py-1 text-[11px]"
                    >
                      Approve
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      setSettingsInitialTab('automation');
                      setSettingsOpen(true);
                    }}
                    className="rounded-lg bg-[#161c2b] hover:bg-[#1e2638] border border-[#293247] px-2.5 py-1 text-[11px] text-blue-300"
                  >
                    Details
                  </button>
                  <button
                    type="button"
                    onClick={() => automationEngineRef.current.stop()}
                    className="rounded-lg bg-red-600 hover:bg-red-500 px-2.5 py-1 text-[11px] font-semibold text-white"
                  >
                    Stop
                  </button>
                </div>
              </div>
            </div>
          )}

        {/* Bottom Input Area */}
        <ChatInput
          input={input}
          setInput={setInput}
          transcript={transcript}
          interimTranscript={interimTranscript}
          onSend={() => handleSendTrigger()}
          onStop={handleStop}
          isStreaming={isStreaming}
          isListening={isListening}
          onToggleListening={() => {
            if (isListening) stopListening();
            else startListening();
          }}
          onPauseVoiceForTyping={cancelListening}
          isWebSearchActive={isWebSearchActive}
          onToggleWebSearch={() => setIsWebSearchActive((prev) => !prev)}
          attachedFiles={attachedFiles}
          onAddFiles={handleAddFiles}
          onRemoveFile={handleRemoveFile}
          isUploadingFile={isUploadingFile}
          uploadError={uploadError}
          onClearUploadError={() => setUploadError(null)}
          onOpenSphere={openVoiceModeWithMic}
        />

        {/* ULTRON Voice Mode Animated Companion Stage */}
        <JarvisSphere
          isActive={sphereModeOpen}
          isListening={isListening}
          isStreaming={isStreaming}
          playbackState={playbackState}
          transcript={transcript}
          interimTranscript={interimTranscript}
          lastAssistantMessage={
            activeConversation?.messages.filter((m) => m.role === 'assistant').pop()?.content || ''
          }
          activeVoiceName={activeVoiceName}
          wakeWordEnabled={!!settings.wakeWordEnabled}
          hasVoicePrint={!!settings.voicePrint}
          getAudioLevel={getAudioLevel}
          onTestVoice={() =>
            play(
              'नमस्ते जगजीत! मैं अल्ट्रॉन हूँ — पूरा सिस्टम मेरे कंट्रोल में है। बताइए, आज क्या करना है?',
              'voice-mode-sample'
            )
          }
          onToggleListening={() => {
            if (isListening) stopListening();
            else startListening();
          }}
          onClose={() => {
            setSphereModeOpen(false);
            if (isListening) cancelListening();
          }}
          onSendCustomPrompt={(prompt) => handleSendTrigger(prompt)}
        />
      </div>

      {/* Proactive Accessibility Permission Prompt Modal */}
      {accessibilityPromptOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Android Accessibility Permission Required"
          data-testid="accessibility-permission-modal"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4"
        >
          <div className="w-full max-w-md rounded-2xl bg-[#090b10] border border-amber-500/45 shadow-2xl shadow-black overflow-hidden">
            <div className="flex items-center justify-between border-b border-[#1c1f29] px-4 py-3 bg-[#0c0f17]">
              <div className="flex items-center gap-2">
                <ShieldAlert className="h-4 w-4 text-amber-400" />
                <h2 className="text-sm font-semibold text-white">
                  Accessibility Permission Required
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setAccessibilityPromptOpen(false)}
                aria-label="Close Accessibility Permission Modal"
                className="flex h-7 w-7 items-center justify-center rounded-lg text-[#8E8E93] hover:bg-[#1a1d27] hover:text-white transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="p-4 space-y-3 text-xs text-[#D4D4D8] leading-relaxed">
              <p>
                URL and web search automation works right away in browser mode. To let{' '}
                <strong className="text-white">ULTRON</strong> tap buttons, type inside apps,
                scroll screens, or open Android Settings sub-screens automatically, grant{' '}
                <strong className="text-amber-300">Android Accessibility Service</strong> permission.
              </p>

              {accessibilityFeedback && (
                <div className="rounded-lg bg-amber-950/35 border border-amber-500/40 px-3 py-2 text-[11px] text-amber-100">
                  {accessibilityFeedback}
                </div>
              )}

              <div className="flex flex-col gap-2 pt-1">
                <button
                  type="button"
                  data-testid="modal-grant-accessibility-btn"
                  onClick={() => {
                    void handleRequestAccessibilityPermission();
                  }}
                  className="flex items-center justify-center gap-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-black font-semibold px-4 py-2 text-xs transition-colors"
                >
                  <ShieldCheck className="h-4 w-4" />
                  <span>Grant Accessibility Permission</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    void executeDeviceAction(
                      {
                        id: 'modal_open_acc_settings',
                        type: 'open_url',
                        title: 'Phone Accessibility Settings',
                        appName: 'Android Settings',
                        appUrl: ANDROID_ACCESSIBILITY_SETTINGS_INTENT,
                        webUrl: ANDROID_ACCESSIBILITY_SETTINGS_INTENT,
                        androidPackage: 'com.android.settings',
                      },
                      true
                    );
                  }}
                  className="flex items-center justify-center gap-2 rounded-xl bg-[#161a26] hover:bg-[#1f2536] border border-[#2c344a] px-4 py-2 text-xs text-white transition-colors"
                >
                  <Smartphone className="h-4 w-4 text-blue-400" />
                  <span>Open Phone Accessibility Settings</span>
                </button>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      void refreshAutomationPermissions(true).then((perms) => {
                        if (perms.accessibilityServiceEnabled) {
                          setAccessibilityPromptOpen(false);
                        } else {
                          setAccessibilityFeedback(perms.notes);
                        }
                      });
                    }}
                    className="flex-1 rounded-xl bg-[#111521] hover:bg-[#192033] border border-[#242b3d] px-3 py-2 text-[11px] text-blue-300 transition-colors"
                  >
                    Check Permission Status
                  </button>
                  <button
                    type="button"
                    onClick={() => setAccessibilityPromptOpen(false)}
                    className="flex-1 rounded-xl bg-[#111115] hover:bg-[#1a1a20] border border-[#262626] px-3 py-2 text-[11px] text-[#A1A1AA] transition-colors"
                  >
                    Continue in Web Mode
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Settings Modal (includes AI Model, Commanding Voice + Voice Print, Automation, Memory & About) */}
      <SettingsModal
        isOpen={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        initialTab={settingsInitialTab}
        settings={settings}
        onSaveSettings={handleSaveSettings}
        verifiedVoices={verifiedVoices}
        onTestVoice={(text, voiceId) => play(text, 'test-voice', undefined, voiceId)}
        onStopTestVoice={stop}
        playbackState={playbackState}
        systemStatus={systemStatus}
        onRefreshStatus={fetchStatus}
        onClearAllConversations={handleClearAllConversations}
        automation={{
          automationEnabled: !!settings.automationEnabled,
          onToggleAutomation: (enabled) => {
            handleSaveSettings({ ...settings, automationEnabled: enabled });
            if (enabled) {
              void refreshAutomationPermissions(true).then((perms) => {
                if (!perms.accessibilityServiceEnabled) {
                  setAccessibilityFeedback(perms.notes);
                  setAccessibilityPromptOpen(true);
                }
              });
            }
          },
          activeRun: activeAutomationRun,
          pendingConfirmation: pendingSensitiveAction,
          permissions: automationPermissions,
          bridgeConfig,
          history: automationHistory,
          onRunCommand: (cmd) => handleRunAutomationCommand(cmd),
          onStopAutomation: () => automationEngineRef.current.stop(),
          onConfirmSensitive: (approved) =>
            automationEngineRef.current.respondToConfirmation(approved),
          onRefreshPermissions: () => refreshAutomationPermissions(true),
          onRequestAccessibility: handleRequestAccessibilityPermission,
          accessibilityFeedback,
          onSaveBridgeConfig: (cfg) => {
            setBridgeConfig(cfg);
            saveBridgeConfig(cfg);
            automationDriverRef.current.updateConfig(cfg);
            refreshAutomationPermissions(true);
          },
          onClearHistory: () => {
            setAutomationHistory([]);
            saveAutomationHistory([]);
          },
        }}
      />
    </div>
  );
}
