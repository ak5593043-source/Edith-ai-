import type { DeviceAction } from './chat.ts';

export type AutomationToolName =
  | 'open_app'
  | 'open_url'
  | 'search_text'
  | 'tap_element'
  | 'scroll_screen'
  | 'enter_text'
  | 'get_screen_information'
  | 'execute_task_plan';

export const ALLOWED_AUTOMATION_TOOLS: ReadonlySet<AutomationToolName> = new Set<AutomationToolName>([
  'open_app',
  'open_url',
  'search_text',
  'tap_element',
  'scroll_screen',
  'enter_text',
  'get_screen_information',
  'execute_task_plan',
]);

export type AutomationStatus =
  | 'idle'
  | 'planning'
  | 'running'
  | 'observing'
  | 'awaiting_confirmation'
  | 'paused'
  | 'completed'
  | 'stopped'
  | 'error';

export type AutomationEnvironmentMode = 'android-companion' | 'web-sandbox';

export interface AutomationPermissionStatus {
  mode: AutomationEnvironmentMode;
  bridgeReachable: boolean;
  accessibilityServiceEnabled: boolean;
  overlayPermissionGranted: boolean;
  deviceModel?: string;
  androidSdk?: number;
  browserIntentsSupported: boolean;
  notes: string;
  lastCheckedAt: number;
}

export interface ScreenUiElement {
  index: number;
  text?: string;
  contentDescription?: string;
  viewId?: string;
  className?: string;
  clickable?: boolean;
  editable?: boolean;
  scrollable?: boolean;
  bounds?: {
    left: number;
    top: number;
    right: number;
    bottom: number;
  };
}

export interface ScreenObservation {
  source: 'android-accessibility' | 'web-fallback';
  timestamp: number;
  packageName?: string;
  appName?: string;
  activityName?: string;
  currentUrl?: string;
  screenTitle?: string;
  visibleTexts: string[];
  interactiveElements: ScreenUiElement[];
  summary: string;
  securityBlocked?: boolean;
}

export interface AutomationToolCall {
  id: string;
  name: AutomationToolName;
  arguments: Record<string, any>;
}

export type AutomationStepStatus =
  | 'pending'
  | 'running'
  | 'observing'
  | 'retrying'
  | 'awaiting_confirmation'
  | 'completed'
  | 'skipped'
  | 'failed'
  | 'stopped';

export interface AutomationStep {
  id: string;
  order: number;
  tool: AutomationToolName;
  arguments: Record<string, any>;
  title: string;
  description?: string;
  status: AutomationStepStatus;
  attempts: number;
  maxRetries: number;
  isSensitive: boolean;
  sensitiveReason?: string;
  observation?: ScreenObservation;
  resultMessage?: string;
  error?: string;
  launchAction?: DeviceAction;
  popupBlocked?: boolean;
  startedAt?: number;
  finishedAt?: number;
}

export interface SensitiveActionRequest {
  runId: string;
  stepId: string;
  tool: AutomationToolName;
  title: string;
  reason: string;
  previewArgs: Record<string, any>;
}

export interface AutomationRun {
  id: string;
  command: string;
  goal: string;
  status: AutomationStatus;
  mode: AutomationEnvironmentMode;
  steps: AutomationStep[];
  currentStepIndex: number;
  startedAt: number;
  finishedAt?: number;
  finalMessage?: string;
  error?: string;
  modelUsed?: string;
  needsAccessibilityPermission?: boolean;
}

export interface AutomationBridgeConfig {
  bridgeUrl: string;
  pairingToken: string;
  maxRetriesPerStep: number;
  maxTotalIterations: number;
}

export const DEFAULT_AUTOMATION_BRIDGE_CONFIG: AutomationBridgeConfig = {
  bridgeUrl: 'http://127.0.0.1:8765',
  pairingToken: '',
  maxRetriesPerStep: 2,
  maxTotalIterations: 16,
};
