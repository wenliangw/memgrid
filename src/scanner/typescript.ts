import * as path from 'path';
import * as fs from 'fs';
import { Project, SyntaxKind } from 'ts-morph';
import type { MemoryUnit, MemoryGrid, Association, ScanOptions } from '../shared/types.js';
import type { FileStore } from '../store/file-store.js';

export class TypeScriptScanner {
  private store: FileStore;
  private projectRoot: string;

  constructor(store: FileStore, projectRoot: string) {
    this.store = store;
    this.projectRoot = projectRoot;
  }

  async scan(options: ScanOptions): Promise<MemoryUnit[]> {
    const units: MemoryUnit[] = [];

    this.store.ensureDirs();

    // 1. Scan TypeScript source files
    units.push(...await this.scanTypeScript());

    // 2. Scan .claude/rules/ for patterns
    if (options.includeRules) {
      units.push(...await this.scanRules());
    }

    // 3. Scan .claude/examples/ for patterns
    if (options.includeExamples) {
      units.push(...await this.scanExamples());
    }

    // 4. Scan config files
    units.push(...await this.scanConfig());

    // 5. Build associations
    this.buildAssociations(units);

    // 6. Save all units
    for (const unit of units) {
      this.store.saveUnit(unit);
    }

    // 7. Update mesh.json
    this.updateGrid(units);

    return units;
  }

  private async scanTypeScript(): Promise<MemoryUnit[]> {
    const units: MemoryUnit[] = [];

    const tsConfigPath = path.join(this.projectRoot, 'tsconfig.json');
    const appsDir = path.join(this.projectRoot, 'apps');

    if (!fs.existsSync(tsConfigPath) && !fs.existsSync(appsDir)) {
      return units;
    }

    const project = new Project({
      tsConfigFilePath: fs.existsSync(tsConfigPath) ? tsConfigPath : undefined,
      skipAddingFilesFromTsConfig: false,
    });

    // Add source files if no tsconfig
    if (!fs.existsSync(tsConfigPath)) {
      const srcDirs = this.findSourceDirs();
      for (const dir of srcDirs) {
        project.addSourceFilesAtPaths(`${dir}/**/*.ts`);
      }
    }

    for (const sourceFile of project.getSourceFiles()) {
      const filePath = path.relative(this.projectRoot, sourceFile.getFilePath());

      // Skip test files, node_modules, dist, .next
      if (filePath.includes('node_modules') || filePath.includes('dist') || filePath.includes('.next')) continue;
      if (filePath.endsWith('.spec.ts') || filePath.endsWith('.test.ts')) continue;

      // Extract classes with public methods
      for (const cls of sourceFile.getClasses()) {
        const className = cls.getName();
        if (!className || cls.isAbstract()) continue;

        for (const method of cls.getMethods()) {
          const scope = method.getScope();
          if (scope !== 'public' && scope !== undefined) continue; // skip private/protected

          const methodName = method.getName();
          const signature = `${className}.${methodName}`;

          const params = method.getParameters().map((p) => {
            const type = p.getType().getText();
            return `${p.getName()}: ${type}`;
          });

          const returnType = method.getReturnType().getText();

          const unit: MemoryUnit = {
            id: `method_${signature.toLowerCase().replace(/\./g, '_').replace(/[^a-z0-9_]/g, '_').replace(/_+/g, '_')}`,
            type: 'method',
            summary: `${signature} — ${this.extractJsDoc(method)}`,
            source: {
              file: filePath,
              lines: `${method.getStartLineNumber()}-${method.getEndLineNumber()}`,
            },
            signatures: [signature],
            content: {
              description: this.extractJsDoc(method) || `${signature}()`,
              inputs: params.length > 0 ? params.join(', ') : 'none',
              outputs: returnType,
              dependencies: this.extractDependencies(method),
              code_snippet: method.getText().split('\n').slice(0, 15).join('\n'), // first 15 lines
            },
            associations: [],
            meta: {
              created: new Date().toISOString(),
              updated: new Date().toISOString(),
              confidence: 0.8, // AST extraction, high confidence
              usage_count: 0,
              status: 'active',
            },
          };

          units.push(unit);
        }
      }

      // Extract exported functions
      for (const func of sourceFile.getFunctions()) {
        if (!func.isExported()) continue;

        const funcName = func.getName();
        if (!funcName) continue;

        const params = func.getParameters().map((p) => {
          const type = p.getType().getText();
          return `${p.getName()}: ${type}`;
        });

        const returnType = func.getReturnType().getText();

        const unit: MemoryUnit = {
          id: `func_${funcName.toLowerCase().replace(/[^a-z0-9_]/g, '_')}`,
          type: 'method',
          summary: `${funcName}() — ${this.extractJsDoc(func)}`,
          source: {
            file: filePath,
            lines: `${func.getStartLineNumber()}-${func.getEndLineNumber()}`,
          },
          signatures: [funcName],
          content: {
            description: this.extractJsDoc(func) || `${funcName}()`,
            inputs: params.length > 0 ? params.join(', ') : 'none',
            outputs: returnType,
            code_snippet: func.getText().split('\n').slice(0, 10).join('\n'),
          },
          associations: [],
          meta: {
            created: new Date().toISOString(),
            updated: new Date().toISOString(),
            confidence: 0.8,
            usage_count: 0,
            status: 'active',
          },
        };

        units.push(unit);
      }
    }

    return units;
  }

