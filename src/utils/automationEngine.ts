import {
  AutomationBridgeConfig,
  AutomationEnvironmentMode,
  AutomationPermissionStatus,
  AutomationRun,
  AutomationStep,
  DEFAULT_AUTOMATION_BRIDGE_CONFIG,
  ScreenObservation,
  SensitiveActionRequest,
} from '../types/automation.ts';
import { PlannedStepDraft, validateAndSanitizeToolCall } from '../server/automationTools.ts';
import { AutomationDriver } from './automationBridge.ts';

const AUTOMATION_HISTORY_KEY = 'edith_automation_history_v1';
const AUTOMATION_CONFIG_KEY = 'edith_automation_bridge_config_v1';
const MAX_HISTORY_ITEMS = 30;

export function loadAutomationHistory(): AutomationRun[] {
  try {
    if (typeof localStorage === 'undefined') return [];
    const raw = localStorage.getItem(AUTOMATION_HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveAutomationHistory(history: AutomationRun[]): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(AUTOMATION_HISTORY_KEY, JSON.stringify(history.slice(0, MAX_HISTORY_ITEMS)));
  } catch {
    // ignore quota errors
  }
}

export function loadBridgeConfig(): AutomationBridgeConfig {
  try {
    if (typeof localStorage === 'undefined') return { ...DEFAULT_AUTOMATION_BRIDGE_CONFIG };
    const raw = localStorage.getItem(AUTOMATION_CONFIG_KEY);
    if (!raw) return { ...DEFAULT_AUTOMATION_BRIDGE_CONFIG };
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_AUTOMATION_BRIDGE_CONFIG, ...parsed };
  } catch {
    return { ...DEFAULT_AUTOMATION_BRIDGE_CONFIG };
  }
}

export function saveBridgeConfig(config: AutomationBridgeConfig): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(AUTOMATION_CONFIG_KEY, JSON.stringify(config));
  } catch {
    // ignore
  }
}

/**
 * Determines whether a natural-language user prompt in chat is an explicit device/app automation command.
 */
export function isAutomationCommandIntent(text: string): boolean {
  const clean = (text || '').trim();
  if (!clean || clean.length < 4) return false;

  // Never hijack PDF requests, coding prompts, or "what/why/how" informational questions
  if (
    /\b(pdf|code|script|program|function|component|explain|what\s+is|why\s+|how\s+to|kaise|kya\s+hai|formula|equation)\b/i.test(
      clean
    ) &&
    !/\b(open|launch|kholo|khol|tap|scroll|navigate)\b/i.test(clean)
  ) {
    return false;
  }

  return /\b(open|launch|kholo|khol|chalao|play|bajao|navigate|scroll|tap|click|turn\s+(?:on|off)|enable\s+wifi|disable\s+wifi|search\s+(?:for|on|in)|settings?\s+(?:me|mein|open|kholo|navigate))\b/i.test(
    clean
  );
}

export interface AutomationPlannerApi {
  createPlan(params: {
    command: string;
    environmentMode: AutomationEnvironmentMode;
    model: string;
    signal?: AbortSignal;
  }): Promise<{ goal: string; steps: PlannedStepDraft[]; modelUsed?: string }>;
  decideNext(params: {
    command: string;
    goal: string;
    lastStep: { tool: string; title: string; success: boolean; message: string };
    observation: ScreenObservation;
    remainingSteps: Array<{ tool: string; title: string }>;
    model: string;
    signal?: AbortSignal;
  }): Promise<
    | { action: 'continue'; message?: string; modelUsed?: string }
    | { action: 'halt'; reason: string; modelUsed?: string }
    | { action: 'tool'; nextStep: PlannedStepDraft; modelUsed?: string }
  >;
}

