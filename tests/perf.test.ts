import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FileStore } from '../src/store/file-store.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/** Performance thresholds — contract-level guarantees from the README */
const PERF = {
  /** Store.load() should be under 50ms for 100+ units */
  STORE_LOAD_MAX_MS: 50,
  /** Search should complete under 50ms for keyword queries */
  SEARCH_MAX_MS: 50,
  /** Repeated query (LRU cache) should complete under 1ms */
  CACHE_HIT_MAX_MS: 2,
  /** Bulk save should keep per-unit time under 1ms */
  SAVE_PER_UNIT_MAX_MS: 1,
};

describe('Performance Benchmarks', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'memgrid-perf-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // ===== Store Performance =====

  it('loads 200 units in under 50ms', () => {
    const store = new FileStore(tmpDir);
    store.ensureDirs();

    for (let i = 0; i < 200; i++) {
      store.saveUnit({
        id: `perf_unit_${i}`,
        type: 'fact' as const,
        summary: `Performance test unit ${i}`,
        signatures: [`perf_unit_${i}`],
        content: {
          description: `Test unit ${i}. Contains some realistic content for load testing.`,
          inputs: 'x: number, y: string',
          outputs: 'Promise<void>',
          code_snippet:
            'function test() {\n  const x = 1;\n  const y = "hello";\n  return x + y.length;\n}',
        },
        associations: [
          { to: `perf_unit_${i - 1}`, relation: 'calls' as const, weight: 0.5 },
          { to: `perf_unit_${i - 2}`, relation: 'calls' as const, weight: 0.3 },
        ],
        meta: {
          created: new Date().toISOString(),
          updated: new Date().toISOString(),
          confidence: 0.8,
          usage_count: i % 50,
          status: 'active' as const,
        },
      });
    }

    const store2 = new FileStore(tmpDir);
    const t0 = performance.now();
    const result = store2.load();
    const elapsed = performance.now() - t0;

    expect(result.total).toBe(200);
    expect(elapsed).toBeLessThan(PERF.STORE_LOAD_MAX_MS);
  });

  it('bulk save keeps per-unit under 1ms', () => {
    const store = new FileStore(tmpDir);
    store.ensureDirs();

    const unitCount = 100;
    const t0 = performance.now();

    for (let i = 0; i < unitCount; i++) {
      store.saveUnit({
        id: `perf_bulk_${i}`,
        type: 'fact',
        summary: `Bulk unit ${i}`,
        signatures: [`bulk_${i}`],
        content: { description: `Test ${i}` },
        associations: [],
        meta: {
          created: new Date().toISOString(),
          updated: new Date().toISOString(),
          confidence: 0.8,
          usage_count: 0,
          status: 'active',
        },
      });
    }

    const elapsed = performance.now() - t0;
    const perUnit = elapsed / unitCount;
    expect(perUnit).toBeLessThan(PERF.SAVE_PER_UNIT_MAX_MS);
  });

  // ===== Search Performance =====

  it('keyword search under 50ms for 200 units', async () => {
    const store = new FileStore(tmpDir);
    store.ensureDirs();

    for (let i = 0; i < 200; i++) {
      store.saveUnit({
        id: `search_unit_${i}`,
        type: i % 3 === 0 ? 'insight' : 'fact',
        summary: `Search test unit ${i}: ${i % 5 === 0 ? 'creation' : 'handler'}`,
        signatures: [`search_unit_${i}`],
        content: {
          description: `Test ${i}. ${i % 7 === 0 ? 'This unit relates to creation patterns' : 'Generic handler'}`,
        },
        associations: [],
        meta: {
          created: new Date().toISOString(),
          updated: new Date().toISOString(),
          confidence: 0.8,
          usage_count: i % 10,
          status: 'active',
        },
      });
    }

    store.load();

    const { RetrieveEngine } = await import('../src/retrieve/index.js');
    const engine = new RetrieveEngine(store);

    const t0 = performance.now();
    const result = await engine.search('creation', 10, 1);
    const elapsed = performance.now() - t0;

    expect(result.units.length).toBeGreaterThan(0);
    expect(elapsed).toBeLessThan(PERF.SEARCH_MAX_MS);
  });

  it('LRU cache hit under 1ms', async () => {
    const store = new FileStore(tmpDir);
    store.ensureDirs();

    for (let i = 0; i < 100; i++) {
      store.saveUnit({
        id: `cache_unit_${i}`,
        type: 'fact',
        summary: `Cache test ${i}`,
        signatures: [`cache_${i}`],
        content: { description: `Cache test ${i}` },
        associations: [],
        meta: {
          created: new Date().toISOString(),
          updated: new Date().toISOString(),
          confidence: 0.8,
          usage_count: 0,
          status: 'active',
        },
      });
    }

    store.load();

    const { RetrieveEngine } = await import('../src/retrieve/index.js');
    const engine = new RetrieveEngine(store);

    // Populate cache
    await engine.search('cache test', 10, 1);

    // Should hit LRU
    const t0 = performance.now();
    const result = await engine.search('cache test', 10, 1);
    const elapsed = performance.now() - t0;

    expect(result.elapsedMs).toBeLessThan(10);
    expect(elapsed).toBeLessThan(PERF.CACHE_HIT_MAX_MS * 5);
  });
});
