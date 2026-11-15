import { DeviceAction, DeviceActionType } from '../types/chat.ts';

export function buildAndroidIntentUrl(
  packageName: string,
  webUrl: string,
  scheme = 'https',
  schemePath?: string
): string {
  try {
    const parsed = new URL(webUrl);
    const pathAndQuery = schemePath ?? `${parsed.host}${parsed.pathname}${parsed.search}`;
    const encodedFallback = encodeURIComponent(webUrl);
    return `intent://${pathAndQuery}#Intent;scheme=${scheme};package=${packageName};S.browser_fallback_url=${encodedFallback};end`;
  } catch {
    return webUrl;
  }
}

export const KNOWN_ANDROID_PACKAGES: Record<string, string> = {
  instagram_reels: 'com.instagram.android',
  instagram_message: 'com.instagram.android',
  instagram_open: 'com.instagram.android',
  whatsapp_message: 'com.whatsapp',
  youtube_search: 'com.google.android.youtube',
  spotify_play: 'com.spotify.music',
  maps_search: 'com.google.android.apps.maps',
  telegram_open: 'org.telegram.messenger',
  snapchat_open: 'com.snapchat.android',
  facebook_open: 'com.facebook.katana',
  chrome_search: 'com.android.chrome',
};

const DIRECT_SCHEME_TYPES = new Set<DeviceActionType>(['call_phone', 'sms_message', 'email_compose']);

/**
 * Balanced-brace scanner to find ALL [ACTION:{...}] tags without truncating on nested JSON braces.
 */
function findAllBalancedActionTags(text: string): Array<{ fullMatch: string; jsonStr: string }> {
  const results: Array<{ fullMatch: string; jsonStr: string }> = [];
  let cursor = 0;

  while (cursor < text.length) {
    const slice = text.slice(cursor);
    const startMatch = /\[ACTION:\s*\{/i.exec(slice);
    if (!startMatch) break;

    const tagStart = cursor + startMatch.index;
    const jsonStart = tagStart + startMatch[0].length - 1;

    let depth = 0;
    let inString = false;
    let escaped = false;
    let closedAt = -1;

    for (let i = jsonStart; i < text.length; i++) {
      const ch = text[i];
      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (ch === '\\') {
          escaped = true;
        } else if (ch === '"') {
          inString = false;
        }
        continue;
      }

      if (ch === '"') {
        inString = true;
      } else if (ch === '{') {
        depth++;
      } else if (ch === '}') {
        depth--;
        if (depth === 0) {
          let endIdx = i + 1;
          while (endIdx < text.length && /\s/.test(text[endIdx])) {
            endIdx++;
          }
          if (text[endIdx] === ']') {
            endIdx++;
          }
          closedAt = endIdx;
          results.push({
            fullMatch: text.slice(tagStart, endIdx),
            jsonStr: text.slice(jsonStart, i + 1),
          });
          break;
        }
      }
    }

    if (closedAt === -1) break;
    cursor = closedAt;
  }

  return results;
}

const LAUNCH_VERB_REGEX =
  /\b(kholo|khol|open|launch|chalao|chalu|play|bajao|bhejo|send|call|dial|phone|karo|start|dikhao|batao|search|navigate|direction|directions|route|rasta|le\s*chalo|dekho|sunao|msg|message|dm|sms|email|mail)\b|खोल|चलाओ|बजाओ|भेजो|दिखाओ|कॉल|मैसेज|रास्ता/i;

/**
 * Splits a multi-step command into ordered clauses while preserving text inside quotation marks
 * and recognizing numbered steps ("1. ...", "2. ...", "Step 3:"), newlines, semicolons, commas,
 * and Hindi/Hinglish/English connectors ("aur", "phir", "then", "and", "uske baad", "next", etc.).
 */
export function splitMultiStepClauses(text: string): string[] {
  if (!text || !text.trim()) return [];

  // Temporarily mask quoted strings so commas/"and" inside a WhatsApp/SMS message aren't split
  const quotedMask: string[] = [];
  const masked = text.replace(/("([^"\\]|\\.)*"|'([^'\\]|\\.)*')/g, (match) => {
    const idx = quotedMask.length;
    quotedMask.push(match);
    return `__EDITH_QUOTE_${idx}__`;
  });

  // Normalize numbered prefixes ("1.", "2)", "Step 1:") and bullet dashes into hard delimiters
  const normalized = masked
    .replace(/\r\n/g, '\n')
    .replace(/(?:^|[\n;])\s*(?:step\s*\d+\s*[:.\-]?|\d+[.)]|[-*•])\s+/gi, '\n')
    .replace(/\s+(?:\d+[.)]|step\s*\d+\s*[:.\-])\s+/gi, '\n');

  const rawClauses = normalized
    .split(
      /\s*(?:\n+|;|,(?!\d)|\baur\b|\bphir\b|\bfir\b|\bthen\b|\band\b|\buske\s+baad\b|\buske\s+bad\b|\bafter\s+that\b|\bnext\b|\balso\b|तथा|और|फिर|उसके\s+बाद|बाद\s+में)\s*/i
    )
    .map((c) => c.trim())
    .filter((c) => c.length > 0);

  return rawClauses.map((clause) =>
    clause.replace(/__EDITH_QUOTE_(\d+)__/g, (_, i) => quotedMask[Number(i)] || '')
  );
}

