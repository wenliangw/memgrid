import type { MemoryUnit, ScanOptions, SearchOptions, SearchResult } from './shared/types.js';
import { FileStore } from './store/file-store.js';
import { TypeScriptScanner } from './scanner/typescript.js';
import { RetrieveEngine } from './retrieve/index.js';
import { LearnEngine, type TaskResult, type LearningSuggestions } from './learn/index.js';

export class MemGrid {
  store: FileStore;
  scanner: TypeScriptScanner;
  retrieve: RetrieveEngine;
  learn: LearnEngine;
  projectRoot: string;

  constructor(projectRoot: string) {
    this.projectRoot = projectRoot;
    this.store = new FileStore(projectRoot);
    this.scanner = new TypeScriptScanner(this.store, projectRoot);
    this.retrieve = new RetrieveEngine(this.store);
    this.learn = new LearnEngine(this.store);
  }

  async init(options: ScanOptions): Promise<MemoryUnit[]> {
    return await this.scanner.scan(options);
  }

  async search(query: string, options?: SearchOptions): Promise<SearchResult> {
    return await this.retrieve.search(query, options?.maxResults, options?.maxHops);
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
    return this.retrieve.toContext(result);
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
    const units = await this.store.listUnits();
    const grid = this.store.getGrid();

    const typeDistribution: Record<string, number> = {};
    for (const u of units) {
      typeDistribution[u.type] = (typeDistribution[u.type] || 0) + 1;
    }

    return {
      totalUnits: units.length,
      activeUnits: units.filter((u) => u.meta.status === 'active').length,
      archivedUnits: units.filter((u) => u.meta.status === 'archived').length,
      typeDistribution,
      lastScanAt: grid?.lastScanAt || null,
      version: grid?.version || '0.1.0',
    };
  }
}
