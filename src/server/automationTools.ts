import {
  ALLOWED_AUTOMATION_TOOLS,
  AutomationToolName,
  ScreenObservation,
} from '../types/automation.ts';

export interface PlannedStepDraft {
  tool: AutomationToolName;
  title: string;
  description?: string;
  arguments: Record<string, any>;
  isSensitive: boolean;
  sensitiveReason?: string;
}

export interface ValidationResult {
  valid: boolean;
  sanitizedTool?: AutomationToolName;
  sanitizedArgs?: Record<string, any>;
  isSensitive: boolean;
  sensitiveReason?: string;
  error?: string;
}

/**
 * Strict Groq / Llama Tool Calling JSON schema exposing ONLY implemented, allowlisted functions.
 */
export const GROQ_AUTOMATION_TOOLS = [
  {
    type: 'function' as const,
    function: {
      name: 'execute_task_plan',
      description:
        'Create a full sequential multi-step execution plan for a user command before executing actions.',
      parameters: {
        type: 'object',
        properties: {
          goal: {
            type: 'string',
            description: 'Concise overall goal of the automation command.',
          },
          steps: {
            type: 'array',
            description: 'Ordered list of atomic allowlisted automation tool calls.',
            items: {
              type: 'object',
              properties: {
                tool: {
                  type: 'string',
                  enum: [
                    'open_app',
                    'open_url',
                    'search_text',
                    'tap_element',
                    'scroll_screen',
                    'enter_text',
                    'get_screen_information',
                  ],
                },
                title: {
                  type: 'string',
                  description: 'Human-readable short title for this step.',
                },
                description: {
                  type: 'string',
                  description: 'Detailed explanation of what this step does.',
                },
                arguments: {
                  type: 'object',
                  description: 'Exact JSON arguments matching the chosen tool schema.',
                },
              },
              required: ['tool', 'title', 'arguments'],
            },
          },
        },
        required: ['goal', 'steps'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'open_app',
      description:
        'Open an installed Android app (e.g. Instagram, YouTube, Chrome, Settings, WhatsApp, Spotify, Maps) or Settings sub-screen.',
      parameters: {
        type: 'object',
        properties: {
          appName: {
            type: 'string',
            description: 'App name such as Instagram, Chrome, YouTube, Settings, WhatsApp, Spotify, Maps.',
          },
          packageName: {
            type: 'string',
            description: 'Optional Android package name e.g. com.instagram.android or com.android.settings.',
          },
          targetScreen: {
            type: 'string',
            description:
              'Optional sub-screen hint (e.g., wifi, bluetooth, display, sound, battery, apps, privacy, reels).',
          },
        },
        required: ['appName'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'open_url',
      description: 'Open a safe https:// or http:// web URL in Chrome or the default browser.',
      parameters: {
        type: 'object',
        properties: {
          url: {
            type: 'string',
            description: 'Full http:// or https:// URL to open.',
          },
          browserApp: {
            type: 'string',
            enum: ['chrome', 'default'],
          },
        },
        required: ['url'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'search_text',
      description:
        'Search for a query inside a target app (YouTube, Chrome, Google, Instagram, Spotify, Maps, Settings) or the currently active screen.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'The search phrase, username, video title, or setting name.',
          },
          targetApp: {
            type: 'string',
            enum: ['youtube', 'chrome', 'google', 'instagram', 'spotify', 'maps', 'settings', 'current'],
          },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'tap_element',
      description:
        'Tap a visible UI button, search bar, tab, or list item on the current Android screen via Accessibility Service.',
      parameters: {
        type: 'object',
        properties: {
          text: {
            type: 'string',
            description: 'Visible text label of the element to tap.',
          },
          contentDescription: {
            type: 'string',
            description: 'Accessibility contentDescription label of the element.',
          },
          viewId: {
            type: 'string',
            description: 'Android resource-id name if known from screen observation.',
          },
          index: {
            type: 'number',
            description: '0-based element index from the latest get_screen_information snapshot.',
          },
        },
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'scroll_screen',
      description: 'Scroll the active Android screen or scrollable container.',
      parameters: {
        type: 'object',
        properties: {
          direction: {
            type: 'string',
            enum: ['down', 'up', 'left', 'right'],
          },
          steps: {
            type: 'number',
            description: 'Number of scroll gestures to perform (1 to 5).',
          },
        },
        required: ['direction'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'enter_text',
      description:
        'Type text into a focused or hinted input field on the active Android screen.',
      parameters: {
        type: 'object',
        properties: {
          text: {
            type: 'string',
            description: 'Text to type into the input field.',
          },
          targetFieldHint: {
            type: 'string',
            description: 'Optional hint or label of the target EditText (e.g., Search, Message, Email).',
          },
          submitAfter: {
            type: 'boolean',
            description: 'Whether to submit/press Search/Enter after entering text.',
          },
        },
        required: ['text'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_screen_information',
      description:
        'Inspect the current foreground app, screen title, visible text, and interactive UI elements via Accessibility Service or Web runtime.',
      parameters: {
        type: 'object',
        properties: {
          includeInteractiveElements: {
            type: 'boolean',
            description: 'Include clickable/editable/scrollable Accessibility nodes.',
          },
        },
      },
    },
  },
];

const UNSAFE_SECURITY_BYPASS_REGEX =
  /\b(bypass\s*captcha|solve\s*captcha|crack\s*password|brute\s*force|bypass\s*(?:2fa|otp|login|biometric|pin|security)|steal\s*token|rm\s*-rf|chmod\s+777|sudo\s+|powershell|cmd\.exe|\/bin\/sh|\/bin\/bash|eval\s*\()\b/i;

const DANGEROUS_URL_PROTOCOL_REGEX = /^\s*(javascript|data|vbscript|file|content):/i;

const KNOWN_APP_PACKAGES: Record<string, string> = {
  instagram: 'com.instagram.android',
  insta: 'com.instagram.android',
  youtube: 'com.google.android.youtube',
  chrome: 'com.android.chrome',
  browser: 'com.android.chrome',
  google: 'com.google.android.googlequicksearchbox',
  settings: 'com.android.settings',
  whatsapp: 'com.whatsapp',
  spotify: 'com.spotify.music',
  maps: 'com.google.android.apps.maps',
  'google maps': 'com.google.android.apps.maps',
  telegram: 'org.telegram.messenger',
  snapchat: 'com.snapchat.android',
  facebook: 'com.facebook.katana',
  gmail: 'com.google.android.gm',
  phone: 'com.google.android.dialer',
  messages: 'com.google.android.apps.messaging',
};

export function resolveKnownPackageName(appName: string): string | undefined {
  const normalized = (appName || '').trim().toLowerCase();
  for (const [key, pkg] of Object.entries(KNOWN_APP_PACKAGES)) {
    if (normalized === key || normalized.includes(key)) {
      return pkg;
    }
  }
  return undefined;
}

/**
 * Evaluates whether a tool call constitutes a sensitive action requiring explicit user confirmation.
 */
export function assessToolSensitivity(
  tool: AutomationToolName,
  args: Record<string, any>
): { isSensitive: boolean; reason?: string } {
  const serialized = JSON.stringify(args || {}).toLowerCase();

  if (tool === 'tap_element') {
    const label = `${args.text || ''} ${args.contentDescription || ''} ${args.viewId || ''}`.toLowerCase();
    if (
      /\b(send|post|publish|submit|pay|checkout|order|buy|purchase|delete|remove|uninstall|erase|reset|transfer|confirm|allow|grant|follow|unfollow|block|report|bhejo)\b/.test(
        label
      )
    ) {
      return {
        isSensitive: true,
        reason: `Tapping "${args.text || args.contentDescription || args.viewId}" triggers an irreversible or outbound action.`,
      };
    }
  }

  if (tool === 'enter_text' && args.submitAfter) {
    const hint = `${args.targetFieldHint || ''}`.toLowerCase();
    if (/(message|dm|chat|comment|post|reply|sms|email|password|pin|otp|payment|card)/.test(hint)) {
      return {
        isSensitive: true,
        reason: `Submitting text into "${args.targetFieldHint}" may send a message or submit account data.`,
      };
    }
  }

  if (tool === 'open_app') {
    const appLower = `${args.appName || ''} ${args.packageName || ''} ${args.targetScreen || ''}`.toLowerCase();
    if (
      /(dialer|phone|messages|messaging)/.test(appLower) ||
      /(factory|reset|lock|biometric|security|password|developer)/.test(appLower)
    ) {
      return {
        isSensitive: true,
        reason: `Opening sensitive system/communication screen (${args.targetScreen || args.appName}).`,
      };
    }
  }

  if (tool === 'open_url') {
    const url = String(args.url || '').toLowerCase();
    if (url.startsWith('tel:') || url.startsWith('sms:') || url.startsWith('mailto:') || url.includes('wa.me/')) {
      return {
        isSensitive: true,
        reason: 'This URL initiates a phone call, SMS, email, or WhatsApp action.',
      };
    }
  }

  if (/\b(delete\s+account|factory\s+reset|send\s+money|bank\s+transfer|upi\s+pay)\b/.test(serialized)) {
    return {
      isSensitive: true,
      reason: 'Financial or destructive account operation detected.',
    };
  }

  return { isSensitive: false };
}

/**
 * Validates tool name against strict allowlist and sanitizes arguments against injections or CAPTCHA/security bypass.
 */
export function validateAndSanitizeToolCall(
  rawTool: string,
  rawArgs: unknown
): ValidationResult {
  const trimmedTool = String(rawTool || '').trim() as AutomationToolName;
  if (!ALLOWED_AUTOMATION_TOOLS.has(trimmedTool)) {
    return {
      valid: false,
      isSensitive: false,
      error: `Blocked non-allowlisted tool "${rawTool}". Only predefined automation tools are permitted.`,
    };
  }

  const args: Record<string, any> =
    rawArgs && typeof rawArgs === 'object' && !Array.isArray(rawArgs)
      ? { ...(rawArgs as Record<string, any>) }
      : {};

  const fullTextCheck = `${trimmedTool} ${JSON.stringify(args)}`;
  if (UNSAFE_SECURITY_BYPASS_REGEX.test(fullTextCheck)) {
    return {
      valid: false,
      isSensitive: false,
      error: 'Blocked unsafe security bypass, CAPTCHA circumvention, or arbitrary shell command.',
    };
  }

  if (trimmedTool === 'open_app') {
    const appName = String(args.appName || '').trim();
    if (!appName) {
      return { valid: false, isSensitive: false, error: 'open_app requires appName.' };
    }
    args.appName = appName.slice(0, 80);
    if (args.packageName) {
      const pkg = String(args.packageName).trim();
      if (!/^[a-zA-Z0-9_.]+$/.test(pkg)) {
        return { valid: false, isSensitive: false, error: 'Invalid Android packageName format.' };
      }
      args.packageName = pkg;
    } else {
      args.packageName = resolveKnownPackageName(appName);
    }
    if (args.targetScreen) {
      args.targetScreen = String(args.targetScreen).trim().slice(0, 80);
    }
  }

  if (trimmedTool === 'open_url') {
    let url = String(args.url || '').trim();
    if (!url) {
      return { valid: false, isSensitive: false, error: 'open_url requires url.' };
    }
    if (DANGEROUS_URL_PROTOCOL_REGEX.test(url)) {
      return {
        valid: false,
        isSensitive: false,
        error: 'Blocked unsafe URL scheme (javascript:, data:, file:, content: are disallowed).',
      };
    }
    if (!/^(https?:\/\/|tel:|sms:|mailto:)/i.test(url)) {
      url = `https://${url}`;
    }
    args.url = url.slice(0, 1000);
    args.browserApp = args.browserApp === 'chrome' ? 'chrome' : 'default';
  }

  if (trimmedTool === 'search_text') {
    const query = String(args.query || '').trim();
    if (!query) {
      return { valid: false, isSensitive: false, error: 'search_text requires query.' };
    }
    args.query = query.slice(0, 300);
    const allowedTargets = new Set([
      'youtube',
      'chrome',
      'google',
      'instagram',
      'spotify',
      'maps',
      'settings',
      'current',
    ]);
    args.targetApp = allowedTargets.has(String(args.targetApp || '').toLowerCase())
      ? String(args.targetApp).toLowerCase()
      : 'current';
  }

  if (trimmedTool === 'tap_element') {
    const hasLocator =
      (typeof args.text === 'string' && args.text.trim().length > 0) ||
      (typeof args.contentDescription === 'string' && args.contentDescription.trim().length > 0) ||
      (typeof args.viewId === 'string' && args.viewId.trim().length > 0) ||
      (typeof args.index === 'number' && Number.isFinite(args.index));
    if (!hasLocator) {
      return {
        valid: false,
        isSensitive: false,
        error: 'tap_element requires text, contentDescription, viewId, or index.',
      };
    }
  }

  if (trimmedTool === 'scroll_screen') {
    const dir = String(args.direction || 'down').toLowerCase();
    args.direction = ['down', 'up', 'left', 'right'].includes(dir) ? dir : 'down';
    const stepsNum = Number(args.steps ?? 1);
    args.steps = Math.max(1, Math.min(5, Number.isFinite(stepsNum) ? Math.round(stepsNum) : 1));
  }

  if (trimmedTool === 'enter_text') {
    const text = String(args.text ?? '');
    if (!text.trim()) {
      return { valid: false, isSensitive: false, error: 'enter_text requires non-empty text.' };
    }
    args.text = text.slice(0, 1000);
    args.submitAfter = Boolean(args.submitAfter);
  }

  if (trimmedTool === 'get_screen_information') {
    args.includeInteractiveElements = args.includeInteractiveElements !== false;
  }

  const sensitivity = assessToolSensitivity(trimmedTool, args);
  return {
    valid: true,
    sanitizedTool: trimmedTool,
    sanitizedArgs: args,
    isSensitive: sensitivity.isSensitive,
    sensitiveReason: sensitivity.reason,
  };
}

/**
 * Builds deterministic structured fallback steps from natural-language commands if Groq tool calling
 * isn't triggered or Groq API key is unavailable.
 */
export function buildFallbackAutomationPlan(command: string): {
  goal: string;
  steps: PlannedStepDraft[];
} {
  const clean = (command || '').trim();
  const lower = clean.toLowerCase();
  const steps: PlannedStepDraft[] = [];

  const pushValidatedStep = (
    tool: AutomationToolName,
    title: string,
    args: Record<string, any>,
    description?: string
  ) => {
    const check = validateAndSanitizeToolCall(tool, args);
    if (!check.valid || !check.sanitizedTool || !check.sanitizedArgs) return;
    steps.push({
      tool: check.sanitizedTool,
      title,
      description,
      arguments: check.sanitizedArgs,
      isSensitive: check.isSensitive,
      sensitiveReason: check.sensitiveReason,
    });
  };

  // Detect security bypass attempt right at planning stage
  if (UNSAFE_SECURITY_BYPASS_REGEX.test(clean)) {
    return { goal: 'Blocked unsafe security operation', steps: [] };
  }

  // Split by sequential connectors while preserving quoted text
  const clauses = clean
    .split(/\s*(?:\bthen\b|\band\b|\baur\b|\bphir\b|\buske\s+baad\b|\bnext\b|;|->|\n+)\s*/i)
    .map((c) => c.trim())
    .filter(Boolean);

  let activeApp: string | undefined;

  for (const clause of clauses) {
    const cLower = clause.toLowerCase();

    // Case 1: Instagram + account/search
    if (cLower.includes('instagram') || /\binsta\b/.test(cLower)) {
      activeApp = 'instagram';
      const isReels = cLower.includes('reel');
      pushValidatedStep(
        'open_app',
        isReels ? 'Open Instagram Reels' : 'Open Instagram',
        {
          appName: 'Instagram',
          packageName: 'com.instagram.android',
          ...(isReels ? { targetScreen: 'reels' } : {}),
        },
        'Launch Instagram app on Android or web fallback.'
      );
      pushValidatedStep(
        'get_screen_information',
        'Observe Instagram screen',
        { includeInteractiveElements: true },
        'Read active screen state to locate Search tab or profile.'
      );

      const searchAccMatch = clause.match(
        /(?:search(?:\s+for)?|find|look\s*up|account|profile|dhundo|khojo)\s+@?([a-zA-Z0-9._ -]{2,50})/i
      );
      if (searchAccMatch && !/\breels?\b/i.test(searchAccMatch[1])) {
        const accountQuery = searchAccMatch[1].replace(/\b(account|profile|page|par|pe)\b/gi, '').trim();
        if (accountQuery) {
          pushValidatedStep(
            'tap_element',
            'Tap Instagram Search tab',
            { contentDescription: 'Search and explore', text: 'Search' },
            'Open Search screen inside Instagram.'
          );
          pushValidatedStep(
            'enter_text',
            `Search Instagram for "${accountQuery}"`,
            { text: accountQuery, targetFieldHint: 'Search', submitAfter: true },
            `Enter "${accountQuery}" into Instagram search bar.`
          );
          pushValidatedStep(
            'get_screen_information',
            'Verify Instagram search results',
            { includeInteractiveElements: true }
          );
        }
      }
      continue;
    }

    // Case 2: YouTube + search
    if (cLower.includes('youtube')) {
      activeApp = 'youtube';
      pushValidatedStep(
        'open_app',
        'Open YouTube',
        { appName: 'YouTube', packageName: 'com.google.android.youtube' },
        'Launch YouTube.'
      );
      const q = clause
        .replace(
          /\b(open|launch|youtube|and|aur|search(?:\s+for)?|find|play|watch|a|video|videos|song|karo|par|pe|on|for)\b/gi,
          ' '
        )
        .replace(/\s+/g, ' ')
        .trim();
      if (q.length >= 2) {
        pushValidatedStep(
          'search_text',
          `Search YouTube for "${q}"`,
          { query: q, targetApp: 'youtube' },
          `Execute YouTube search for "${q}".`
        );
      }
      pushValidatedStep('get_screen_information', 'Observe YouTube screen', {
        includeInteractiveElements: true,
      });
      continue;
    }

    // Case 3: Chrome / Browser + search
    if (cLower.includes('chrome') || cLower.includes('browser')) {
      activeApp = 'chrome';
      pushValidatedStep(
        'open_app',
        'Open Chrome',
        { appName: 'Chrome', packageName: 'com.android.chrome' },
        'Launch Google Chrome.'
      );
      const urlMatch = clause.match(/https?:\/\/[^\s]+/i);
      if (urlMatch) {
        pushValidatedStep('open_url', `Open URL ${urlMatch[0]}`, {
          url: urlMatch[0],
          browserApp: 'chrome',
        });
      } else {
        const q = clause
          .replace(/\b(open|launch|chrome|browser|and|aur|search(?:\s+for)?|google|something|karo|on|for)\b/gi, ' ')
          .replace(/\s+/g, ' ')
          .trim();
        if (q.length >= 2) {
          pushValidatedStep('search_text', `Search Chrome for "${q}"`, {
            query: q,
            targetApp: 'chrome',
          });
        }
      }
      pushValidatedStep('get_screen_information', 'Observe Chrome page state', {
        includeInteractiveElements: true,
      });
      continue;
    }

    // Case 4: Settings + specific setting
    if (cLower.includes('setting')) {
      activeApp = 'settings';
      const targetMatch = clause.match(
        /\b(wifi|wi-fi|bluetooth|display|brightness|sound|volume|battery|apps|notifications|privacy|location|network|hotspot|dark mode|accessibility)\b/i
      );
      const targetScreen = targetMatch ? targetMatch[1].toLowerCase() : undefined;
      pushValidatedStep(
        'open_app',
        targetScreen ? `Open Settings (${targetScreen})` : 'Open Settings',
        {
          appName: 'Settings',
          packageName: 'com.android.settings',
          ...(targetScreen ? { targetScreen } : {}),
        },
        'Open Android Settings app.'
      );
      pushValidatedStep('get_screen_information', 'Observe Settings screen', {
        includeInteractiveElements: true,
      });
      if (targetScreen) {
        pushValidatedStep(
          'tap_element',
          `Tap "${targetMatch![1]}" setting`,
          { text: targetMatch![1] },
          `Navigate to ${targetMatch![1]} inside Settings.`
        );
        pushValidatedStep('get_screen_information', 'Confirm setting screen opened', {
          includeInteractiveElements: true,
        });
      }
      continue;
    }

    // Case 5: Subsequent clause acting on previously opened app ("search for ...", "scroll down", "tap ...", "type ...")
    if (/^(search|find|look\s*up|dhundo|khojo)\b/i.test(clause)) {
      const q = clause
        .replace(/^(search(?:\s+for)?|find|look\s*up|dhundo|khojo)\s*/i, '')
        .replace(/\b(particular\s+account|account)\b/gi, '')
        .replace(/\s+/g, ' ')
        .trim();
      if (q) {
        if (activeApp === 'instagram') {
          pushValidatedStep(
            'tap_element',
            'Tap Instagram Search tab',
            { contentDescription: 'Search and explore', text: 'Search' },
            'Open Search screen inside Instagram.'
          );
          pushValidatedStep(
            'enter_text',
            `Search Instagram for "${q}"`,
            { text: q, targetFieldHint: 'Search', submitAfter: true },
            `Enter "${q}" into Instagram search bar.`
          );
        } else {
          pushValidatedStep(
            'search_text',
            `Search "${q}"`,
            { query: q, targetApp: activeApp || 'chrome' },
            `Search for "${q}" in ${activeApp || 'browser'}.`
          );
        }
        pushValidatedStep('get_screen_information', 'Observe search results', {
          includeInteractiveElements: true,
        });
      }
      continue;
    }

    if (/\bscroll\b/i.test(cLower)) {
      const dir = cLower.includes('up') ? 'up' : cLower.includes('left') ? 'left' : cLower.includes('right') ? 'right' : 'down';
      pushValidatedStep('scroll_screen', `Scroll ${dir}`, { direction: dir, steps: 1 });
      pushValidatedStep('get_screen_information', 'Observe screen after scroll', {
        includeInteractiveElements: true,
      });
      continue;
    }

    if (/\b(tap|click|press|select|daba)\b/i.test(cLower)) {
      const label = clause.replace(/\b(tap|click|press|select|on|the|button|dabao|daba)\b/gi, ' ').replace(/\s+/g, ' ').trim();
      if (label) {
        pushValidatedStep('tap_element', `Tap "${label}"`, { text: label });
        pushValidatedStep('get_screen_information', 'Observe screen after tap', {
          includeInteractiveElements: true,
        });
      }
      continue;
    }

    if (/\b(navigate|go\s+to|switch\s+to|jao)\b/i.test(cLower)) {
      const target = clause
        .replace(/\b(navigate|go|switch|to|a|the|particular|setting|settings|me|mein|par|jao)\b/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (target) {
        if (activeApp === 'settings') {
          const settingsStep = steps.find(
            (s) => s.tool === 'open_app' && s.arguments.packageName === 'com.android.settings'
          );
          if (settingsStep && !settingsStep.arguments.targetScreen) {
            settingsStep.arguments.targetScreen = target.toLowerCase();
            settingsStep.title = `Open Settings (${target})`;
          }
        }
        pushValidatedStep('tap_element', `Navigate to "${target}"`, { text: target });
        pushValidatedStep('get_screen_information', `Observe "${target}" screen`, {
          includeInteractiveElements: true,
        });
      }
      continue;
    }

    const urlOnly = clause.match(/https?:\/\/[^\s]+/i);
    if (urlOnly) {
      pushValidatedStep('open_url', `Open ${urlOnly[0]}`, { url: urlOnly[0], browserApp: 'default' });
      pushValidatedStep('get_screen_information', 'Observe opened page', {
        includeInteractiveElements: true,
      });
      continue;
    }

    // Generic "open <app>"
    const openMatch = clause.match(/\b(?:open|launch|kholo|khol)\s+([a-zA-Z0-9 ._-]{2,40})/i);
    if (openMatch) {
      const appName = openMatch[1].trim();
      activeApp = appName.toLowerCase();
      pushValidatedStep('open_app', `Open ${appName}`, {
        appName,
        packageName: resolveKnownPackageName(appName),
      });
      pushValidatedStep('get_screen_information', `Observe ${appName} screen`, {
        includeInteractiveElements: true,
      });
    }
  }

  // Fallback if no structured step matched cleanly: default to Chrome/Google web search
  if (steps.length === 0 && clean.length >= 2) {
    if (/https?:\/\/[^\s]+/i.test(clean)) {
      const url = clean.match(/https?:\/\/[^\s]+/i)![0];
      pushValidatedStep('open_url', `Open ${url}`, { url, browserApp: 'chrome' });
    } else {
      pushValidatedStep('search_text', `Search Chrome for "${clean}"`, {
        query: clean,
        targetApp: 'chrome',
      });
    }
    pushValidatedStep('get_screen_information', 'Observe result screen', {
      includeInteractiveElements: true,
    });
  }

  // Enforce sequential sense: deduplicate consecutive identical get_screen_information
  const deduped: PlannedStepDraft[] = [];
  for (const s of steps) {
    const prev = deduped[deduped.length - 1];
    if (prev && prev.tool === 'get_screen_information' && s.tool === 'get_screen_information') {
      continue;
    }
    deduped.push(s);
  }

  return {
    goal: clean.slice(0, 120) || 'Automated Task',
    steps: deduped,
  };
}

export function buildAutomationPlannerSystemPrompt(): string {
  return `You are ULTRON's intelligent Multi-Step Device Automation Planner powered by Llama on Groq.
Your job is to understand natural-language commands (English, Hindi, Hinglish) and produce a complete, safe, ordered automation plan using ONLY the provided allowlisted tools.

STRICT RULES:
1. Always call execute_task_plan once with ALL required sequential steps.
2. Break commands into granular actions: open_app -> get_screen_information -> tap_element / enter_text / search_text / scroll_screen -> get_screen_information.
3. ONLY use allowlisted tools: open_app, open_url, search_text, tap_element, scroll_screen, enter_text, get_screen_information.
4. NEVER attempt to bypass CAPTCHA, 2FA, login screens, OTP prompts, or Android OS security dialogs.
5. NEVER generate shell commands or javascript: URLs.`;
}

export function buildAutomationDeciderSystemPrompt(): string {
  return `You are ULTRON's Step-by-Step Automation Observer & Decision Controller.
After executing an automation step, you receive the latest screen observation (packageName, visibleTexts, interactiveElements, summary).
Decide whether:
- Another allowlisted tool call is required to recover, tap an element, enter text, scroll, or search (call ONE next tool), OR
- The current step/goal is satisfied, OR
- A security/CAPTCHA/login screen was encountered (STOP and report honestly without bypassing).

If no additional tool call is needed and the execution can proceed to the next planned step (or finish), reply with a brief JSON summary:
{"action":"continue","message":"..."}
or if blocked by security/error:
{"action":"halt","reason":"..."}`;
}

/**
 * Safely parses Groq tool_calls into validated PlannedStepDrafts.
 */
export function extractPlanFromGroqToolCalls(
  toolCalls: Array<{ function?: { name?: string; arguments?: string } }> | undefined,
  fallbackCommand: string
): { goal: string; steps: PlannedStepDraft[]; usedGroqTools: boolean } {
  if (!Array.isArray(toolCalls) || toolCalls.length === 0) {
    const fb = buildFallbackAutomationPlan(fallbackCommand);
    return { ...fb, usedGroqTools: false };
  }

  const collectedSteps: PlannedStepDraft[] = [];
  let goal = fallbackCommand.slice(0, 120);

  for (const call of toolCalls) {
    const fnName = call?.function?.name || '';
    let parsedArgs: any = {};
    try {
      parsedArgs = call?.function?.arguments ? JSON.parse(call.function.arguments) : {};
    } catch {
      continue;
    }

    if (fnName === 'execute_task_plan' && Array.isArray(parsedArgs.steps)) {
      if (typeof parsedArgs.goal === 'string' && parsedArgs.goal.trim()) {
        goal = parsedArgs.goal.trim();
      }
      for (const rawStep of parsedArgs.steps) {
        const validation = validateAndSanitizeToolCall(rawStep?.tool, rawStep?.arguments);
        if (validation.valid && validation.sanitizedTool && validation.sanitizedArgs) {
          collectedSteps.push({
            tool: validation.sanitizedTool,
            title: String(rawStep?.title || validation.sanitizedTool).trim(),
            description: rawStep?.description ? String(rawStep.description).trim() : undefined,
            arguments: validation.sanitizedArgs,
            isSensitive: validation.isSensitive,
            sensitiveReason: validation.sensitiveReason,
          });
        }
      }
    } else {
      const validation = validateAndSanitizeToolCall(fnName, parsedArgs);
      if (validation.valid && validation.sanitizedTool && validation.sanitizedArgs) {
        collectedSteps.push({
          tool: validation.sanitizedTool,
          title: fnName.replace(/_/g, ' '),
          arguments: validation.sanitizedArgs,
          isSensitive: validation.isSensitive,
          sensitiveReason: validation.sensitiveReason,
        });
      }
    }
  }

  if (collectedSteps.length === 0) {
    const fb = buildFallbackAutomationPlan(fallbackCommand);
    return { ...fb, usedGroqTools: false };
  }

  return { goal, steps: collectedSteps, usedGroqTools: true };
}

export function formatObservationForLlama(obs: ScreenObservation | undefined): string {
  if (!obs) return 'No screen observation captured yet.';
  const topElements = (obs.interactiveElements || [])
    .slice(0, 18)
    .map(
      (el) =>
        `[${el.index}] ${el.clickable ? 'clickable ' : ''}${el.editable ? 'editable ' : ''}` +
        `text="${el.text || ''}" desc="${el.contentDescription || ''}" id="${el.viewId || ''}"`
    )
    .join('\n');

  return [
    `Source: ${obs.source}`,
    obs.appName ? `App: ${obs.appName} (${obs.packageName || ''})` : '',
    obs.screenTitle ? `Title: ${obs.screenTitle}` : '',
    obs.currentUrl ? `URL: ${obs.currentUrl}` : '',
    `Summary: ${obs.summary}`,
    obs.securityBlocked ? 'WARNING: Login/CAPTCHA/Security prompt detected on screen.' : '',
    obs.visibleTexts?.length ? `Visible Texts: ${obs.visibleTexts.slice(0, 15).join(' | ')}` : '',
    topElements ? `Interactive UI Nodes:\n${topElements}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}