export function inferSingleClauseAction(
  clause: string,
  indexOffset = 0,
  inheritLaunchVerb = false
): DeviceAction | null {
  const text = clause.trim();
  if (!text) return null;

  const lower = text.toLowerCase();
  const hasLaunchVerb = LAUNCH_VERB_REGEX.test(text);

  if (!hasLaunchVerb && !inheritLaunchVerb) {
    return null;
  }

  const uid = `act_${Date.now()}_${indexOffset}_${Math.random().toString(36).substring(2, 6)}`;

  // 1. Phone Call (tel:)
  if (
    /\b(call|dial|ring)\b/i.test(lower) ||
    /\bphone\s*lagao\b/i.test(lower) ||
    /कॉल/.test(text)
  ) {
    const phoneMatch = text.match(/(?:\+?\d[\d\s-]{6,}\d)/);
    if (phoneMatch) {
      const digits = phoneMatch[0].replace(/[^\d+]/g, '');
      return {
        id: uid,
        type: 'call_phone',
        appName: 'Phone',
        title: `Call ${digits}`,
        target: digits,
        appUrl: `tel:${digits}`,
        webUrl: `tel:${digits}`,
      };
    }
  }

  // 2. SMS Message (sms:)
  if (/\b(sms|text message)\b/i.test(lower)) {
    const phoneMatch = text.match(/(?:\+?\d[\d\s-]{6,}\d)/);
    const digits = phoneMatch ? phoneMatch[0].replace(/[^\d+]/g, '') : '';
    const quotedMsg = text.match(/["']([^"']+)["']/)?.[1]?.trim();
    const msgMatch = text.match(/(?:likh|likho|message|msg|text|body|say|bhejo)\s*[:\-]?\s*["']?([^"']+)["']?$/i);
    const body = quotedMsg || (msgMatch ? msgMatch[1].trim() : '');
    const smsUrl = `sms:${digits}${body ? `?body=${encodeURIComponent(body)}` : ''}`;
    return {
      id: uid,
      type: 'sms_message',
      appName: 'Messages',
      title: digits ? `SMS ${digits}` : 'Open SMS Messages',
      target: digits || undefined,
      message: body || undefined,
      appUrl: smsUrl,
      webUrl: smsUrl,
    };
  }

  // 3. Email Compose (mailto:)
  if (/\b(email|gmail|mail)\b/i.test(lower)) {
    const emailMatch = text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
    const recipient = emailMatch ? emailMatch[0] : '';
    const mailtoUrl = `mailto:${recipient}`;
    return {
      id: uid,
      type: 'email_compose',
      appName: 'Email',
      title: recipient ? `Email ${recipient}` : 'Compose Email',
      target: recipient || undefined,
      appUrl: mailtoUrl,
      webUrl: mailtoUrl,
    };
  }

  // 4. Instagram Reels
  if (lower.includes('reel') || lower.includes('रील')) {
    return {
      id: uid,
      type: 'instagram_reels',
      appName: 'Instagram',
      title: 'Open Instagram Reels',
      appUrl: 'instagram://reels',
      webUrl: 'https://www.instagram.com/reels/',
      androidPackage: 'com.instagram.android',
    };
  }

  // 5. Instagram Message / Open
  if (lower.includes('instagram') || /\binsta\b/i.test(lower)) {
    if (
      lower.includes('message') ||
      lower.includes('dm') ||
      lower.includes('bhejo') ||
      lower.includes('send')
    ) {
      let target = 'jagjit';
      if (!lower.includes('jagjit') && !lower.includes('जगजीत')) {
        const matchName = text.match(/(?:message|dm|send to|ko)\s+@?([a-zA-Z0-9_.]+)/i);
        if (matchName) target = matchName[1];
      }
      return {
        id: uid,
        type: 'instagram_message',
        appName: 'Instagram',
        title: `Message @${target} on Instagram`,
        target,
        message: 'Hello!',
        appUrl: `instagram://user?username=${target.toLowerCase()}`,
        webUrl: `https://ig.me/m/${target.toLowerCase()}`,
        androidPackage: 'com.instagram.android',
      };
    }

    return {
      id: uid,
      type: 'instagram_open',
      appName: 'Instagram',
      title: 'Open Instagram',
      appUrl: 'instagram://app',
      webUrl: 'https://www.instagram.com/',
      androidPackage: 'com.instagram.android',
    };
  }

  // 6. WhatsApp (with phone number & custom message extraction)
  if (lower.includes('whatsapp') || lower.includes('व्हाट्सएप')) {
    const phoneMatch = text.match(/(?:\+?\d[\d\s-]{7,}\d)/);
    const digits = phoneMatch ? phoneMatch[0].replace(/[^\d]/g, '') : '';
    const quotedMsg = text.match(/["']([^"']+)["']/)?.[1]?.trim();
    const colonMsg = text.match(/(?:likh(?:o)?|bol(?:o)?|message|msg|bhejo|send)\s*[:\-]\s*(.+)$/i)?.[1]?.trim();
    const message = quotedMsg || colonMsg || '';
    const encodedMsg = message ? encodeURIComponent(message) : '';
    const waWeb = digits
      ? `https://wa.me/${digits}${encodedMsg ? `?text=${encodedMsg}` : ''}`
      : `https://wa.me/${encodedMsg ? `?text=${encodedMsg}` : ''}`;
    const waApp = digits
      ? `whatsapp://send?phone=${digits}${encodedMsg ? `&text=${encodedMsg}` : ''}`
      : `whatsapp://send${encodedMsg ? `?text=${encodedMsg}` : ''}`;

    return {
      id: uid,
      type: 'whatsapp_message',
      appName: 'WhatsApp',
      title: digits ? `WhatsApp ${digits}` : message ? 'Send WhatsApp Message' : 'Open WhatsApp',
      target: digits || undefined,
      message: message || undefined,
      appUrl: waApp,
      webUrl: waWeb,
      androidPackage: 'com.whatsapp',
    };
  }

  // 7. YouTube
  if (lower.includes('youtube') || lower.includes('यूट्यूब')) {
    const cleanedQuery = text
      .replace(
        /\b(youtube|par|pe|on|in|me|mein|kholo|khol|open|launch|chalao|chalu|play|bajao|karo|search|dekho|sunao|video|videos|song|songs|please|jara|pehle|first)\b|यूट्यूब|खोलो|चलाओ|बजाओ/gi,
        ' '
      )
      .replace(/\s+/g, ' ')
      .trim();
    const encoded = encodeURIComponent(cleanedQuery);
    const webUrl = cleanedQuery
      ? `https://www.youtube.com/results?search_query=${encoded}`
      : 'https://www.youtube.com/';
    return {
      id: uid,
      type: 'youtube_search',
      appName: 'YouTube',
      title: cleanedQuery ? `YouTube: ${cleanedQuery}` : 'Open YouTube',
      target: cleanedQuery || undefined,
      appUrl: cleanedQuery ? `vnd.youtube://results?search_query=${encoded}` : 'vnd.youtube://',
      webUrl,
      androidPackage: 'com.google.android.youtube',
    };
  }

  // 8. Spotify
  if (lower.includes('spotify') || lower.includes('स्पॉटिफाई')) {
    const cleanedQuery = text
      .replace(
        /\b(spotify|par|pe|on|in|me|kholo|khol|open|chalao|play|bajao|karo|song|songs|music|sunao)\b|स्पॉटिफाई|खोलो|चलाओ|बजाओ/gi,
        ' '
      )
      .replace(/\s+/g, ' ')
      .trim();
    const encoded = encodeURIComponent(cleanedQuery);
    return {
      id: uid,
      type: 'spotify_play',
      appName: 'Spotify',
      title: cleanedQuery ? `Spotify: ${cleanedQuery}` : 'Open Spotify',
      target: cleanedQuery || undefined,
      appUrl: cleanedQuery ? `spotify:search:${encoded}` : 'spotify://',
      webUrl: cleanedQuery ? `https://open.spotify.com/search/${encoded}` : 'https://open.spotify.com/',
      androidPackage: 'com.spotify.music',
    };
  }

  // 9. Google Maps (Search vs Navigation / Directions)
  if (lower.includes('maps') || lower.includes('google map') || lower.includes('rasta') || lower.includes('navigate')) {
    const isDirections = /\b(direction|directions|navigate|navigation|route|rasta|le\s*chalo|chalo|dikhao)\b/i.test(lower);
    const place = text
      .replace(
        /\b(google|maps|map|kholo|open|rasta|dikhao|direction|directions|navigation|navigate|route|le|chalo|par|pe|on|in|me|mein|se|tak|to|ka|ki|ke|for)\b|गूगल|मैप्स|रास्ता/gi,
        ' '
      )
      .replace(/\s+/g, ' ')
      .trim();
    const encoded = encodeURIComponent(place);
    const webUrl = place
      ? isDirections
        ? `https://www.google.com/maps/dir/?api=1&destination=${encoded}`
        : `https://www.google.com/maps/search/?api=1&query=${encoded}`
      : 'https://www.google.com/maps';

    return {
      id: uid,
      type: 'maps_search',
      appName: 'Google Maps',
      title: place
        ? isDirections
          ? `Directions: ${place}`
          : `Maps: ${place}`
        : 'Open Google Maps',
      target: place || undefined,
      appUrl: place
        ? isDirections
          ? `google.navigation:q=${encoded}`
          : `geo:0,0?q=${encoded}`
        : 'geo:0,0',
      webUrl,
      androidPackage: 'com.google.android.apps.maps',
    };
  }

  // 10. Telegram / Snapchat / Facebook / Chrome
  if (lower.includes('telegram') || lower.includes('टेलीग्राम')) {
    return {
      id: uid,
      type: 'telegram_open',
      appName: 'Telegram',
      title: 'Open Telegram',
      appUrl: 'tg://resolve',
      webUrl: 'https://t.me/',
      androidPackage: 'org.telegram.messenger',
    };
  }

  if (lower.includes('snapchat') || lower.includes('स्नैपचैट')) {
    return {
      id: uid,
      type: 'snapchat_open',
      appName: 'Snapchat',
      title: 'Open Snapchat',
      appUrl: 'snapchat://',
      webUrl: 'https://web.snapchat.com/',
      androidPackage: 'com.snapchat.android',
    };
  }

  if (lower.includes('facebook') || lower.includes('फेसबुक')) {
    return {
      id: uid,
      type: 'facebook_open',
      appName: 'Facebook',
      title: 'Open Facebook',
      appUrl: 'fb://feed',
      webUrl: 'https://www.facebook.com/',
      androidPackage: 'com.facebook.katana',
    };
  }

  if (lower.includes('chrome') || lower.includes('browser') || /\bgoogle\s+par\s+search\b/i.test(lower)) {
    const query = text
      .replace(/\b(chrome|browser|google|par|pe|on|kholo|open|search|karo|find)\b/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    const encoded = encodeURIComponent(query);
    const webUrl = query ? `https://www.google.com/search?q=${encoded}` : 'https://www.google.com/';
    return {
      id: uid,
      type: 'chrome_search',
      appName: 'Chrome',
      title: query ? `Search: ${query}` : 'Open Chrome',
      target: query || undefined,
      appUrl: webUrl,
      webUrl,
      androidPackage: 'com.android.chrome',
    };
  }

  return null;
}

/**
 * Parses ALL [ACTION:{...}] blocks from message text or infers unlimited multi-step mobile app launch
 * pipelines from Hindi/Hinglish/English commands (3, 5, 10+ steps supported cleanly with verb inheritance).
 */
export function extractDeviceActions(
  text: string,
  allowHeuristic = true
): { cleanText: string; actions: DeviceAction[] } {
  if (!text) return { cleanText: '', actions: [] };

  const tags = findAllBalancedActionTags(text);
  const actions: DeviceAction[] = [];
  let cleanText = text;

  for (let idx = 0; idx < tags.length; idx++) {
    const tag = tags[idx];
    cleanText = cleanText.replace(tag.fullMatch, '').trim();
    try {
      const parsed = JSON.parse(tag.jsonStr);
      const actionType: DeviceActionType = parsed.type || 'open_url';
      actions.push({
        id: `act_${Date.now()}_${idx}_${Math.random().toString(36).substring(2, 6)}`,
        type: actionType,
        title: parsed.title || 'Open App',
        appName: parsed.appName || parsed.title || 'App',
        target: parsed.target,
        message: parsed.message,
        appUrl: parsed.appUrl || parsed.url || parsed.webUrl || 'https://www.google.com',
        webUrl: parsed.webUrl || parsed.url || 'https://www.google.com',
        androidPackage: parsed.androidPackage || KNOWN_ANDROID_PACKAGES[actionType],
      });
    } catch (e) {
      console.warn('Failed to parse [ACTION] block:', e);
    }
  }

  // Strip any incomplete trailing [ACTION: fragment cleanly
  cleanText = cleanText.replace(/\s*\[ACTION:\s*\{[\s\S]*$/i, '').trim();

  if (actions.length > 0 || !allowHeuristic) {
    return { cleanText, actions };
  }

  const clauses = splitMultiStepClauses(text);
  const targetClauses = clauses.length > 0 ? clauses : [text];
  const promptHasAnyLaunchVerb = LAUNCH_VERB_REGEX.test(text);
  const seenKeys = new Set<string>();
  let prevHadVerb = false;

  targetClauses.forEach((clause, idx) => {
    const clauseHasVerb = LAUNCH_VERB_REGEX.test(clause);
    const inferred = inferSingleClauseAction(clause, idx, prevHadVerb || promptHasAnyLaunchVerb);
    if (clauseHasVerb) prevHadVerb = true;

    if (inferred) {
      const dedupeKey = `${inferred.type}:${inferred.webUrl}:${inferred.target || ''}`;
      if (!seenKeys.has(dedupeKey)) {
        seenKeys.add(dedupeKey);
        actions.push(inferred);
      }
    }
  });

  // If clause splitting didn't match (e.g. verb was before "and" and app was after), evaluate whole text
  if (actions.length === 0) {
    const whole = inferSingleClauseAction(text, 0, false);
    if (whole) actions.push(whole);
  }

  return { cleanText, actions };
}

/**
 * Backward-compatible single-action accessor returning the first resolved action.
 */
export function extractDeviceAction(
  text: string,
  allowHeuristic = true
): { cleanText: string; action: DeviceAction | null } {
  const { cleanText, actions } = extractDeviceActions(text, allowHeuristic);
  return { cleanText, action: actions[0] || null };
}

/**
 * Executes a mobile app launch cleanly using direct scheme (tel/sms/mailto), Android intent:// URLs
 * on Android, native app scheme + web fallback on iOS, and new-tab launch on desktop.
 */
export async function executeDeviceAction(
  action: DeviceAction,
  fromUserClick = false
): Promise<{ success: boolean; autoNavigated: boolean; popupBlocked?: boolean; message: string }> {
  if (action.message && typeof navigator !== 'undefined' && navigator.clipboard) {
    try {
      await navigator.clipboard.writeText(action.message);
    } catch {
      // ignore clipboard errors when not triggered from direct tap
    }
  }

  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  const isAndroid = /Android/i.test(ua);
  const isIOS = /iPhone|iPad|iPod/i.test(ua);

  // Direct OS handler for tel:, sms:, mailto:
  if (DIRECT_SCHEME_TYPES.has(action.type)) {
    if (fromUserClick || isAndroid || isIOS) {
      try {
        const a = document.createElement('a');
        a.href = action.appUrl || action.webUrl;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        return {
          success: true,
          autoNavigated: true,
          message: `Launching ${action.appName || action.title}...`,
        };
      } catch {
        // fallback below
      }
    }
  }

  if (isAndroid) {
    const isHttpFallback = /^https?:\/\//i.test(action.webUrl);
    const hasExplicitIntent = /^intent:/i.test(action.appUrl || '');
    const targetUrl = hasExplicitIntent
      ? action.appUrl
      : action.androidPackage && isHttpFallback
      ? buildAndroidIntentUrl(action.androidPackage, action.webUrl)
      : action.appUrl || action.webUrl;

    try {
      const a = document.createElement('a');
      a.href = targetUrl;
      a.rel = 'noopener noreferrer';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      return {
        success: true,
        autoNavigated: true,
        message: `Opening ${action.appName || action.title} on Android...`,
      };
    } catch {
      window.location.href = targetUrl;
      return {
        success: true,
        autoNavigated: true,
        message: `Launching ${action.appName || action.title}...`,
      };
    }
  }

  if (isIOS) {
    try {
      window.location.href = action.appUrl || action.webUrl;
      const start = Date.now();
      setTimeout(() => {
        if (document.visibilityState === 'visible' && Date.now() - start < 1600) {
          window.location.href = action.webUrl;
        }
      }, 1100);
      return {
        success: true,
        autoNavigated: true,
        message: `Opening ${action.appName || action.title} on iOS...`,
      };
    } catch {
      // continue to fallback
    }
  }

  // Desktop / fallback (honestly check whether browser allowed popup)
  if (fromUserClick) {
    try {
      const opened = window.open(action.webUrl, '_blank', 'noopener,noreferrer');
      if (opened) {
        return {
          success: true,
          autoNavigated: true,
          popupBlocked: false,
          message: `Opened ${action.appName || action.title}.`,
        };
      }
    } catch {
      // popup blocked
    }
    return {
      success: true,
      autoNavigated: false,
      popupBlocked: true,
      message: `Ready to open ${action.appName || action.title} (popup blocked by browser — tap Open).`,
    };
  }

  return {
    success: true,
    autoNavigated: false,
    message: `Ready to open ${action.appName || action.title}.`,
  };
}
