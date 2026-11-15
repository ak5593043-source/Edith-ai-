export type CodingTaskType =
  | 'dsa'
  | 'debug'
  | 'architecture'
  | 'fullstack'
  | 'sql'
  | 'general'
  | 'none';

export interface CodingTaskAnalysis {
  isCoding: boolean;
  isHardCoding: boolean;
  taskType: CodingTaskType;
  languageHints: string[];
  recommendedTemperature: number;
}

const LANGUAGE_PATTERNS: Array<{ name: string; regex: RegExp }> = [
  { name: 'TypeScript', regex: /\b(typescript|tsx?|interface\s+\w+|type\s+\w+\s*=|generics?)\b/i },
  { name: 'JavaScript', regex: /\b(javascript|jsx?|node\.?js|express|react|next\.?js|vue|svelte|async\/await|promise)\b/i },
  { name: 'Python', regex: /\b(python|py|fastapi|django|flask|pandas|numpy|pytorch|asyncio|def\s+\w+)\b/i },
  { name: 'C++', regex: /\b(c\+\+|cpp|std::|vector<|unordered_map|pointer|segmentation fault|cmake)\b/i },
  { name: 'Java', regex: /\b(java|spring\s*boot|jvm|hashmap|arraylist|public\s+static\s+void)\b/i },
  { name: 'Rust', regex: /\b(rust|cargo|tokio|borrow checker|impl\s+\w+|Result<|Option<)\b/i },
  { name: 'Go', regex: /\b(golang|goroutine|channel|gin|go\s+func)\b/i },
  { name: 'SQL', regex: /\b(sql|postgres|postgresql|mysql|sqlite|select\s+.+\s+from|join|window function|cte|index)\b/i },
  { name: 'HTML/CSS', regex: /\b(html|css|tailwind|flexbox|grid|responsive)\b/i },
];

const GENERAL_CODING_REGEX =
  /```|\b(code|coding|program|programming|script|function|class|method|api|endpoint|bug|debug|error|exception|stack\s*trace|traceback|syntax|compile|typescript|javascript|python|java|cpp|c\+\+|rust|golang|react|node|express|sql|database|query|regex|docker|kubernetes|git|html|css|tailwind|coad|coading|program banao|code likho|code do|app banao|website banao)\b/i;

const HARD_DSA_REGEX =
  /\b(algorithm|dsa|dynamic\s*programming|dp\b|memoization|tabulation|dijkstra|bellman|floyd|kruskal|prim|topological\s*sort|union[\s-]*find|disjoint\s*set|segment\s*tree|fenwick|trie|red[\s-]*black|avl|b[\s-]*tree|lru\s*cache|lfu\s*cache|backtracking|n[\s-]*queens|sudoku|knapsack|sliding\s*window|two\s*pointers|binary\s*search|monotonic\s*stack|heap|priority\s*queue|graph\s*traversal|bfs|dfs|cycle\s*detection|shortest\s*path|time\s*complexity|o\(1\)|o\(log\s*n\)|leetcode|codeforces|competitive\s*programming)\b/i;

const HARD_ARCH_REGEX =
  /\b(system\s*design|architecture|microservice|distributed|concurrency|concurrent|multithread|mutex|semaphore|deadlock|race\s*condition|thread[\s-]*safe|rate\s*limiter|token\s*bucket|websocket|real[\s-]*time|authentication|oauth|jwt|rbac|encryption|hashing|crdt|compiler|parser|ast|interpreter|state\s*machine|production[\s-]*ready|full[\s-]*stack|multi[\s-]*file|refactor|optimize|memory\s*leak|performance\s*bottleneck|hard\s*coding|hard\s*coading|complex\s*code)\b/i;

const DEBUG_REGEX =
  /\b(bug|debug|fix\s+(this|the|my)?\s*(code|error|issue|app)|stack\s*trace|traceback|TypeError|ReferenceError|SyntaxError|NullPointer|undefined\s+is\s+not|cannot\s+read\s+propert|crash|failing\s+test|edge\s*case|why\s+is\s+(this|it)\s+failing|kam\s+nahi\s+kar\s+raha|error\s+aa\s+raha)\b/i;

const SQL_REGEX =
  /\b(sql|postgres|postgresql|mysql|cte|window\s*function|recursive\s+query|deadlock|query\s*plan|n\+1|schema\s*design|migration|transaction\s*isolation)\b/i;

/**
 * Analyzes user conversation messages to detect coding & hard-engineering queries
 * so EDITH automatically routes to strong models and strict software-engineering mandates.
 */
export function analyzeCodingTask(
  messages: Array<{ role?: string; content?: string }>
): CodingTaskAnalysis {
  const userMessages = messages.filter((m) => m.role === 'user' && typeof m.content === 'string');
  const lastUserText = (userMessages[userMessages.length - 1]?.content || '').trim();
  const recentCombined = userMessages
    .slice(-3)
    .map((m) => m.content || '')
    .join('\n');

  const languageHints = LANGUAGE_PATTERNS.filter((p) => p.regex.test(recentCombined)).map(
    (p) => p.name
  );

  const hasCodeFence = /```[\s\S]*?```/.test(lastUserText) || /```/.test(lastUserText);
  const hasCodeSymbols =
    /(const |let |var |function |def |class |import |export |=>|async |SELECT |CREATE TABLE)/.test(
      lastUserText
    );

  const isCoding =
    hasCodeFence ||
    hasCodeSymbols ||
    GENERAL_CODING_REGEX.test(lastUserText) ||
    HARD_DSA_REGEX.test(lastUserText) ||
    HARD_ARCH_REGEX.test(lastUserText) ||
    (languageHints.length > 0 && lastUserText.length > 15);

  if (!isCoding) {
    return {
      isCoding: false,
      isHardCoding: false,
      taskType: 'none',
      languageHints: [],
      recommendedTemperature: 0.7,
    };
  }

  let taskType: CodingTaskType = 'general';
  if (HARD_DSA_REGEX.test(lastUserText)) taskType = 'dsa';
  else if (DEBUG_REGEX.test(lastUserText)) taskType = 'debug';
  else if (SQL_REGEX.test(lastUserText)) taskType = 'sql';
  else if (HARD_ARCH_REGEX.test(lastUserText)) taskType = 'architecture';
  else if (/\b(full[\s-]*stack|backend|frontend|react|express|crud|schema|app)\b/i.test(lastUserText))
    taskType = 'fullstack';

  const isHardCoding =
    taskType === 'dsa' ||
    taskType === 'architecture' ||
    taskType === 'fullstack' ||
    taskType === 'sql' ||
    (taskType === 'debug' && (hasCodeFence || lastUserText.length > 80)) ||
    hasCodeFence ||
    lastUserText.length >= 130 ||
    languageHints.length >= 2;

  return {
    isCoding: true,
    isHardCoding,
    taskType,
    languageHints,
    recommendedTemperature: isHardCoding ? 0.25 : 0.35,
  };
}

