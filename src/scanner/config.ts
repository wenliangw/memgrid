import * as path from 'path';
import * as fs from 'fs';
import type { MemoryUnit, ScanOptions } from '../shared/types.js';
import type { Scanner } from './scanner.js';

/**
 * Shared scanner for project config files (package.json, docker-compose.yml, etc.).
 * Applies to any project regardless of language.
 */
export class ConfigScanner implements Scanner {
  readonly name = 'config';
  private projectRoot: string;

  constructor(projectRoot: string) {
    this.projectRoot = projectRoot;
  }

  detect(projectRoot: string): boolean {
    return (
      fs.existsSync(path.join(projectRoot, 'package.json')) ||
      fs.existsSync(path.join(projectRoot, 'docker-compose.yml')) ||
      fs.existsSync(path.join(projectRoot, 'pyproject.toml')) ||
      fs.existsSync(path.join(projectRoot, 'go.mod')) ||
      fs.existsSync(path.join(projectRoot, 'Cargo.toml'))
    );
  }

  async scan(_options: ScanOptions): Promise<MemoryUnit[]> {
    const units: MemoryUnit[] = [];

    // package.json (Node.js)
    const pkgPath = path.join(this.projectRoot, 'package.json');
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
        const deps = { ...pkg.dependencies, ...pkg.devDependencies };
        const keyDeps = Object.entries(deps as Record<string, string>)
          .filter(([name]) =>
            [
              'next',
              'react',
              'nestjs',
              'typeorm',
              'chakra',
              'zustand',
              'swr',
              'pnpm',
              'typescript',
              'express',
              'fastify',
              'prisma',
            ].some((k) => name.includes(k)),
          )
          .map(([name, ver]) => `${name}@${ver}`);

        if (keyDeps.length > 0) {
          units.push({
            id: 'config_tech_stack_js',
            type: 'config',
            summary: `JS tech stack: ${keyDeps.slice(0, 8).join(', ')}`,
            source: { file: 'package.json' },
            signatures: ['tech stack', 'dependencies', 'npm', 'node', '技术栈'],
            content: { description: `Key dependencies: ${keyDeps.join(', ')}` },
            associations: [],
            meta: {
              created: new Date().toISOString(),
              updated: new Date().toISOString(),
              confidence: 0.95,
              usage_count: 0,
              status: 'active',
            },
          });
        }
      } catch {
        /* JSON parse error, skip */
      }
    }

    // pyproject.toml (Python)
    const pyProjectPath = path.join(this.projectRoot, 'pyproject.toml');
    if (fs.existsSync(pyProjectPath)) {
      try {
        const content = fs.readFileSync(pyProjectPath, 'utf-8');
        const depsMatch = content.match(/dependencies\s*=\s*\[([\s\S]*?)\]/);
        const optDeps = content.match(/optional-dependencies\s*=\s*\{/);
        const deps = depsMatch
          ? depsMatch[1].match(/"([^"]+)"/g)?.map((d) => d.replace(/"/g, '')) || []
          : [];

        units.push({
          id: 'config_tech_stack_python',
          type: 'config',
          summary: `Python project${deps.length ? ': ' + deps.slice(0, 5).join(', ') : ''}`,
          source: { file: 'pyproject.toml' },
          signatures: ['tech stack', 'dependencies', 'python', 'pyproject'],
          content: { description: `Python project. Dependencies: ${deps.join(', ') || 'unknown'}` },
          associations: [],
          meta: {
            created: new Date().toISOString(),
            updated: new Date().toISOString(),
            confidence: 0.9,
            usage_count: 0,
            status: 'active',
          },
        });
      } catch {
        /* parse error, skip */
      }
    }

    // go.mod (Go)
    const goModPath = path.join(this.projectRoot, 'go.mod');
    if (fs.existsSync(goModPath)) {
      const content = fs.readFileSync(goModPath, 'utf-8');
      const moduleMatch = content.match(/^module\s+(\S+)/m);
      const goMatch = content.match(/^go\s+(\S+)/m);
      const deps =
        content
          .match(/^\s+(\S+)\s+v[\d.]+/gm)
          ?.map((l) => l.trim().split(/\s+/)[0])
          .slice(0, 10) || [];

      units.push({
        id: 'config_tech_stack_go',
        type: 'config',
        summary: `Go module: ${moduleMatch?.[1] || 'unknown'} (go ${goMatch?.[1] || '?'})`,
        source: { file: 'go.mod' },
        signatures: ['tech stack', 'dependencies', 'go', 'golang'],
        content: {
          description: `Go module ${moduleMatch?.[1] || 'unknown'}. Dependencies: ${deps.join(', ') || 'none'}`,
        },
        associations: [],
        meta: {
          created: new Date().toISOString(),
          updated: new Date().toISOString(),
          confidence: 0.9,
          usage_count: 0,
          status: 'active',
        },
      });
    }

    // Cargo.toml (Rust)
    const cargoPath = path.join(this.projectRoot, 'Cargo.toml');
    if (fs.existsSync(cargoPath)) {
      const content = fs.readFileSync(cargoPath, 'utf-8');
      const nameMatch = content.match(/^name\s*=\s*"([^"]+)"/m);
      const deps =
        content
          .match(/(\[dependencies.*?\n)([\s\S]*?)(?=\n\[|$)/)?.[2]
          ?.match(/^(\w+)\s*=/gm)
          ?.map((d) => d.replace(' =', '').trim()) || [];

      units.push({
        id: 'config_tech_stack_rust',
        type: 'config',
        summary: `Rust crate: ${nameMatch?.[1] || 'unknown'}`,
        source: { file: 'Cargo.toml' },
        signatures: ['tech stack', 'dependencies', 'rust', 'cargo'],
        content: {
          description: `Rust crate ${nameMatch?.[1] || 'unknown'}. Dependencies: ${deps.join(', ') || 'unknown'}`,
        },
        associations: [],
        meta: {
          created: new Date().toISOString(),
          updated: new Date().toISOString(),
          confidence: 0.9,
          usage_count: 0,
          status: 'active',
        },
      });
    }

    // docker-compose.yml
    const composePath = path.join(this.projectRoot, 'docker-compose.yml');
    if (fs.existsSync(composePath)) {
      const compose = fs.readFileSync(composePath, 'utf-8');
      const serviceMatches = compose.match(/container_name:\s*(\S+)/g) || [];
      const services = serviceMatches.map((m) => m.replace('container_name:', '').trim());
      const dbMatch = compose.match(/image:\s*(mysql|postgres|mongo|redis|elasticsearch)/gi) || [];

      if (services.length > 0) {
        units.push({
          id: 'config_docker_services',
          type: 'config',
          summary: `Docker services: ${services.join(', ')}`,
          source: { file: 'docker-compose.yml' },
          signatures: ['docker', 'infrastructure', 'services', '容器'],
          content: {
            description: `Services: ${services.join(', ')}. Databases: ${dbMatch.join(', ') || 'none'}`,
          },
          associations: [],
          meta: {
            created: new Date().toISOString(),
            updated: new Date().toISOString(),
            confidence: 0.9,
            usage_count: 0,
            status: 'active',
          },
        });
      }
    }

    return units;
  }

  async scanFiles(_files: string[], _options: ScanOptions): Promise<MemoryUnit[]> {
    return this.scan(_options);
  }
}
