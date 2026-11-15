import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AutomationEngineController,
  AutomationPlannerApi,
  isAutomationCommandIntent,
} from './automationEngine.ts';
import {
  AutomationDriver,
  ToolExecutionResult,
  mapToolToDeviceAction,
} from './automationBridge.ts';
import {
  AutomationPermissionStatus,
  AutomationRun,
  ScreenObservation,
  SensitiveActionRequest,
} from '../types/automation.ts';

function createMockDriver(options?: {
  mode?: 'android-companion' | 'web-sandbox';
  executeTool?: (tool: string, args: Record<string, any>) => Promise<ToolExecutionResult>;
  screenImpl?: () => Promise<ScreenObservation>;
}): AutomationDriver {
  const mode = options?.mode || 'android-companion';
  return {
    async probePermissions(): Promise<AutomationPermissionStatus> {
      return {
        mode,
        bridgeReachable: mode === 'android-companion',
        accessibilityServiceEnabled: mode === 'android-companion',
        overlayPermissionGranted: mode === 'android-companion',
        browserIntentsSupported: true,
        notes: mode === 'android-companion' ? 'Connected' : 'Web Sandbox',
        lastCheckedAt: Date.now(),
      };
    },
    async getScreenInformation(): Promise<ScreenObservation> {
      if (options?.screenImpl) return options.screenImpl();
      return {
        source: mode === 'android-companion' ? 'android-accessibility' : 'web-fallback',
        timestamp: Date.now(),
        appName: 'Instagram',
        packageName: 'com.instagram.android',
        visibleTexts: ['Search', 'Home'],
        interactiveElements: [{ index: 0, text: 'Search', clickable: true }],
        summary: 'Instagram Home screen ready',
      };
    },
    async executeTool(tool, args): Promise<ToolExecutionResult> {
      if (options?.executeTool) return options.executeTool(tool, args);
      return { success: true, message: `Executed ${tool}` };
    },
  };
}

test('AutomationEngineController executes sequential steps, observes screen, and inserts adaptive step', async () => {
  const engine = new AutomationEngineController();
  const executedTools: string[] = [];
  let decideCount = 0;

  const planner: AutomationPlannerApi = {
    async createPlan() {
      return {
        goal: 'Open Instagram and search nasa',
        modelUsed: 'llama-3.3-70b-versatile',
        steps: [
          {
            tool: 'open_app',
            title: 'Open Instagram',
            arguments: { appName: 'Instagram', packageName: 'com.instagram.android' },
            isSensitive: false,
          },
          {
            tool: 'enter_text',
            title: 'Enter nasa',
            arguments: { text: 'nasa', targetFieldHint: 'Search', submitAfter: true },
            isSensitive: false,
          },
        ],
      };
    },
    async decideNext() {
      decideCount++;
      if (decideCount === 1) {
        return {
          action: 'tool',
          nextStep: {
            tool: 'tap_element',
            title: 'Tap Search Bar',
            arguments: { text: 'Search' },
            isSensitive: false,
          },
        };
      }
      return { action: 'continue', message: 'Looking good' };
    },
  };

  const driver = createMockDriver({
    async executeTool(tool) {
      executedTools.push(tool);
      return { success: true, message: `Ran ${tool}` };
    },
  });

  const finalRun = await engine.runCommand({
    command: 'Open Instagram and search nasa',
    model: 'llama-3.3-70b-versatile',
    driver,
    planner,
    retryDelayMs: 0,
    stepDelayMs: 0,
    onUpdate: () => {},
  });

  assert.equal(finalRun.status, 'completed');
  assert.deepEqual(executedTools, ['open_app', 'tap_element', 'enter_text']);
  assert.equal(finalRun.steps.length, 3);
  assert.ok(finalRun.steps.every((s) => s.status === 'completed'));
});

