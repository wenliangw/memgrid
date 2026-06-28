import type { MemoryUnit, MemoryUnitType } from '../shared/types.js';

/**
 * Natural language memory parser.
 *
 * Converts free-form human or Claude descriptions into structured memory units.
 * Parses patterns like:
 * - "multer fileFilter returned 500 instead of 400" → error_solution
 * - "We chose PostgreSQL over MongoDB because..." → decision
 * - "Always use ResponseBuilder instead of raw JSON" → pattern/style_preference
 */

export interface ParsedMemory {
  type: MemoryUnitType;
  summary: string;
  content: {
    description: string;
    trigger?: string;
    action?: string;
    inputs?: string;
    outputs?: string;
  };
  signatures: string[];
  confidence: number;
}

/**
 * Parse a natural language description into a structured memory suggestion.
 */
export function parseMemoryInput(input: string, _sourceFile?: string): ParsedMemory {
  const lower = input.toLowerCase().trim();

  // Detect error_solution: error/fix/bug/OOM/crash keywords
  const errorKeywords = [
    'error',
    '错误',
    'fix',
    '修复',
    'bug',
    'oom',
    'crash',
    '500',
    '400',
    'exception',
    'throw',
    'return false',
    'returned false',
    "doesn't work",
    'not working',
    '不对',
    '报错',
    '失败',
  ];
  const isError = errorKeywords.some((k) => lower.includes(k));

  // Detect decision: chose/picked/decided/selected
  const decisionKeywords = [
    'chose',
    'chosen',
    'picked',
    'decided',
    'selected',
    '选择',
    '决定',
    'why',
    '为什么',
    'because',
    '因为',
    'over',
    'instead of',
    '代替',
  ];
  const isDecision = decisionKeywords.some((k) => lower.includes(k));

  // Detect style/pattern: always/never/prefer/pattern/use
  const styleKeywords = [
    'always',
    'never',
    'prefer',
    'pattern',
    'convention',
    'use',
    'should',
    '规范',
    '模式',
    '应当',
    '必须',
    'always use',
    'should be',
  ];
  const isStyle = styleKeywords.some((k) => lower.includes(k));

  // Determine primary type
  let type: MemoryUnitType;
  if (isError) {
    type = 'error_solution';
  } else if (isDecision) {
    type = 'decision';
  } else if (isStyle) {
    type = 'style_preference';
  } else {
    type = 'pattern';
  }

  // Extract component/library names from the input
  const signatures = extractSignatures(input);

  // Build content
  const content: ParsedMemory['content'] = {
    description: input,
  };

  if (isError) {
    // Try to extract: what broke, context, and fix
    const problemPart = extractProblemPart(input);
    const fixPart = extractFixPart(input);
    const contextPart = extractContextPart(input);

    content.trigger = contextPart || 'When this error occurs';
    content.action = fixPart || 'Review the fix described above';
    content.description = fixPart ? `${problemPart}. Fix: ${fixPart}` : `Error: ${problemPart}`;
  }

  if (isDecision) {
    content.description = extractDecisionSummary(input);
  }

  return {
    type,
    summary: input.slice(0, 80),
    content,
    signatures,
    confidence: isError ? 0.7 : 0.5,
  };
}

/**
 * Create a MemoryUnit from parsed input.
 */
export function createMemoryUnit(parsed: ParsedMemory, _sourceFile?: string): MemoryUnit {
  const id = `auto_${parsed.type}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

  return {
    id,
    type: parsed.type,
    summary: parsed.summary,
    source: _sourceFile ? { file: _sourceFile } : undefined,
    signatures: parsed.signatures,
    content: parsed.content,
    associations: [],
    meta: {
      created: new Date().toISOString(),
      updated: new Date().toISOString(),
      confidence: parsed.confidence,
      usage_count: 0,
      status: 'active',
    },
  };
}

// ===== Extraction helpers =====

/**
 * Extract technology/library names as search signatures.
 */
function extractSignatures(input: string): string[] {
  const sigs: string[] = [];

  // Common library patterns
  const patterns = [
    /\b(multer|express|nestjs|typeorm|chakra|react|next\.?js|axios|redis|postgres|docker)\b/gi,
    /\b(\w+Exception|ErrorCode\.\w+)\b/g,
    /\b(\w+Service|\w+Controller|\w+Module|\w+Guard)\b/g,
    /\b(\.\w+\(\))\b/g,
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(input)) !== null) {
      const name = match[1].toLowerCase();
      if (!sigs.includes(name)) sigs.push(name);
    }
  }

  return sigs.slice(0, 5);
}

/**
 * Extract the "what broke" part.
 */
function extractProblemPart(input: string): string {
  // Look for patterns: "X returned Y instead of Z", "X doesn't work", "X 报错"
  const returnMatch = input.match(
    /(.+?)\s+(returned|return|returns|gives|threw?|throw)\s+(.+?)(\s+(instead of|,|\.|but|$))/i,
  );
  if (returnMatch) {
    return `${returnMatch[1]} ${returnMatch[2]} ${returnMatch[3]}`.trim();
  }

  const errorMatch = input.match(/(.+?)(报错|失败|不对|doesn't work|not working|error|broken)/i);
  if (errorMatch) {
    return `${errorMatch[1]} failed/error`.trim();
  }

  // Default: take first sentence
  const firstSentence = input.split(/[.。]/)[0].trim();
  return firstSentence || input.slice(0, 60);
}

/**
 * Extract the fix/solution part.
 */
function extractFixPart(input: string): string {
  // Look for: "need to X", "should X", "set X", "use X instead"
  const fixPatterns = [
    /need(?:ed)?\s+to\s+(.+?)(?:\.|$)/i,
    /should\s+(.+?)(?:\.|$)/i,
    /must\s+(.+?)(?:\.|$)/i,
    /solution:?\s+(.+?)(?:\.|$)/i,
    /fix:?\s+(.+?)(?:\.|$)/i,
    /\bset\s+(.+?)(?:\.|$)/i,
    /办法[：:]?\s*(.+?)(?:[。.]|$)/,
    /解决[：:]?\s*(.+?)(?:[。.]|$)/,
  ];

  for (const pattern of fixPatterns) {
    const match = input.match(pattern);
    if (match) return match[1].trim();
  }

  return '';
}

/**
 * Extract context: when/where does this happen.
 */
function extractContextPart(input: string): string {
  const contextPatterns = [
    /when\s+(.+?)(?:,|\.|$)/i,
    /当\s*(.+?)(?:时[,，。.]|$)/,
    /(?:在用|使用|调用)\s*(\S+)\s*(?:时|的时候)/,
  ];

  for (const pattern of contextPatterns) {
    const match = input.match(pattern);
    if (match) return match[1].trim();
  }

  return '';
}

/**
 * Extract a concise decision summary.
 */
function extractDecisionSummary(input: string): string {
  // "chose X over Y because Z"
  const choseMatch = input.match(
    /(?:chose|chosen|picked|decided|选择|决定)\s+(.+?)\s+(?:over|instead of|代替|而不是)\s+(.+?)(?:\s+because|因为|$)/i,
  );
  if (choseMatch) {
    return `Chose ${choseMatch[1]} instead of ${choseMatch[2]}: ${input}`;
  }

  return `Decision: ${input.slice(0, 100)}`;
}
