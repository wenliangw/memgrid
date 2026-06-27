import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import type { MemoryUnit, MemoryGrid } from '../shared/types.js';

const GRID_DIR = '.claude/memory-grid';
const UNITS_DIR = 'units';
const ARCHIVE_DIR = 'archive';
const MESH_FILE = 'mesh.json';

export class FileStore {
  private projectRoot: string;

  constructor(projectRoot: string) {
    this.projectRoot = projectRoot;
  }

  get gridDir(): string {
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

  // ===== Initialization =====

  ensureDirs(): void {
    fs.mkdirSync(this.unitsDir, { recursive: true });
    fs.mkdirSync(this.archiveDir, { recursive: true });
  }

  // ===== Unit CRUD =====

  unitPath(id: string): string {
    return path.join(this.unitsDir, `${id}.yaml`);
  }

  archivePath(id: string): string {
    const year = new Date().getFullYear();
    const dir = path.join(this.archiveDir, String(year));
    fs.mkdirSync(dir, { recursive: true });
    return path.join(dir, `${id}.yaml`);
  }

  async listUnits(filter?: { type?: string; includeArchived?: boolean }): Promise<MemoryUnit[]> {
    const units: MemoryUnit[] = [];

    // Active units
    if (fs.existsSync(this.unitsDir)) {
      for (const file of fs.readdirSync(this.unitsDir)) {
        if (file.endsWith('.yaml')) {
          const content = fs.readFileSync(path.join(this.unitsDir, file), 'utf-8');
          const unit = yaml.load(content) as MemoryUnit;
          if (!filter?.type || unit.type === filter.type) {
            units.push(unit);
          }
        }
      }
    }

    // Archived units
    if (filter?.includeArchived && fs.existsSync(this.archiveDir)) {
      for (const yearDir of fs.readdirSync(this.archiveDir)) {
        const archiveYearDir = path.join(this.archiveDir, yearDir);
        if (!fs.statSync(archiveYearDir).isDirectory()) continue;
        for (const file of fs.readdirSync(archiveYearDir)) {
          if (file.endsWith('.yaml')) {
            const content = fs.readFileSync(path.join(archiveYearDir, file), 'utf-8');
            const unit = yaml.load(content) as MemoryUnit;
            if (!filter?.type || unit.type === filter.type) {
              units.push(unit);
            }
          }
        }
      }
    }

    return units;
  }

  getUnit(id: string): MemoryUnit | null {
    const filePath = this.unitPath(id);
    if (!fs.existsSync(filePath)) return null;
    const content = fs.readFileSync(filePath, 'utf-8');
    return yaml.load(content) as MemoryUnit;
  }

  saveUnit(unit: MemoryUnit): void {
    const filePath = this.unitPath(unit.id);
    const yamlStr = yaml.dump(unit, { lineWidth: 120, noRefs: true });
    fs.writeFileSync(filePath, yamlStr, 'utf-8');
  }

  deleteUnit(id: string): void {
    const filePath = this.unitPath(id);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  }

  archiveUnit(id: string): void {
    const unit = this.getUnit(id);
    if (!unit) return;

    const fromPath = this.unitPath(id);
    const toPath = this.archivePath(id);

    unit.meta.status = 'archived';
    unit.meta.updated = new Date().toISOString();

    const yamlStr = yaml.dump(unit, { lineWidth: 120, noRefs: true });
    fs.writeFileSync(toPath, yamlStr, 'utf-8');
    fs.unlinkSync(fromPath);
  }

  // ===== Grid (mesh.json) =====

  getGrid(): MemoryGrid | null {
    if (!fs.existsSync(this.meshPath)) return null;
    const content = fs.readFileSync(this.meshPath, 'utf-8');
    return JSON.parse(content) as MemoryGrid;
  }

  saveGrid(grid: MemoryGrid): void {
    fs.writeFileSync(this.meshPath, JSON.stringify(grid, null, 2), 'utf-8');
  }
}
