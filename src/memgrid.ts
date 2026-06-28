import * as fs from 'fs';
import * as crypto from 'crypto';
import * as path from 'path';
import type { MemoryUnit, ScanOptions, SearchOptions, SearchResult, SyncOptions, SyncResult, FileSnapshot } from './shared/types.js';
import { FileStore } from './store/file-store.js';
import { TypeScriptScanner, type Scanner } from './scanner/index.js';
import { RetrieveEngine } from './retrieve/index.js';
import { SemanticRetriever, type EmbeddingProvider, KeywordEmbeddingProvider } from './retrieve/semantic.js';
import { LearnEngine, type TaskResult, type LearningSuggestions } from './learn/index.js';
import { SyncEngine } from './sync/index.js';

export class MemGrid {
  store: FileStore;
  scanner: Scanner;
  retrieve: RetrieveEngine;
  semantic: SemanticRetriever;
  learn: LearnEngine;
  syncEngine: SyncEngine;
  projectRoot: string;

  constructor(projectRoot: string, provider?: EmbeddingProvider, scanner?: Scanner) {
    this.projectRoot = projectRoot;
    this.store = new FileStore(projectRoot);
    // Accept optional scanner injection, default to TypeScript
    this.scanner = scanner ?? new TypeScriptScanner(this.store, projectRoot);
    this.retrieve = new RetrieveEngine(this.store);
    this.semantic = new SemanticRetriever(this.store, provider || new KeywordEmbeddingProvider());
    this.learn = new LearnEngine(this.store);
    this.syncEngine = new SyncEngine(this.store, this.scanner, projectRoot);
  }

  async init(options: ScanOptions): Promise<MemoryUnit[]> {
    // Load existing cache first (if any)
    this.store.load();
    const units = await this.scanner.scan(options);
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

    const collectHashes = (dir: string) => {
      if (!fs.existsSync(dir)) return;
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const abs = path.join(dir, entry.name);
        const rel = path.relative(this.projectRoot, abs);
        if (entry.isDirectory()) {
          if (entry.name !== 'node_modules' && entry.name !== 'dist' && entry.name !== '.next' && !entry.name.startsWith('.')) {
            collectHashes(abs);
          }
        } else if (
          entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts') && !entry.name.endsWith('.test.ts')
        ) {
          snapshot[rel] = crypto.createHash('sha256').update(fs.readFileSync(abs, 'utf-8')).digest('hex');
        }
      }
    };

    // Scan source dirs
    ['apps', 'packages', 'src'].forEach((d) => collectHashes(path.join(this.projectRoot, d)));

    // Rules and examples
    if (options.includeRules) collectHashes(path.join(this.projectRoot, '.claude', 'rules'));
    if (options.includeExamples) collectHashes(path.join(this.projectRoot, '.claude', 'examples'));

    // Config files
    for (const f of ['package.json', 'docker-compose.yml']) {
      const abs = path.join(this.projectRoot, f);
      if (fs.existsSync(abs)) {
        snapshot[f] = crypto.createHash('sha256').update(fs.readFileSync(abs, 'utf-8')).digest('hex');
      }
    }

    const grid = this.store.getGrid();
    if (grid) {
      grid.fileSnapshot = snapshot;
      this.store.saveGrid(grid);
    }
  }

  async search(query: string, options?: SearchOptions): Promise<SearchResult> {
    const result = await this.semantic.search(query, options);
    // Touch usage counts for retrieved units (in-memory, periodically flushed)
    for (const unit of result.units) {
      this.store.touch(unit.id);
    }
    return result;
  }

  async add(unit: Partial<MemoryUnit> & { id: string; type: MemoryUnit['type']; summary: string; content: MemoryUnit['content'] }): Promise<MemoryUnit> {
    const fullUnit: MemoryUnit = {
      ...unit,
      signatures: unit.signatures || [],
      associations: unit.associations || [],
      meta: {
        created: new Date().toISOString(),
        updated: new Date().toISOString(),
        confidence: unit.meta?.confidence ?? 0.7,
        usage_count: 0,
        status: 'active',
      },
    };

    this.store.ensureDirs();
    this.store.saveUnit(fullUnit);
    return fullUnit;
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

  context(result: SearchResult): string {
    return this.semantic.toContext(result);
  }

  async analyzeTask(task: TaskResult): Promise<LearningSuggestions> {
    return await this.learn.analyze(task);
  }

  async applySuggestions(suggestions: LearningSuggestions): Promise<string[]> {
    return await this.learn.apply(suggestions);
  }

  formatSuggestions(suggestions: LearningSuggestions): string {
    return this.learn.formatSuggestions(suggestions);
  }

  /**
   * Incremental sync — re-scan only changed files and repair associations.
   * Much faster than full init() when only a few files changed.
   */
  async sync(options: SyncOptions): Promise<SyncResult> {
    return this.syncEngine.sync(options);
  }

  async stats() {
    const cached = this.store.getStats();
    const grid = this.store.getGrid();

    return {
      ...cached,
      lastScanAt: grid?.lastScanAt || null,
      version: grid?.version || '0.1.0',
    };
  }
}
