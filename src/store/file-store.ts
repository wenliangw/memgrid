import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import type { MemoryUnit, MemoryGrid, MemoryUnitType } from '../shared/types.js';

const GRID_DIR = '.claude/memory-grid';
const UNITS_DIR = 'units';
const ARCHIVE_DIR = 'archive';
const MESH_FILE = 'mesh.json';

export interface ListFilter {
  type?: MemoryUnitType;
  includeArchived?: boolean;
}

/**
 * File-based store with in-memory index cache.
 *
 * First init/load: all YAML files read → parsed → cached in Map.
 * After that: listUnits()/getUnit() are O(1) memory lookups.
 * saveUnit() writes to disk + updates cache instantly.
 * Periodic sync: usage_count and meta changes flushed back to disk.
 */
export class FileStore {
  private projectRoot: string;

  // In-memory cache — the performance heart
  private cache: Map<string, MemoryUnit> = new Map();
  private archiveCache: Map<string, MemoryUnit> = new Map();
  private gridCache: MemoryGrid | null = null;
  private loaded = false;

  // Dirty tracking: IDs of units whose usage_count has changed since last sync
  private dirtyUsage: Set<string> = new Set();

  constructor(projectRoot: string) {
    this.projectRoot = projectRoot;
  }

  // ===== Path helpers =====

  get gridDir(): string { return path.join(this.projectRoot, GRID_DIR); }
  get unitsDir(): string { return path.join(this.gridDir, UNITS_DIR); }
  get archiveDir(): string { return path.join(this.gridDir, ARCHIVE_DIR); }
  get meshPath(): string { return path.join(this.gridDir, MESH_FILE); }

  unitPath(id: string): string {
    return path.join(this.unitsDir, `${id}.yaml`);
  }

  archivePath(id: string): string {
    const year = new Date().getFullYear();
    const dir = path.join(this.archiveDir, String(year));
    fs.mkdirSync(dir, { recursive: true });
    return path.join(dir, `${id}.yaml`);
  }

  // ===== Initialization =====

  ensureDirs(): void {
    fs.mkdirSync(this.unitsDir, { recursive: true });
    fs.mkdirSync(this.archiveDir, { recursive: true });
  }

  /**
   * Load all YAML files into memory cache.
   * Called once at startup. After this, listUnits/getUnit are O(1).
   */
  load(): { total: number; loadedMs: number } {
    const start = Date.now();
    this.ensureDirs();

    // Load active units
    this.cache.clear();
    if (fs.existsSync(this.unitsDir)) {
      for (const file of fs.readdirSync(this.unitsDir)) {
        if (!file.endsWith('.yaml')) continue;
        try {
          const content = fs.readFileSync(path.join(this.unitsDir, file), 'utf-8');
          const unit = yaml.load(content) as MemoryUnit;
          this.cache.set(unit.id, unit);
        } catch {
          // Skip corrupted files
        }
      }
    }

    // Load archived units
    this.archiveCache.clear();
    if (fs.existsSync(this.archiveDir)) {
      for (const yearDir of fs.readdirSync(this.archiveDir)) {
        const archiveYearDir = path.join(this.archiveDir, yearDir);
        if (!fs.statSync(archiveYearDir).isDirectory()) continue;
        for (const file of fs.readdirSync(archiveYearDir)) {
          if (!file.endsWith('.yaml')) continue;
          try {
            const content = fs.readFileSync(path.join(archiveYearDir, file), 'utf-8');
            const unit = yaml.load(content) as MemoryUnit;
            this.archiveCache.set(unit.id, unit);
          } catch {
            // Skip corrupted files
          }
        }
      }
    }

    this.loaded = true;
    this.dirtyUsage.clear();

    return {
      total: this.cache.size + this.archiveCache.size,
      loadedMs: Date.now() - start,
    };
  }

  /** Reload from disk (e.g., after external edit) */
  reload(): void {
    this.load();
  }

  // ===== Unit read (from cache) =====

  async listUnits(filter?: ListFilter): Promise<MemoryUnit[]> {
    this.ensureLoaded();

    const results: MemoryUnit[] = [];

    // Active units from cache
    for (const unit of this.cache.values()) {
      if (!filter?.type || unit.type === filter.type) {
        results.push(unit);
      }
    }

    // Archived units
    if (filter?.includeArchived) {
      for (const unit of this.archiveCache.values()) {
        if (!filter?.type || unit.type === filter.type) {
          results.push(unit);
        }
      }
    }

    return results;
  }

  getUnit(id: string): MemoryUnit | null {
    this.ensureLoaded();
    return this.cache.get(id) || this.archiveCache.get(id) || null;
  }

