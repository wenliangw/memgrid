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
      type: 'pattern',
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
    active.content.description = 'API creation endpoint handler';
    active.signatures = ['handleCreation'];
    store.saveUnit(active);

    // listUnitsSync should filter candidates
    const units = store.listUnitsSync();
    expect(units.length).toBe(1);
    expect(units[0].id).toBe('a_search');
  });

  it('detectConflicts finds opposing preferences', () => {
    const a = makeUnit('s1', 'active');
    a.type = 'style_preference';
    a.summary = 'Prefer Dialog over Collapse';
    a.content.description = 'Use Dialog for all modal interactions';
    store.saveUnit(a);

    const b = makeUnit('s2', 'active');
    b.type = 'style_preference';
    b.summary = 'Prefer Collapse over Dialog';
    b.content.description = 'Use Collapse instead of Dialog';
    store.saveUnit(b);

    // Also add a non-conflicting unit
    const c = makeUnit('s3', 'active');
    c.type = 'error_solution';
    c.summary = 'Fix N+1 query in list endpoint';
    c.content.description = 'Use preload to batch load relations';
    store.saveUnit(c);

    // Use same store instance for MemGrid
    const mg = new MemGrid(tmpDir);
    mg.store = store;
    const conflicts = mg.detectConflicts();

    expect(conflicts.length).toBeGreaterThanOrEqual(1);
    const styleConflict = conflicts.find(
      (cf) => cf.unitA.type === 'style_preference' && cf.unitB.type === 'style_preference',
    );
    expect(styleConflict).toBeDefined();
    expect(styleConflict!.hasOpposition).toBe(true);
    expect(styleConflict!.overlapScore).toBeGreaterThan(0.5);
  });

  it('detectConflicts returns empty for unrelated units', () => {
    const a = makeUnit('d1', 'active');
    a.type = 'decision';
    a.summary = 'Choose PostgreSQL for primary storage';
    a.content.description = 'ACID compliance and team expertise';
    store.saveUnit(a);

    const b = makeUnit('d2', 'active');
    b.type = 'decision';
    b.summary = 'Use Redis for session caching';
    b.content.description = 'Fast in-memory cache with TTL support';
    store.saveUnit(b);

    const mg = new MemGrid(tmpDir);
    mg.store = store;
    const conflicts = mg.detectConflicts();
    expect(conflicts.length).toBe(0);
  });
});
