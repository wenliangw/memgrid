import * as path from 'path';
import * as fs from 'fs';
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { Project, SyntaxKind } from 'ts-morph';
import type { MemoryUnit, MemoryGrid, ScanOptions } from '../shared/types.js';
import type { FileStore } from '../store/file-store.js';
import type { Scanner } from './scanner.js';
import type { RulesScanner } from './rules.js';

export class TypeScriptScanner implements Scanner {
  readonly name = 'typescript';
  private store: FileStore;
  private projectRoot: string;
  private rulesScanner?: RulesScanner;

  constructor(store: FileStore, projectRoot: string, rulesScanner?: RulesScanner) {
    this.store = store;
    this.projectRoot = projectRoot;
    this.rulesScanner = rulesScanner;
  }

  detect(projectRoot: string): boolean {
    return (
      fs.existsSync(path.join(projectRoot, 'tsconfig.json')) || this.findSourceDirs().length > 0
    );
  }

  async scan(options: ScanOptions): Promise<MemoryUnit[]> {
    const units: MemoryUnit[] = [];

    this.store.ensureDirs();

    // Run all scans in parallel (they are independent)
    const scans: Promise<MemoryUnit[]>[] = [this.scanTypeScript()];

    if (options.includeRules && this.rulesScanner) scans.push(this.rulesScanner.scan(options));
    if (options.includeExamples) scans.push(this.scanExamples());
    scans.push(this.scanConfig());

    const results = await Promise.all(scans);
    for (const result of results) {
      units.push(...result);
    }

    // 5. Build associations
    this.buildAssociations(units);

    // 6. Save all units
    for (const unit of units) {
      this.store.saveUnit(unit);
    }

    // 7. Update mesh.json
    this.updateGrid(units);

    // Invalidate search index (units changed)
    // (handled by store.load() called before this)

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

    // Always add source directories that may not be in tsconfig
    // (e.g., apps/server in monorepos where tsconfig only covers apps/web)
    if (fs.existsSync(tsConfigPath)) {
      const srcDirs = this.findSourceDirs();
      for (const dir of srcDirs) {
        project.addSourceFilesAtPaths(`${dir}/**/*.ts`);
      }
    }

    for (const sourceFile of project.getSourceFiles()) {
      const filePath = path.relative(this.projectRoot, sourceFile.getFilePath());

      // Skip test files, node_modules, dist, .next, migrations
      if (
        filePath.includes('node_modules') ||
        filePath.includes('dist') ||
        filePath.includes('.next') ||
        filePath.includes('migrations')
      )
        continue;
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
            id: `method_${signature
              .toLowerCase()
              .replace(/\./g, '_')
              .replace(/[^a-z0-9_]/g, '_')
              .replace(/_+/g, '_')}`,
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
              code_snippet: className.endsWith('Controller')
                ? ''
                : this.truncateLines(method.getText(), 15),
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
          id: `method_${this.sanitizeId(funcName)}`,
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

  private async scanExamples(): Promise<MemoryUnit[]> {
    const units: MemoryUnit[] = [];
    const examplesDir = path.join(this.projectRoot, '.claude', 'examples');
    if (!fs.existsSync(examplesDir)) return units;

    const scanDir = (dir: string, isBad: boolean) => {
      if (!fs.existsSync(dir)) return;
      for (const file of fs.readdirSync(dir)) {
        if (!file.endsWith('.ts')) continue;
        if (file.startsWith('_TEMPLATE')) continue;
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
          ].some((k) => name.includes(k)),
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

  private sanitizeId(text: string): string {
    return text
      .replace(/[^a-zA-Z0-9_-]/g, '_')
      .replace(/_+/g, '_')
      .toLowerCase();
  }

  private buildAssociations(units: MemoryUnit[]): void {
    const methodUnits = units.filter((u) => u.type === 'method');
    const patternUnits = units.filter((u) => u.type === 'pattern');
    const configUnits = units.filter((u) => u.type === 'config');

    // Build a signature → unit index for fast lookup
    const sigIndex = new Map<string, string>(); // signature → unit id
    for (const u of methodUnits) {
      for (const sig of u.signatures) {
        sigIndex.set(sig.toLowerCase(), u.id);
      }
    }

    for (const unit of methodUnits) {
      if (!unit.source?.file) continue;

      // 1. Extract called names from code_snippet
      const snippet = unit.content.code_snippet || '';
      const calledNames = this.extractCalledNames(snippet);

      for (const name of calledNames) {
        // Exact match in sigIndex
        let matchedId = sigIndex.get(name.toLowerCase());

        // Partial match: "this.verifyOwnership" → matches "verifyOwnership"
        if (!matchedId) {
          for (const [sig, id] of sigIndex) {
            if (sig.includes(name.toLowerCase()) || name.toLowerCase().includes(sig)) {
              matchedId = id;
              break;
            }
          }
        }

        if (matchedId && matchedId !== unit.id) {
          unit.associations.push({
            to: matchedId,
            relation: 'calls',
            weight: 0.8,
          });
        }
      }

      // 2. Match patterns used in this method
      for (const p of patternUnits) {
        for (const sig of p.signatures) {
          if (snippet.toLowerCase().includes(sig.toLowerCase()) && sig.length > 5) {
            unit.associations.push({
              to: p.id,
              relation: 'follows_rule',
              weight: 0.6,
            });
            break;
          }
        }
      }

      // 3. Module-level association: same source subdirectory
      const unitDir = path.dirname(unit.source.file);
      const siblings = methodUnits.filter(
        (m) => m.source?.file && path.dirname(m.source.file) === unitDir && m.id !== unit.id,
      );
      for (const sib of siblings.slice(0, 3)) {
        unit.associations.push({
          to: sib.id,
          relation: 'belongs_to_module',
          weight: 0.3,
        });
      }
    }

    // 4. Config → method associations (methods using config values)
    for (const config of configUnits) {
      const configKeywords = config.signatures;
      for (const method of methodUnits) {
        const snippet = (method.content.code_snippet || '') + (method.content.description || '');
        if (
          configKeywords.some(
            (k) => snippet.toLowerCase().includes(k.toLowerCase()) && k.length > 3,
          )
        ) {
          method.associations.push({
            to: config.id,
            relation: 'calls',
            weight: 0.4,
          });
        }
      }
    }

    // Deduplicate associations
    for (const unit of methodUnits) {
      const seen = new Set<string>();
      unit.associations = unit.associations.filter((a) => {
        const key = `${a.to}:${a.relation}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
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

  /**
   * Extract function/method names called in a code snippet.
   * Matches patterns like: foo(), await foo(), this.foo(), obj.foo()
   */
  private extractCalledNames(code: string): string[] {
    const names = new Set<string>();

    // Match function calls: foo(...), await foo(...), this.foo(...), obj.foo(...)
    const callPatterns = [
      /\b(\w+)\s*\(/g, // direct calls: foo()
      /this\.(\w+)\s*\(/g, // this.foo()
      /(\w+)\.(\w+)\s*\(/g, // obj.method() — captures both obj and method
    ];

    for (const pattern of callPatterns) {
      let match;
      while ((match = pattern.exec(code)) !== null) {
        // Take the last capture group (the actual called function name)
        const name = match[match.length - 1];
        if (name && name.length > 2 && !this.isCommonKeyword(name)) {
          names.add(name);
        }
      }
    }

    // Match import statements
    const importPattern = /import\s*\{[^}]*\}\s*from\s*['"]([^'"]+)['"]/g;
    let match;
    while ((match = importPattern.exec(code)) !== null) {
      // Extract individual imported names
      const namesStr = match[0].match(/\{([^}]*)\}/)?.[1] || '';
      for (const n of namesStr.split(',')) {
        const clean = n
          .trim()
          .split(/\s+as\s+/)[0]
          .trim();
        if (clean && clean.length > 2) names.add(clean);
      }
    }

    return [...names];
  }

  private truncateLines(text: string, maxLines: number): string {
    const lines = text.split('\n');
    return lines.slice(0, maxLines).join('\n') + (lines.length > maxLines ? '\n// ...' : '');
  }

  private isCommonKeyword(name: string): boolean {
    const keywords = new Set([
      'if',
      'for',
      'let',
      'var',
      'new',
      'try',
      'const',
      'typeof',
      'instanceof',
      'return',
      'throw',
      'await',
      'async',
      'while',
      'switch',
      'catch',
      'finally',
      'export',
      'import',
      'from',
      'require',
      'default',
      'function',
      'class',
      'true',
      'false',
      'null',
      'undefined',
      'this',
      'super',
      'void',
      'delete',
      'map',
      'filter',
      'reduce',
      'find',
      'forEach',
      'push',
      'pop',
      'slice',
      'split',
      'join',
      'concat',
      'sort',
      'some',
      'every',
      'includes',
    ]);
    return keywords.has(name);
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