export const defaultFetchPlannerApi: AutomationPlannerApi = {
  async createPlan({ command, environmentMode, model, signal }) {
    const res = await fetch('/api/automation/plan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal,
      body: JSON.stringify({ command, environmentMode, model }),
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || `Automation planning failed (HTTP ${res.status})`);
    }
    return {
      goal: data.goal,
      steps: data.steps || [],
      modelUsed: data.modelUsed,
    };
  },

  async decideNext({ command, goal, lastStep, observation, remainingSteps, model, signal }) {
    const res = await fetch('/api/automation/decide-next', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal,
      body: JSON.stringify({
        command,
        goal,
        lastStep,
        observation,
        remainingSteps,
        model,
      }),
    });
    if (!res.ok) {
      return { action: 'continue', message: 'Continuing execution sequence.' };
    }
    return await res.json();
  },
};

function sleepCancelable(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error('Automation stopped'));
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new Error('Automation stopped'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export class AutomationEngineController {
  private abortController: AbortController | null = null;
  private pendingConfirmationResolver: ((approved: boolean) => void) | null = null;
  private currentRun: AutomationRun | null = null;

  getActiveRun(): AutomationRun | null {
    return this.currentRun;
  }

  stop(): void {
    if (this.abortController) {
      this.abortController.abort();
    }
    if (this.pendingConfirmationResolver) {
      this.pendingConfirmationResolver(false);
      this.pendingConfirmationResolver = null;
    }
  }

  respondToConfirmation(approved: boolean): void {
    if (this.pendingConfirmationResolver) {
      const resolve = this.pendingConfirmationResolver;
      this.pendingConfirmationResolver = null;
      resolve(approved);
    }
  }

  async runCommand(params: {
    command: string;
    model: string;
    driver: AutomationDriver;
    planner?: AutomationPlannerApi;
    config?: Partial<AutomationBridgeConfig>;
    retryDelayMs?: number;
    stepDelayMs?: number;
    onUpdate: (
      run: AutomationRun,
      pendingConfirmation: SensitiveActionRequest | null,
      permissions?: AutomationPermissionStatus
    ) => void;
  }): Promise<AutomationRun> {
    this.stop();

    const planner = params.planner || defaultFetchPlannerApi;
    const maxRetries = Math.max(0, Math.min(4, params.config?.maxRetriesPerStep ?? 2));
    const maxIterations = Math.max(3, Math.min(30, params.config?.maxTotalIterations ?? 16));
    const retryDelayMs = params.retryDelayMs ?? 350;
    const stepDelayMs = params.stepDelayMs ?? 250;

    const controller = new AbortController();
    this.abortController = controller;
    const signal = controller.signal;

    const runId = `run_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    if (typeof (params.driver as any).resetRunContext === 'function') {
      (params.driver as any).resetRunContext();
    }
    let permissions = await params.driver.probePermissions();

    const run: AutomationRun = {
      id: runId,
      command: params.command.trim(),
      goal: params.command.trim(),
      status: 'planning',
      mode: permissions.mode,
      steps: [],
      currentStepIndex: -1,
      startedAt: Date.now(),
    };
    this.currentRun = run;

    const emit = (pending: SensitiveActionRequest | null = null) => {
      const snapshot: AutomationRun = {
        ...run,
        steps: run.steps.map((s) => ({ ...s })),
      };
      this.currentRun = snapshot;
      params.onUpdate(snapshot, pending, permissions);
    };

    emit(null);

    try {
      const planned = await planner.createPlan({
        command: params.command,
        environmentMode: permissions.mode,
        model: params.model,
        signal,
      });

      if (signal.aborted) throw new Error('Automation stopped');

      run.goal = planned.goal || run.command;
      run.modelUsed = planned.modelUsed;
      run.steps = (planned.steps || []).map((draft, idx) => ({
        id: `step_${idx + 1}_${Math.random().toString(36).slice(2, 5)}`,
        order: idx + 1,
        tool: draft.tool,
        arguments: draft.arguments || {},
        title: draft.title || draft.tool,
        description: draft.description,
        status: 'pending',
        attempts: 0,
        maxRetries,
        isSensitive: Boolean(draft.isSensitive),
        sensitiveReason: draft.sensitiveReason,
      }));

      if (run.steps.length === 0) {
        run.status = 'error';
        run.error = 'No valid allowlisted automation steps were produced for this command.';
        run.finishedAt = Date.now();
        emit(null);
        return this.currentRun!;
      }

      run.status = 'running';
      emit(null);

      let index = 0;
      let totalIterations = 0;

      while (index < run.steps.length) {
        if (signal.aborted) throw new Error('Automation stopped');
        if (totalIterations >= maxIterations) {
          run.status = 'error';
          run.error = `Safety limit reached (${maxIterations} steps). Stopping loop.`;
          break;
        }
        totalIterations++;

        const step = run.steps[index];
        run.currentStepIndex = index;

        // Enforce client-side allowlist double check
        const recheck = validateAndSanitizeToolCall(step.tool, step.arguments);
        if (!recheck.valid) {
          step.status = 'failed';
          step.error = recheck.error || 'Blocked by client security allowlist.';
          step.finishedAt = Date.now();
          run.status = 'error';
          run.error = step.error;
          break;
        }

        // Sensitive Action Confirmation Gate
        if (step.isSensitive || recheck.isSensitive) {
          step.isSensitive = true;
          step.sensitiveReason = step.sensitiveReason || recheck.sensitiveReason || 'Sensitive action requires permission.';
          step.status = 'awaiting_confirmation';
          run.status = 'awaiting_confirmation';

          const reqPayload: SensitiveActionRequest = {
            runId: run.id,
            stepId: step.id,
            tool: step.tool,
            title: step.title,
            reason: step.sensitiveReason,
            previewArgs: step.arguments,
          };
          emit(reqPayload);

          const approved = await new Promise<boolean>((resolve) => {
            this.pendingConfirmationResolver = resolve;
          });
          this.pendingConfirmationResolver = null;

          if (!approved || signal.aborted) {
            step.status = 'stopped';
            step.error = 'User declined sensitive action.';
            step.finishedAt = Date.now();
            run.status = 'stopped';
            run.finalMessage = 'Automation stopped because sensitive action was declined.';
            break;
          }
        }

        // Execute step with bounded retry handling
        step.startedAt = step.startedAt || Date.now();
        let lastError: string | undefined;
        let stepResultMessage = '';
        let stepObservation: ScreenObservation | undefined;
        let stepLaunchAction = step.launchAction;
        let stepPopupBlocked = step.popupBlocked;
        let succeeded = false;
        let unsupportedInSandbox = false;

        for (let attempt = 1; attempt <= step.maxRetries + 1; attempt++) {
          if (signal.aborted) throw new Error('Automation stopped');

          step.attempts = attempt;
          step.status = attempt === 1 ? 'running' : 'retrying';
          run.status = 'running';
          emit(null);

          const res = await params.driver.executeTool(step.tool, step.arguments, signal);
          if (res.launchAction) stepLaunchAction = res.launchAction;
          if (res.popupBlocked !== undefined) stepPopupBlocked = res.popupBlocked;

          if (res.success) {
            succeeded = true;
            stepResultMessage = res.message;
            stepObservation = res.observation;
            break;
          }

          lastError = res.error || res.message || 'Step execution failed';
          if (res.unsupportedInWebSandbox) {
            unsupportedInSandbox = true;
            break; // Do not waste retries when OS sandbox explicitly forbids native UI access
          }

          if (attempt <= step.maxRetries) {
            await sleepCancelable(retryDelayMs, signal);
          }
        }

        if (stepLaunchAction) step.launchAction = stepLaunchAction;
        if (stepPopupBlocked !== undefined) step.popupBlocked = stepPopupBlocked;

        if (!succeeded) {
          step.status = unsupportedInSandbox ? 'skipped' : 'failed';
          step.error = lastError;
          step.finishedAt = Date.now();

          if (unsupportedInSandbox) {
            run.needsAccessibilityPermission = true;
            // Observe & continue remaining intent/web steps, recording honest limitation
            step.resultMessage = lastError;
            index++;
            emit(null);
            continue;
          }

          run.status = 'error';
          run.error = `Step ${step.order} (${step.title}) failed after ${step.attempts} attempts: ${lastError}`;
          break;
        }

        // Observation phase after each executed step
        if (signal.aborted) throw new Error('Automation stopped');
        run.status = 'observing';
        step.status = 'observing';
        step.resultMessage = stepResultMessage;
        emit(null);

        const obs =
          stepObservation || (await params.driver.getScreenInformation(signal));
        step.observation = obs;
        step.status = 'completed';
        step.finishedAt = Date.now();

        if (obs.securityBlocked) {
          run.status = 'paused';
          run.finalMessage =
            'Security / Login / CAPTCHA prompt detected on screen. ULTRON will never bypass security screens—please complete it manually.';
          break;
        }

        // Ask Llama controller to evaluate screen observation and decide next action
        // Avoid redundant Llama observation roundtrips when the current step was already get_screen_information
        const nextPendingStep = run.steps[index + 1];
        if (step.tool !== 'get_screen_information') {
          const remaining = run.steps
            .slice(index + 1)
            .map((s) => ({ tool: s.tool, title: s.title }));

          const decision = await planner.decideNext({
            command: run.command,
            goal: run.goal,
            lastStep: {
              tool: step.tool,
              title: step.title,
              success: true,
              message: stepResultMessage,
            },
            observation: obs,
            remainingSteps: remaining,
            model: params.model,
            signal,
          });

          if (signal.aborted) throw new Error('Automation stopped');

          if (decision.action === 'halt') {
            run.status = 'paused';
            run.finalMessage = decision.reason || 'Halted by AI screen observer.';
            break;
          }

          if (decision.action === 'tool' && decision.nextStep) {
            const adaptive = decision.nextStep;
            const isDuplicateObserve =
              adaptive.tool === 'get_screen_information' &&
              nextPendingStep?.tool === 'get_screen_information';
            const isIdenticalRepeat =
              adaptive.tool === step.tool &&
              JSON.stringify(adaptive.arguments) === JSON.stringify(step.arguments);

            if (!isDuplicateObserve && !isIdenticalRepeat) {
              const adaptiveStep: AutomationStep = {
                id: `step_adapt_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
                order: index + 2,
                tool: adaptive.tool,
                arguments: adaptive.arguments,
                title: adaptive.title,
                description: adaptive.description,
                status: 'pending',
                attempts: 0,
                maxRetries,
                isSensitive: adaptive.isSensitive,
                sensitiveReason: adaptive.sensitiveReason,
              };
              run.steps.splice(index + 1, 0, adaptiveStep);
              run.steps = run.steps.map((s, idx) => ({ ...s, order: idx + 1 }));
            }
          }
        }

        index++;
        if (index < run.steps.length && stepDelayMs > 0) {
          await sleepCancelable(stepDelayMs, signal);
        }
      }

      if (run.status === 'running' || run.status === 'observing') {
        const skippedNativeCount = run.steps.filter((s) => s.status === 'skipped').length;
        const completedCount = run.steps.filter((s) => s.status === 'completed').length;
        run.status = 'completed';
        run.finalMessage =
          skippedNativeCount > 0
            ? `Executed ${completedCount} supported steps. ${skippedNativeCount} native Android UI steps require the ULTRON Android Companion Accessibility Service.`
            : `Completed all ${completedCount} automation steps successfully.`;
      }
    } catch (err: any) {
      if (signal.aborted || err?.name === 'AbortError' || /stopped/i.test(err?.message || '')) {
        run.status = 'stopped';
        run.finalMessage = 'Automation stopped immediately by user.';
        run.steps = run.steps.map((s) =>
          s.status === 'running' || s.status === 'retrying' || s.status === 'observing' || s.status === 'awaiting_confirmation'
            ? { ...s, status: 'stopped', finishedAt: Date.now() }
            : s
        );
      } else {
        run.status = 'error';
        run.error = err?.message || 'Unexpected automation error.';
      }
    } finally {
      run.finishedAt = run.finishedAt || Date.now();
      if (this.abortController === controller) {
        this.abortController = null;
      }
      if (run.status === 'stopped' && params.driver.stopBridge) {
        params.driver.stopBridge().catch(() => {});
      }
      emit(null);
    }

    return this.currentRun!;
  }
}
