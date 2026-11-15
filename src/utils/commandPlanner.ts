import {
  DeviceAction,
  DeviceActionType,
  TaskPlan,
  TaskStep,
  TaskStepStatus,
  TaskStepType,
} from '../types/chat.ts';
import {
  KNOWN_ANDROID_PACKAGES,
  inferSingleClauseAction,
  splitMultiStepClauses,
} from './actionDispatcher.ts';

function findBalancedTaskPlanTags(text: string): Array<{ fullMatch: string; jsonStr: string }> {
  const results: Array<{ fullMatch: string; jsonStr: string }> = [];
  let cursor = 0;

  while (cursor < text.length) {
    const slice = text.slice(cursor);
    const startMatch = /\[TASK_PLAN:\s*\{/i.exec(slice);
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

export function stripRawTaskPlanTags(text: string): string {
  if (!text) return '';
  let out = text;
  const tags = findBalancedTaskPlanTags(text);
  for (const t of tags) {
    out = out.replace(t.fullMatch, '').trim();
  }
  out = out.replace(/\s*\[TASK_PLAN:\s*\{[\s\S]*$/i, '').trim();
  return out;
}

function classifyStepType(clause: string, action?: DeviceAction | null): TaskStepType {
  if (action) return 'app';
  const lower = clause.toLowerCase();
  if (/\b(pdf|notes pdf|export pdf|document bana)\b/i.test(lower) || /पीडीएफ/.test(clause)) {
    return 'pdf';
  }
  if (/\b(search|find|dhundo|khojo|google|latest news|weather|price)\b/i.test(lower)) {
    return 'search';
  }
  return 'answer';
}

function normalizeActionPayload(raw: any, index: number): DeviceAction | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const webUrl = raw.webUrl || raw.url || '';
  const appUrl = raw.appUrl || raw.url || webUrl;
  if (!webUrl && !appUrl && !raw.type) return undefined;

  const actionType: DeviceActionType = raw.type || 'open_url';
  return {
    id: `plan_act_${Date.now()}_${index}_${Math.random().toString(36).substring(2, 6)}`,
    type: actionType,
    title: raw.title || raw.appName || 'Run App Action',
    appName: raw.appName || raw.title || 'App',
    target: raw.target,
    message: raw.message,
    appUrl: appUrl || 'https://www.google.com',
    webUrl: webUrl || appUrl || 'https://www.google.com',
    androidPackage: raw.androidPackage || KNOWN_ANDROID_PACKAGES[actionType],
  };
}

/**
 * Splits a raw multi-step user command into ordered TaskSteps with ZERO 2-step limit.
 * Works for 2, 5, 10, 20+ sequential clauses (WhatsApp, YouTube, Instagram, Maps, Spotify, Call, PDF, Search, Answers).
 */
export function parseCommandIntoSteps(command: string): TaskStep[] {
  if (!command || !command.trim()) return [];
  const clauses = splitMultiStepClauses(command);
  const steps: TaskStep[] = [];
  const hasAnyVerb =
    /\b(kholo|khol|open|launch|chalao|play|bajao|bhejo|send|call|dial|karo|start|dikhao|batao|search|navigate|bana|create|write|explain|summarize|likho|banado)\b/i.test(
      command
    );

  clauses.forEach((rawClause, idx) => {
    const clause = rawClause.replace(/^(?:pehle|first|then|phir|fir|uske\s+baad|next|finally)\s+/i, '').trim();
    if (!clause || clause.length < 2) return;

    const inferredAction = inferSingleClauseAction(clause, idx, hasAnyVerb);
    const stepType = classifyStepType(clause, inferredAction);

    // Filter out tiny filler fragments that aren't actionable or informational
    if (!inferredAction && stepType === 'answer' && clause.split(/\s+/).length < 2) {
      return;
    }

    steps.push({
      id: `step_${idx + 1}_${Math.random().toString(36).substring(2, 6)}`,
      order: steps.length + 1,
      title: inferredAction ? inferredAction.title : clause.charAt(0).toUpperCase() + clause.slice(1),
      detail: inferredAction
        ? inferredAction.message
          ? `Message: "${inferredAction.message}"`
          : clause
        : undefined,
      type: stepType,
      status: 'pending',
      action: inferredAction || undefined,
    });
  });

  return steps;
}

/**
 * Extracts a structured [TASK_PLAN:{...}] emitted by ULTRON, and ensures all steps from
 * resolved device actions or a multi-step user prompt are captured without ever stopping at 2 steps.
 */
export function extractTaskPlan(
  assistantText: string,
  userPrompt = '',
  resolvedActions: DeviceAction[] = []
): { cleanText: string; plan: TaskPlan | null } {
  const tags = findBalancedTaskPlanTags(assistantText || '');
  let cleanText = stripRawTaskPlanTags(assistantText || '');

  let parsedPlan: TaskPlan | null = null;
  if (tags.length > 0) {
    // Prefer the last / most complete tag
    for (let tIdx = tags.length - 1; tIdx >= 0; tIdx--) {
      try {
        const raw = JSON.parse(tags[tIdx].jsonStr);
        if (raw && Array.isArray(raw.steps) && raw.steps.length > 0) {
          const steps: TaskStep[] = raw.steps.map((s: any, idx: number) => {
            const normalizedAction = normalizeActionPayload(s.action, idx);
            const stepTitle = String(s.title || s.task || s.name || `Step ${idx + 1}`).trim();
            const stepDetail = s.detail || s.description ? String(s.detail || s.description).trim() : undefined;
            const inferredFallback =
              normalizedAction ||
              inferSingleClauseAction(`${stepTitle} ${stepDetail || ''}`, idx, true) ||
              undefined;
            const rawType = String(s.type || '').toLowerCase();
            const stepType: TaskStepType =
              rawType === 'app' || rawType === 'pdf' || rawType === 'search' || rawType === 'answer' || rawType === 'custom'
                ? (rawType as TaskStepType)
                : inferredFallback
                ? 'app'
                : classifyStepType(`${stepTitle} ${stepDetail || ''}`);

            return {
              id: String(s.id || `step_${idx + 1}`),
              order: idx + 1,
              title: stepTitle,
              detail: stepDetail,
              type: stepType,
              status: s.status === 'completed' ? 'completed' : 'pending',
              action: inferredFallback,
            };
          });

          parsedPlan = {
            id: `plan_${Date.now()}`,
            goal: String(raw.goal || userPrompt.slice(0, 80) || 'Multi-Step Command Plan').trim(),
            steps,
          };
          break;
        }
      } catch {
        // Fallback to heuristic parsing below
      }
    }
  }

  // Synthesize or backfill if user gave >= 2 steps or multiple device actions exist
  const promptSteps = parseCommandIntoSteps(userPrompt);

  if (parsedPlan) {
    // Backfill any missing actions from resolvedActions onto matching app steps
    if (resolvedActions.length > 0) {
      const usedActionIds = new Set<string>();
      const enriched = parsedPlan.steps.map((step) => {
        if (step.action) return step;
        const match = resolvedActions.find(
          (a) =>
            !usedActionIds.has(a.id) &&
            (step.title.toLowerCase().includes((a.appName || '').toLowerCase()) ||
              (a.target && step.title.toLowerCase().includes(a.target.toLowerCase())))
        );
        if (match) {
          usedActionIds.add(match.id);
          return { ...step, type: 'app' as const, action: match };
        }
        return step;
      });
      parsedPlan = { ...parsedPlan, steps: enriched };
    }

    // If user explicitly listed more steps than AI noted (e.g., AI stopped at 2), append missing prompt steps
    if (promptSteps.length > parsedPlan.steps.length) {
      const existingTitles = parsedPlan.steps.map((s) => s.title.toLowerCase());
      const missingSteps = promptSteps.filter((ps) => {
        const key = (ps.action?.appName || ps.title).toLowerCase().slice(0, 18);
        return !existingTitles.some((et) => et.includes(key));
      });
      if (missingSteps.length > 0) {
        const merged = [...parsedPlan.steps, ...missingSteps].map((s, idx) => ({
          ...s,
          order: idx + 1,
        }));
        parsedPlan = { ...parsedPlan, steps: merged };
      }
    }

    return { cleanText, plan: parsedPlan };
  }

  // No explicit [TASK_PLAN] tag — build one automatically when >= 2 steps or >= 2 actions are present
  if (promptSteps.length >= 2 || resolvedActions.length >= 2) {
    const baseSteps: TaskStep[] =
      promptSteps.length >= resolvedActions.length
        ? promptSteps
        : resolvedActions.map((act, idx) => ({
            id: `step_${idx + 1}`,
            order: idx + 1,
            title: act.title,
            detail: act.message ? `Message: "${act.message}"` : act.target ? `Target: ${act.target}` : undefined,
            type: 'app' as const,
            status: 'pending' as const,
            action: act,
          }));

    // Bind resolvedActions (e.g. from AI [ACTION:{...}] tags) onto corresponding promptSteps
    const boundSteps = baseSteps.map((step, idx) => {
      if (step.action) return step;
      const matchingAction = resolvedActions.find(
        (a) =>
          step.title.toLowerCase().includes((a.appName || '').toLowerCase()) ||
          (a.target && step.title.toLowerCase().includes(a.target.toLowerCase()))
      );
      if (matchingAction) {
        return { ...step, type: 'app' as const, action: matchingAction };
      }
      if (step.type === 'answer' && !assistantText.includes('error') && assistantText.trim().length > 20) {
        return { ...step, status: 'completed' as const };
      }
      return { ...step, order: idx + 1 };
    });

    return {
      cleanText,
      plan: {
        id: `plan_${Date.now()}`,
        goal: userPrompt ? userPrompt.slice(0, 90) : 'Multi-Step Command Execution',
        steps: boundSteps.map((s, idx) => ({ ...s, order: idx + 1 })),
      },
    };
  }

  return { cleanText, plan: null };
}

export function markStepStatus(plan: TaskPlan, stepId: string, status: TaskStepStatus): TaskPlan {
  return {
    ...plan,
    steps: plan.steps.map((s) =>
      s.id === stepId
        ? {
            ...s,
            status,
            action: s.action ? { ...s.action, executed: status === 'completed' } : undefined,
          }
        : s
    ),
  };
}

export function getNextPendingStep(plan: TaskPlan): TaskStep | null {
  return plan.steps.find((s) => s.status === 'pending' || s.status === 'running') || null;
}

export function computePlanProgress(plan: TaskPlan): {
  total: number;
  completed: number;
  pending: number;
  percent: number;
} {
  const total = plan.steps.length;
  const completed = plan.steps.filter((s) => s.status === 'completed' || s.status === 'skipped').length;
  const pending = Math.max(0, total - completed);
  const percent = total > 0 ? Math.round((completed / total) * 100) : 0;
  return { total, completed, pending, percent };
}
