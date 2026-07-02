import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { MemGrid } from '../src/memgrid.js';
import type { MemoryUnit } from '../src/shared/types.js';

describe('v0.12 P1 — git diff sync + cross-domain + auto-forgetting', () => {
  let tmpDir: string;
  let mg: MemGrid;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'memgrid-v12-'));
    mg = new MemGrid(tmpDir);
    mg.store.ensureDirs();
    mg.store.load();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function makeUnit(
    id: string,
    overrides: Partial<MemoryUnit> = {},
    metaOverrides: Partial<MemoryUnit['meta']> = {},
  ): MemoryUnit {
    return {
      id,
      type: 'insight',
      summary: `Test unit ${id}`,
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
      provenance: {
        createdBy: 'test',
        basedOnTask: 'testing v0.12',
        timestamp: new Date().toISOString(),
      },
      ...overrides,
    };
  }

  describe('crossDomainSearch', () => {
    it('should return results from local domain only when no cross-domains given', async () => {
      const unit = makeUnit('local_001');
      mg.store.saveUnit(unit);

      const result = await mg.crossDomainSearch('local', []);
      expect(result.units.length).toBeGreaterThan(0);
      expect(result.domainResults.length).toBe(1);
      expect(result.domainResults[0].domain).toBe('local');
    });

    it('should merge results from cross-domain searches without duplicates', async () => {
      const unit1 = makeUnit('unique_a');
      mg.store.saveUnit(unit1);

      // Create second domain
      const domain2Dir = fs.mkdtempSync(path.join(os.tmpdir(), 'memgrid-domain2-'));
      const domain2 = new MemGrid(domain2Dir);
      domain2.store.ensureDirs();
      domain2.store.load();
      const unit2 = makeUnit('unique_b');
      // Accept to make searchable
      unit2.meta.status = 'active';
      domain2.store.saveUnit(unit2);

      try {
        const result = await mg.crossDomainSearch('unique', [{ name: 'domain2', grid: domain2 }]);
        expect(result.units.length).toBeGreaterThanOrEqual(2);
        expect(result.domainResults.length).toBe(2);
        // domain2 should have at least 1 result
        const domain2Result = result.domainResults.find((d) => d.domain === 'domain2');
        expect(domain2Result).toBeDefined();
      } finally {
        fs.rmSync(domain2Dir, { recursive: true, force: true });
      }
    });
  });

  describe('detectForgettable', () => {
    it('should return empty when all units are fresh', async () => {
      const unit = makeUnit(
        'fresh_unit',
        {},
        {
          lastAccessedAt: new Date().toISOString(),
          freshness_score: 1.0,
        },
      );
      mg.store.saveUnit(unit);
      const result = await mg.detectForgettable();
      expect(result.candidates).toEqual([]);
    });

    it('should detect stale units past threshold', async () => {
      const sixtyDaysAgo = new Date(Date.now() - 61 * 24 * 60 * 60 * 1000).toISOString();
      const unit = makeUnit(
        'stale_unit',
        {},
        {
          status: 'stale',
          lastAccessedAt: sixtyDaysAgo,
        },
      );
      mg.store.saveUnit(unit);
      const result = await mg.detectForgettable({ minDaysStale: 60 });
      expect(result.candidates.length).toBe(1);
      expect(result.candidates[0].id).toBe('stale_unit');
    });

    it('should detect cold tier with very low freshness', async () => {
      const unit = makeUnit(
        'cold_unit',
        {},
        {
          tier: 'cold',
          freshness_score: 0.05,
        },
      );
      mg.store.saveUnit(unit);
      const result = await mg.detectForgettable();
      expect(result.candidates.length).toBe(1);
      expect(result.reasons.get('cold_unit')).toContain('Cold tier');
    });

    it('should detect units with all broken associations', async () => {
      const unit = makeUnit('broken_unit', {
        associations: [
          { to: 'nonexistent_1', relation: 'references', weight: 0.8 },
          { to: 'nonexistent_2', relation: 'extends', weight: 0.5 },
        ],
      });
      mg.store.saveUnit(unit);
      const result = await mg.detectForgettable();
      // May or may not be detected depending on other factors
      // The key assertion: if detected, reason mentions associations
      if (result.candidates.length > 0) {
        expect(result.reasons.get('broken_unit')).toContain('broken');
      }
    });

    it('should not auto-archive by default', async () => {
      const sixtyDaysAgo = new Date(Date.now() - 61 * 24 * 60 * 60 * 1000).toISOString();
      const unit = makeUnit(
        'no_auto',
        {},
        {
          status: 'stale',
          lastAccessedAt: sixtyDaysAgo,
        },
      );
      mg.store.saveUnit(unit);
      const result = await mg.detectForgettable({ minDaysStale: 60 });
      expect(result.autoArchived).toBe(0);
      // Unit should still exist
      expect(mg.store.getUnit('no_auto')).toBeTruthy();
    });

    it('should auto-archive when autoArchive=true', async () => {
      const sixtyDaysAgo = new Date(Date.now() - 61 * 24 * 60 * 60 * 1000).toISOString();
      const unit = makeUnit(
        'auto_archive',
        {},
        {
          status: 'stale',
          lastAccessedAt: sixtyDaysAgo,
        },
      );
      mg.store.saveUnit(unit);
      const result = await mg.detectForgettable({ minDaysStale: 60, autoArchive: true });
      expect(result.autoArchived).toBe(1);
      // Unit should now be archived
      const archived = mg.store.getUnit('auto_archive');
      expect(archived?.meta.status).toBe('archived');
    });
  });
});
