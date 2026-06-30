import MiniSearch from 'minisearch';
import type { MemoryUnit, SearchResult } from '../shared/types.js';
import type { FileStore } from '../store/file-store.js';

/**
 * Simple LRU cache for search results.
 */
class LRUCache<K, V> {
  private map = new Map<K, V>();
  constructor(private max: number = 200) {}

  get(key: K): V | undefined {
    return this.map.get(key);
  }
  set(key: K, value: V): void {
    if (this.map.size >= this.max) {
      const first = this.map.keys().next().value as K;
      this.map.delete(first);
    }
    this.map.set(key, value);
  }
  clear(): void {
    this.map.clear();
  }
}

export class RetrieveEngine {
  private store: FileStore;
  private index: MiniSearch | null = null;
  private indexBuilt = false;
  private unitVersion = 0; // Incremented on add/update/archive — invalidates index

  // LRU cache: query hash → SearchResult
  private resultCache = new LRUCache<string, SearchResult>(200);

  constructor(store: FileStore) {
    this.store = store;
  }

  /**
   * Build MiniSearch index once. Call after init or when units change.
   */
  ensureIndex(): void {
    if (this.index && this.indexBuilt) return;

    this.index = new MiniSearch({
      fields: [
        'summary',
        'signatures',
        'keywords',
        'narrative',
      ],
      storeFields: ['id'],
      searchOptions: {
        boost: { summary: 5, keywords: 4, narrative: 3, signatures: 3 },
        prefix: true,
        fuzzy: 0.2,
      },
    });

    // Load from cache (already in memory)
    const units = this.getCachedUnits();
    if (units.length > 0) {
      this.index.addAll(
        units.map((u) => ({
          id: u.id,
          summary: u.summary,
          signatures: u.signatures.join(' '),
          narrative: u.narrative || '',
          keywords: (u.keywords || []).join(' '),
        })),
      );
    }

    this.indexBuilt = true;
  }

  /**
   * Incremental index update — call when a single unit is added/updated.
   */
  updateIndex(unit: MemoryUnit): void {
    if (!this.index) return;
    this.index.remove(unit.id as any);
    this.index.add({
      id: unit.id,
      summary: unit.summary,
      signatures: unit.signatures.join(' '),
      narrative: unit.narrative || '',
      keywords: (unit.keywords || []).join(' '),
    });
    this.resultCache.clear(); // Invalidate cache on any change
  }

  invalidateIndex(): void {
    this.index = null;
    this.indexBuilt = false;
    this.resultCache.clear();
  }

  /**
   * Get active units from cache (with stale included).
   */
  private getCachedUnits(): MemoryUnit[] {
    const all = this.store.listUnitsSync({ includeCandidate: true }) || [];
    return all.filter((u) => u.meta.status === 'active' || u.meta.status === 'stale');
  }

  /**
   * Search: keyword + associative expansion (hops).
   */
  search(query: string, options?: { maxResults?: number; maxHops?: number }): SearchResult {
    const start = Date.now();
    const maxResults = options?.maxResults ?? 10;
    const maxHops = options?.maxHops ?? 2;

    this.ensureIndex();
    if (!this.index) {
      return { query, units: [], totalHops: 0, elapsedMs: Date.now() - start };
    }

    // Step 1: keyword search
    const raw = this.index.search(query, { prefix: true, fuzzy: 0.2 });

    // Step 2: deduplicate & collect
    const seen = new Set<string>();
    const units: MemoryUnit[] = [];

    for (const hit of raw) {
      if (units.length >= maxResults) break;
      if (seen.has(hit.id)) continue;
      seen.add(hit.id);
      const unit = this.store.getUnit(hit.id);
      if (unit && (unit.meta.status === 'active' || unit.meta.status === 'stale')) {
        units.push(unit);
      }
    }

    // Step 3: associative expansion (hops)
    let totalHops = 0;
    for (let hop = 0; hop < maxHops; hop++) {
      const currentIds = new Set(units.map((u) => u.id));
      let added = 0;
      for (const unit of [...units]) {
        for (const assoc of unit.associations || []) {
          if (units.length >= maxResults * 2) break;
          if (currentIds.has(assoc.to)) continue;
          if (seen.has(assoc.to)) continue;
          seen.add(assoc.to);
          const linked = this.store.getUnit(assoc.to);
          if (linked && (linked.meta.status === 'active' || linked.meta.status === 'stale')) {
            units.push(linked);
            added++;
          }
        }
      }
      totalHops++;
      if (added === 0) break;
    }

    return {
      query,
      units: units.slice(0, maxResults),
      totalHops,
      elapsedMs: Date.now() - start,
    };
  }

  /**
   * Format a unit for display context.
   */
  context(unit: MemoryUnit): string {
    const lines: string[] = [];
    lines.push(`[${unit.type}] ${unit.summary}`);
    if (unit.signatures.length > 0) {
      lines.push(`  signatures: ${unit.signatures.join(', ')}`);
    }
    if (unit.narrative) {
      lines.push(`  ${unit.narrative.slice(0, 300)}`);
    }
    if (unit.keywords && unit.keywords.length > 0) {
      lines.push(`  keywords: ${unit.keywords.join(', ')}`);
    }
    if (unit.code_snippet) {
      lines.push(`  code:\n${unit.code_snippet.slice(0, 200)}`);
    }
    if (unit.library_ref) {
      lines.push(`  📚 library: ${unit.library_ref}`);
    }
    return lines.join('\n');
  }

  /**
   * Format full search results as context string.
   */
  toContext(result: SearchResult): string {
    if (result.units.length === 0) {
      return `No matching memories found for "${result.query}".`;
    }
    const lines = [`Found ${result.units.length} memories for "${result.query}" (${result.elapsedMs}ms):`];
    for (const u of result.units) {
      lines.push(`\n--- ${u.id} ---`);
      lines.push(this.context(u));
    }
    return lines.join('\n');
  }
}
