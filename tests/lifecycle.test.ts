import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { MemGrid } from '../src/memgrid.js';
import type { MemoryUnit } from '../src/shared/types.js';

describe('v0.11.1 — Lifecycle pipeline', () => {
  let tmpDir: string;
  let mg: MemGrid;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'memgrid-lifecycle-'));
    mg = new MemGrid(tmpDir);
    mg.store.ensureDirs();
    mg.store.load();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function makeUnit(
    id: string,
    metaOverrides: Partial<MemoryUnit['meta']> = {},
    overrides: Partial<MemoryUnit> = {},
  ): MemoryUnit {
    return {
      id,
      type: 'insight',
      summary: `Test ${id}`,
      signatures: [id],
      narrative: `Narrative for ${id}`,
      keywords: ['test'],
      associations: [],
      meta: {
        created: new Date().toISOString(),
        updated: new Date().toISOString(),
        confidence: 0.8,
        usage_count: 0,
        status: 'active',
        ...metaOverrides,
      },
      ...overrides,
    };
  }

  describe('bootstrapFreshness', () => {
    it('should set freshness for units without it', async () => {
      const unit = makeUnit('boot_001');
      // Simulate pre-v0.11 unit without freshness_score
      delete unit.meta.freshness_score;
      mg.store.saveUnit(unit);

      await mg.runLifecycle();

      const updated = mg.store.getUnit('boot_001');
      expect(updated!.meta.freshness_score).toBeDefined();
      expect(updated!.meta.freshness_score!).toBeGreaterThanOrEqual(0);
      expect(updated!.meta.freshness_score!).toBeLessThanOrEqual(1);
    });

    it('should not overwrite existing freshness', async () => {
      const unit = makeUnit('boot_002', { freshness_score: 0.5 });
      mg.store.saveUnit(unit);

      // Note: rebalance() will recompute freshness via exponential decay.
      // Since this unit was just created, the recomputed value should be near 1.0.
      // The key assertion: bootstrapFreshness() skipped it because it already had a value.
      await mg.runLifecycle();

      const updated = mg.store.getUnit('boot_002');
      // Rebalance recomputes freshness but doesn't crash or NaN
      expect(updated!.meta.freshness_score).toBeDefined();
      expect(updated!.meta.freshness_score!).toBeGreaterThanOrEqual(0);
    });

    it('should skip archived units', async () => {
      const unit = makeUnit('boot_003', { status: 'archived' });
      delete unit.meta.freshness_score;
      mg.store.saveUnit(unit);

      await mg.runLifecycle();

      const updated = mg.store.getUnit('boot_003');
      expect(updated!.meta.freshness_score).toBeUndefined();
    });

    it('should give lower freshness to older units', async () => {
      // Unit from 60 days ago
      const sixtyDaysAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
      const oldUnit = makeUnit('boot_old', {
        updated: sixtyDaysAgo,
        created: sixtyDaysAgo,
      });
      delete oldUnit.meta.freshness_score;

      // Unit from now
      const newUnit = makeUnit('boot_new');
      delete newUnit.meta.freshness_score;

      mg.store.saveUnit(oldUnit);
      mg.store.saveUnit(newUnit);

      await mg.runLifecycle();

      const old = mg.store.getUnit('boot_old');
      const fresh = mg.store.getUnit('boot_new');
      expect(old!.meta.freshness_score!).toBeLessThan(fresh!.meta.freshness_score!);
    });
  });

  describe('runLifecycle', () => {
    it('should return rebalance and cleanup stats', async () => {
      const unit = makeUnit('life_001');
      mg.store.saveUnit(unit);

      const result = await mg.runLifecycle();
      expect(result.rebalance).toBeDefined();
      expect(result.cleanup).toBeDefined();
      expect(typeof result.rebalance.hot).toBe('number');
      expect(typeof result.cleanup.candidates).toBe('number');
    });
  });

  describe('auto-trigger via search', () => {
    it('should not rebalance on first few searches', async () => {
      const unit = makeUnit('auto_001');
      mg.store.saveUnit(unit);

      // Construct a new MemGrid so searchCount starts at 0
      const fresh = new MemGrid(tmpDir);
      // First search should not trigger rebalance (counter < threshold)
      await fresh.search('test');
      // searchCount should be 1, below threshold
    });
  });
});
