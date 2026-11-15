import {
  ALLOWED_AUTOMATION_TOOLS,
  AutomationBridgeConfig,
  AutomationPermissionStatus,
  AutomationToolName,
  ScreenObservation,
} from '../types/automation.ts';
import { DeviceAction, DeviceActionType } from '../types/chat.ts';
import { executeDeviceAction, KNOWN_ANDROID_PACKAGES } from './actionDispatcher.ts';

export interface ToolExecutionResult {
  success: boolean;
  message: string;
  observation?: ScreenObservation;
  unsupportedInWebSandbox?: boolean;
  launchAction?: DeviceAction;
  popupBlocked?: boolean;
  error?: string;
}

export interface AccessibilityRequestResult {
  triggered: boolean;
  method: 'already-enabled' | 'companion-bridge' | 'android-intent' | 'manual-guide';
  message: string;
  permissions: AutomationPermissionStatus;
}

export interface AutomationDriver {
  probePermissions(): Promise<AutomationPermissionStatus>;
  getScreenInformation(signal?: AbortSignal): Promise<ScreenObservation>;
  executeTool(
    tool: AutomationToolName,
    args: Record<string, any>,
    signal?: AbortSignal
  ): Promise<ToolExecutionResult>;
  stopBridge?(): Promise<void>;
}

export const ANDROID_ACCESSIBILITY_SETTINGS_INTENT =
  'intent:#Intent;action=android.settings.ACCESSIBILITY_SETTINGS;end';

export const ANDROID_COMPANION_REQUEST_INTENT =
  'intent:#Intent;action=com.jagjit.edith.companion.REQUEST_ACCESSIBILITY;package=com.jagjit.edith.companion;end';

const APP_LAUNCH_FALLBACKS: Record<
  string,
  { type: DeviceActionType; appName: string; appUrl: string; webUrl: string; androidPackage?: string }
> = {
  instagram: {
    type: 'instagram_open',
    appName: 'Instagram',
    appUrl: 'instagram://app',
    webUrl: 'https://www.instagram.com/',
    androidPackage: 'com.instagram.android',
  },
  youtube: {
    type: 'youtube_search',
    appName: 'YouTube',
    appUrl: 'vnd.youtube://',
    webUrl: 'https://www.youtube.com/',
    androidPackage: 'com.google.android.youtube',
  },
  chrome: {
    type: 'chrome_search',
    appName: 'Chrome',
    appUrl: 'https://www.google.com/',
    webUrl: 'https://www.google.com/',
    androidPackage: 'com.android.chrome',
  },
  whatsapp: {
    type: 'whatsapp_message',
    appName: 'WhatsApp',
    appUrl: 'whatsapp://send',
    webUrl: 'https://wa.me/',
    androidPackage: 'com.whatsapp',
  },
  spotify: {
    type: 'spotify_play',
    appName: 'Spotify',
    appUrl: 'spotify://',
    webUrl: 'https://open.spotify.com/',
    androidPackage: 'com.spotify.music',
  },
  maps: {
    type: 'maps_search',
    appName: 'Google Maps',
    appUrl: 'geo:0,0',
    webUrl: 'https://www.google.com/maps',
    androidPackage: 'com.google.android.apps.maps',
  },
  telegram: {
    type: 'telegram_open',
    appName: 'Telegram',
    appUrl: 'tg://resolve',
    webUrl: 'https://t.me/',
    androidPackage: 'org.telegram.messenger',
  },
  snapchat: {
    type: 'snapchat_open',
    appName: 'Snapchat',
    appUrl: 'snapchat://',
    webUrl: 'https://web.snapchat.com/',
    androidPackage: 'com.snapchat.android',
  },
  facebook: {
    type: 'facebook_open',
    appName: 'Facebook',
    appUrl: 'fb://feed',
    webUrl: 'https://www.facebook.com/',
    androidPackage: 'com.facebook.katana',
  },
};