  // ===== Unit write (to disk + cache) =====

  saveUnit(unit: MemoryUnit): void {
    this.ensureLoaded();
    const filePath = this.unitPath(unit.id);
    const yamlStr = yaml.dump(unit, { lineWidth: 120, noRefs: true });
    fs.writeFileSync(filePath, yamlStr, 'utf-8');

    // Update cache
    if (unit.meta.status === 'archived') {
      this.cache.delete(unit.id);
      this.archiveCache.set(unit.id, unit);
    } else {
      this.cache.set(unit.id, unit);
    }
  }

  deleteUnit(id: string): void {
    this.ensureLoaded();
    const filePath = this.unitPath(id);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
    this.cache.delete(id);
    this.archiveCache.delete(id);
  }

  archiveUnit(id: string): void {
    this.ensureLoaded();
    const unit = this.cache.get(id);
    if (!unit) return;

    const fromPath = this.unitPath(id);
    const toPath = this.archivePath(id);

    unit.meta.status = 'archived';
    unit.meta.updated = new Date().toISOString();

    const yamlStr = yaml.dump(unit, { lineWidth: 120, noRefs: true });
    fs.writeFileSync(toPath, yamlStr, 'utf-8');

    if (fs.existsSync(fromPath)) fs.unlinkSync(fromPath);

    // Update cache
    this.cache.delete(id);
    this.archiveCache.set(id, unit);
  }

  /**
   * Increment usage count (in-memory only, flushed on sync)
   */
  touch(id: string): void {
    this.ensureLoaded();
    const unit = this.cache.get(id) || this.archiveCache.get(id);
    if (unit) {
      unit.meta.usage_count++;
      this.dirtyUsage.add(id);
    }
  }

  /**
   * Flush dirty usage counts back to disk.
   * Call periodically or on shutdown.
   */
  flushUsage(): { synced: number } {
    let synced = 0;
    for (const id of this.dirtyUsage) {
      const unit = this.cache.get(id) || this.archiveCache.get(id);
      if (unit) {
        const filePath = unit.meta.status === 'archived'
          ? this.archivePath(id)
          : this.unitPath(id);
        if (fs.existsSync(filePath)) {
          const yamlStr = yaml.dump(unit, { lineWidth: 120, noRefs: true });
          fs.writeFileSync(filePath, yamlStr, 'utf-8');
          synced++;
        }
      }
    }
    this.dirtyUsage.clear();
    return { synced };
  }

  // ===== Batch operations (fast, single-pass) =====

  /**
   * Save many units at once. Only writes changed ones to disk.
   */
  saveUnits(units: MemoryUnit[]): { written: number; skipped: number } {
    this.ensureLoaded();
    let written = 0;
    let skipped = 0;

    for (const unit of units) {
      const existing = this.cache.get(unit.id);
      if (existing && this.unitsEqual(existing, unit)) {
        skipped++;
      } else {
        this.saveUnit(unit);
        written++;
      }
    }

    return { written, skipped };
  }

  // ===== Grid (mesh.json) =====

  getGrid(): MemoryGrid | null {
    if (this.gridCache) return this.gridCache;
    if (!fs.existsSync(this.meshPath)) return null;
    const content = fs.readFileSync(this.meshPath, 'utf-8');
    this.gridCache = JSON.parse(content) as MemoryGrid;
    return this.gridCache;
  }

  saveGrid(grid: MemoryGrid): void {
    this.gridCache = grid;
    fs.writeFileSync(this.meshPath, JSON.stringify(grid, null, 2), 'utf-8');
  }

  // ===== Stats (from cache, no disk I/O) =====

  getStats() {
    this.ensureLoaded();
    const typeDistribution: Record<string, number> = {};
    let active = 0;

    for (const unit of this.cache.values()) {
      typeDistribution[unit.type] = (typeDistribution[unit.type] || 0) + 1;
      if (unit.meta.status === 'active') active++;
    }

    return {
      totalUnits: this.cache.size,
      activeUnits: active,
      archivedUnits: this.archiveCache.size,
      typeDistribution,
    };
  }

  // ===== Cache management =====

  private ensureLoaded(): void {
    if (!this.loaded) {
      this.load();
    }
  }

  /**
   * Quick equality check for units (compare key fields only).
   * Avoids writing to disk if nothing changed.
   */
  private unitsEqual(a: MemoryUnit, b: MemoryUnit): boolean {
    return (
      a.summary === b.summary &&
      a.meta.status === b.meta.status &&
      a.meta.updated === b.meta.updated &&
      a.associations.length === b.associations.length &&
      a.content.description === b.content.description
    );
  }
}