test('AutomationEngineController retries failed step up to maxRetriesPerStep and succeeds', async () => {
  const engine = new AutomationEngineController();
  let calls = 0;

  const planner: AutomationPlannerApi = {
    async createPlan() {
      return {
        goal: 'Tap WiFi',
        steps: [
          {
            tool: 'tap_element',
            title: 'Tap WiFi',
            arguments: { text: 'Wi-Fi' },
            isSensitive: false,
          },
        ],
      };
    },
    async decideNext() {
      return { action: 'continue' };
    },
  };

  const driver = createMockDriver({
    async executeTool() {
      calls++;
      if (calls < 3) {
        return { success: false, message: 'Node not ready', error: 'Transient UI delay' };
      }
      return { success: true, message: 'Tapped Wi-Fi' };
    },
  });

  const run = await engine.runCommand({
    command: 'Tap WiFi',
    model: 'llama-3.3-70b-versatile',
    driver,
    planner,
    config: { maxRetriesPerStep: 2 },
    retryDelayMs: 0,
    stepDelayMs: 0,
    onUpdate: () => {},
  });

  assert.equal(calls, 3);
  assert.equal(run.status, 'completed');
  assert.equal(run.steps[0].attempts, 3);
});

test('AutomationEngineController gates sensitive actions for explicit user confirmation', async () => {
  const engine = new AutomationEngineController();
  const seenConfirmations: SensitiveActionRequest[] = [];

  const planner: AutomationPlannerApi = {
    async createPlan() {
      return {
        goal: 'Tap Send',
        steps: [
          {
            tool: 'tap_element',
            title: 'Tap Send Message',
            arguments: { text: 'Send' },
            isSensitive: true,
            sensitiveReason: 'Sends outbound message.',
          },
        ],
      };
    },
    async decideNext() {
      return { action: 'continue' };
    },
  };

  const driver = createMockDriver();
  let latestRun: AutomationRun | null = null;

  const promise = engine.runCommand({
    command: 'Send message',
    model: 'llama-3.3-70b-versatile',
    driver,
    planner,
    retryDelayMs: 0,
    stepDelayMs: 0,
    onUpdate: (run, pending) => {
      latestRun = run;
      if (pending) {
        seenConfirmations.push(pending);
        setTimeout(() => engine.respondToConfirmation(true), 10);
      }
    },
  });

  const finalRun = await promise;
  assert.equal(seenConfirmations.length, 1);
  assert.equal(seenConfirmations[0].tool, 'tap_element');
  assert.equal(finalRun.status, 'completed');
  assert.ok(latestRun);
});

test('AutomationEngineController stops immediately when user triggers stop()', async () => {
  const engine = new AutomationEngineController();
  const planner: AutomationPlannerApi = {
    async createPlan() {
      return {
        goal: 'Long workflow',
        steps: [
          { tool: 'open_app', title: 'Step 1', arguments: { appName: 'Chrome' }, isSensitive: false },
          { tool: 'scroll_screen', title: 'Step 2', arguments: { direction: 'down' }, isSensitive: false },
        ],
      };
    },
    async decideNext() {
      return { action: 'continue' };
    },
  };

  const driver = createMockDriver({
    async executeTool() {
      engine.stop();
      return { success: true, message: 'Opened Chrome' };
    },
  });

  const finalRun = await engine.runCommand({
    command: 'Open Chrome and scroll down',
    model: 'llama-3.3-70b-versatile',
    driver,
    planner,
    retryDelayMs: 0,
    stepDelayMs: 50,
    onUpdate: () => {},
  });

  assert.equal(finalRun.status, 'stopped');
});

test('AutomationEngineController halts cleanly on CAPTCHA / securityBlocked screens', async () => {
  const engine = new AutomationEngineController();
  const planner: AutomationPlannerApi = {
    async createPlan() {
      return {
        goal: 'Open Instagram',
        steps: [
          { tool: 'open_app', title: 'Open Instagram', arguments: { appName: 'Instagram' }, isSensitive: false },
          { tool: 'tap_element', title: 'Tap Profile', arguments: { text: 'Profile' }, isSensitive: false },
        ],
      };
    },
    async decideNext() {
      return { action: 'continue' };
    },
  };

  const driver = createMockDriver({
    async screenImpl() {
      return {
        source: 'android-accessibility',
        timestamp: Date.now(),
        appName: 'Instagram',
        visibleTexts: ['Verify you are human', 'CAPTCHA'],
        interactiveElements: [],
        summary: 'CAPTCHA verification screen shown',
        securityBlocked: true,
      };
    },
  });

  const finalRun = await engine.runCommand({
    command: 'Open Instagram',
    model: 'llama-3.3-70b-versatile',
    driver,
    planner,
    retryDelayMs: 0,
    stepDelayMs: 0,
    onUpdate: () => {},
  });

  assert.equal(finalRun.status, 'paused');
  assert.match(finalRun.finalMessage || '', /Security|CAPTCHA/i);
  assert.equal(finalRun.steps[1].status, 'pending');
});

