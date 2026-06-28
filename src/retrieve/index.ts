import MiniSearch from 'minisearch';
import type { MemoryUnit, SearchResult, Association } from '../shared/types.js';
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
      fields: ['summary', 'signatures', 'content.description', 'content.trigger', 'content.action'],
      storeFields: ['id'],
      searchOptions: {
        boost: { summary: 5, signatures: 3 },
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
          'content.description': u.content.description,
          'content.trigger': u.content.trigger || '',
          'content.action': u.content.action || '',
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
      'content.description': unit.content.description,
      'content.trigger': unit.content.trigger || '',
      'content.action': unit.content.action || '',
    });
    this.resultCache.clear(); // Invalidate cache on any change
  }

  invalidateIndex(): void {
    this.index = null;
    this.indexBuilt = false;
    this.resultCache.clear();
  }

  async search(query: string, maxResults = 10, maxHops = 2): Promise<SearchResult> {
    const startTime = Date.now();

    // Check result cache first (exact query match)
    const cacheKey = `${query}::${maxResults}::${maxHops}`;
    const cached = this.resultCache.get(cacheKey);
    if (cached) {
      return { ...cached, elapsedMs: Date.now() - startTime };
    }

    // Ensure index is built
    this.ensureIndex();
    if (!this.index) {
      return { query, units: [], totalHops: 0, elapsedMs: Date.now() - startTime };
    }

    // Step 1: Keyword search (reused index — no rebuild!)
    const results = this.index.search(query, { prefix: true, fuzzy: 0.2 });
    const keywordUnitIds = new Map<string, number>();
    for (const r of results) {
      keywordUnitIds.set(r.id, r.score);
    }

    // Step 2: Traverse associations (BFS)
    const visited = new Set<string>();
    const queue: { id: string; hop: number }[] = [];

    for (const [id] of keywordUnitIds) {
      visited.add(id);
      queue.push({ id, hop: 0 });
    }

    const grid = this.store.getGrid();
    const edgeIndex = grid?.edgeIndex ?? {};

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (current.hop >= maxHops) continue;

      const edges = edgeIndex[current.id] || [];
      for (const edge of edges) {
        if (!visited.has(edge.to)) {
          visited.add(edge.to);
          queue.push({ id: edge.to, hop: current.hop + 1 });
        }
      }
    }

    // Step 3: Collect and rank (from cache, O(1) lookups)
    const matchedUnits: { unit: MemoryUnit; score: number }[] = [];
    const allUnits = this.getCachedUnits();
    const unitMap = new Map<string, MemoryUnit>();
    for (const u of allUnits) unitMap.set(u.id, u);

    for (const id of visited) {
      const unit = unitMap.get(id);
      if (!unit) continue;

      const keywordScore = keywordUnitIds.get(id) || 0;
      const associationBonus = this.computeAssociationBonus(id, keywordUnitIds, edgeIndex);
      const usageBonus = Math.min(unit.meta.usage_count / 50, 0.2);

      const score = keywordScore * 0.7 + associationBonus * 0.2 + usageBonus * 0.1;
      matchedUnits.push({ unit, score });
    }

    matchedUnits.sort((a, b) => b.score - a.score);
    const topUnits = matchedUnits.slice(0, maxResults).map((m) => m.unit);

    const result: SearchResult = {
      query,
      units: topUnits,
      totalHops: maxHops,
      elapsedMs: Date.now() - startTime,
    };

    // Cache result
    this.resultCache.set(cacheKey, result);

    return result;
  }

  private computeAssociationBonus(
    unitId: string,
    seedScores: Map<string, number>,
    edgeIndex: Record<string, Association[]>,
  ): number {
    let bonus = 0;
    for (const [seedId, score] of seedScores) {
      const edges = edgeIndex[seedId] || [];
      if (edges.some((e) => e.to === unitId)) {
        bonus += score * 0.1;
      }
    }
    return Math.min(bonus, 1.0);
  }

  /**
   * Get units from store's in-memory cache (no disk I/O).
   */
  private getCachedUnits(): MemoryUnit[] {
    // FileStore.load() already loaded everything into memory
    // We access via listUnits() which reads from Map, not disk
    const units: MemoryUnit[] = [];
    const storeWithCache = this.store as any;
    if (storeWithCache.cache && storeWithCache.cache.size > 0) {
      for (const u of storeWithCache.cache.values()) {
        units.push(u);
      }
    }
    return units;
  }

  toContext(result: SearchResult): string {
    if (result.units.length === 0) {
      return 'No relevant memory units found.';
    }

    const lines: string[] = [
      `## MemGrid Context (${result.units.length} units, ${result.elapsedMs}ms)`,
      '',
    ];

    for (const unit of result.units) {
      lines.push(`### ${unit.id} (${unit.type})`);
      lines.push(`- **${unit.summary}**`);
      if (unit.source) {
        lines.push(
          `- location: \`${unit.source.file}\`${unit.source.lines ? `:${unit.source.lines}` : ''}`,
        );
      }
      if (unit.content.inputs && unit.content.inputs !== 'none') {
        lines.push(`- inputs: ${unit.content.inputs}`);
      }
      if (unit.content.outputs && unit.content.outputs !== 'void') {
        lines.push(`- outputs: ${unit.content.outputs}`);
      }
      lines.push(`- ${unit.content.description}`);
      if (unit.content.style_notes) {
        lines.push(`- style: ${unit.content.style_notes}`);
      }
      if (unit.content.code_snippet) {
        lines.push('```ts');
        lines.push(unit.content.code_snippet.slice(0, 300));
        lines.push('```');
      }
      lines.push('');
    }

    return lines.join('\n');
  }
}