function resolveAndroidSettingsIntent(targetScreen?: string): string {
  const screen = (targetScreen || '').toLowerCase();
  if (screen.includes('wifi') || screen.includes('wi-fi')) {
    return 'intent:#Intent;action=android.settings.WIFI_SETTINGS;end';
  }
  if (screen.includes('bluetooth')) {
    return 'intent:#Intent;action=android.settings.BLUETOOTH_SETTINGS;end';
  }
  if (screen.includes('display') || screen.includes('brightness')) {
    return 'intent:#Intent;action=android.settings.DISPLAY_SETTINGS;end';
  }
  if (screen.includes('sound') || screen.includes('volume')) {
    return 'intent:#Intent;action=android.settings.SOUND_SETTINGS;end';
  }
  if (screen.includes('accessibility')) {
    return ANDROID_ACCESSIBILITY_SETTINGS_INTENT;
  }
  if (screen.includes('app')) {
    return 'intent:#Intent;action=android.settings.APPLICATION_SETTINGS;end';
  }
  if (screen.includes('privacy')) {
    return 'intent:#Intent;action=android.settings.PRIVACY_SETTINGS;end';
  }
  if (screen.includes('location')) {
    return 'intent:#Intent;action=android.settings.LOCATION_SOURCE_SETTINGS;end';
  }
  return 'intent:#Intent;action=android.settings.SETTINGS;end';
}

export function mapToolToDeviceAction(
  tool: AutomationToolName,
  args: Record<string, any>,
  activeAppHint?: string | null
): DeviceAction | null {
  const uid = `auto_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

  if (tool === 'open_url') {
    const url = String(args.url || 'https://www.google.com').trim();
    return {
      id: uid,
      type: url.startsWith('tel:')
        ? 'call_phone'
        : url.startsWith('sms:')
        ? 'sms_message'
        : url.startsWith('mailto:')
        ? 'email_compose'
        : 'open_url',
      title: `Open ${url}`,
      appName: args.browserApp === 'chrome' ? 'Chrome' : 'Browser',
      appUrl: url,
      webUrl: url,
      androidPackage: args.browserApp === 'chrome' ? 'com.android.chrome' : undefined,
    };
  }

  if (tool === 'open_app') {
    const appLower = String(args.appName || '').trim().toLowerCase();
    for (const [key, spec] of Object.entries(APP_LAUNCH_FALLBACKS)) {
      if (appLower.includes(key)) {
        const isReels = key === 'instagram' && String(args.targetScreen || '').toLowerCase() === 'reels';
        return {
          id: uid,
          type: isReels ? 'instagram_reels' : spec.type,
          title: isReels ? 'Open Instagram Reels' : `Open ${spec.appName}`,
          appName: spec.appName,
          appUrl: isReels ? 'instagram://reels' : spec.appUrl,
          webUrl: isReels ? 'https://www.instagram.com/reels/' : spec.webUrl,
          androidPackage: args.packageName || spec.androidPackage,
        };
      }
    }
    return null;
  }

  if (tool === 'search_text') {
    const query = String(args.query || '').trim();
    const encoded = encodeURIComponent(query);
    const rawTarget = String(args.targetApp || 'current').toLowerCase();
    const target = rawTarget === 'current' && activeAppHint ? activeAppHint.toLowerCase() : rawTarget;

    if (target === 'youtube') {
      return {
        id: uid,
        type: 'youtube_search',
        title: `YouTube: ${query}`,
        appName: 'YouTube',
        target: query,
        appUrl: `vnd.youtube://results?search_query=${encoded}`,
        webUrl: `https://www.youtube.com/results?search_query=${encoded}`,
        androidPackage: KNOWN_ANDROID_PACKAGES.youtube_search,
      };
    }

    if (target === 'spotify') {
      return {
        id: uid,
        type: 'spotify_play',
        title: `Spotify: ${query}`,
        appName: 'Spotify',
        target: query,
        appUrl: `spotify:search:${encoded}`,
        webUrl: `https://open.spotify.com/search/${encoded}`,
        androidPackage: KNOWN_ANDROID_PACKAGES.spotify_play,
      };
    }

    if (target === 'maps') {
      return {
        id: uid,
        type: 'maps_search',
        title: `Maps: ${query}`,
        appName: 'Google Maps',
        target: query,
        appUrl: `geo:0,0?q=${encoded}`,
        webUrl: `https://www.google.com/maps/search/?api=1&query=${encoded}`,
        androidPackage: KNOWN_ANDROID_PACKAGES.maps_search,
      };
    }

    if (target === 'instagram') {
      const cleanHandle = query.replace(/^@/, '').replace(/\s+/g, '');
      return {
        id: uid,
        type: 'instagram_open',
        title: `Instagram: ${query}`,
        appName: 'Instagram',
        target: cleanHandle,
        appUrl: `instagram://user?username=${encodeURIComponent(cleanHandle)}`,
        webUrl: `https://www.instagram.com/${encodeURIComponent(cleanHandle)}/`,
        androidPackage: KNOWN_ANDROID_PACKAGES.instagram_open,
      };
    }

    return {
      id: uid,
      type: 'chrome_search',
      title: `Search: ${query}`,
      appName: 'Chrome',
      target: query,
      appUrl: `https://www.google.com/search?q=${encoded}`,
      webUrl: `https://www.google.com/search?q=${encoded}`,
      androidPackage: KNOWN_ANDROID_PACKAGES.chrome_search,
    };
  }

  return null;
}