  private async scanRules(): Promise<MemoryUnit[]> {
    const units: MemoryUnit[] = [];
    const rulesDir = path.join(this.projectRoot, '.claude', 'rules');
    if (!fs.existsSync(rulesDir)) return units;

    for (const file of fs.readdirSync(rulesDir)) {
      if (!file.endsWith('.md')) continue;

      const filePath = path.join(rulesDir, file);
      const content = fs.readFileSync(filePath, 'utf-8');
      const relativePath = path.relative(this.projectRoot, filePath);

      // Extract sections from markdown
      const sections = content.split(/^## /m).filter(Boolean);
      for (const section of sections) {
        const title = section.split('\n')[0].trim();
        const body = section.split('\n').slice(1).join('\n').trim();

        if (!title || body.length < 50) continue;

        const safeTitle = title.replace(/[^a-zA-Z0-9_\-]/g, '_').replace(/_+/g, '_').slice(0, 50).toLowerCase();
        const safeFile = file.replace('.md', '').replace(/[^a-zA-Z0-9_\-]/g, '_').replace(/_+/g, '_').slice(0, 30).toLowerCase();

        const unit: MemoryUnit = {
          id: `rule_${safeFile}_${safeTitle}`,
          type: 'pattern',
          summary: `${file.replace('.md', '')}: ${title}`,
          source: { file: relativePath },
          signatures: [title, file.replace('.md', '').replace(/-/g, ' ')],
          content: {
            description: body.slice(0, 500),
          },
          associations: [],
          meta: {
            created: new Date().toISOString(),
            updated: new Date().toISOString(),
            confidence: 0.9,
            usage_count: 0,
            status: 'active',
          },
        };

        units.push(unit);
      }

      // Also create a rule_trigger unit
      const safeFile = file.replace('.md', '').replace(/[^a-zA-Z0-9_\-]/g, '_').replace(/_+/g, '_').slice(0, 30).toLowerCase();
      const triggerUnit: MemoryUnit = {
        id: `trigger_rule_${safeFile}`,
        type: 'rule_trigger',
        summary: `When working on ${file.replace('.md', '').replace(/-/g, ' ')} → load ${file}`,
        source: { file: relativePath },
        signatures: [file.replace('.md', '').replace(/-/g, ' ')],
        content: {
          description: `Load ${relativePath} when working on relevant code`,
          trigger: `Working on ${file.replace('.md', '').replace(/-/g, ' ')} related code`,
          action: `Load ${relativePath}`,
        },
        associations: [],
        meta: {
          created: new Date().toISOString(),
          updated: new Date().toISOString(),
          confidence: 0.8,
          usage_count: 0,
          status: 'active',
        },
      };

      units.push(triggerUnit);
    }

    return units;
  }

  private async scanExamples(): Promise<MemoryUnit[]> {
    const units: MemoryUnit[] = [];
    const examplesDir = path.join(this.projectRoot, '.claude', 'examples');
    if (!fs.existsSync(examplesDir)) return units;

    const scanDir = (dir: string, isBad: boolean) => {
      if (!fs.existsSync(dir)) return;
      for (const file of fs.readdirSync(dir)) {
        if (!file.endsWith('.ts')) continue;
        const filePath = path.join(dir, file);
        const content = fs.readFileSync(filePath, 'utf-8');
        const relativePath = path.relative(this.projectRoot, filePath);

        const unit: MemoryUnit = {
          id: `example_${isBad ? 'bad' : 'good'}_${file.replace('.ts', '')}`,
          type: isBad ? 'error_solution' : 'pattern',
          summary: `${isBad ? '❌ Bad' : '✅ Good'} example: ${file.replace('.ts', '').replace(/-/g, ' ')}`,
          source: { file: relativePath },
          signatures: [file.replace('.ts', '').replace(/-/g, ' ')],
          content: {
            description: `${isBad ? 'Anti-pattern to avoid' : 'Recommended pattern'}: ${file}`,
            code_snippet: content.slice(0, 800),
          },
          associations: [],
          meta: {
            created: new Date().toISOString(),
            updated: new Date().toISOString(),
            confidence: 0.9,
            usage_count: 0,
            status: 'active',
          },
        };

        units.push(unit);
      }
    };

    scanDir(path.join(examplesDir, 'server', 'good'), false);
    scanDir(path.join(examplesDir, 'server', 'bad'), true);
    scanDir(path.join(examplesDir, 'web', 'good'), false);
    scanDir(path.join(examplesDir, 'web', 'bad'), true);

    return units;
  }

  private async scanConfig(): Promise<MemoryUnit[]> {
    const units: MemoryUnit[] = [];

    // package.json
    const pkgPath = path.join(this.projectRoot, 'package.json');
    if (fs.existsSync(pkgPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };
      const keyDeps = Object.entries(deps as Record<string, string>)
        .filter(([name]) =>
          ['next', 'react', 'nestjs', 'typeorm', 'chakra', 'zustand', 'swr', 'pnpm', 'typescript'].some((k) =>
            name.includes(k),
          ),
        )
        .map(([name, ver]) => `${name}@${ver}`);

      if (keyDeps.length > 0) {
        units.push({
          id: 'config_tech_stack',
          type: 'config',
          summary: `Tech stack: ${keyDeps.slice(0, 8).join(', ')}`,
          source: { file: 'package.json' },
          signatures: ['tech stack', 'dependencies', '技术栈'],
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
    }

    // docker-compose.yml
    const composePath = path.join(this.projectRoot, 'docker-compose.yml');
    if (fs.existsSync(composePath)) {
      const compose = fs.readFileSync(composePath, 'utf-8');
      const serviceMatches = compose.match(/container_name:\s*(\S+)/g) || [];
      const services = serviceMatches.map((m) => m.replace('container_name:', '').trim());

      units.push({
        id: 'config_docker_services',
        type: 'config',
        summary: `Docker services: ${services.join(', ')}`,
        source: { file: 'docker-compose.yml' },
        signatures: ['docker', 'services', 'containers'],
        content: { description: `Running containers: ${services.join(', ')}` },
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

    return units;
  }

  private buildAssociations(units: MemoryUnit[]): void {
    const methodUnits = units.filter((u) => u.type === 'method');

    for (const unit of methodUnits) {
      const deps = unit.content.dependencies || [];
      for (const dep of deps) {
        // Find matching method unit
        const matched = methodUnits.find((m) =>
          m.signatures.some((s) => dep.includes(s.split('.')[s.split('.').length - 1])),
        );

        if (matched && matched.id !== unit.id) {
          unit.associations.push({
            to: matched.id,
            relation: 'calls',
            weight: 0.8,
          });
        }
      }
    }
  }

  private updateGrid(units: MemoryUnit[]): void {
    const edgeIndex: MemoryGrid['edgeIndex'] = {};
    let totalAssociations = 0;

    for (const unit of units) {
      if (unit.meta.status === 'archived') continue;
      if (unit.associations.length > 0) {
        edgeIndex[unit.id] = unit.associations;
        totalAssociations += unit.associations.length;
      }
    }

    const grid: MemoryGrid = {
      version: '0.1.0',
      project: path.basename(this.projectRoot),
      lastScanAt: new Date().toISOString(),
      stats: {
        totalUnits: units.length,
        activeUnits: units.filter((u) => u.meta.status === 'active').length,
        archivedUnits: units.filter((u) => u.meta.status === 'archived').length,
        totalAssociations,
      },
      edgeIndex,
    };

    this.store.saveGrid(grid);
  }

  private extractJsDoc(node: any): string {
    const jsDocs = node.getJsDocs?.();
    if (jsDocs && jsDocs.length > 0) {
      const text = jsDocs[0].getDescription().trim();
      return text || '';
    }
    return '';
  }

  private extractDependencies(method: any): string[] {
    // Simple heuristic: find method calls in the body
    const body = method.getBodyText?.() || '';
    const deps: string[] = [];

    // Match this.xxxService.yyy() or this.repo.yyy()
    const serviceCalls = body.match(/this\.(\w+(?:Service|Repo|Query|Builder))\b/g) || [];
    for (const call of serviceCalls) {
      const name = call.replace('this.', '');
      if (!deps.includes(name)) deps.push(name);
    }

    return deps;
  }

  private findSourceDirs(): string[] {
    const dirs: string[] = [];
    const appsDir = path.join(this.projectRoot, 'apps');
    if (fs.existsSync(appsDir)) {
      for (const app of fs.readdirSync(appsDir)) {
        const srcDir = path.join(appsDir, app, 'src');
        if (fs.existsSync(srcDir)) dirs.push(srcDir);
      }
    }
    const packagesDir = path.join(this.projectRoot, 'packages');
    if (fs.existsSync(packagesDir)) {
      for (const pkg of fs.readdirSync(packagesDir)) {
        const srcDir = path.join(packagesDir, pkg, 'src');
        if (fs.existsSync(srcDir)) dirs.push(srcDir);
      }
    }
    return dirs;
  }
}
