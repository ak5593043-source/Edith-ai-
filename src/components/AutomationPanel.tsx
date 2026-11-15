import React, { useState } from 'react';
import {
  Bot,
  X,
  Play,
  Square,
  ShieldAlert,
  ShieldCheck,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  Clock,
  ChevronDown,
  ChevronUp,
  Trash2,
  Smartphone,
  Globe,
  Cpu,
  History,
  Lock,
  ExternalLink,
} from 'lucide-react';
import {
  AutomationBridgeConfig,
  AutomationPermissionStatus,
  AutomationRun,
  AutomationStatus,
  SensitiveActionRequest,
} from '../types/automation.ts';
import { DeviceAction } from '../types/chat.ts';
import {
  AccessibilityRequestResult,
  ANDROID_ACCESSIBILITY_SETTINGS_INTENT,
} from '../utils/automationBridge.ts';
import { executeDeviceAction } from '../utils/actionDispatcher.ts';

export interface AutomationWorkspaceProps {
  automationEnabled: boolean;
  onToggleAutomation: (enabled: boolean) => void;
  activeRun: AutomationRun | null;
  pendingConfirmation: SensitiveActionRequest | null;
  permissions: AutomationPermissionStatus;
  bridgeConfig: AutomationBridgeConfig;
  history: AutomationRun[];
  onRunCommand: (command: string) => void;
  onStopAutomation: () => void;
  onConfirmSensitive: (approved: boolean) => void;
  onRefreshPermissions: () => void;
  onRequestAccessibility?: () => Promise<AccessibilityRequestResult | void> | void;
  accessibilityFeedback?: string | null;
  onSaveBridgeConfig: (cfg: AutomationBridgeConfig) => void;
  onClearHistory: () => void;
  showInlineMasterToggle?: boolean;
}

interface AutomationPanelProps extends AutomationWorkspaceProps {
  isOpen: boolean;
  onClose: () => void;
}

const QUICK_COMMANDS = [
  'Open Chrome and search for Groq Llama 3.3',
  'Open YouTube and search for AI coding music',
  'Open Instagram and search for nasa',
  'Open Settings and navigate to WiFi',
];

function statusLabel(status: AutomationStatus): string {
  switch (status) {
    case 'planning':
      return 'Planning with Llama...';
    case 'running':
      return 'Executing Step';
    case 'observing':
      return 'Observing Screen';
    case 'awaiting_confirmation':
      return 'Awaiting Confirmation';
    case 'paused':
      return 'Paused (Safety)';
    case 'completed':
      return 'Completed';
    case 'stopped':
      return 'Stopped';
    case 'error':
      return 'Failed';
    default:
      return 'Idle';
  }
}

function statusBadgeClasses(status: AutomationStatus): string {
  switch (status) {
    case 'planning':
    case 'running':
    case 'observing':
      return 'bg-blue-950/70 border-blue-600/60 text-blue-300';
    case 'awaiting_confirmation':
    case 'paused':
      return 'bg-amber-950/70 border-amber-600/60 text-amber-300';
    case 'completed':
      return 'bg-emerald-950/70 border-emerald-600/60 text-emerald-300';
    case 'stopped':
    case 'error':
      return 'bg-red-950/70 border-red-600/60 text-red-300';
    default:
      return 'bg-[#141824] border-[#262b38] text-[#A1A1AA]';
  }
}

