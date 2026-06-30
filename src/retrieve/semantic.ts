/**
 * Semantic search layer for MemGrid.
 * v0.4: Pluggable embedding providers + cosine similarity ranking.
 * No native dependencies (pure JS). Embedding API calls are optional —
 * falls back gracefully to keyword-only search if no embedding provider configured.
 */

import { RetrieveEngine } from './index.js';
import type { FileStore } from '../store/file-store.js';
import type { MemoryUnit, SearchResult } from '../shared/types.js';

/** Simple LRU cache */
class LRUCache<K, V> {
  private map = new Map<K, V>();
  constructor(private max: number = 100) {}
  get(key: K): V | undefined {
    return this.map.get(key);
  }
  set(key: K, value: V): void {
    if (this.map.size >= this.max) this.map.delete(this.map.keys().next().value as K);
    this.map.set(key, value);
  }
  clear(): void {
    this.map.clear();
  }
}

export interface EmbeddingProvider {
  name: string;
  embed(texts: string[]): Promise<number[][]>;
  dimensions: number;
}

export interface SemanticSearchOptions {
  maxResults?: number;
  maxHops?: number;
  /** Weight of semantic vs keyword score: 0.0 = keyword only, 1.0 = semantic only */
  semanticWeight?: number;
  /** Limit search to specific tiers (v0.9+) */
  tiers?: string[];
}

export class SemanticRetriever {
  private baseEngine: RetrieveEngine;
  private store: FileStore;
  private provider: EmbeddingProvider | null = null;
  private vectorCache: Map<string, number[]> = new Map();
  private resultCache: LRUCache<string, SearchResult> = new LRUCache(100);

  constructor(store: FileStore, provider?: EmbeddingProvider) {
    this.store = store;
    this.baseEngine = new RetrieveEngine(store);
    if (provider) {
      this.provider = provider;
    }
  }

  setProvider(provider: EmbeddingProvider): void {
    this.provider = provider;
    this.vectorCache.clear(); // Invalidate cache on provider change
  }

  /**
   * Build embedding vectors for all units in the grid.
   * Called after memgrid init to pre-compute embeddings.
   */
  async buildIndex(): Promise<{ indexed: number; errors: number }> {
    if (!this.provider) return { indexed: 0, errors: 0 };

    const units = await this.store.listUnits();
    if (units.length === 0) return { indexed: 0, errors: 0 };

    const batchSize = 20;
    let indexed = 0;
    let errors = 0;

    for (let i = 0; i < units.length; i += batchSize) {
      const batch = units.slice(i, i + batchSize);
      const texts = batch.map((u) =>
        `${u.summary}. ${u.narrative}. ${u.signatures.join(' ')}`.slice(0, 500),
      );

      try {
        const vectors = await this.provider.embed(texts);
        for (let j = 0; j < batch.length; j++) {
          this.vectorCache.set(batch[j].id, vectors[j]);
          indexed++;
        }
      } catch {
        errors += batch.length;
      }
    }

    return { indexed, errors };
  }

