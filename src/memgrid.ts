import type { MemoryUnit, ScanOptions, SearchOptions, SearchResult } from './shared/types.js';
import { FileStore } from './store/file-store.js';
import { TypeScriptScanner } from './scanner/typescript.js';
import { RetrieveEngine } from './retrieve/index.js';
import { SemanticRetriever, type EmbeddingProvider, KeywordEmbeddingProvider } from './retrieve/semantic.js';
import { LearnEngine, type TaskResult, type LearningSuggestions } from './learn/index.js';

export class MemGrid {
  store: FileStore;
  scanner: TypeScriptScanner;
  retrieve: RetrieveEngine;
  semantic: SemanticRetriever;
  learn: LearnEngine;
  projectRoot: string;

  constructor(projectRoot: string, provider?: EmbeddingProvider) {
    this.projectRoot = projectRoot;
    this.store = new FileStore(projectRoot);
    this.scanner = new TypeScriptScanner(this.store, projectRoot);
    this.retrieve = new RetrieveEngine(this.store);
    this.semantic = new SemanticRetriever(this.store, provider || new KeywordEmbeddingProvider());
    this.learn = new LearnEngine(this.store);
  }

  async init(options: ScanOptions): Promise<MemoryUnit[]> {
    // Load existing cache first (if any)
    this.store.load();
    const units = await this.scanner.scan(options);
    // Build semantic index after scan
    await this.semantic.buildIndex();
    return units;
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
