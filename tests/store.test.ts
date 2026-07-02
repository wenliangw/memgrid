import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FileStore } from '../src/store/file-store.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('FileStore', () => {
  let tmpDir: string;
  let store: FileStore;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'memgrid-test-'));
    store = new FileStore(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates directories on ensureDirs', () => {
    store.ensureDirs();
    expect(fs.existsSync(store.gridDir)).toBe(true);
    expect(fs.existsSync(store.unitsDir)).toBe(true);
    expect(fs.existsSync(store.archiveDir)).toBe(true);
  });

  it('saves and retrieves a unit', async () => {
    store.ensureDirs();
    const unit = {
      id: 'test_method_1',
      type: 'fact' as const,
      summary: 'Test method',
      signatures: ['test.method'],
      content: { description: 'A test method' },
      associations: [],
      meta: {
        created: new Date().toISOString(),
        updated: new Date().toISOString(),
        confidence: 0.9,
        usage_count: 0,
        status: 'active' as const,
      },
    };

    store.saveUnit(unit);
    const retrieved = store.getUnit('test_method_1');
    expect(retrieved).not.toBeNull();
    expect(retrieved!.id).toBe('test_method_1');
    expect(retrieved!.type).toBe('fact');
  });

  it('lists only active units by default', async () => {
    store.ensureDirs();
    store.saveUnit({
      id: 'active_1',
      type: 'fact' as const,
      summary: 'Active',
      signatures: [],
      content: { description: '' },
      associations: [],
      meta: { created: '', updated: '', confidence: 1, usage_count: 0, status: 'active' },
    });

    const units = await store.listUnits();
    expect(units.length).toBe(1);
    expect(units[0].id).toBe('active_1');
  });

  it('archives a unit', async () => {
    store.ensureDirs();
    store.saveUnit({
      id: 'to_archive',
      type: 'insight' as const,
      summary: 'To archive',
      signatures: [],
      content: { description: '' },
      associations: [],
      meta: { created: '', updated: '', confidence: 1, usage_count: 0, status: 'active' },
    });

    store.archiveUnit('to_archive');
    expect(store.getUnit('to_archive')).not.toBeNull(); // still available in archive

    // But not in active list
    const activeUnits = await store.listUnits();
    expect(activeUnits.find((u) => u.id === 'to_archive')).toBeUndefined();
  });

  it('saves and retrieves grid metadata', () => {
    store.ensureDirs();
    const grid = {
      version: '0.1.0',
      project: 'test',
      lastScanAt: new Date().toISOString(),
      stats: { totalUnits: 0, activeUnits: 0, archivedUnits: 0, totalAssociations: 0 },
      edgeIndex: {},
    };

    store.saveGrid(grid);
    const retrieved = store.getGrid();
    expect(retrieved!.project).toBe('test');
  });

  it('detects grid root and avoids .memgrid/ nesting', () => {
    // Simulate ~/.memgrid scenario: tmpDir/.memgrid with units/ and mesh.json
    const gridRoot = path.join(tmpDir, '.memgrid');
    fs.mkdirSync(path.join(gridRoot, 'units'), { recursive: true });
    fs.mkdirSync(path.join(gridRoot, 'archive'), { recursive: true });
    fs.writeFileSync(path.join(gridRoot, 'mesh.json'), '{"version":"0.1"}');

    const gridStore = new FileStore(gridRoot);
    expect(gridStore.gridDir).toBe(gridRoot);
    expect(gridStore.unitsDir).toBe(path.join(gridRoot, 'units'));
  });

  it('uses .memgrid/ subdirectory for normal project roots', () => {
    const projectRoot = path.join(tmpDir, 'my-project');
    fs.mkdirSync(projectRoot, { recursive: true });

    const projectStore = new FileStore(projectRoot);
    expect(projectStore.gridDir).toBe(path.join(projectRoot, '.memgrid'));
  });
});