  /**
   * Hybrid search: semantic (cosine) + keyword (minisearch) → merged & reranked.
   */
  async search(query: string, options?: SemanticSearchOptions): Promise<SearchResult> {
    const maxResults = options?.maxResults ?? 10;
    const maxHops = options?.maxHops ?? 2;
    const semanticWeight = options?.semanticWeight ?? 0.4;

    // Check result cache
    const cacheKey = `${query}::${maxResults}::${maxHops}::${semanticWeight}`;
    const cached = this.resultCache.get(cacheKey);
    if (cached) return { ...cached, elapsedMs: 0 };

    // Step 1: Keyword search (always works)
    const keywordResult = await this.baseEngine.search(query, {
      maxResults: maxResults * 2,
      maxHops,
    });
    const keywordScores = new Map<string, number>();
    const allKeywordUnits = new Map<string, MemoryUnit>();

    for (const unit of keywordResult.units) {
      const idx = keywordResult.units.indexOf(unit);
      const normalizedScore = 1 - idx / keywordResult.units.length;
      keywordScores.set(unit.id, normalizedScore);
      allKeywordUnits.set(unit.id, unit);
    }

    // Step 2: Semantic search (if provider available)
    const semanticScores = new Map<string, number>();

    if (this.provider && this.vectorCache.size > 0) {
      try {
        const queryVector = (await this.provider.embed([query]))[0];

        for (const [id, vec] of this.vectorCache) {
          const similarity = this.cosine(queryVector, vec);
          if (!isNaN(similarity)) {
            semanticScores.set(id, similarity);
          }
        }

        // Also add units from semantic results to allKeywordUnits
        const allUnits = await this.store.listUnits();
        for (const [id] of semanticScores) {
          if (!allKeywordUnits.has(id)) {
            const unit = allUnits.find((u) => u.id === id);
            if (unit) allKeywordUnits.set(id, unit);
          }
        }
      } catch {
        // Semantic failed, fall through to keyword-only
      }
    }

    // Step 3: Merge and rerank
    const merged = new Map<string, number>();

    for (const id of new Set([...keywordScores.keys(), ...semanticScores.keys()])) {
      const kw = keywordScores.get(id) || 0;
      const sem = normaliseScore(semanticScores.get(id)) || 0;
      const score = kw * (1 - semanticWeight) + sem * semanticWeight;

      if (score > 0) {
        merged.set(id, score);
      }
    }

    // Step 4: Apply tier weights (v0.9+) and sort
    const tiers = options?.tiers || ['hot', 'warm', 'cold'];
    const tierWeights: Record<string, number> = {
      hot: 1.0,
      warm: 0.7,
      cold: 0.4,
      frozen: 0, // not included by default
    };

    for (const [id, score] of merged) {
      const unit = allKeywordUnits.get(id);
      if (unit) {
        const tier = unit.meta.tier || 'warm';
        if (!tiers.includes(tier)) {
          merged.delete(id);
        } else {
          merged.set(id, score * (tierWeights[tier] ?? 0.7));
        }
      }
    }

    // Sort and take top N
    const ranked = [...merged.entries()].sort((a, b) => b[1] - a[1]).slice(0, maxResults);

    const resultUnits = ranked
      .map(([id]) => allKeywordUnits.get(id))
      .filter(Boolean) as MemoryUnit[];

    const result: SearchResult = {
      query,
      units: resultUnits,
      totalHops: maxHops,
      elapsedMs: 0,
    };

    // Cache result
    this.resultCache.set(cacheKey, result);

    return result;
  }

  toContext(result: SearchResult): string {
    return this.baseEngine.toContext(result);
  }

  private cosine(a: number[], b: number[]): number {
    if (a.length !== b.length) return 0;

    let dot = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    const denom = Math.sqrt(normA) * Math.sqrt(normB);
    return denom === 0 ? 0 : dot / denom;
  }
}

function normaliseScore(score: number | undefined): number {
  if (score === undefined) return 0;
  return Math.max(0, Math.min(1, score));
}

// ===== Built-in Embedding Providers =====

/**
 * No-external-dependency provider: uses keyword overlap as pseudo-embedding.
 * Not real semantic search but provides scoring diversity without API calls.
 */
export class KeywordEmbeddingProvider implements EmbeddingProvider {
  name = 'keyword';
  dimensions = 0;

  async embed(texts: string[]): Promise<number[][]> {
    // Build vocabulary from all texts
    const vocab = new Map<string, number>();
    for (const text of texts) {
      const words = text.toLowerCase().split(/\W+/).filter(Boolean);
      for (const w of words) {
        if (w.length > 2) vocab.set(w, (vocab.get(w) || 0) + 1);
      }
    }

    // Keep top 500 tokens
    const topTokens = [...vocab.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 500)
      .map(([token], i) => ({ token, idx: i }));

    const tokenIndex = new Map(topTokens.map((t) => [t.token, t.idx]));
    const dims = topTokens.length;

    return texts.map((text) => {
      const vec = new Array(dims).fill(0);
      const words = text.toLowerCase().split(/\W+/).filter(Boolean);
      for (const w of words) {
        const idx = tokenIndex.get(w);
        if (idx !== undefined) vec[idx] = 1;
      }
      return vec;
    });
  }
}

/**
 * Provider that calls an external embedding API (OpenAI-compatible format).
 *
 * Usage:
 *   const provider = new APIEmbeddingProvider('https://api.deepseek.com/v1/embeddings', 'sk-...');
 */
export class APIEmbeddingProvider implements EmbeddingProvider {
  name = 'api';
  dimensions: number;
  private baseUrl: string;
  private apiKey: string;
  private model: string;

  constructor(
    baseUrl: string,
    apiKey: string,
    model = 'text-embedding-3-small',
    dimensions = 1536,
  ) {
    this.baseUrl = baseUrl;
    this.apiKey = apiKey;
    this.model = model;
    this.dimensions = dimensions;
  }

  async embed(texts: string[]): Promise<number[][]> {
    const response = await fetch(this.baseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        input: texts,
      }),
    });

    if (!response.ok) {
      throw new Error(`Embedding API error: ${response.status} ${response.statusText}`);
    }

    const data = (await response.json()) as any;
    return data.data.map((item: any) => item.embedding);
  }
}