function buildHeaders(config: AutomationBridgeConfig): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (config.pairingToken && config.pairingToken.trim()) {
    headers['X-EDITH-Token'] = config.pairingToken.trim();
  }
  return headers;
}

function normalizeBridgeBaseUrl(rawUrl: string): string {
  const clean = (rawUrl || 'http://127.0.0.1:8765').trim().replace(/\/+$/, '');
  return /^https?:\/\//i.test(clean) ? clean : `http://${clean}`;
}

export class BrowserAutomationDriver implements AutomationDriver {
  private config: AutomationBridgeConfig;
  private lastKnownBridgeReachable = false;
  private lastOpenedApp: string | null = null;

  constructor(config: AutomationBridgeConfig) {
    this.config = config;
  }

  updateConfig(config: AutomationBridgeConfig) {
    this.config = config;
  }

  resetRunContext() {
    this.lastOpenedApp = null;
  }

  async probePermissions(explicit = false): Promise<AutomationPermissionStatus> {
    const baseUrl = normalizeBridgeBaseUrl(this.config.bridgeUrl);
    const isAndroidUa = typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent);
    const hasPairingToken = Boolean(this.config.pairingToken && this.config.pairingToken.trim());

    if (!explicit && !isAndroidUa && !hasPairingToken) {
      this.lastKnownBridgeReachable = false;
      return {
        mode: 'web-sandbox',
        bridgeReachable: false,
        accessibilityServiceEnabled: false,
        overlayPermissionGranted: false,
        browserIntentsSupported: false,
        notes:
          'Web Browser Sandbox: URL, web search, and interactive launch cards work directly. Native Android Accessibility steps (tap/type/scroll inside external Android apps) require the ULTRON Android Companion APK.',
        lastCheckedAt: Date.now(),
      };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1600);