test('AutomationEngineController marks unsupported browser-sandbox steps as skipped, flags needsAccessibilityPermission, and propagates launchAction', async () => {
  const engine = new AutomationEngineController();
  const planner: AutomationPlannerApi = {
    async createPlan() {
      return {
        goal: 'Open YouTube and tap first video',
        steps: [
          { tool: 'open_app', title: 'Open YouTube', arguments: { appName: 'YouTube' }, isSensitive: false },
          { tool: 'tap_element', title: 'Tap Video', arguments: { text: 'Play' }, isSensitive: false },
        ],
      };
    },
    async decideNext() {
      return { action: 'continue' };
    },
  };

  const driver = createMockDriver({
    mode: 'web-sandbox',
    async executeTool(tool) {
      if (tool === 'tap_element') {
        return {
          success: false,
          unsupportedInWebSandbox: true,
          message: 'Requires Android Companion',
          error: 'Browser sandbox cannot tap inside external apps.',
        };
      }
      return {
        success: true,
        message: 'Opened YouTube',
        popupBlocked: true,
        launchAction: {
          id: 'act_yt',
          type: 'youtube_search',
          title: 'Open YouTube',
          appName: 'YouTube',
          appUrl: 'vnd.youtube://',
          webUrl: 'https://www.youtube.com/',
        },
      };
    },
  });

  const finalRun = await engine.runCommand({
    command: 'Open YouTube and tap Play',
    model: 'llama-3.3-70b-versatile',
    driver,
    planner,
    retryDelayMs: 0,
    stepDelayMs: 0,
    onUpdate: () => {},
  });

  assert.equal(finalRun.status, 'completed');
  assert.equal(finalRun.steps[0].status, 'completed');
  assert.equal(finalRun.steps[0].popupBlocked, true);
  assert.equal(finalRun.steps[0].launchAction?.appName, 'YouTube');
  assert.equal(finalRun.steps[1].status, 'skipped');
  assert.equal(finalRun.needsAccessibilityPermission, true);
  assert.match(finalRun.finalMessage || '', /Companion Accessibility/i);
});

test('isAutomationCommandIntent triggers on explicit device commands and does not hijack PDF/coding/Q&A prompts', () => {
  assert.equal(isAutomationCommandIntent('Open YouTube and search for AI coding music'), true);
  assert.equal(isAutomationCommandIntent('Open Settings and navigate to WiFi'), true);
  assert.equal(isAutomationCommandIntent('Open Chrome and search for Groq Llama 3.3'), true);
  assert.equal(isAutomationCommandIntent('Write a Python formula PDF for Maxwell equations'), false);
  assert.equal(isAutomationCommandIntent('What is the derivative of sin(x)?'), false);
  assert.equal(isAutomationCommandIntent('Build a React todo component with hooks'), false);
});

test('mapToolToDeviceAction uses activeAppHint when search_text targetApp is current', () => {
  const ytSearch = mapToolToDeviceAction(
    'search_text',
    { query: 'LOFI beats', targetApp: 'current' },
    'youtube'
  );
  assert.ok(ytSearch);
  assert.equal(ytSearch.appName, 'YouTube');
  assert.ok(ytSearch.webUrl?.includes('youtube.com/results?search_query=LOFI%20beats'));

  const igSearch = mapToolToDeviceAction(
    'search_text',
    { query: '@nasa', targetApp: 'current' },
    'instagram'
  );
  assert.ok(igSearch);
  assert.equal(igSearch.appName, 'Instagram');
  assert.equal(igSearch.webUrl, 'https://www.instagram.com/nasa/');
});
