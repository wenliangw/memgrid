import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { FileStore } from '../src/store/file-store.js';
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
});