    try {
      const res = await fetch(`${baseUrl}/health`, {
        method: 'GET',
        headers: buildHeaders(this.config),
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (res.ok) {
        const data = await res.json();
        this.lastKnownBridgeReachable = true;
        const accEnabled = Boolean(data.accessibilityServiceEnabled);
        return {
          mode: accEnabled ? 'android-companion' : 'web-sandbox',
          bridgeReachable: true,
          accessibilityServiceEnabled: accEnabled,
          overlayPermissionGranted: Boolean(data.overlayPermissionGranted),
          deviceModel: data.deviceModel,
          androidSdk: data.androidSdk,
          browserIntentsSupported: isAndroidUa,
          notes: accEnabled
            ? 'Android Companion Bridge connected & Accessibility Service active. Full UI observation, tapping, typing & scrolling enabled.'
            : 'Companion Bridge connected, but Accessibility Service is OFF. Tap "Request Accessibility Permission" to turn on ULTRON Automation Accessibility in Android Settings.',
          lastCheckedAt: Date.now(),
        };
      }
    } catch {
      clearTimeout(timer);
    }

    this.lastKnownBridgeReachable = false;
    return {
      mode: 'web-sandbox',
      bridgeReachable: false,
      accessibilityServiceEnabled: false,
      overlayPermissionGranted: false,
      browserIntentsSupported: isAndroidUa,
      notes: isAndroidUa
        ? 'Android Web Browser: App & Search intents work directly. To grant Accessibility Permission for cross-app taps & Settings toggles, install/open ULTRON Companion APK or tap Request Accessibility Permission.'
        : 'Web Browser Sandbox: URL & web search automation works directly with one-tap launch links. Full Android Accessibility control requires running ULTRON on Android with the Companion APK.',
      lastCheckedAt: Date.now(),
    };
  }

  async requestAccessibilityPermission(): Promise<AccessibilityRequestResult> {
    const perms = await this.probePermissions(true);
    if (perms.accessibilityServiceEnabled) {
      return {
        triggered: true,
        method: 'already-enabled',
        message: 'Accessibility Service is already active and connected!',
        permissions: perms,
      };
    }

    const baseUrl = normalizeBridgeBaseUrl(this.config.bridgeUrl);
    if (perms.bridgeReachable) {
      try {
        const res = await fetch(`${baseUrl}/request-accessibility`, {
          method: 'POST',
          headers: buildHeaders(this.config),
        });
        if (res.ok) {
          return {
            triggered: true,
            method: 'companion-bridge',
            message:
              'Opened Android Accessibility Settings via ULTRON Companion. Select "ULTRON Automation Accessibility", turn it ON, and return here to tap Check Permission.',
            permissions: perms,
          };
        }
      } catch {
        // fall through to Android intent trigger
      }
    }

    const isAndroidUa = typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent);
    if (isAndroidUa && typeof document !== 'undefined') {
      try {
        const a = document.createElement('a');
        a.href = ANDROID_COMPANION_REQUEST_INTENT;
        a.rel = 'noopener noreferrer';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        return {
          triggered: true,
          method: 'android-intent',
          message:
            'Requested Accessibility Permission via ULTRON Companion intent. If nothing opened, tap "Open Phone Accessibility Settings" below or install /android-companion APK.',
          permissions: perms,
        };
      } catch {
        // fall through
      }
    }

    return {
      triggered: false,
      method: 'manual-guide',
      message: isAndroidUa
        ? 'Could not reach ULTRON Companion at 127.0.0.1:8765. Open the ULTRON Companion app (or install the APK from /android-companion) and accept its Accessibility prompt, then tap Check Permission.'
        : 'Accessibility Service is an Android OS permission. Open ULTRON on your Android phone with ULTRON Companion installed, or paste your Android Companion Bridge URL & Pairing Token in Bridge Settings.',
      permissions: perms,
    };
  }

  async getScreenInformation(signal?: AbortSignal): Promise<ScreenObservation> {
    if (this.lastKnownBridgeReachable) {
      const baseUrl = normalizeBridgeBaseUrl(this.config.bridgeUrl);
      try {
        const res = await fetch(`${baseUrl}/screen`, {
          method: 'GET',
          headers: buildHeaders(this.config),
          signal,
        });
        if (res.ok) {
          const obs = await res.json();
          const combinedText = `${obs.screenTitle || ''} ${(obs.visibleTexts || []).join(' ')}`.toLowerCase();
          const securityBlocked =
            Boolean(obs.securityBlocked) ||
            /\b(verify you are human|captcha|enter otp|two-factor|2fa|biometric)\b/i.test(combinedText);

          return {
            source: 'android-accessibility',
            timestamp: Date.now(),
            packageName: obs.packageName,
            appName: obs.appName,
            activityName: obs.activityName,
            screenTitle: obs.screenTitle,
            visibleTexts: Array.isArray(obs.visibleTexts) ? obs.visibleTexts : [],
            interactiveElements: Array.isArray(obs.interactiveElements) ? obs.interactiveElements : [],
            summary:
              obs.summary ||
              `Active Android screen: ${obs.appName || obs.packageName || 'Unknown App'}`,
            securityBlocked,
          };
        }
      } catch {
        // Fallback below if companion disconnected mid-run
      }
    }

    const title = typeof document !== 'undefined' ? document.title : 'ULTRON Web Workspace';
    const currentUrl = typeof window !== 'undefined' ? window.location.href : 'http://localhost:3000/';

    return {
      source: 'web-fallback',
      timestamp: Date.now(),
      currentUrl,
      screenTitle: title,
      visibleTexts: [title, 'ULTRON Web Sandbox'],
      interactiveElements: [],
      summary:
        'Browser Sandbox active: URL & intent launches ready; native cross-app taps require ULTRON Android Companion.',
      securityBlocked: false,
    };
  }

