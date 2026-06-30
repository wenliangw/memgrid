import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { FileStore } from '../src/store/file-store.js';
import { MemGrid } from '../src/memgrid.js';
import type { MemoryUnit } from '../src/shared/types.js';

describe('Candidate review (v0.8)', () => {
  let tmpDir: string;
  let store: FileStore;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'memgrid-review-'));
    store = new FileStore(tmpDir);
    store.ensureDirs();
    store.load();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function makeUnit(id: string, status: 'candidate' | 'active'): MemoryUnit {
    return {
      id,
      type: 'insight',
      summary: `Test pattern ${id}`,
      signatures: [id],
      content: { description: `Description for ${id}` },
      associations: [],
      meta: {
        created: new Date().toISOString(),
        updated: new Date().toISOString(),
        confidence: 0.7,
        usage_count: 0,
        status,
      },
      provenance: {
        createdBy: 'test',
        basedOnTask: 'Test task',
        timestamp: new Date().toISOString(),
      },
    };
  }

  it('candidate units are not returned in default listUnits', async () => {
    store.saveUnit(makeUnit('c1', 'candidate'));
    store.saveUnit(makeUnit('a1', 'active'));

    const units = await store.listUnits();
    expect(units.length).toBe(1);
    expect(units[0].id).toBe('a1');
  });

  it('candidate units are returned with includeCandidate: true', async () => {
    store.saveUnit(makeUnit('c1', 'candidate'));
    store.saveUnit(makeUnit('a1', 'active'));

    const units = await store.listUnits({ includeCandidate: true });
    expect(units.length).toBe(2);
    const ids = units.map((u) => u.id);
    expect(ids).toContain('c1');
    expect(ids).toContain('a1');
  });

  it('acceptCandidate changes status from candidate to active', () => {
    store.saveUnit(makeUnit('c1', 'candidate'));

    let unit = store.getUnit('c1');
    expect(unit!.meta.status).toBe('candidate');

    unit!.meta.status = 'active';
    unit!.meta.updated = new Date().toISOString();
    store.saveUnit(unit!);

    unit = store.getUnit('c1');
    expect(unit!.meta.status).toBe('active');
  });

  it('stats count candidate units separately', () => {
    store.saveUnit(makeUnit('c1', 'candidate'));
    store.saveUnit(makeUnit('c2', 'candidate'));
    store.saveUnit(makeUnit('a1', 'active'));

    const stats = store.getStats();
    expect(stats.totalUnits).toBe(3);
    expect(stats.activeUnits).toBe(1);
    expect(stats.candidateUnits).toBe(2);
    expect(stats.archivedUnits).toBe(0);
  });

  it('provenance is preserved when unit is saved', () => {
    const unit = makeUnit('p1', 'candidate');
    unit.provenance = {
      createdBy: 'ai:sync_learning',
      basedOnTask: 'Auto-detected pattern during sync',
      evidenceUnits: ['method_foo', 'pattern_bar'],
      timestamp: '2026-06-29T00:00:00.000Z',
    };
    store.saveUnit(unit);

    const loaded = store.getUnit('p1');
    expect(loaded!.provenance).toBeDefined();
    expect(loaded!.provenance!.createdBy).toBe('ai:sync_learning');
    expect(loaded!.provenance!.evidenceUnits).toHaveLength(2);
  });

  it('search excludes candidate units', () => {
    store.saveUnit(makeUnit('c_search', 'candidate'));
    const active = makeUnit('a_search', 'active');
    active.narrative = 'API creation endpoint handler';
    active.signatures = ['handleCreation'];
    store.saveUnit(active);

    // listUnitsSync should filter candidates
    const units = store.listUnitsSync();
    expect(units.length).toBe(1);
    expect(units[0].id).toBe('a_search');
  });

  it('detectConflicts finds opposing preferences', () => {
    const a = makeUnit('s1', 'active');
    a.type = 'preference';
    a.summary = 'Prefer Dialog over Collapse';
    a.narrative = 'Use Dialog for all modal interactions';
    store.saveUnit(a);

    const b = makeUnit('s2', 'active');
    b.type = 'preference';
    b.summary = 'Prefer Collapse over Dialog';
    b.narrative = 'Use Collapse instead of Dialog';
    store.saveUnit(b);

    // Also add a non-conflicting unit
    const c = makeUnit('s3', 'active');
    c.type = 'insight';
    c.summary = 'Fix N+1 query in list endpoint';
    c.narrative = 'Use preload to batch load relations';
    store.saveUnit(c);

    // Use same store instance for MemGrid
    const mg = new MemGrid(tmpDir);
    mg.store = store;
    const conflicts = mg.detectConflicts();

    expect(conflicts.length).toBeGreaterThanOrEqual(1);
    const styleConflict = conflicts.find(
      (cf) => cf.unitA.type === 'preference' && cf.unitB.type === 'preference',
    );
    expect(styleConflict).toBeDefined();
    expect(styleConflict!.hasOpposition).toBe(true);
    expect(styleConflict!.overlapScore).toBeGreaterThan(0.5);
  });

  it('detectConflicts returns empty for unrelated units', () => {
    const a = makeUnit('d1', 'active');
    a.type = 'insight';
    a.summary = 'Choose PostgreSQL for primary storage';
    a.narrative = 'ACID compliance and team expertise';
    store.saveUnit(a);

    const b = makeUnit('d2', 'active');
    b.type = 'insight';
    b.summary = 'Use Redis for session caching';
    b.narrative = 'Fast in-memory cache with TTL support';
    store.saveUnit(b);

    const mg = new MemGrid(tmpDir);
    mg.store = store;
    const conflicts = mg.detectConflicts();
    expect(conflicts.length).toBe(0);
  });
});

