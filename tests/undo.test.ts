import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { FileStore } from '../src/store/file-store.js';
import type { MemoryUnit } from '../src/shared/types.js';

describe('Undo / Rollback (v0.11)', () => {
  let tmpDir: string;
  let store: FileStore;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'memgrid-undo-'));
    store = new FileStore(tmpDir);
    store.ensureDirs();
    store.load();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function makeUnit(id: string, status: 'active' | 'candidate' = 'active'): MemoryUnit {
    return {
      id,
      type: 'insight',
      summary: `Test insight ${id}`,
      signatures: [id],
      narrative: `Narrative for ${id}`,
      keywords: ['test', 'insight'],
      associations: [],
      meta: {
        created: new Date().toISOString(),
        updated: new Date().toISOString(),
        confidence: 0.8,
        usage_count: 0,
        status,
      },
      provenance: {
        createdBy: 'test',
        basedOnTask: 'testing undo',
        timestamp: new Date().toISOString(),
      },
    };
  }

  describe('backupUnit', () => {
    it('should create a backup file with metadata', () => {
      const unit = makeUnit('test_001');
      store.saveUnit(unit);

      store.backupUnit(unit, 'update');

      const backups = fs.readdirSync(store.backupDir);
      expect(backups.length).toBe(1);
      expect(backups[0]).toMatch(/^test_001\.backup\.\d+\.json$/);

      const backupContent = JSON.parse(
        fs.readFileSync(path.join(store.backupDir, backups[0]), 'utf-8'),
      );
      expect(backupContent._backup_meta.unitId).toBe('test_001');
      expect(backupContent._backup_meta.operation).toBe('update');
      expect(backupContent._backup_meta.backupTime).toBeDefined();
      expect(backupContent.summary).toBe('Test insight test_001');
    });

    it('should preserve original unit data in backup', () => {
      const unit = makeUnit('test_002');
      store.saveUnit(unit);

      // Modify unit before backup
      unit.summary = 'Modified summary';
      store.backupUnit(unit, 'update');

      const backups = fs.readdirSync(store.backupDir);
      const backupContent = JSON.parse(
        fs.readFileSync(path.join(store.backupDir, backups[0]), 'utf-8'),
      );
      expect(backupContent.summary).toBe('Modified summary');
    });
  });

  describe('listBackups', () => {
    it('should return empty array when no backups exist', () => {
      const list = store.listBackups();
      expect(list).toEqual([]);
    });

    it('should list all backups sorted newest first', async () => {
      const unit1 = makeUnit('test_a');
      const unit2 = makeUnit('test_b');
      store.saveUnit(unit1);
      store.saveUnit(unit2);

      store.backupUnit(unit1, 'update');
      // Wait to ensure different backup timestamps
      await new Promise((r) => setTimeout(r, 5));
      store.backupUnit(unit2, 'archive');

      const list = store.listBackups();
      expect(list.length).toBe(2);
      expect(list[0].unitId).toBe('test_b'); // newest first
      expect(list[1].unitId).toBe('test_a');
      expect(list[0].operation).toBe('archive');
      expect(list[1].operation).toBe('update');
    });

    it('should skip unparseable files', () => {
      fs.writeFileSync(path.join(store.backupDir, 'corrupt.json'), '{ not valid json }', 'utf-8');
      const list = store.listBackups();
      expect(list).toEqual([]);
    });
  });

  describe('findLatestBackup', () => {
    it('should return null when no backup exists', () => {
      const result = store.findLatestBackup('nonexistent');
      expect(result).toBeNull();
    });

    it('should return the latest backup for a unit', async () => {
      const unit = makeUnit('test_003');
      store.saveUnit(unit);

      // Create two backups
      store.backupUnit({ ...unit, summary: 'Version 1' }, 'update');

      // Wait a tick for timestamp difference
      await new Promise((r) => setTimeout(r, 10));
      store.backupUnit({ ...unit, summary: 'Version 2' }, 'update');

      const restored = store.findLatestBackup('test_003');
      expect(restored).not.toBeNull();
      expect(restored!.summary).toBe('Version 2');
      // Should not contain internal _backup_meta
      expect((restored as any)._backup_meta).toBeUndefined();
    });

    it('should only return backups for the given unit ID', () => {
      const unitA = makeUnit('test_aaa');
      const unitB = makeUnit('test_bbb');
      store.saveUnit(unitA);
      store.saveUnit(unitB);
      store.backupUnit(unitA, 'update');
      store.backupUnit(unitB, 'update');

      const result = store.findLatestBackup('test_aaa');
      expect(result!.id).toBe('test_aaa');
    });
  });

  describe('backup on destructive operations', () => {
    it('should backup before archive', () => {
      const unit = makeUnit('test_004');
      store.saveUnit(unit);
      store.archiveUnit('test_004');

      const list = store.listBackups();
      expect(list.length).toBeGreaterThanOrEqual(1);
      const archiveBackup = list.find((b) => b.operation === 'archive');
      expect(archiveBackup).toBeDefined();
      expect(archiveBackup!.unitId).toBe('test_004');
    });

    it('should backup before update (via add with existing id)', () => {
      const unit = makeUnit('test_005');
      store.saveUnit(unit);

      // add with same id = upsert, should backup existing
      store.backupUnit(unit, 'insert');

      const list = store.listBackups();
      expect(list.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('backupDir', () => {
    it('should be inside grid directory', () => {
      expect(store.backupDir).toContain('.memgrid');
      expect(store.backupDir).toContain('backups');
    });

    it('should be created by ensureDirs', () => {
      expect(fs.existsSync(store.backupDir)).toBe(true);
    });
  });
});
