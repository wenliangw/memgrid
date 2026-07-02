// === Memory Unit Types ===

/** Cognitive memory types — cross-domain, human-mind oriented */
export type MemoryUnitType = 'fact' | 'insight' | 'event' | 'preference';

/** @deprecated Old code-metaphor types (v0.9-). Still accepted but mapped to new types on write. */
export type LegacyMemoryUnitType =
  | 'method'
  | 'component'
  | 'pattern'
  | 'config'
  | 'error_solution'
  | 'decision'
  | 'skill_trigger'
  | 'mcp_trigger'
  | 'rule_trigger'
  | 'style_preference'
  | 'architecture_principle';

/** Accept both new and legacy types */
export type AnyMemoryUnitType = MemoryUnitType | LegacyMemoryUnitType;

/** Map legacy type → new cognitive type */
export const LEGACY_TYPE_MAP: Record<LegacyMemoryUnitType, MemoryUnitType> = {
  method: 'fact',
  component: 'fact',
  config: 'fact',
  pattern: 'insight',
  error_solution: 'insight',
  decision: 'insight',
  architecture_principle: 'preference',
  style_preference: 'preference',
  rule_trigger: 'preference',
  skill_trigger: 'event',
  mcp_trigger: 'event',
};

export type RelationType =
  | 'caused_by'
  | 'causes'
  | 'related_to'
  | 'references'
  | 'contradicts'
  | 'supersedes'
  | 'embodies'
  | 'paired_with'
  | 'triggers'
  | 'belongs_to'
  // Legacy compat
  | 'calls'
  | 'used_by'
  | 'implements_pattern'
  | 'follows_rule'
  | 'similar_pattern'
  | 'similar_error'
  | 'belongs_to_module';

export interface Association {
  to: string;
  relation: RelationType;
  weight: number; // 0.0 ~ 1.0
}

/** Provenance chain: who created this memory and based on what */
export interface Provenance {
  createdBy: string; // "scanner:typescript" | "ai:claude" | "agent:糖豆" | "user"
  basedOnTask?: string; // task summary that produced this memory
  evidenceUnits?: string[]; // IDs of units used as evidence
  timestamp: string;
}

export type MemoryTier = 'hot' | 'warm' | 'cold' | 'frozen';

/**
 * MemoryUnit — the core memory atom.
 *
 * Structure (for indexing)     | Narrative (for understanding)
 * -----------------------------|------------------------------
 * id, type, domain, keywords   | summary, narrative
 * associations                 |
 * source, code_snippet         |
 */
export interface MemoryUnit {
  id: string;
  type: MemoryUnitType;
  /** Domain this memory belongs to */
  domain?: string;
  /** One-line summary — lightweight index card title */
  summary: string;
  /** Natural language narrative — time, people, events, causality live here */
  narrative?: string;
  /** Source information */
  source?: {
    file?: string;
    lines?: string;
    /** Source type: source code, markdown doc, atom, etc. */
    type?: 'code' | 'markdown' | 'atom' | 'document' | 'library';
  };
  /** Function/method signatures (from code scanning) */
  signatures: string[];
  /** @deprecated Use narrative, keywords, code_snippet directly. Kept for backward compat. */
  content?: {
    description?: string;
    inputs?: string;
    outputs?: string;
    dependencies?: string[];
    code_snippet?: string;
    style_notes?: string;
    trigger?: string;
    action?: string;
  };
  /** Code snippet if applicable */
  code_snippet?: string;
  /** Search keywords — lightweight index for retrieval */
  keywords?: string[];
  /** Reference to a library document for full content */
  library_ref?: string;
  associations: Association[];
  meta: {
    created: string;
    updated: string;
    confidence: number; // 0.0 ~ 1.0
    usage_count: number;
    status: 'active' | 'stale' | 'archived' | 'candidate';
    /** Which storage tier (v0.9+) */
    tier?: MemoryTier;
    /** Last time this memory was accessed via search or touch (v0.9+) */
    lastAccessedAt?: string;
    /** Freshness score: 1.0 (just accessed) → 0.0 (stale). Decays over time, boosted on access. (v0.11+) */
    freshness_score?: number;
  };
  /** Who created this memory and based on what (v0.8+) */
  provenance?: Provenance;
}