describe('Tiered storage (v0.9)', () => {
  let tmpDir: string;
  let store: FileStore;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'memgrid-tier-'));
    store = new FileStore(tmpDir);
    store.ensureDirs();
    store.load();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function makeTierUnit(id: string, tier: string, accessedAt: string, usage: number): MemoryUnit {
    return {
      id,
      type: 'fact',
      summary: `Method ${id}`,
      signatures: [id],
      content: { description: `Description for ${id}` },
      associations: [],
      meta: {
        created: '2026-01-01',
        updated: '2026-01-01',
        confidence: 0.8,
        usage_count: usage,
        status: 'active',
        tier: tier as any,
        lastAccessedAt: accessedAt,
      },
    };
  }

  it('rebalance promotes high-usage recent units to hot', async () => {
    const _now = new Date().toISOString();
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();

    store.saveUnit(makeTierUnit('u1', 'warm', threeDaysAgo, 5)); // should be hot (usage>=3, recent)
    store.saveUnit(makeTierUnit('u2', 'warm', threeDaysAgo, 1)); // should stay warm (usage<3)

    const mg = new MemGrid(tmpDir);
    mg.store = store;
    const result = await mg.rebalance();

    expect(result.hot).toBe(1);
    expect(result.warm).toBe(1);
    expect(result.promoted).toBe(1);

    const u1 = store.getUnit('u1');
    expect(u1!.meta.tier).toBe('hot');
  });

  it('rebalance demotes old unused units to cold', async () => {
    const _now = new Date().toISOString();
    const sixtyDaysAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();

    store.saveUnit(makeTierUnit('u1', 'warm', sixtyDaysAgo, 1)); // should go cold (>30 days)

    const mg = new MemGrid(tmpDir);
    mg.store = store;
    const result = await mg.rebalance();

    expect(result.cold).toBe(1);
    expect(result.demoted).toBe(1);

    const u1 = store.getUnit('u1');
    expect(u1!.meta.tier).toBe('cold');
  });

  it('rebalance freezes cold overflow', async () => {
    const ninetyDaysAgo = new Date(Date.now() - 91 * 24 * 60 * 60 * 1000).toISOString();

    // Create many units so cold capacity is small relative to total
    // Cold capacity = max(100, total * 0.3)
    // First create 300 warm units (to push total up) + 100 old cold ones
    for (let i = 0; i < 100; i++) {
      const unit = makeTierUnit(`warm_${i}`, 'warm', new Date().toISOString(), 0);
      store.saveUnit(unit);
    }
    // Create 200 cold units (way over 30% of 300 = 90 cold capacity)
    for (let i = 0; i < 200; i++) {
      const unit = makeTierUnit(`cold_${i}`, 'cold', ninetyDaysAgo, 0);
      unit.type = 'preference'; // low type weight → low retention score
      store.saveUnit(unit);
    }

    const mg = new MemGrid(tmpDir);
    mg.store = store;
    const result = await mg.rebalance();

    // Capacity: max(100, 300*0.3) = max(100, 90) = 100
    // Current cold: 200 → overflow: 200 - 100 = 100 to freeze
    expect(result.frozenCount).toBeGreaterThan(0);

    // Verify some units were frozen
    const frozen = store
      .listUnitsSync({ includeCandidate: true })!
      .filter((u) => u.meta.tier === 'frozen');
    expect(frozen.length).toBeGreaterThan(0);
  });

  it('thaw restores frozen unit to warm', async () => {
    const ninetyDaysAgo = new Date(Date.now() - 91 * 24 * 60 * 60 * 1000).toISOString();
    const unit = makeTierUnit('f1', 'frozen', ninetyDaysAgo, 0);
    store.saveUnit(unit);

    const mg = new MemGrid(tmpDir);
    mg.store = store;

    const thawed = await mg.thaw('f1');
    expect(thawed).not.toBeNull();
    expect(thawed!.meta.tier).toBe('warm');
    expect(thawed!.meta.usage_count).toBe(1); // reset to re-earn hot status
  });

  it('searchFrozen finds units by clue', () => {
    const ninetyDaysAgo = new Date(Date.now() - 91 * 24 * 60 * 60 * 1000).toISOString();
    const u1 = makeTierUnit('f_search', 'frozen', ninetyDaysAgo, 0);
    u1.summary = 'CreationDomainService.create — Create new work';
    u1.signatures = ['CreationDomainService.create'];
    u1.narrative = 'Creates a new work entity with ownership validation';
    store.saveUnit(u1);

    const mg = new MemGrid(tmpDir);
    mg.store = store;

    const results = mg.searchFrozen('CreationDomainService');
    expect(results.length).toBe(1);
    expect(results[0].id).toBe('f_search');
  });
});
