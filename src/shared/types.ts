// === Memory Unit Types ===

export type MemoryUnitType =
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

export type RelationType =
  | 'calls'
  | 'used_by'
  | 'implements_pattern'
  | 'follows_rule'
  | 'similar_pattern'
  | 'similar_error'
  | 'paired_with'
  | 'embodies'
  | 'belongs_to_module'
  | 'triggers';

export interface Association {
  to: string;
  relation: RelationType;
  weight: number; // 0.0 ~ 1.0
}

/** Provenance chain: who created this memory and based on what */
export interface Provenance {
  createdBy: string; // "scanner:typescript" | "ai:claude" | "user:7c"
  basedOnTask?: string; // task summary that produced this memory
  evidenceUnits?: string[]; // IDs of units used as evidence
  timestamp: string;
}

export type MemoryTier = 'hot' | 'warm' | 'cold' | 'frozen';

export interface MemoryUnit {
  id: string;
  type: MemoryUnitType;
  summary: string;
  source?: {
    file: string;
    lines?: string;
  };
  signatures: string[];
  content: {
    description: string;
    inputs?: string;
    outputs?: string;
    dependencies?: string[];
    code_snippet?: string;
    style_notes?: string;
    trigger?: string; // for trigger types: "when to use"
    action?: string; // for trigger types: "what to do"
  };
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
  };
  /** Who created this memory and based on what (v0.8+) */
  provenance?: Provenance;
}

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
  /** Files that changed (has hash delta) */
  changedFiles: string[];
  /** Files that were removed entirely */
  removedFiles: string[];
  /** Units added or updated */
  updatedUnits: number;
  /** Units marked stale (method name/line changed beyond fuzzy match) */
  staleUnits: number;
  /** Associations repaired via fuzzy match */
  repairedAssociations: number;
  /** Broken associations that couldn't be repaired */
  brokenAssociations: number;
  /** New associations discovered from code analysis */
  newAssociations: number;
  /** Patterns detected in recent changes */
  detectedPatterns: SyncPattern[];
  /** Architecture alerts triggered by changes */
  alerts: SyncAlert[];
  /** Auto-created memory units from learning engine (high-confidence, auto-active) */
  autoLearnedUnits: number;
  /** Candidate units created (need review before searchable) */
  candidateUnitsCreated: number;
  /** Total time in ms */
  elapsedMs: number;
}

/** A pattern detected during sync (new error handling, design pattern, etc.) */
export interface SyncPattern {
  type: 'error_solution' | 'pattern' | 'decision';
  summary: string;
  file: string;
  confidence: number;
}

/** An architecture alert triggered by a code change */
export interface SyncAlert {
  level: 'warning' | 'error';
  message: string;
  file: string;
  /** Which principle unit triggered this alert */
  principle?: string;
}

/** Options for sync */
export interface SyncOptions {
  projectRoot: string;
  includeRules: boolean;
  includeExamples: boolean;
  /** Max fuzzy match distance (0.0 = exact, 1.0 = anything) */
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
  /** Limit search to specific tiers (v0.9+). Default: hot+warm */
  tiers?: MemoryTier[];
}

/** Single-file scan result from SyncEngine */
export interface FileScanResult {
  file: string;
  units: MemoryUnit[];
  hash: string;
}