// ===== Library Types =====

export interface LibraryUnit {
  id: string;
  title: string;
  content: string; // full text
  source?: {
    file: string; // original file path (for migration)
    type?: 'memory' | 'document' | 'log';
    migratedAt?: string;
  };
  keywords: string[];
  domain: string; // which domain this library doc belongs to
  meta: {
    created: string;
    updated: string;
    size: number; // content length in chars
    usage_count: number;
    status: 'active' | 'archived';
  };
}

// ===== Conflict / Rebalance / Sync types =====

/** A conflict detected between two memory units */
export interface ConflictResult {
  unitA: MemoryUnit;
  unitB: MemoryUnit;
  overlapScore: number;
  hasOpposition: boolean;
}

/** Result of tier rebalancing */
export interface RebalanceResult {
  hot: number;
  warm: number;
  cold: number;
  frozen: number;
  promoted: number;
  demoted: number;
  frozenCount: number;
  thawedCount: number;
}

export type FileSnapshot = Record<string, string>;

export interface MemoryGrid {
  version: string;
  project: string;
  lastScanAt: string;
  stats: {
    totalUnits: number;
    activeUnits: number;
    archivedUnits: number;
    totalAssociations: number;
  };
  edgeIndex: Record<string, Association[]>;
  fileSnapshot?: FileSnapshot;
}

/** Result of a sync operation */
export interface SyncResult {
  changedFiles: string[];
  removedFiles: string[];
  updatedUnits: number;
  staleUnits: number;
  repairedAssociations: number;
  brokenAssociations: number;
  newAssociations: number;
  detectedPatterns: SyncPattern[];
  alerts: SyncAlert[];
  autoLearnedUnits: number;
  candidateUnitsCreated: number;
  elapsedMs: number;
}

export interface SyncPattern {
  type: 'insight' | 'event' | 'fact';
  summary: string;
  file: string;
  confidence: number;
}

export interface SyncAlert {
  level: 'warning' | 'error';
  message: string;
  file: string;
  principle?: string;
}

export interface SyncOptions {
  projectRoot: string;
  includeRules: boolean;
  includeExamples: boolean;
  fuzzyThreshold?: number;
}

export interface SearchResult {
  query: string;
  units: MemoryUnit[];
  totalHops: number;
  elapsedMs: number;
}

export interface ScanOptions {
  projectRoot: string;
  includeRules: boolean;
  includeExamples: boolean;
  force: boolean;
}

export interface SearchOptions {
  maxResults?: number;
  maxHops?: number;
  semanticWeight?: number;
  tiers?: MemoryTier[];
}

export interface FileScanResult {
  file: string;
  units: MemoryUnit[];
  hash: string;
}

// ===== Multi-Domain Types (v0.10+) =====

/**
 * Domain type is now free-form.
 * Only "personality" is treated as built-in.
 * All other domains derive meaning from content, not labels.
 */
export type DomainType = 'personality' | string;

export interface MemoryDomain {
  name: string;
  /** @deprecated Use name/content to determine semantics. Kept for backward compat. */
  type?: DomainType;
  path: string;
  description?: string;
  enabled: boolean;
}

export interface UserGrid {
  version: string;
  user: string;
  createdAt: string;
  domains: MemoryDomain[];
  crossDomainAssociations: CrossDomainAssociation[];
}

export interface CrossDomainAssociation {
  from: { domain: string; unitId: string };
  to: { domain: string; unitId: string };
  relation: string;
  weight: number;
}

// ===== Extract Engine Types (v0.10+) =====

/** Configuration for the extract engine */
export interface ExtractConfig {
  enabled: boolean;
  /** Model to use for LLM refinement. Uses agent's model if not set. */
  model?: string;
  /** Minimum confidence to auto-activate (skip candidate review) */
  autoActivateThreshold?: number;
}

/** A raw candidate extracted from conversation */
export interface ExtractCandidate {
  type: MemoryUnitType;
  summary: string;
  narrative: string;
  keywords: string[];
  confidence: number;
  /** Which part of the conversation triggered this */
  sourceText: string;
  /** Related unit IDs */
  relatedTo?: string[];
}