export const CODING_MODEL_PRIORITY = [
  'openai/gpt-oss-120b',
  'llama-3.3-70b-versatile',
  'deepseek-r1-distill-llama-70b',
  'qwen/qwen3-32b',
  'llama3-70b-8192',
];

/**
 * Selects the strongest model for coding prompts, upgrading weak 8B defaults automatically.
 */
export function selectCodingPreferredModel(
  requestedModel: string | undefined,
  analysis: CodingTaskAnalysis
): string {
  const clean = (requestedModel || '').trim();

  if (clean === 'gemini-4-hydrogen') {
    return 'gemini-4-hydrogen';
  }

  if (analysis.isHardCoding) {
    // Never downgrade hard coding to lightweight 8B models
    if (!clean || clean === 'llama-3.1-8b-instant' || clean === 'llama3-8b-8192') {
      return 'openai/gpt-oss-120b';
    }
    return clean;
  }

  if (analysis.isCoding) {
    if (!clean || clean === 'llama-3.1-8b-instant' || clean === 'llama3-8b-8192') {
      return 'llama-3.3-70b-versatile';
    }
    return clean;
  }

  return clean || 'llama-3.3-70b-versatile';
}

/**
 * Builds strict Senior Principal Engineer system instructions so code output is complete,
 * optimal, type-safe, edge-case proof, and free of placeholder stubs.
 */
export function buildHardCodingSystemMandate(analysis: CodingTaskAnalysis): string {
  if (!analysis.isCoding) return '';

  const langLine =
    analysis.languageHints.length > 0
      ? `Target stack / languages detected: ${analysis.languageHints.join(', ')}.`
      : 'Use the exact language/framework requested or best-fit typed industry standard.';

  const focusByType: Record<CodingTaskType, string> = {
    dsa: 'Provide optimal algorithm selection first, explicit Time Complexity O(...) & Space Complexity O(...), boundary edge-case handling (empty, single-item, duplicates, negative/overflow, cycles), and complete clean runnable code.',
    debug:
      'Diagnose the EXACT root cause before writing code (race condition, off-by-one, stale closure, null dereference, async error, etc.), then provide the full corrected code and explain what changed and why.',
    architecture:
      'Design cleanly with separation of concerns, concurrency/race safety, proper error boundaries, resource cleanup, strict types/validation, and production-grade modular files.',
    fullstack:
      'Provide complete end-to-end working modules (schema/types, validated backend handler, frontend state/fetch wiring, proper HTTP error codes, zero mocked shortcuts).',
    sql: 'Write injection-safe parameterized queries, proper indexes/constraints, transaction safety, CTE/window logic where optimal, and note performance considerations.',
    general: 'Write clean, well-typed, directly runnable code with clear structure and brief explanation.',
    none: '',
  };

  return `
SENIOR PRINCIPAL SOFTWARE ENGINEER CODING MANDATE (CRITICAL):
- ${langLine}
- Focus (${analysis.taskType.toUpperCase()}): ${focusByType[analysis.taskType]}
- ZERO PLACEHOLDERS RULE: NEVER write "// TODO", "// implement here", "...rest of code...", or stubbed functions. Every helper, import, type, and error handler referenced MUST be completely written out so the code compiles and runs directly.
- EDGE CASES & ROBUSTNESS: Validate null/undefined, empty collections, invalid inputs, async rejections, division by zero, and resource cleanup.
- CLEAN STRUCTURE: Put each file or module in a clearly labeled fenced code block (e.g. \`\`\`typescript, \`\`\`python, \`\`\`cpp, \`\`\`sql) with filename headers when multi-file.
- If the user asks in Hindi or Hinglish, explain the logic clearly in simple Hindi/Hinglish while keeping code comments and identifiers crisp English.`;
}
