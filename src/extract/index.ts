import type { MemoryUnit, ExtractCandidate } from '../shared/types.js';

/**
 * Extract memory candidates from conversation text.
 *
 * Mode 1 (rule): keyword + pattern matching — zero cost, always available.
 * Mode 2 (LLM): optional refinement via external model — higher quality.
 */
export class ExtractEngine {
  private config: { enabled: boolean; model?: string; autoActivateThreshold?: number };

  constructor(config?: { enabled?: boolean; model?: string; autoActivateThreshold?: number }) {
    this.config = {
      enabled: config?.enabled ?? false,
      model: config?.model,
      autoActivateThreshold: config?.autoActivateThreshold ?? 0.8,
    };
  }

  /**
   * Extract memory candidates from conversation text.
   * Returns { raw, refined } — raw from rule engine, refined if LLM enabled.
   */
  extract(conversationText: string): { raw: ExtractCandidate[]; refined?: ExtractCandidate[] } {
    const raw = this.ruleExtract(conversationText);
    return { raw };
  }

  /**
   * Rule-based extraction: keyword + sentence pattern matching.
   */
  private ruleExtract(text: string): ExtractCandidate[] {
    const candidates: ExtractCandidate[] = [];
    const sentences = splitSentences(text);

    for (const sentence of sentences) {
      const s = sentence.trim();
      if (s.length < 10) continue;

      const lower = s.toLowerCase();

      // Decision patterns
      if (DECISION_PATTERNS.some((p) => p.test(lower))) {
        candidates.push({
          type: 'insight',
          summary: s.slice(0, 80),
          narrative: s,
          keywords: extractKeywordsFrom(s),
          confidence: 0.6,
          sourceText: s,
        });
        continue;
      }

      // Preference patterns
      if (PREFERENCE_PATTERNS.some((p) => p.test(lower))) {
        candidates.push({
          type: 'preference',
          summary: s.slice(0, 80),
          narrative: s,
          keywords: extractKeywordsFrom(s),
          confidence: 0.55,
          sourceText: s,
        });
        continue;
      }

      // Event patterns
      if (EVENT_PATTERNS.some((p) => p.test(lower))) {
        candidates.push({
          type: 'event',
          summary: s.slice(0, 80),
          narrative: s,
          keywords: extractKeywordsFrom(s),
          confidence: 0.5,
          sourceText: s,
        });
        continue;
      }

      // Fact patterns (technical/architecture keywords)
      if (FACT_PATTERNS.some((p) => p.test(lower))) {
        candidates.push({
          type: 'fact',
          summary: s.slice(0, 80),
          narrative: s,
          keywords: extractKeywordsFrom(s),
          confidence: 0.45,
          sourceText: s,
        });
      }
    }

    // Deduplicate by summary similarity
    return deduplicate(candidates);
  }

  /**
   * Build refinement prompt for LLM.
   * Returns null if nothing worth refining.
   */
  buildRefinementPrompt(candidates: ExtractCandidate[]): string | null {
    if (candidates.length === 0) return null;

    const items = candidates
      .map(
        (c, i) =>
          `${i + 1}. [${c.type}] ${c.summary}\n   Text: ${c.sourceText}`,
      )
      .join('\n');

    return `Extract memory units from the following conversation. For each item, refine the type (fact/insight/event/preference), summary, and keywords. Return JSON array:

${items}

Output JSON format:
[{"type": "fact|insight|event|preference", "summary": "...", "narrative": "...", "keywords": ["..."], "confidence": 0.0-1.0}]`;
  }

  /**
   * Convert candidates to MemoryUnit format for storage.
   */
  toMemoryUnit(
    candidate: ExtractCandidate,
    domain: string,
    status: 'candidate' | 'active' = 'candidate',
  ): MemoryUnit {
    const isActive = candidate.confidence >= (this.config.autoActivateThreshold ?? 0.8);
    const id = `extract_${candidate.type}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

    return {
      id,
      type: candidate.type,
      domain,
      summary: candidate.summary,
      narrative: candidate.narrative,
      keywords: candidate.keywords,
      signatures: [],
      associations: [],
      meta: {
        created: new Date().toISOString(),
        updated: new Date().toISOString(),
        confidence: candidate.confidence,
        usage_count: 0,
        status: isActive && status === 'candidate' ? 'active' : status,
      },
      provenance: {
        createdBy: 'ai:extract',
        basedOnTask: `Auto-extracted from conversation`,
        timestamp: new Date().toISOString(),
      },
    };
  }
}

// ===== Rule patterns =====

const DECISION_PATTERNS = [
  /\b(decided|chose|selected|picked|决定|选择)\b/i,
  /\b(over|instead of|rather than|代替|而不是)\b/i,
  /\b(因为|because|reason|rationale)\b/i,
  /我们\s*\S*\s*[选决定]/,
  /why\s+\w+\s+(is|was|does|did)/i,
];

const PREFERENCE_PATTERNS = [
  /always\s+(use|do|check|prefer)/i,
  /never\s+(use|do|allow|forget)/i,
  /prefer\s+\w+(\s+over)?/i,
  /应该\s*(用|使用|避免|注意)/,
  /必须\s*(用|使用|避免|注意)/,
  /(规范|约定|习惯)\s*[是：:]/,
  /从今以后/,
  /以后\s*都/,
];

const EVENT_PATTERNS = [
  /(发布了|上线|updated|deployed|released|published)/i,
  /(创建了|added|created|新增)/i,
  /(修复了|fixed|resolved|解决了)/i,
  /(PR|pull request)\s*#?\d+/i,
  /\b(合并|merged|approved)\b/i,
  /(今天|昨天|上周|这周|本月)/,
  /(完成|做完|搞定了)/,
];

const FACT_PATTERNS = [
  /\b(架构|architecture|design|tech stack)\b/i,
  /\b(uses|using|基于|采用)\s+/i,
  /\b(consists of|composed of|由.*组成)\b/i,
  /\b(API|endpoint|接口|config|配置)\b/i,
  /\b(database|数据库|cache|缓存)\b.*(is|use|用|是)/i,
  /\b\d+\s*[xv]\d+/i, // version numbers like "v2.0"
];

// ===== Helpers =====

function splitSentences(text: string): string[] {
  return text
    .split(/[。！？\n.!?]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function extractKeywordsFrom(text: string): string[] {
  const words = text
    .toLowerCase()
    .split(/\W+/)
    .filter((w) => w.length > 2)
    .filter((w) => !STOP_WORDS.has(w));

  const freq: Record<string, number> = {};
  for (const w of words) freq[w] = (freq[w] || 0) + 1;

  return Object.entries(freq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([w]) => w);
}

function deduplicate(candidates: ExtractCandidate[]): ExtractCandidate[] {
  const seen = new Set<string>();
  return candidates.filter((c) => {
    const key = c.summary.slice(0, 40).toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

const STOP_WORDS = new Set([
  'the', 'and', 'for', 'with', 'that', 'this', 'from', 'have',
  'not', 'are', 'but', 'was', 'has', 'been', 'can', 'all',
  'will', 'would', 'should', 'about', 'when', 'where',
  'which', 'what', 'their', 'they', 'there', 'here',
  '的', '了', '是', '在', '我', '不', '有', '人',
  '这', '就', '都', '也', '个', '和', '你', '他',
  '那', '要', '会', '着', '没', '到', '说', '去',
]);