export const AutomationWorkspace: React.FC<AutomationWorkspaceProps> = ({
  automationEnabled,
  onToggleAutomation,
  activeRun,
  pendingConfirmation,
  permissions,
  bridgeConfig,
  history,
  onRunCommand,
  onStopAutomation,
  onConfirmSensitive,
  onRefreshPermissions,
  onRequestAccessibility,
  accessibilityFeedback,
  onSaveBridgeConfig,
  onClearHistory,
  showInlineMasterToggle = true,
}) => {
  const [commandInput, setCommandInput] = useState('');
  const [showSetupGuide, setShowSetupGuide] = useState(false);
  const [showCompanionConfig, setShowCompanionConfig] = useState(false);
  const [draftUrl, setDraftUrl] = useState(bridgeConfig.bridgeUrl);
  const [draftToken, setDraftToken] = useState(bridgeConfig.pairingToken);
  const [isCheckingPerms, setIsCheckingPerms] = useState(false);
  const [isRequestingAccess, setIsRequestingAccess] = useState(false);
  const [localLaunchNote, setLocalLaunchNote] = useState<string | null>(null);

  const isRunBusy =
    activeRun !== null &&
    (activeRun.status === 'planning' ||
      activeRun.status === 'running' ||
      activeRun.status === 'observing' ||
      activeRun.status === 'awaiting_confirmation');

  const totalSteps = activeRun?.steps.length || 0;
  const completedSteps = activeRun
    ? activeRun.steps.filter((s) => s.status === 'completed' || s.status === 'skipped').length
    : 0;
  const progressPercent = totalSteps > 0 ? Math.round((completedSteps / totalSteps) * 100) : 0;
  const currentStep =
    activeRun && activeRun.currentStepIndex >= 0
      ? activeRun.steps[activeRun.currentStepIndex]
      : null;

  const handleSubmitCommand = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = commandInput.trim();
    if (!trimmed) return;
    if (!automationEnabled) {
      onToggleAutomation(true);
    }
    onRunCommand(trimmed);
    setCommandInput('');
  };

  const handleRefreshPerms = async () => {
    setIsCheckingPerms(true);
    try {
      await onRefreshPermissions();
    } finally {
      setIsCheckingPerms(false);
    }
  };

  const handleRequestAccessibilityClick = async () => {
    if (!onRequestAccessibility) {
      setShowSetupGuide(true);
      return;
    }
    setIsRequestingAccess(true);
    try {
      const res = await onRequestAccessibility();
      if (res && !res.triggered && res.method === 'manual-guide') {
        setShowSetupGuide(true);
      }
    } finally {
      setIsRequestingAccess(false);
    }
  };

  const handleOpenPhoneAccessibilitySettings = async () => {
    const isAndroidUa = typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent);
    if (isAndroidUa) {
      await executeDeviceAction(
        {
          id: 'open_acc_settings',
          type: 'open_url',
          title: 'Phone Accessibility Settings',
          appName: 'Android Settings',
          appUrl: ANDROID_ACCESSIBILITY_SETTINGS_INTENT,
          webUrl: ANDROID_ACCESSIBILITY_SETTINGS_INTENT,
          androidPackage: 'com.android.settings',
        },
        true
      );
    } else {
      setShowSetupGuide(true);
      setLocalLaunchNote(
        'Android Accessibility Settings can only be opened directly on an Android phone. Follow the Companion APK instructions below.'
      );
    }
  };

  const handleLaunchStepAction = async (action: DeviceAction) => {
    const res = await executeDeviceAction(action, true);
    setLocalLaunchNote(res.message);
  };

  const handleSaveCompanion = (e: React.FormEvent) => {
    e.preventDefault();
    onSaveBridgeConfig({
      ...bridgeConfig,
      bridgeUrl: draftUrl.trim() || 'http://127.0.0.1:8765',
      pairingToken: draftToken.trim(),
    });
  };

  return (
    <div data-testid="automation-panel" className="space-y-4">
      {showInlineMasterToggle && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-[#0e1118] border border-blue-500/35 p-3.5">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-blue-600/20 border border-blue-500/40 text-blue-400">
              <Bot className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <h3 className="text-xs sm:text-sm font-semibold text-white">
                ULTRON Automation Mode
              </h3>
              <p className="text-[11px] text-[#8E8E93]">
                Groq Llama Tool Calling • Multi-step app &amp; web execution
              </p>
            </div>
          </div>

          <button
            type="button"
            role="switch"
            aria-checked={automationEnabled}
            aria-label="Toggle Automation ON or OFF"
            data-testid="automation-master-toggle"
            onClick={() => onToggleAutomation(!automationEnabled)}
            className={`flex items-center gap-2 rounded-xl px-3 py-1.5 text-xs font-semibold border transition-all shrink-0 ${
              automationEnabled
                ? 'bg-emerald-950/60 border-emerald-500/60 text-emerald-300'
                : 'bg-[#141720] border-[#262936] text-[#9CA3AF] hover:text-white'
            }`}
          >
            <span
              className={`h-2 w-2 rounded-full ${
                automationEnabled ? 'bg-emerald-400 animate-pulse' : 'bg-[#52525B]'
              }`}
            />
            <span>Automation: {automationEnabled ? 'ON' : 'OFF'}</span>
          </button>
        </div>
      )}
          {/* Sensitive Action Confirmation Banner */}
          {pendingConfirmation && (
            <div
              data-testid="sensitive-confirmation-banner"
              className="rounded-xl bg-amber-950/50 border border-amber-500/60 p-3.5 space-y-2.5"
            >
              <div className="flex items-start gap-2.5">
                <ShieldAlert className="h-5 w-5 text-amber-400 shrink-0 mt-0.5" />
                <div className="min-w-0 flex-1">
                  <h3 className="text-xs sm:text-sm font-semibold text-amber-200">
                    Permission Required for Sensitive Action
                  </h3>
                  <p className="text-xs text-amber-100/90 mt-0.5">
                    Step: <span className="font-semibold">{pendingConfirmation.title}</span> (
                    <code className="font-mono text-[11px]">{pendingConfirmation.tool}</code>)
                  </p>
                  <p className="text-[11px] text-amber-200/80 mt-1">{pendingConfirmation.reason}</p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2 pl-7">
                <button
                  type="button"
                  onClick={() => onConfirmSensitive(true)}
                  className="rounded-lg bg-amber-500 hover:bg-amber-400 text-black font-semibold px-3 py-1.5 text-xs transition-colors"
                >
                  Approve & Continue
                </button>
                <button
                  type="button"
                  onClick={() => onConfirmSensitive(false)}
                  className="rounded-lg bg-red-600/80 hover:bg-red-500 text-white font-semibold px-3 py-1.5 text-xs transition-colors"
                >
                  Reject & Stop
                </button>
              </div>
            </div>
          )}

          {/* Command Runner */}
          <div className="rounded-xl bg-[#0e1118] border border-[#1d2230] p-3.5 space-y-2.5">
            <form onSubmit={handleSubmitCommand} className="flex flex-col sm:flex-row gap-2">
              <input
                type="text"
                value={commandInput}
                onChange={(e) => setCommandInput(e.target.value)}
                placeholder='e.g. "Open Chrome and search for Groq Llama 3.3"'
                aria-label="Automation command input"
                data-testid="automation-command-input"
                className="flex-1 rounded-xl bg-[#06070a] border border-[#252a38] focus:border-blue-500 px-3.5 py-2 text-xs sm:text-sm text-white placeholder-[#6B7280] focus:outline-none"
              />
              <div className="flex items-center gap-2">
                <button
                  type="submit"
                  disabled={!commandInput.trim() || isRunBusy}
                  data-testid="run-automation-btn"
                  className="flex items-center justify-center gap-1.5 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-40 px-4 py-2 text-xs font-semibold text-white transition-colors"
                >
                  <Play className="h-3.5 w-3.5 fill-white" />
                  <span>Run Task</span>
                </button>
                {isRunBusy && (
                  <button
                    type="button"
                    onClick={onStopAutomation}
                    data-testid="stop-automation-btn"
                    className="flex items-center justify-center gap-1.5 rounded-xl bg-red-600 hover:bg-red-500 px-3.5 py-2 text-xs font-semibold text-white transition-colors"
                  >
                    <Square className="h-3.5 w-3.5 fill-white" />
                    <span>Stop Automation</span>
                  </button>
                )}
              </div>
            </form>

            {/* Quick Command Chips */}
            <div className="flex flex-wrap items-center gap-1.5">
              {QUICK_COMMANDS.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  disabled={isRunBusy}
                  onClick={() => setCommandInput(preset)}
                  className="rounded-lg bg-[#141824] hover:bg-[#1c2233] border border-[#23293a] px-2.5 py-1 text-[11px] text-[#A1A1AA] hover:text-white transition-colors text-left"
                >
                  {preset}
                </button>
              ))}
            </div>
          </div>

          {/* Live Execution Tracker */}
          <div
            data-testid="automation-live-status"
            className="rounded-xl bg-[#0e1118] border border-[#1d2230] p-3.5 space-y-3"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Cpu className="h-4 w-4 text-blue-400" />
                <span className="text-xs font-semibold text-white">Live Execution Tracker</span>
              </div>

              <div className="flex items-center gap-2">
                <span
                  data-testid="automation-status-badge"
                  className={`rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${statusBadgeClasses(
                    activeRun?.status || 'idle'
                  )}`}
                >
                  {statusLabel(activeRun?.status || 'idle')}
                </span>
                {isRunBusy && (
                  <button
                    type="button"
                    onClick={onStopAutomation}
                    className="rounded-lg bg-red-950/70 hover:bg-red-600 border border-red-700/60 px-2.5 py-0.5 text-[11px] font-semibold text-red-200 hover:text-white transition-colors"
                  >
                    Stop
                  </button>
                )}
              </div>
            </div>

            {activeRun ? (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
                  <div className="rounded-lg bg-[#080a0f] border border-[#1c202c] p-2.5">
                    <div className="text-[10px] text-[#71717A] uppercase tracking-wider">Goal</div>
                    <div className="text-white font-medium truncate mt-0.5">{activeRun.goal}</div>
                  </div>
                  <div className="rounded-lg bg-[#080a0f] border border-[#1c202c] p-2.5">
                    <div className="text-[10px] text-[#71717A] uppercase tracking-wider">
                      Current Step
                    </div>
                    <div className="text-blue-300 font-medium truncate mt-0.5">
                      {currentStep ? `#${currentStep.order} ${currentStep.title}` : 'Preparing...'}
                    </div>
                  </div>
                  <div className="rounded-lg bg-[#080a0f] border border-[#1c202c] p-2.5">
                    <div className="text-[10px] text-[#71717A] uppercase tracking-wider">
                      Task Progress
                    </div>
                    <div className="text-emerald-300 font-mono font-semibold mt-0.5">
                      {completedSteps}/{totalSteps} ({progressPercent}%)
                    </div>
                  </div>
                </div>

                {/* Progress Bar */}
                <div className="h-1.5 w-full rounded-full bg-[#171b26] overflow-hidden">
                  <div
                    className={`h-full transition-all duration-300 ${
                      activeRun.status === 'error' || activeRun.status === 'stopped'
                        ? 'bg-red-500'
                        : 'bg-gradient-to-r from-blue-500 to-emerald-400'
                    }`}
                    style={{ width: `${progressPercent}%` }}
                  />
                </div>

                {/* Step Breakdown */}
                <ol className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
                  {activeRun.steps.map((step) => (
                    <li
                      key={step.id}
                      className={`rounded-lg border px-3 py-2 text-xs ${
                        step.status === 'running' || step.status === 'observing' || step.status === 'retrying'
                          ? 'bg-blue-950/35 border-blue-500/50'
                          : step.status === 'completed'
                          ? 'bg-emerald-950/20 border-emerald-800/40'
                          : step.status === 'failed' || step.status === 'stopped'
                          ? 'bg-red-950/25 border-red-800/50'
                          : step.status === 'skipped'
                          ? 'bg-amber-950/20 border-amber-700/40'
                          : 'bg-[#090b10] border-[#1d2230]'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          {step.status === 'running' ||
                          step.status === 'observing' ||
                          step.status === 'retrying' ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-400 shrink-0" />
                          ) : step.status === 'completed' ? (
                            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                          ) : step.status === 'failed' || step.status === 'stopped' ? (
                            <AlertTriangle className="h-3.5 w-3.5 text-red-400 shrink-0" />
                          ) : step.status === 'skipped' ? (
                            <AlertTriangle className="h-3.5 w-3.5 text-amber-400 shrink-0" />
                          ) : (
                            <Clock className="h-3.5 w-3.5 text-[#71717A] shrink-0" />
                          )}
                          <span className="font-mono text-[10px] text-blue-400">#{step.order}</span>
                          <span className="font-medium text-white truncate">{step.title}</span>
                          <span className="rounded bg-[#161b26] px-1.5 py-0.5 font-mono text-[10px] text-[#9CA3AF]">
                            {step.tool}
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          {step.launchAction && (
                            <button
                              type="button"
                              onClick={() => handleLaunchStepAction(step.launchAction!)}
                              data-testid={`step-launch-btn-${step.order}`}
                              className="flex items-center gap-1 rounded-md bg-blue-600 hover:bg-blue-500 px-2 py-0.5 text-[10px] font-semibold text-white transition-colors"
                            >
                              <ExternalLink className="h-2.5 w-2.5" />
                              <span>Open {step.launchAction.appName || 'Link'}</span>
                            </button>
                          )}
                          <span className="text-[10px] uppercase tracking-wide text-[#9CA3AF]">
                            {step.status}
                            {step.attempts > 1 ? ` (try ${step.attempts})` : ''}
                          </span>
                        </div>
                      </div>

                      {(step.resultMessage || step.error || step.observation?.summary) && (
                        <div className="mt-1 pl-5 text-[11px] text-[#A1A1AA] space-y-0.5">
                          {step.resultMessage && <div>{step.resultMessage}</div>}
                          {step.error && <div className="text-amber-300">{step.error}</div>}
                          {step.observation?.summary && (
                            <div className="text-[#71717A]">
                              Screen: {step.observation.summary}
                            </div>
                          )}
                        </div>
                      )}
                    </li>
                  ))}
                </ol>

                {(() => {
                  const launchSteps = activeRun.steps.filter((s) => Boolean(s.launchAction));
                  if (launchSteps.length === 0) return null;
                  return (
                    <div
                      data-testid="automation-launch-links"
                      className="rounded-lg bg-[#080b12] border border-blue-500/30 p-2.5 space-y-2"
                    >
                      <div className="text-[11px] font-medium text-blue-200">
                        Quick Open Launch Links ({launchSteps.length})
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {launchSteps.map((s) => (
                          <button
                            key={`quick-${s.id}`}
                            type="button"
                            onClick={() => handleLaunchStepAction(s.launchAction!)}
                            className="flex items-center gap-1.5 rounded-lg bg-blue-600/20 hover:bg-blue-600/35 border border-blue-500/40 px-2.5 py-1 text-[11px] font-medium text-blue-200 hover:text-white transition-colors"
                          >
                            <ExternalLink className="h-3 w-3" />
                            <span>Open {s.launchAction!.appName || s.title}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                })()}

                {(activeRun.finalMessage || activeRun.error) && (
                  <div
                    className={`rounded-lg border px-3 py-2 text-xs ${
                      activeRun.error
                        ? 'bg-red-950/35 border-red-800/60 text-red-200'
                        : 'bg-blue-950/30 border-blue-800/40 text-blue-200'
                    }`}
                  >
                    {activeRun.error || activeRun.finalMessage}
                  </div>
                )}

                {localLaunchNote && (
                  <div className="rounded-lg bg-emerald-950/30 border border-emerald-700/40 px-3 py-1.5 text-[11px] text-emerald-200">
                    {localLaunchNote}
                  </div>
                )}
              </>
            ) : (
              <p className="text-xs text-[#71717A]">
                No automation task running right now. Turn Automation ON and give ULTRON a command
                above or in chat.
              </p>
            )}
          </div>

          {/* Permission Status & Android Companion Compatibility */}
          <div
            data-testid="automation-permissions-card"
            className="rounded-xl bg-[#0e1118] border border-[#1d2230] p-3.5 space-y-3"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                {permissions.mode === 'android-companion' ? (
                  <ShieldCheck className="h-4 w-4 text-emerald-400" />
                ) : (
                  <Globe className="h-4 w-4 text-blue-400" />
                )}
                <span className="text-xs font-semibold text-white">
                  Permission Status & Compatibility
                </span>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowCompanionConfig((v) => !v)}
                  className="rounded-lg bg-[#161a26] hover:bg-[#1f2536] border border-[#262c3d] px-2.5 py-1 text-[11px] text-[#D4D4D8] transition-colors"
                >
                  Bridge Settings
                </button>
                <button
                  type="button"
                  onClick={handleRefreshPerms}
                  disabled={isCheckingPerms}
                  className="flex items-center gap-1 rounded-lg bg-[#161a26] hover:bg-[#1f2536] border border-[#262c3d] px-2.5 py-1 text-[11px] text-white transition-colors"
                >
                  <RefreshCw className={`h-3 w-3 ${isCheckingPerms ? 'animate-spin' : ''}`} />
                  <span>Check</span>
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
              <div className="rounded-lg bg-[#080a0f] border border-[#1c202c] p-2.5">
                <div className="text-[10px] text-[#71717A]">Runtime Mode</div>
                <div className="font-medium text-white mt-0.5">
                  {permissions.mode === 'android-companion'
                    ? 'Native Android Companion'
                    : 'Web Browser Sandbox'}
                </div>
              </div>
              <div className="rounded-lg bg-[#080a0f] border border-[#1c202c] p-2.5">
                <div className="text-[10px] text-[#71717A]">Android Accessibility Service</div>
                <div
                  className={`font-medium mt-0.5 ${
                    permissions.accessibilityServiceEnabled ? 'text-emerald-400' : 'text-amber-300'
                  }`}
                >
                  {permissions.accessibilityServiceEnabled
                    ? 'Active (Full UI Control)'
                    : 'Not Connected'}
                </div>
              </div>
              <div className="rounded-lg bg-[#080a0f] border border-[#1c202c] p-2.5">
                <div className="text-[10px] text-[#71717A]">Security Policy</div>
                <div className="font-medium text-emerald-400 flex items-center gap-1 mt-0.5">
                  <Lock className="h-3 w-3" />
                  <span>Allowlist + Confirmations</span>
                </div>
              </div>
            </div>

            <p className="text-[11px] text-[#9CA3AF] leading-relaxed">{permissions.notes}</p>

            {!permissions.accessibilityServiceEnabled && (
              <div
                data-testid="accessibility-permission-card"
                className="rounded-lg bg-amber-950/35 border border-amber-500/45 p-3 space-y-2.5"
              >
                <div className="flex items-start gap-2">
                  <ShieldAlert className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="text-xs font-semibold text-amber-200">
                      Accessibility Permission Required for Full Android Control
                    </div>
                    <p className="text-[11px] text-amber-100/85 leading-relaxed">
                      URL &amp; app launch links work directly in your browser. To let ULTRON tap buttons,
                      scroll, type text, or change Settings inside other apps, grant Android
                      Accessibility Service permission.
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2 pl-6">
                  <button
                    type="button"
                    data-testid="request-accessibility-btn"
                    onClick={handleRequestAccessibilityClick}
                    disabled={isRequestingAccess}
                    className="flex items-center gap-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-black font-semibold px-3 py-1.5 text-[11px] transition-colors"
                  >
                    <ShieldCheck className="h-3.5 w-3.5" />
                    <span>
                      {isRequestingAccess ? 'Requesting...' : 'Request Accessibility Permission'}
                    </span>
                  </button>
                  <button
                    type="button"
                    data-testid="open-phone-accessibility-btn"
                    onClick={handleOpenPhoneAccessibilitySettings}
                    className="flex items-center gap-1.5 rounded-lg bg-[#161a26] hover:bg-[#1f2536] border border-[#2c344a] px-3 py-1.5 text-[11px] text-white transition-colors"
                  >
                    <Smartphone className="h-3.5 w-3.5 text-blue-400" />
                    <span>Phone Accessibility Settings</span>
                  </button>
                </div>

                {accessibilityFeedback && (
                  <div
                    data-testid="accessibility-feedback-banner"
                    className="ml-6 rounded-md bg-black/40 border border-amber-500/30 px-2.5 py-1.5 text-[11px] text-amber-100"
                  >
                    {accessibilityFeedback}
                  </div>
                )}
              </div>
            )}

            {showCompanionConfig && (
              <form
                onSubmit={handleSaveCompanion}
                className="rounded-lg bg-[#07090d] border border-[#202636] p-3 grid grid-cols-1 sm:grid-cols-3 gap-2 items-end"
              >
                <div>
                  <label className="block text-[10px] text-[#9CA3AF] mb-1">
                    Companion Bridge URL
                  </label>
                  <input
                    type="text"
                    value={draftUrl}
                    onChange={(e) => setDraftUrl(e.target.value)}
                    className="w-full rounded-lg bg-[#0d1017] border border-[#262d3f] px-2.5 py-1.5 text-xs text-white"
                  />
                </div>
                <div>
                  <label className="block text-[10px] text-[#9CA3AF] mb-1">
                    Pairing Token (from Companion App)
                  </label>
                  <input
                    type="password"
                    value={draftToken}
                    onChange={(e) => setDraftToken(e.target.value)}
                    placeholder="Optional token"
                    className="w-full rounded-lg bg-[#0d1017] border border-[#262d3f] px-2.5 py-1.5 text-xs text-white"
                  />
                </div>
                <button
                  type="submit"
                  className="rounded-lg bg-blue-600 hover:bg-blue-500 px-3 py-1.5 text-xs font-semibold text-white transition-colors"
                >
                  Save & Re-Check
                </button>
              </form>
            )}

            {/* Collapsible Android Companion Permission Instructions */}
            <button
              type="button"
              onClick={() => setShowSetupGuide((v) => !v)}
              className="flex w-full items-center justify-between rounded-lg bg-[#121622] hover:bg-[#171c2b] border border-[#232a3d] px-3 py-2 text-xs text-blue-300 transition-colors"
            >
              <span className="flex items-center gap-2 font-medium">
                <Smartphone className="h-3.5 w-3.5" />
                Android Companion Permission & Setup Instructions
              </span>
              {showSetupGuide ? (
                <ChevronUp className="h-4 w-4" />
              ) : (
                <ChevronDown className="h-4 w-4" />
              )}
            </button>

            {showSetupGuide && (
              <div className="rounded-lg bg-[#07090d] border border-[#1f2535] p-3 text-[11px] text-[#D4D4D8] space-y-1.5 leading-relaxed">
                <p>
                  <strong>Why Browser JS Alone Cannot Control External Apps:</strong> Android isolates
                  installed apps so Chrome/PWA JavaScript can only open intents (
                  <code>open_app</code>, <code>open_url</code>, <code>search_text</code>) and cannot
                  tap buttons or read text inside Instagram, YouTube, or Settings.
                </p>
                <p>
                  <strong>Native Android Companion Setup (Kotlin Accessibility Layer):</strong>
                </p>
                <ol className="list-decimal pl-4 space-y-1 text-[#A1A1AA]">
                  <li>
                    Build the included <code>/android-companion</code> Android project (
                    <code>./gradlew assembleDebug</code>) and install the APK on your Android phone.
                  </li>
                  <li>
                    Open <strong>ULTRON Companion</strong> and tap{' '}
                    <strong>Enable Accessibility Service</strong> (on Android 13+, first tap{' '}
                    <em>App Info -&gt; Allow restricted settings</em> if greyed out).
                  </li>
                  <li>
                    Start the local bridge (<code>127.0.0.1:8765</code>), copy the pairing token into{' '}
                    <strong>Bridge Settings</strong> above, and tap <strong>Check</strong>.
                  </li>
                </ol>
              </div>
            )}
          </div>

          {/* Execution History */}
          <div
            data-testid="automation-history-section"
            className="rounded-xl bg-[#0e1118] border border-[#1d2230] p-3.5 space-y-2.5"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <History className="h-4 w-4 text-[#A1A1AA]" />
                <span className="text-xs font-semibold text-white">
                  Execution History ({history.length})
                </span>
              </div>
              {history.length > 0 && (
                <button
                  type="button"
                  onClick={onClearHistory}
                  className="flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] text-[#8E8E93] hover:bg-red-950/30 hover:text-red-300 transition-colors"
                >
                  <Trash2 className="h-3 w-3" />
                  <span>Clear</span>
                </button>
              )}
            </div>

            {history.length === 0 ? (
              <p className="text-xs text-[#71717A]">
                Completed, stopped, or failed automation runs will appear here.
              </p>
            ) : (
              <ul className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                {history.map((item) => {
                  const done = item.steps.filter((s) => s.status === 'completed').length;
                  return (
                    <li
                      key={item.id}
                      className="rounded-lg bg-[#080a0f] border border-[#1c202c] px-3 py-2 flex items-center justify-between gap-2 text-xs"
                    >
                      <div className="min-w-0">
                        <div className="font-medium text-white truncate">{item.command}</div>
                        <div className="text-[10px] text-[#8E8E93] truncate">
                          {new Date(item.startedAt).toLocaleTimeString()} • {done}/
                          {item.steps.length} steps •{' '}
                          {item.error || item.finalMessage || item.status}
                        </div>
                      </div>
                      <span
                        className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium ${statusBadgeClasses(
                          item.status
                        )}`}
                      >
                        {item.status}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
    </div>
  );
};

export const AutomationPanel: React.FC<AutomationPanelProps> = ({
  isOpen,
  onClose,
  ...workspaceProps
}) => {
  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="ULTRON Automation Engine"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-3 sm:p-5"
    >
      <div className="flex flex-col w-full max-w-3xl max-h-[90vh] rounded-2xl bg-[#090b10] border border-blue-500/30 shadow-2xl shadow-black overflow-hidden">
        <div className="flex items-center justify-between border-b border-[#1c1f29] px-4 py-3.5 bg-[#0c0f17]">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-blue-600/20 border border-blue-500/40 text-blue-400">
              <Bot className="h-4.5 w-4.5" />
            </div>
            <div className="min-w-0">
              <h2 className="text-sm sm:text-base font-semibold text-white truncate">
                ULTRON Automation Engine
              </h2>
              <p className="text-[11px] text-[#8E8E93] truncate">
                Groq Llama Tool Calling • Multi-Step Plan, Observe & Control
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close Automation Panel"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-[#8E8E93] hover:bg-[#1a1d27] hover:text-white transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 sm:p-5">
          <AutomationWorkspace {...workspaceProps} />
        </div>
      </div>
    </div>
  );
};