  async executeTool(
    tool: AutomationToolName,
    args: Record<string, any>,
    signal?: AbortSignal
  ): Promise<ToolExecutionResult> {
    if (!ALLOWED_AUTOMATION_TOOLS.has(tool)) {
      return {
        success: false,
        message: 'Tool blocked',
        error: `Tool "${tool}" is not on the allowlist.`,
      };
    }

    if (tool === 'get_screen_information') {
      const observation = await this.getScreenInformation(signal);
      return {
        success: true,
        message: observation.summary,
        observation,
      };
    }

    // Attempt native companion execution when bridge + accessibility service is active
    if (this.lastKnownBridgeReachable) {
      const baseUrl = normalizeBridgeBaseUrl(this.config.bridgeUrl);
      try {
        const res = await fetch(`${baseUrl}/execute`, {
          method: 'POST',
          headers: buildHeaders(this.config),
          body: JSON.stringify({ tool, arguments: args }),
          signal,
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok && data.success) {
          return {
            success: true,
            message: data.message || `Executed ${tool} via Android Companion.`,
            observation: data.observation,
          };
        }
        return {
          success: false,
          message: data.message || `Companion failed on ${tool}`,
          error: data.error || `HTTP ${res.status}`,
        };
      } catch (err: any) {
        return {
          success: false,
          message: `Companion bridge request failed for ${tool}`,
          error: err.message || 'Companion unreachable',
        };
      }
    }

    // Track opened app context so subsequent search_text(targetApp:'current') targets the right app
    if (tool === 'open_app') {
      const appLower = String(args.appName || '').toLowerCase();
      for (const candidate of ['youtube', 'instagram', 'chrome', 'spotify', 'maps', 'whatsapp', 'settings']) {
        if (appLower.includes(candidate)) {
          this.lastOpenedApp = candidate;
          break;
        }
      }
    }

    // Web Sandbox honest execution path:
    // On Android Chrome, Settings can be opened via intent:// android.settings.*, while desktop cannot
    if (tool === 'open_app' && String(args.appName || '').toLowerCase().includes('setting')) {
      const isAndroidUa = typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent);
      const intentUri = resolveAndroidSettingsIntent(args.targetScreen);
      const settingsAction: DeviceAction = {
        id: `auto_settings_${Date.now()}`,
        type: 'open_url',
        title: args.targetScreen ? `Open Settings (${args.targetScreen})` : 'Open Android Settings',
        appName: 'Android Settings',
        appUrl: intentUri,
        webUrl: intentUri,
        androidPackage: 'com.android.settings',
      };

      if (isAndroidUa) {
        const launchRes = await executeDeviceAction(settingsAction, true);
        return {
          success: true,
          message: `${launchRes.message} Note: changing toggles inside Settings requires Android Accessibility permission.`,
          launchAction: settingsAction,
          popupBlocked: launchRes.popupBlocked,
        };
      }

      return {
        success: false,
        unsupportedInWebSandbox: true,
        message: 'Android Settings requires an Android phone + Accessibility Permission',
        error:
          'Desktop browsers cannot open Android system Settings. Open ULTRON on Android and grant Accessibility Permission to control Settings automatically.',
      };
    }

    const mappedAction = mapToolToDeviceAction(tool, args, this.lastOpenedApp);
    if (mappedAction) {
      const launchRes = await executeDeviceAction(mappedAction, true);
      return {
        success: launchRes.success,
        message: launchRes.popupBlocked
          ? `Prepared ${mappedAction.appName || mappedAction.title}: ${mappedAction.webUrl} (browser blocked auto-popup — tap Open).`
          : `${launchRes.message} (${mappedAction.webUrl})`,
        launchAction: mappedAction,
        popupBlocked: launchRes.popupBlocked,
      };
    }

    // Native UI gestures (tap_element, enter_text, scroll_screen) cannot control external apps in browser JS
    return {
      success: false,
      unsupportedInWebSandbox: true,
      message: `${tool} requires Android Accessibility Permission`,
      error: `Browser JavaScript cannot perform "${tool}" inside external apps without Accessibility Service. Grant Accessibility Permission via ULTRON Companion APK to enable taps & typing.`,
    };
  }

  async stopBridge(): Promise<void> {
    if (!this.lastKnownBridgeReachable) return;
    const baseUrl = normalizeBridgeBaseUrl(this.config.bridgeUrl);
    try {
      await fetch(`${baseUrl}/stop`, {
        method: 'POST',
        headers: buildHeaders(this.config),
      });
    } catch {
      // best effort
    }
  }
}
