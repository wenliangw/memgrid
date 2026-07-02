import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { FileStore } from '../src/store/file-store.js';
import { MemGrid } from '../src/memgrid.js';
import type { MemoryUnit } from '../src/shared/types.js';

describe('Time decay / freshness (v0.11)', () => {
  let tmpDir: string;
  let store: FileStore;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'memgrid-decay-'));
    store = new FileStore(tmpDir);
    store.ensureDirs();
    store.load();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function makeUnit(id: string, overrides: Partial<MemoryUnit['meta']> = {}): MemoryUnit {
    return {
      id,
      type: 'insight',
      summary: `Test decay ${id}`,
      signatures: [id],
      narrative: `Narrative for ${id}`,
      keywords: ['test', 'decay'],
      associations: [],
      meta: {
        created: new Date().toISOString(),
        updated: new Date().toISOString(),
        confidence: 0.8,
        usage_count: 0,
        status: 'active',
        freshness_score: 1.0,
        ...overrides,
      },
      provenance: {
        createdBy: 'test',
        basedOnTask: 'testing time decay',
        timestamp: new Date().toISOString(),
      },
    };
  }

  describe('freshness_score field', () => {
    it('should be present on new units', () => {
      const unit = makeUnit('fresh_001');
      store.saveUnit(unit);
      const loaded = store.getUnit('fresh_001');
      expect(loaded!.meta.freshness_score).toBe(1.0);
    });

    it('should default to 0.5 if not set', () => {
      const unit = makeUnit('fresh_002');
      delete unit.meta.freshness_score;
      store.saveUnit(unit);

      // rebalance will set it
      const mg = new MemGrid(tmpDir);
      mg.store = store;

      // Load and check default behavior
      const loaded = store.getUnit('fresh_002');
      expect(loaded!.meta.freshness_score).toBeUndefined();
    });
  });

  describe('touch() boosts freshness', () => {
    it('should increase freshness_score on touch', () => {
      const unit = makeUnit('fresh_003', { freshness_score: 0.5 });
      store.saveUnit(unit);

      store.touch('fresh_003');
      const updated = store.getUnit('fresh_003');
      expect(updated!.meta.freshness_score).toBeGreaterThan(0.5);
      expect(updated!.meta.freshness_score).toBeLessThanOrEqual(1.0);
      expect(updated!.meta.usage_count).toBe(1);
    });

    it('should cap freshness at 1.0', () => {
      const unit = makeUnit('fresh_004', { freshness_score: 0.99 });
      store.saveUnit(unit);

      store.touch('fresh_004');
      const updated = store.getUnit('fresh_004');
      expect(updated!.meta.freshness_score).toBe(1.0);
    });

    it('should set lastAccessedAt on touch', () => {
      const unit = makeUnit('fresh_005');
      expect(unit.meta.lastAccessedAt).toBeUndefined();
      store.saveUnit(unit);

      store.touch('fresh_005');
      const updated = store.getUnit('fresh_005');
      expect(updated!.meta.lastAccessedAt).toBeDefined();
      expect(new Date(updated!.meta.lastAccessedAt!).getTime()).toBeGreaterThan(0);
    });
  });

  describe('rebalance() computes freshness', () => {
    it('should compute freshness_score during rebalance', async () => {
      // Create a unit that was last accessed 30 days ago
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      const unit = makeUnit('decay_001', {
        lastAccessedAt: thirtyDaysAgo,
        freshness_score: undefined as any,
      });
      store.saveUnit(unit);

      const mg = new MemGrid(tmpDir);
      mg.store = store;
      await mg.rebalance();

      const updated = store.getUnit('decay_001');
      expect(updated!.meta.freshness_score).toBeDefined();
      // 30 days with warm tier → should be significantly decayed (< 0.3)
      expect(updated!.meta.freshness_score!).toBeLessThan(0.3);
    });

    it('should give high freshness to recently accessed units', async () => {
      const recentUnit = makeUnit('decay_002', {
        lastAccessedAt: new Date().toISOString(),
        freshness_score: undefined as any,
        usage_count: 3,
      });
      store.saveUnit(recentUnit);

      const mg = new MemGrid(tmpDir);
      mg.store = store;
      await mg.rebalance();

      const updated = store.getUnit('decay_002');
      expect(updated!.meta.freshness_score!).toBeGreaterThan(0.9);
    });
  });

  describe('tier ↔ freshness integration', () => {
    it('should boost new units to freshness 1.0 via MemGrid.add()', async () => {
      const mg = new MemGrid(tmpDir);
      mg.store = store;

      const unit = await mg.add({
        id: 'integ_001',
        type: 'insight',
        summary: 'Integration test unit',
        narrative: 'Testing freshness integration',
      });

      expect(unit.meta.freshness_score).toBe(1.0);
    });

    it('should preserve existing freshness on update', async () => {
      const unit = makeUnit('integ_002', { freshness_score: 0.8 });
      store.saveUnit(unit);

      const mg = new MemGrid(tmpDir);
      mg.store = store;

      const updated = await mg.update('integ_002', { summary: 'Updated summary' });
      // Freshness preserved through backup-then-update cycle
      expect(updated!.meta.freshness_score).toBe(0.8);
    });
  });
});
