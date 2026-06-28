import * as path from 'path';
import * as fs from 'fs';
import type { MemoryUnit, ScanOptions } from '../shared/types.js';
import type { Scanner } from './scanner.js';

/**
 * Go project scanner.
 * Regex-based: extracts func, type, method declarations.
 */
export class GoScanner implements Scanner {
  readonly name = 'golang';
  private projectRoot: string;

  constructor(_store: any, projectRoot: string) {
    this.projectRoot = projectRoot;
  }

  detect(projectRoot: string): boolean {
    return fs.existsSync(path.join(projectRoot, 'go.mod'));
  }

  async scan(_options: ScanOptions): Promise<MemoryUnit[]> {
    const units: MemoryUnit[] = [];
    const srcDirs = this.findSourceDirs(this.projectRoot);

    // If no src dirs, scan root-level .go files
    if (srcDirs.length === 0) {
      const rootFiles = fs
        .readdirSync(this.projectRoot)
        .filter((f) => f.endsWith('.go') && !f.endsWith('_test.go'));
      for (const file of rootFiles) {
        try {
          this.parseGoFile(
            fs.readFileSync(path.join(this.projectRoot, file), 'utf-8'),
            file,
            units,
          );
        } catch {
          /* skip */
        }
      }
    }

    for (const dir of srcDirs) {
      await this.scanDir(dir, '', units);
    }

    return units;
  }

  private async scanDir(dir: string, relPrefix: string, units: MemoryUnit[]): Promise<void> {
    if (!fs.existsSync(dir)) return;

    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      const rel = relPrefix ? path.join(relPrefix, entry.name) : entry.name;

      if (entry.isDirectory()) {
        if (entry.name.startsWith('.') || entry.name === 'vendor' || entry.name === 'node_modules')
          continue;
        await this.scanDir(abs, rel, units);
      } else if (entry.name.endsWith('.go') && !entry.name.endsWith('_test.go')) {
        try {
          const code = fs.readFileSync(abs, 'utf-8');
          this.parseGoFile(code, rel, units);
        } catch {
          /* skip */
        }
      }
    }
  }

  private parseGoFile(code: string, file: string, units: MemoryUnit[]): void {
    const lines = code.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();

      // func Name(params) returnType {
      let match = line.match(/^func\s+(\w+)\s*\(([^)]*)\)\s*(\(?[\w[\]*.]+\)?)?\s*\{/);
      if (match) {
        const funcName = match[1];
        if (funcName[0] === funcName[0].toLowerCase() && !this.isStructMethod(line, funcName))
          continue; // skip unexported (unless struct method)
        const params = match[2];
        const ret = match[3] || '';
        units.push({
          id: `method_go_${this.sanitizeId(funcName)}`,
          type: 'method',
          summary: `${funcName}(${params}) ${ret}`.trim(),
          source: { file, lines: `${i + 1}` },
          signatures: [funcName],
          content: {
            description: `Go function ${funcName}`,
            inputs: params || 'none',
            outputs: ret || 'none',
          },
          associations: [],
          meta: {
            created: new Date().toISOString(),
            updated: new Date().toISOString(),
            confidence: 0.7,
            usage_count: 0,
            status: 'active',
          },
        });
        continue;
      }

      // func (receiver Type) methodName(params) returnType {
      match = line.match(
        /^func\s+\((\w+)\s+\*?(\w+)\)\s+(\w+)\s*\(([^)]*)\)\s*(\(?[\w[\]*.]+\)?)?\s*\{/,
      );
      if (match) {
        const receiverName = match[1];
        const receiverType = match[2];
        const methodName = match[3];
        const params = match[4];
        const ret = match[5] || '';

        units.push({
          id: `method_go_${this.sanitizeId(receiverType + '_' + methodName)}`,
          type: 'method',
          summary: `${receiverType}.${methodName}(${params}) ${ret}`.trim(),
          source: { file, lines: `${i + 1}` },
          signatures: [`${receiverType}.${methodName}`, methodName],
          content: {
            description: `Go method ${receiverType}.${methodName}()`,
            inputs: params || 'none',
            outputs: ret || 'none',
          },
          associations: [],
          meta: {
            created: new Date().toISOString(),
            updated: new Date().toISOString(),
            confidence: 0.75,
            usage_count: 0,
            status: 'active',
          },
        });
        continue;
      }

      // type Name struct {
      match = line.match(/^type\s+(\w+)\s+struct\s*\{/);
      if (match) {
        const structName = match[1];
        if (structName[0] !== structName[0].toUpperCase()) continue;

        units.push({
          id: `method_go_struct_${this.sanitizeId(structName)}`,
          type: 'method',
          summary: `${structName} (struct)`,
          source: { file, lines: `${i + 1}` },
          signatures: [structName],
          content: { description: `Go struct ${structName}` },
          associations: [],
          meta: {
            created: new Date().toISOString(),
            updated: new Date().toISOString(),
            confidence: 0.65,
            usage_count: 0,
            status: 'active',
          },
        });
        continue;
      }

      // type Name interface {
      match = line.match(/^type\s+(\w+)\s+interface\s*\{/);
      if (match) {
        units.push({
          id: `method_go_iface_${this.sanitizeId(match[1])}`,
          type: 'pattern',
          summary: `${match[1]} (interface)`,
          source: { file, lines: `${i + 1}` },
          signatures: [match[1]],
          content: { description: `Go interface ${match[1]}` },
          associations: [],
          meta: {
            created: new Date().toISOString(),
            updated: new Date().toISOString(),
            confidence: 0.7,
            usage_count: 0,
            status: 'active',
          },
        });
        continue;
      }
    }
  }

  private isStructMethod(line: string, _funcName: string): boolean {
    // Check if this looks like a struct method (func (r Type) name)
    return /func\s+\(\w+\s+\*?\w+\)/.test(line);
  }

  private findSourceDirs(projectRoot: string): string[] {
    const dirs: string[] = [];
    for (const name of ['cmd', 'internal', 'pkg', 'src', 'app']) {
      const abs = path.join(projectRoot, name);
      if (fs.existsSync(abs) && fs.statSync(abs).isDirectory()) {
        dirs.push(abs);
      }
    }
    return dirs;
  }

  private sanitizeId(text: string): string {
    return text
      .replace(/\./g, '_')
      .replace(/\*/g, 'ptr_')
      .replace(/[^a-zA-Z0-9_-]/g, '_')
      .replace(/_+/g, '_')
      .toLowerCase()
      .replace(/^_|_$/g, '');
  }
}
