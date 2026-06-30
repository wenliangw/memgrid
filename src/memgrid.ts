import * as fs from 'fs';
import * as crypto from 'crypto';
import * as path from 'path';
import type {
  MemoryUnit,
  MemoryUnitType,
  LegacyMemoryUnitType,
  MemoryTier,
  ScanOptions,
  SearchOptions,
  SearchResult,
  SyncOptions,
  SyncResult,
  FileSnapshot,
  ConflictResult,
  RebalanceResult,
} from './shared/types.js';
import { LEGACY_TYPE_MAP } from './shared/types.js';
import { FileStore } from './store/file-store.js';
import {
  TypeScriptScanner,
  RulesScanner,
  ConfigScanner,
  MarkdownScanner,
  type Scanner,
} from './scanner/index.js';
import { RetrieveEngine } from './retrieve/index.js';
import {
  SemanticRetriever,
  type EmbeddingProvider,
  KeywordEmbeddingProvider,
} from './retrieve/semantic.js';
import { LearnEngine, type TaskResult, type LearningSuggestions } from './learn/index.js';
import { SyncEngine } from './sync/index.js';
import { LibraryManager } from './library/index.js';
import { ExtractEngine } from './extract/index.js';

export class MemGrid {
  store: FileStore;
  scanner: Scanner;
  retrieve: RetrieveEngine;
  semantic: SemanticRetriever;
  learn: LearnEngine;
  syncEngine: SyncEngine;
  library: LibraryManager;
  extract: ExtractEngine;
  projectRoot: string;

  constructor(projectRoot: string, provider?: EmbeddingProvider, scanner?: Scanner) {
    this.projectRoot = projectRoot;
    this.store = new FileStore(projectRoot);
    // Accept optional scanner injection, default to TypeScript
    // Share a single RulesScanner between TypeScriptScanner and init() to avoid duplicates
    if (!scanner) {
      const rulesScanner = new RulesScanner(projectRoot);
      this.scanner = new TypeScriptScanner(this.store, projectRoot, rulesScanner);
    } else {
      this.scanner = scanner;
    }
    this.retrieve = new RetrieveEngine(this.store);
    this.semantic = new SemanticRetriever(this.store, provider || new KeywordEmbeddingProvider());
    this.learn = new LearnEngine(this.store);
    this.syncEngine = new SyncEngine(this.store, this.scanner, projectRoot);
    this.library = new LibraryManager(path.join(projectRoot, '.memgrid'));
    this.extract = new ExtractEngine();
  }

  async init(options: ScanOptions): Promise<MemoryUnit[]> {
    // Load existing cache first (if any)
    this.store.load();

    // Run language scanner
    const units = await this.scanner.scan(options);

    // Run universal scanners (rules, config, markdown) in parallel
    const universalScans: Promise<MemoryUnit[]>[] = [];
    if (options.includeRules && !(this.scanner instanceof TypeScriptScanner)) {
      const rulesScanner = new RulesScanner(this.projectRoot);
      if (rulesScanner.detect(this.projectRoot)) universalScans.push(rulesScanner.scan(options));
    }
    universalScans.push(new ConfigScanner(this.projectRoot).scan(options));
    const mdScanner = new MarkdownScanner(this.projectRoot);
    if (mdScanner.detect(this.projectRoot)) universalScans.push(mdScanner.scan(options));

    const universalResults = await Promise.all(universalScans);
    for (const result of universalResults) {
      // Save universal scanner units (language scanner saves its own)
      for (const unit of result) {
        this.store.saveUnit(unit);
        units.push(unit);
      }
    }

    // Build semantic index after scan
    await this.semantic.buildIndex();
    // Record file snapshot for future incremental syncs
    this.saveFileSnapshot(options);
    return units;
  }

  /**
   * Generate and persist fileSnapshot for all scanned files.
   * Done once on init; sync() diffs against this baseline.
   */
  private saveFileSnapshot(options: ScanOptions): void {
    const snapshot: FileSnapshot = {};

    const sourceExts = new Set([
      '.ts',
      '.tsx',
      '.js',
      '.jsx',
      '.mjs',
      '.cjs',
      '.py',
      '.go',
      '.rs',
      '.md',
    ]);
    const testPatterns = ['.spec.', '.test.', '_test.'];

    const collectHashes = (dir: string) => {
      if (!fs.existsSync(dir)) return;
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const abs = path.join(dir, entry.name);
        const rel = path.relative(this.projectRoot, abs);
        if (entry.isDirectory()) {
          const skipDirs = new Set([
            'node_modules',
            'dist',
            '.next',
            'vendor',
            'target',
            '__pycache__',
          ]);
          if (!skipDirs.has(entry.name) && !entry.name.startsWith('.')) {
            collectHashes(abs);
          }
        } else {
          const ext = path.extname(entry.name);
          if (sourceExts.has(ext)) {
            // Skip test files
            if (testPatterns.some((p) => entry.name.includes(p))) continue;
            snapshot[rel] = crypto
              .createHash('sha256')
              .update(fs.readFileSync(abs, 'utf-8'))
              .digest('hex');
          }
        }
      }
    };

