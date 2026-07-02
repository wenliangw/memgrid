import * as fs from 'fs';
import * as path from 'path';
import type {
  MemoryUnit,
  MemoryGrid,
  MemoryUnitType,
  LegacyMemoryUnitType,
} from '../shared/types.js';
import { LEGACY_TYPE_MAP } from '../shared/types.js';

const GRID_DIR = '.memgrid';
const UNITS_DIR = 'units';
const ARCHIVE_DIR = 'archive';
const MESH_FILE = 'mesh.json';

/** Check if a directory is already a MemGrid root by looking for units/ or mesh.json */
function isGridRoot(dir: string): boolean {
  return fs.existsSync(path.join(dir, 'units')) || fs.existsSync(path.join(dir, 'mesh.json'));
}

export interface ListFilter {
  type?: MemoryUnitType;
  includeArchived?: boolean;
  includeCandidate?: boolean;
}

/**
 * File-based store with in-memory index cache.
 *
 * Units stored as JSON (not YAML) for maximum read/write performance.
 * First init/load: all JSON files read → JSON.parse → cached in Map.
 * After that: listUnits()/getUnit() are O(1) memory lookups.
 * saveUnit() writes to disk + updates cache instantly.
 */
export class FileStore {
  private projectRoot: string;

  // In-memory cache
  private cache: Map<string, MemoryUnit> = new Map();
  private archiveCache: Map<string, MemoryUnit> = new Map();
  private gridCache: MemoryGrid | null = null;
  private loaded = false;
  private dirtyUsage: Set<string> = new Set();

  constructor(projectRoot: string) {
    this.projectRoot = projectRoot;
  }

  // ===== Path helpers =====

  get gridDir(): string {
    // If projectRoot is already a MemGrid root (contains units/ or mesh.json),
    // don't append .memgrid/ again — prevents ~/.memgrid/.memgrid/ nesting.
    if (isGridRoot(this.projectRoot)) return this.projectRoot;
    return path.join(this.projectRoot, GRID_DIR);
  }
  get unitsDir(): string {
    return path.join(this.gridDir, UNITS_DIR);
  }
  get archiveDir(): string {
    return path.join(this.gridDir, ARCHIVE_DIR);
  }
  get meshPath(): string {
    return path.join(this.gridDir, MESH_FILE);
  }

  unitPath(id: string): string {
    return path.join(this.unitsDir, `${id}.json`);
  }

  archivePath(id: string): string {
    const year = new Date().getFullYear();
    const dir = path.join(this.archiveDir, String(year));
    fs.mkdirSync(dir, { recursive: true });
    return path.join(dir, `${id}.json`);
  }

  // ===== Initialization =====

  ensureDirs(): void {
    fs.mkdirSync(this.unitsDir, { recursive: true });
    fs.mkdirSync(this.archiveDir, { recursive: true });
  }

  /**
   * Load all JSON unit files into memory cache.
   * Supports both .json (new) and .yaml (legacy) for migration.
   */
  load(): { total: number; loadedMs: number } {
    const start = Date.now();
    this.ensureDirs();

    const parseUnit = (filePath: string): MemoryUnit | null => {
      try {
        const content = fs.readFileSync(filePath, 'utf-8');
        const raw = JSON.parse(content) as any;
        // Auto-migrate: old units with content.description → narrative
        if (raw.content?.description && !raw.narrative) {
          raw.narrative = raw.content.description;
        }
        // Auto-migrate: legacy type → new type
        if (LEGACY_TYPE_MAP[raw.type as LegacyMemoryUnitType]) {
          raw.type = LEGACY_TYPE_MAP[raw.type as LegacyMemoryUnitType];
        }
        // Ensure keywords exists
        if (!raw.keywords) raw.keywords = [];
        return raw as MemoryUnit;
      } catch {
        return null;
      }
    };

    // Load active units
    this.cache.clear();
    if (fs.existsSync(this.unitsDir)) {
      for (const file of fs.readdirSync(this.unitsDir)) {
        if (!file.endsWith('.json') && !file.endsWith('.yaml')) continue;
        const unit = parseUnit(path.join(this.unitsDir, file));
        if (unit) this.cache.set(unit.id, unit);
      }
    }

    // Load archived units
    this.archiveCache.clear();
    if (fs.existsSync(this.archiveDir)) {
      const walkArchive = (dir: string) => {
        if (!fs.existsSync(dir)) return;
        for (const entry of fs.readdirSync(dir)) {
          const full = path.join(dir, entry);
          if (fs.statSync(full).isDirectory()) {
            walkArchive(full);
          } else if (entry.endsWith('.json') || entry.endsWith('.yaml')) {
            const unit = parseUnit(full);
            if (unit) this.archiveCache.set(unit.id, unit);
          }
        }
      };
      walkArchive(this.archiveDir);
    }

    this.loaded = true;
    this.dirtyUsage.clear();

    return {
      total: this.cache.size + this.archiveCache.size,
      loadedMs: Date.now() - start,
    };
  }

  reload(): void {
    this.load();
  }

  // ===== Unit read (from cache) =====

