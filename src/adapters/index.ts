// MemGrid → OpenClaw Gateway Adapter (v0.10+)
//
// This module provides a drop-in memory provider for OpenClaw Gateway.
// It reads ~/.memgrid/opclaw-config.json and exposes a memory search
// interface compatible with OpenClaw's memory_host API.
//
// Usage in OpenClaw Gateway:
//   Copy this file into the Gateway's extensions/ directory and register
//   it as the memory provider. See openclaw-adapter.json for config.

import { MemGrid } from '../memgrid.js';

export type MemoryProvider = {
  search: (query: string, options?: { maxResults?: number }) => Promise<MemorySearchResult>;
  get: (id: string) => Promise<MemoryUnit | null>;
};

export type MemoryUnit = {
  id: string;
  type: string;
  summary: string;
  description: string;
  provenance?: {
    createdBy: string;
    basedOnTask?: string;
    timestamp: string;
  };
  confidence: number;
};

export type MemorySearchResult = {
  query: string;
  units: MemoryUnit[];
  elapsedMs: number;
};

export function createMemGridProvider(gridPath: string, _domainName?: string): MemoryProvider {
  try {
    const mg = new MemGrid(gridPath);

    return {
      async search(query, options) {
        mg.store.load();
        const results = await mg.search(query, {
          maxResults: options?.maxResults ?? 10,
          maxHops: 2,
          tiers: ['hot', 'warm', 'cold'],
        });

        return {
          query,
          units: results.units.map((u) => ({
            id: u.id,
            type: u.type,
            summary: u.summary,
            description: u.content.description,
            provenance: u.provenance,
            confidence: u.meta.confidence,
          })),
          elapsedMs: results.elapsedMs,
        };
      },

      async get(id) {
        const unit = mg.store.getUnit(id);
        if (!unit) return null;

        return {
          id: unit.id,
          type: unit.type,
          summary: unit.summary,
          description: unit.content.description,
          provenance: unit.provenance,
          confidence: unit.meta.confidence,
        };
      },
    };
  } catch {
    // MemGrid not installed or grid not initialized
    return {
      async search() {
        return { query: '', units: [], elapsedMs: 0 };
      },
      async get() {
        return null;
      },
    };
  }
}