    // Scan source dirs
    ['apps', 'packages', 'src', 'lib', 'cmd', 'internal', 'pkg', 'app'].forEach((d) =>
      collectHashes(path.join(this.projectRoot, d)),
    );

    // Rules and examples
    if (options.includeRules) collectHashes(path.join(this.projectRoot, '.claude', 'rules'));
    if (options.includeExamples) collectHashes(path.join(this.projectRoot, '.claude', 'examples'));

    // Config files
    for (const f of [
      'package.json',
      'pyproject.toml',
      'go.mod',
      'Cargo.toml',
      'docker-compose.yml',
    ]) {
      const abs = path.join(this.projectRoot, f);
      if (fs.existsSync(abs)) {
        snapshot[f] = crypto
          .createHash('sha256')
          .update(fs.readFileSync(abs, 'utf-8'))
          .digest('hex');
      }
    }

    const grid = this.store.getGrid();
    if (grid) {
      grid.fileSnapshot = snapshot;
      this.store.saveGrid(grid);
    }
  }

  async search(query: string, options?: SearchOptions): Promise<SearchResult> {
    this.store.load();
    const result = await this.semantic.search(query, options);
    // Touch usage counts for retrieved units (in-memory, periodically flushed)
    for (const unit of result.units) {
      this.store.touch(unit.id);
    }
    return result;
  }

  async add(
    unit: Partial<MemoryUnit> & {
      id: string;
      type: MemoryUnit['type'];
      summary: string;
      narrative?: string;
    },
  ): Promise<MemoryUnit> {
    // Auto-upgrade legacy types to new cognitive types
    const legacyType = unit.type as string;
    const normalizedType: MemoryUnitType =
      LEGACY_TYPE_MAP[legacyType as LegacyMemoryUnitType] ?? (unit.type as MemoryUnitType);

    const fullUnit: MemoryUnit = {
      ...unit,
      type: normalizedType,
      narrative: unit.narrative || '',
      signatures: unit.signatures || [],
      keywords: unit.keywords || [],
      associations: unit.associations || [],
      meta: {
        created: new Date().toISOString(),
        updated: new Date().toISOString(),
        confidence: unit.meta?.confidence ?? 0.7,
        usage_count: 0,
        status: unit.meta?.status ?? 'candidate',
      },
      provenance: unit.provenance,
    };

    this.store.ensureDirs();
    this.store.saveUnit(fullUnit);
    return fullUnit;
  }

  /**
   * Accept a candidate unit — make it active and searchable.
   */
  async acceptCandidate(id: string): Promise<MemoryUnit | null> {
    const unit = this.store.getUnit(id);
    if (!unit) return null;
    if (unit.meta.status !== 'candidate') return null;

    unit.meta.status = 'active';
    unit.meta.updated = new Date().toISOString();
    this.store.saveUnit(unit);
    return unit;
  }

  /**
   * Detect potentially conflicting memory units.
   *
   * Two units conflict if they share the same type and their summaries
   * have high keyword overlap but describe opposite things — e.g.
   * "prefer Dialog over Collapse" vs "prefer Collapse over Dialog".
   *
   * Returns conflicts sorted by overlap score (highest first).
   */
  detectConflicts(): ConflictResult[] {
    const units = this.store.listUnitsSync({ includeCandidate: true }) || [];
    const conflicts: ConflictResult[] = [];

    // Group by type — only some types can meaningfully conflict
    const conflictTypes: MemoryUnitType[] = ['preference', 'insight'];

    for (const cType of conflictTypes) {
      const group = units.filter(
        (u) => u.type === cType && (u.meta.status === 'active' || u.meta.status === 'candidate'),
      );

      for (let i = 0; i < group.length; i++) {
        for (let j = i + 1; j < group.length; j++) {
          const overlap = this.keywordOverlap(group[i], group[j]);
          // High overlap (>0.6) with same type = potential conflict
          if (overlap >= 0.6) {
            // Check if they describe opposing things (simple heuristics)
            const hasOpposition = this.detectOpposition(group[i].summary, group[j].summary);

            conflicts.push({
              unitA: group[i],
              unitB: group[j],
              overlapScore: overlap,
              hasOpposition,
            });
          }
        }
      }
    }

    // Sort by overlap score descending
    conflicts.sort((a, b) => b.overlapScore - a.overlapScore);
    return conflicts;
  }

  /**
   * Simple keyword overlap score between two units (Jaccard-like).
   */
  private keywordOverlap(a: MemoryUnit, b: MemoryUnit): number {
    const tokensA = new Set(
      `${a.summary} ${a.narrative}`
        .toLowerCase()
        .split(/\W+/)
        .filter((t) => t.length > 2),
    );
    const tokensB = new Set(
      `${b.summary} ${b.narrative}`
        .toLowerCase()
        .split(/\W+/)
        .filter((t) => t.length > 2),
    );

    if (tokensA.size === 0 || tokensB.size === 0) return 0;

    let intersection = 0;
    for (const t of tokensA) {
      if (tokensB.has(t)) intersection++;
    }

    return intersection / Math.min(tokensA.size, tokensB.size);
  }

  /**
   * Detect opposing meaning using simple negation/contrast signals.
   * Looks for: "not/never/instead/but/ > /vs/vs."
   */
  private detectOpposition(a: string, b: string): boolean {
    const oppositeSignals = [' not ', " don't ", ' never ', ' instead ', ' rather ', ' but '];
    const combined = (a + ' ' + b).toLowerCase();

    // Signal 1: explicit negation/contrast words
    if (oppositeSignals.some((s) => combined.includes(s))) return true;

    // Signal 2: one uses " > " (prefer A over B pattern)
    if (a.includes(' > ') && b.includes(' > ')) {
      const preferredA = a.split(' > ')[0].trim();
      const preferredB = b.split(' > ')[0].trim();
      if (preferredA !== preferredB) return true;
    }

    // Signal 3: one mentions "prefer" with different targets
    if (a.toLowerCase().includes('prefer') && b.toLowerCase().includes('prefer')) {
      // Both express preferences — likely conflict if high overlap
      return true;
    }

    return false;
  }

  async update(id: string, patch: Partial<MemoryUnit>): Promise<MemoryUnit | null> {
    const unit = this.store.getUnit(id);
    if (!unit) return null;

    Object.assign(unit, patch);
    unit.meta.updated = new Date().toISOString();

    this.store.saveUnit(unit);
    return unit;
  }

  async archive(id: string): Promise<void> {
    this.store.archiveUnit(id);
  }

  // ===== Tiered Storage Engine (v0.9+) =====

  /**
   * Rebalance all memory units across tiers.
   *
   * Rules:
   * - hot: usage_count >= 3 AND lastAccessedAt within 7 days
   * - warm: default for new/active units, OR hot demoted
   * - cold: lastAccessedAt > 30 days ago (from warm)
   * - frozen: lastAccessedAt > 90 days ago (from cold) — compressed, not searchable by default
   *
   * Cold tier has a capacity cap (max 30% of total, min 100).
   * When cold overflows, lowest retention_score units move to frozen.
   *
   * Candidate units are excluded from tiering.
   */
  async rebalance(): Promise<RebalanceResult> {
    this.store.load();
    const allUnits = this.store.listUnitsSync({ includeCandidate: true }) || [];

    // Only rebalance active and stale units
    const activeUnits = allUnits.filter(
      (u) => u.meta.status === 'active' || u.meta.status === 'stale',
    );

    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);

    const result: RebalanceResult = {
      hot: 0,
      warm: 0,
      cold: 0,
      frozen: 0,
      promoted: 0,
      demoted: 0,
      frozenCount: 0,
      thawedCount: 0,
    };

    // Phase 1: Assign tiers based on access patterns
    const coldCandidates: MemoryUnit[] = [];

    for (const unit of activeUnits) {
      const prevTier = unit.meta.tier;
      const accessedAt = unit.meta.lastAccessedAt
        ? new Date(unit.meta.lastAccessedAt)
        : new Date(unit.meta.updated);

      let newTier: MemoryTier;

      if (unit.meta.usage_count >= 3 && accessedAt >= sevenDaysAgo) {
        newTier = 'hot';
      } else if (accessedAt >= thirtyDaysAgo) {
        newTier = 'warm';
      } else if (accessedAt >= ninetyDaysAgo) {
        newTier = 'cold';
        coldCandidates.push(unit);
      } else {
        newTier = 'cold';
        coldCandidates.push(unit);
      }

      unit.meta.tier = newTier;
      unit.meta.updated = now.toISOString();

      if (newTier === 'hot') result.hot++;
      else if (newTier === 'warm') result.warm++;
      else result.cold++;

      if (prevTier && prevTier !== newTier) {
        if (
          (prevTier === 'warm' && newTier === 'hot') ||
          (prevTier === 'cold' && newTier === 'warm') ||
          (prevTier === 'cold' && newTier === 'hot')
        ) {
          result.promoted++;
        } else {
          result.demoted++;
        }
      }
    }

    // Phase 2: Cold tier overflow → freeze lowest retention_score units
    const totalActive = activeUnits.length;
    const coldCapacity = Math.max(100, Math.floor(totalActive * 0.3));
    const currentCold = coldCandidates.length;

    if (currentCold > coldCapacity) {
      // Sort cold candidates by retention_score ascending (lowest first → freeze)
      coldCandidates.sort((a, b) => this.retentionScore(a) - this.retentionScore(b));

      const toFreeze = coldCandidates.slice(0, currentCold - coldCapacity);
      for (const unit of toFreeze) {
        unit.meta.tier = 'frozen';
        unit.meta.updated = now.toISOString();
        result.cold--;
        result.frozen++;
        result.frozenCount++;
      }
    }

    // Persist all changes
    for (const unit of activeUnits) {
      this.store.saveUnit(unit);
    }

    return result;
  }

  /**
   * Thaw a frozen unit — restore it to warm tier so it appears in normal search.
   */
  async thaw(id: string): Promise<MemoryUnit | null> {
    const unit = this.store.getUnit(id);
    if (!unit) return null;
    if (unit.meta.tier !== 'frozen') return null;

    const now = new Date().toISOString();
    unit.meta.tier = 'warm';
    unit.meta.lastAccessedAt = now;
    unit.meta.updated = now;
    unit.meta.usage_count = 1; // Reset — re-earn hot status

    this.store.saveUnit(unit);
    return unit;
  }

  /**
   * Search frozen tier for a specific clue (exact method name, keyword, etc).
   */
  searchFrozen(clue: string): MemoryUnit[] {
    const allUnits = this.store.listUnitsSync({ includeCandidate: true }) || [];
    const frozen = allUnits.filter((u) => u.meta.tier === 'frozen');

    const clueLower = clue.toLowerCase();
    return frozen.filter((u) => {
      const text = `${u.summary} ${u.signatures.join(' ')} ${u.narrative}`.toLowerCase();
      return text.includes(clueLower);
    });
  }

  /**
   * Calculate retention score for a cold-tier unit.
   * Higher score = more worth keeping in cold (not freezing).
   * Lower score = freeze first.
   */
  /**
   * Calculate retention score for a memory unit.
   * All types treated equally — retention depends on confidence, usage, and connectivity.
   */
  private retentionScore(unit: MemoryUnit): number {
    const confidenceFactor = unit.meta.confidence;
    const usageFactor = Math.min(1, unit.meta.usage_count / 10);
    const hasAssociations = unit.associations.length > 0 ? 0.5 : 0;
    const richnessFactor = Math.min(1, (unit.narrative?.length || 0) / 500);

    return (
      confidenceFactor * 0.35 + usageFactor * 0.25 + hasAssociations * 0.25 + richnessFactor * 0.15
    );
  }

  context(result: SearchResult): string {
    return this.semantic.toContext(result);
  }

  async analyzeTask(task: TaskResult): Promise<LearningSuggestions> {
    return await this.learn.analyze(task);
  }

  async applySuggestions(
    suggestions: LearningSuggestions,
    options?: { status?: 'candidate' | 'active' },
  ): Promise<string[]> {
    return await this.learn.apply(suggestions, options);
  }

  formatSuggestions(suggestions: LearningSuggestions): string {
    return this.learn.formatSuggestions(suggestions);
  }

  /**
   * Incremental sync — re-scan only changed files and repair associations.
   * Much faster than full init() when only a few files changed.
   */
  async sync(options: SyncOptions): Promise<SyncResult> {
    this.store.load();
    const result = await this.syncEngine.sync(options);

    // Auto-rebalance tiers after sync (v0.9+)
    if (result.changedFiles.length > 0 || result.candidateUnitsCreated > 0) {
      await this.rebalance();
    }

    return result;
  }

  async stats() {
    this.store.load();
    const cached = this.store.getStats();
    const grid = this.store.getGrid();

    return {
      ...cached,
      lastScanAt: grid?.lastScanAt || null,
      version: grid?.version || '0.1.0',
    };
  }
}
