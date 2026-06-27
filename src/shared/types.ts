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
    trigger?: string;       // for trigger types: "when to use"
    action?: string;        // for trigger types: "what to do"
  };
  associations: Association[];
  meta: {
    created: string;
    updated: string;
    confidence: number;     // 0.0 ~ 1.0
    usage_count: number;
    status: 'active' | 'stale' | 'archived';
  };
}

/** SHA-256 hash of each scanned source file, keyed by relative path */
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
  /** Total time in ms */
  elapsedMs: number;
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
}

/** Single-file scan result from SyncEngine */
export interface FileScanResult {
  file: string;
  units: MemoryUnit[];
  hash: string;
}
