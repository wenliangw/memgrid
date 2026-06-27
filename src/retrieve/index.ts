import MiniSearch from 'minisearch';
import type { MemoryUnit, SearchResult, Association } from '../shared/types.js';
import type { FileStore } from '../store/file-store.js';

export class RetrieveEngine {
  private store: FileStore;
  private index: MiniSearch | null = null;

  constructor(store: FileStore) {
    this.store = store;
  }

  private buildIndex(units: MemoryUnit[]): MiniSearch {
    const idx = new MiniSearch({
      fields: ['summary', 'signatures', 'content.description', 'content.trigger', 'content.action'],
      storeFields: ['id'],
      searchOptions: {
        boost: { summary: 5, signatures: 3 },
        prefix: true,
        fuzzy: 0.2,
      },
    });

    idx.addAll(
      units.map((u) => ({
        id: u.id,
        summary: u.summary,
        signatures: u.signatures.join(' '),
        'content.description': u.content.description,
        'content.trigger': u.content.trigger || '',
        'content.action': u.content.action || '',
      })),
    );

    return idx;
  }

  async search(query: string, maxResults = 10, maxHops = 2): Promise<SearchResult> {
    const startTime = Date.now();
    const allUnits = await this.store.listUnits();

    if (allUnits.length === 0) {
      return { query, units: [], totalHops: 0, elapsedMs: Date.now() - startTime };
    }

    // Build index (in-memory, rebuild on each search for simplicity)
    this.index = this.buildIndex(allUnits);

    // Step 1: Keyword search
    const results = this.index.search(query, { prefix: true, fuzzy: 0.2 });
    const keywordUnitIds = new Map<string, number>(); // id → score
    for (const r of results) {
      keywordUnitIds.set(r.id, r.score);
    }

    // Step 2: Traverse associations (BFS with maxHops)
    const visited = new Set<string>();
    const queue: { id: string; hop: number }[] = [];

    // Seed with keyword results
    for (const [id, score] of keywordUnitIds) {
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

    // Step 3: Collect and rank units
    const matchedUnits: { unit: MemoryUnit; score: number }[] = [];

    for (const id of visited) {
      const unit = allUnits.find((u) => u.id === id);
      if (!unit) continue;

      const keywordScore = keywordUnitIds.get(id) || 0;
      const associationBonus = this.computeAssociationBonus(id, keywordUnitIds, edgeIndex);
      const usageBonus = Math.min(unit.meta.usage_count / 50, 0.2); // cap at 0.2

      const score = keywordScore * 0.7 + associationBonus * 0.2 + usageBonus * 0.1;

      matchedUnits.push({ unit, score });
    }

    // Sort by score, take top N
    matchedUnits.sort((a, b) => b.score - a.score);
    const topUnits = matchedUnits.slice(0, maxResults).map((m) => m.unit);

    return {
      query,
      units: topUnits,
      totalHops: maxHops,
      elapsedMs: Date.now() - startTime,
    };
  }

  private computeAssociationBonus(
    unitId: string,
    seedScores: Map<string, number>,
    edgeIndex: Record<string, Association[]>,
  ): number {
    // Bonus based on how many high-scoring units link to this one
    let bonus = 0;
    for (const [seedId, score] of seedScores) {
      const edges = edgeIndex[seedId] || [];
      if (edges.some((e) => e.to === unitId)) {
        bonus += score * 0.1;
      }
    }
    return Math.min(bonus, 1.0);
  }

  toContext(result: SearchResult): string {
    if (result.units.length === 0) {
      return 'No relevant memory units found.';
    }

    const lines: string[] = [
      `## 🔍 MemGrid Context (${result.units.length} units, ${result.elapsedMs}ms)`,
      '',
    ];

    for (const unit of result.units) {
      lines.push(`### ${unit.id} (${unit.type})`);
      lines.push(`- **${unit.summary}**`);
      if (unit.source) {
        lines.push(`- 位置: \`${unit.source.file}\`${unit.source.lines ? `:${unit.source.lines}` : ''}`);
      }
      if (unit.content.inputs) {
        lines.push(`- 输入: ${unit.content.inputs}`);
      }
      if (unit.content.outputs) {
        lines.push(`- 输出: ${unit.content.outputs}`);
      }
      lines.push(`- ${unit.content.description}`);
      if (unit.content.style_notes) {
        lines.push(`- 风格: ${unit.content.style_notes}`);
      }
      if (unit.content.code_snippet) {
        lines.push('```ts');
        lines.push(unit.content.code_snippet);
        lines.push('```');
      }
      lines.push('');
    }

    return lines.join('\n');
  }
}