  /**
   * Synchronous version of listUnits — only reads from in-memory cache.
   * Returns empty if cache not loaded yet. Call load() first.
   * Default filter: excludes 'candidate' and 'archived' units.
   */
  listUnitsSync(filter?: ListFilter): MemoryUnit[] {
    if (!this.loaded) return [];
    const results: MemoryUnit[] = [];

    for (const unit of this.cache.values()) {
      // Skip candidate units (not yet confirmed) unless explicitly included
      if (unit.meta.status === 'candidate' && !filter?.includeCandidate) continue;
      if (!filter?.type || unit.type === filter.type) results.push(unit);
    }

    if (filter?.includeArchived) {
      for (const unit of this.archiveCache.values()) {
        if (!filter?.type || unit.type === filter.type) results.push(unit);
      }
    }

    return results;
  }

  async listUnits(filter?: ListFilter): Promise<MemoryUnit[]> {
    this.ensureLoaded();
    const results: MemoryUnit[] = [];

    for (const unit of this.cache.values()) {
      // Skip candidate units (not yet confirmed) unless explicitly included
      if (unit.meta.status === 'candidate' && !filter?.includeCandidate) continue;
      if (!filter?.type || unit.type === filter.type) results.push(unit);
    }

    if (filter?.includeArchived) {
      for (const unit of this.archiveCache.values()) {
        if (!filter?.type || unit.type === filter.type) results.push(unit);
      }
    }

    return results;
  }

  getUnit(id: string): MemoryUnit | null {
    this.ensureLoaded();
    return this.cache.get(id) || this.archiveCache.get(id) || null;
  }

  // ===== Unit write (JSON → disk + cache) =====

  saveUnit(unit: MemoryUnit): void {
    this.ensureLoaded();
    // Auto-normalize: migrate old content.description → narrative
    if (!unit.narrative && (unit as any).content?.description) {
      unit.narrative = (unit as any).content.description;
    }
    if (!unit.narrative) unit.narrative = unit.summary || '';
    if (!unit.keywords) unit.keywords = [];
    // Auto-upgrade legacy type
    if (LEGACY_TYPE_MAP[unit.type as LegacyMemoryUnitType]) {
      (unit as any).type = LEGACY_TYPE_MAP[unit.type as LegacyMemoryUnitType];
    }
    const filePath = this.unitPath(unit.id);
    const jsonStr = JSON.stringify(unit, null, 2);
    fs.writeFileSync(filePath, jsonStr, 'utf-8');

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
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
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

    const jsonStr = JSON.stringify(unit, null, 2);
    fs.writeFileSync(toPath, jsonStr, 'utf-8');
    if (fs.existsSync(fromPath)) fs.unlinkSync(fromPath);

    this.cache.delete(id);
    this.archiveCache.set(id, unit);
  }

  touch(id: string): void {
    this.ensureLoaded();
    const unit = this.cache.get(id) || this.archiveCache.get(id);
    if (unit) {
      unit.meta.usage_count++;
      unit.meta.lastAccessedAt = new Date().toISOString();
      this.dirtyUsage.add(id);
    }
  }

  flushUsage(): { synced: number } {
    let synced = 0;
    for (const id of this.dirtyUsage) {
      const unit = this.cache.get(id) || this.archiveCache.get(id);
      if (unit) {
        const filePath = unit.meta.status === 'archived' ? this.archivePath(id) : this.unitPath(id);
        if (fs.existsSync(filePath)) {
          fs.writeFileSync(filePath, JSON.stringify(unit, null, 2), 'utf-8');
          synced++;
        }
      }
    }
    this.dirtyUsage.clear();
    return { synced };
  }

  saveUnits(units: MemoryUnit[]): { written: number; skipped: number } {
    this.ensureLoaded();
    let written = 0,
      skipped = 0;

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

  // ===== Grid =====

  getGrid(): MemoryGrid | null {
    if (this.gridCache) return this.gridCache;
    if (!fs.existsSync(this.meshPath)) return null;
    this.gridCache = JSON.parse(fs.readFileSync(this.meshPath, 'utf-8')) as MemoryGrid;
    return this.gridCache;
  }

  saveGrid(grid: MemoryGrid): void {
    this.gridCache = grid;
    fs.writeFileSync(this.meshPath, JSON.stringify(grid, null, 2), 'utf-8');
  }

  // ===== Stats =====

  getStats() {
    this.ensureLoaded();
    const typeDistribution: Record<string, number> = {};
    const tierDistribution: Record<string, number> = {};
    let active = 0;
    let candidate = 0;

    for (const unit of this.cache.values()) {
      typeDistribution[unit.type] = (typeDistribution[unit.type] || 0) + 1;
      if (unit.meta.status === 'active') active++;
      if (unit.meta.status === 'candidate') candidate++;
      const tier = unit.meta.tier || 'warm';
      tierDistribution[tier] = (tierDistribution[tier] || 0) + 1;
    }

    return {
      totalUnits: this.cache.size,
      activeUnits: active,
      candidateUnits: candidate,
      archivedUnits: this.archiveCache.size,
      typeDistribution,
      tierDistribution,
    };
  }

  private ensureLoaded(): void {
    if (!this.loaded) this.load();
  }

  private unitsEqual(a: MemoryUnit, b: MemoryUnit): boolean {
    return (
      a.summary === b.summary &&
      a.meta.status === b.meta.status &&
      a.meta.updated === b.meta.updated &&
      a.associations.length === b.associations.length &&
      a.narrative === b.narrative
    );
  }
}
