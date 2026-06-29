import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { MemoryDomain, UserGrid, DomainType } from '../shared/types.js';

const GRID_DIR_NAME = '.memgrid';
const USER_GRID_DIR = path.join(os.homedir(), GRID_DIR_NAME);
const SESSIONS_DIR = 'sessions';
const PERSONALITY_DIR = 'personality';

export class DomainManager {
  gridDir: string;

  constructor(gridDir?: string) {
    this.gridDir = gridDir || USER_GRID_DIR;
  }

  // ===== User Grid Init =====

  /** Initialize the user grid (~/.memgrid/) */
  initUserGrid(): { created: boolean; path: string } {
    fs.mkdirSync(this.gridDir, { recursive: true });
    fs.mkdirSync(path.join(this.gridDir, PERSONALITY_DIR), { recursive: true });
    fs.mkdirSync(path.join(this.gridDir, SESSIONS_DIR), { recursive: true });

    const meshPath = path.join(this.gridDir, 'mesh.json');
    if (fs.existsSync(meshPath)) {
      return { created: false, path: this.gridDir };
    }

    const grid: UserGrid = {
      version: '1.0',
      user: os.userInfo().username,
      createdAt: new Date().toISOString(),
      domains: [],
      crossDomainAssociations: [],
    };

    // Register personality domain
    grid.domains.push({
      name: 'personality',
      type: 'personality',
      path: path.join(this.gridDir, PERSONALITY_DIR),
      description: 'Personal preferences, style, and cross-project experience',
      enabled: true,
    });

    fs.writeFileSync(meshPath, JSON.stringify(grid, null, 2), 'utf-8');

    // Create personality README
    const personalityReadme = path.join(this.gridDir, PERSONALITY_DIR, 'README.md');
    fs.writeFileSync(
      personalityReadme,
      [
        '# Personality Domain',
        '',
        'This domain stores your personal preferences, coding style, debugging experience,',
        'and cross-project patterns. It follows you across all projects.',
        '',
        '## What goes here',
        '- Coding style preferences',
        '- Debugging experiences',
        '- Design decisions that apply across projects',
        '- Tool and workflow preferences',
        '',
        'Managed by MemGrid. Run `memgrid personality add` to contribute.',
      ].join('\n'),
      'utf-8',
    );

    return { created: true, path: this.gridDir };
  }

  // ===== Domain Registration =====

  /** Register a new domain in the user grid */
  registerDomain(domain: MemoryDomain): MemoryDomain {
    const grid = this.loadGrid();
    const existing = grid.domains.find((d) => d.name === domain.name);
    if (existing) {
      // Update path if changed
      existing.path = domain.path;
      existing.type = domain.type;
      existing.description = domain.description;
      this.saveGrid(grid);
      return existing;
    }

    grid.domains.push(domain);
    this.saveGrid(grid);
    return domain;
  }

  /** List all registered domains */
  listDomains(): MemoryDomain[] {
    const grid = this.loadGrid();
    return grid.domains;
  }

  /** Get a specific domain by name */
  getDomain(name: string): MemoryDomain | null {
    const grid = this.loadGrid();
    return grid.domains.find((d) => d.name === name) || null;
  }

  /** Find domain that matches a project path */
  findDomainByPath(projectPath: string): MemoryDomain | null {
    const grid = this.loadGrid();
    const abs = path.resolve(projectPath);
    return (
      grid.domains.find((d) => d.path === abs || d.path === path.join(abs, GRID_DIR_NAME)) || null
    );
  }

  /** Remove a domain from the user grid (does not delete files) */
  unregisterDomain(name: string): boolean {
    const grid = this.loadGrid();
    const idx = grid.domains.findIndex((d) => d.name === name);
    if (idx === -1) return false;
    grid.domains.splice(idx, 1);
    this.saveGrid(grid);
    return true;
  }

  // ===== Domain Detection =====

  /** Detect domain name from project directory */
  static detectDomainName(projectRoot: string): string {
    // Priority: package.json > pyproject.toml > go.mod > Cargo.toml > directory name
    const pkgPath = path.join(projectRoot, 'package.json');
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
        if (pkg.name) return pkg.name;
      } catch {
        /* ignore */
      }
    }
    return path.basename(projectRoot);
  }

  /** Detect domain type from project directory */
  static detectDomainType(projectRoot: string): DomainType {
    if (fs.existsSync(path.join(projectRoot, 'package.json'))) return 'project';
    if (fs.existsSync(path.join(projectRoot, 'go.mod'))) return 'project';
    if (fs.existsSync(path.join(projectRoot, 'Cargo.toml'))) return 'project';
    if (
      fs.existsSync(path.join(projectRoot, 'docker-compose.yml')) ||
      fs.existsSync(path.join(projectRoot, 'Dockerfile'))
    )
      return 'server';
    if (
      fs.existsSync(path.join(projectRoot, 'SOUL.md')) ||
      fs.existsSync(path.join(projectRoot, 'MEMORY.md'))
    )
      return 'agent-session';
    return 'custom';
  }

  // ===== Persistence =====

  private loadGrid(): UserGrid {
    const meshPath = path.join(this.gridDir, 'mesh.json');
    if (!fs.existsSync(meshPath)) {
      return {
        version: '1.0',
        user: os.userInfo().username,
        createdAt: new Date().toISOString(),
        domains: [],
        crossDomainAssociations: [],
      };
    }
    return JSON.parse(fs.readFileSync(meshPath, 'utf-8'));
  }

  private saveGrid(grid: UserGrid): void {
    fs.mkdirSync(this.gridDir, { recursive: true });
    fs.writeFileSync(path.join(this.gridDir, 'mesh.json'), JSON.stringify(grid, null, 2), 'utf-8');
  }
}
