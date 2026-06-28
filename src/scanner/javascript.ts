import * as path from 'path';
import * as fs from 'fs';
import type { MemoryUnit, ScanOptions } from '../shared/types.js';
import type { Scanner } from './scanner.js';

/**
 * JavaScript project scanner (no TypeScript).
 * Regex-based: extracts exported functions, classes, arrow functions.
 */
export class JavaScriptScanner implements Scanner {
  readonly name = 'javascript';
  private projectRoot: string;

  constructor(_store: any, projectRoot: string) {
    this.projectRoot = projectRoot;
  }

  detect(projectRoot: string): boolean {
    const hasTS = fs.existsSync(path.join(projectRoot, 'tsconfig.json'));
    if (hasTS) return false; // let TypeScriptScanner handle it

    const hasJS = (
      fs.existsSync(path.join(projectRoot, 'package.json')) &&
      !hasTS
    );
    if (!hasJS) return false;

    // Quick check: any .js/.mjs/.cjs files?
    return this.findSourceDirs(projectRoot).length > 0;
  }

  async scan(_options: ScanOptions): Promise<MemoryUnit[]> {
    const units: MemoryUnit[] = [];
    const srcDirs = this.findSourceDirs(this.projectRoot);

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
        if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
        if (entry.name === '__tests__' || entry.name === 'test') continue;
        await this.scanDir(abs, rel, units);
      } else if (
        (entry.name.endsWith('.js') || entry.name.endsWith('.mjs') || entry.name.endsWith('.cjs')) &&
        !entry.name.includes('.test.') && !entry.name.includes('.spec.')
      ) {
        try {
          const code = fs.readFileSync(abs, 'utf-8');
          this.parseJSFile(code, rel, units);
        } catch {
          // skip
        }
      }
    }
  }

  private parseJSFile(code: string, file: string, units: MemoryUnit[]): void {
    const lines = code.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();

      // export async function name(params)
      let match = line.match(/^export\s+(?:async\s+)?function\s+(\w+)\s*\(([^)]*)\)/);
      if (match) {
        this.addFunctionUnit(match[1], match[2], file, i + 1, units, '');
        continue;
      }

      // export const name = async (params) => {
      match = line.match(/^export\s+const\s+(\w+)\s*=\s*(?:async\s*)?\(([^)]*)\)\s*=>/);
      if (match) {
        this.addFunctionUnit(match[1], match[2], file, i + 1, units, '');
        continue;
      }

      // export const name = async function(params)
      match = line.match(/^export\s+const\s+(\w+)\s*=\s*(?:async\s+)?function\s*\(([^)]*)\)/);
      if (match) {
        this.addFunctionUnit(match[1], match[2], file, i + 1, units, '');
        continue;
      }

      // class ClassName
      match = line.match(/^export\s+(?:default\s+)?class\s+(\w+)/);
      if (match) {
        const methods = this.extractClassMethods(lines, i);
        units.push({
          id: `method_js_${match[1].toLowerCase()}`,
          type: 'method',
          summary: `${match[1]} (class)`,
          source: { file, lines: `${i + 1}` },
          signatures: [match[1]],
          content: {
            description: `JavaScript class ${match[1]}${methods.length ? `. Methods: ${methods.join(', ')}` : ''}`,
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
    }
  }

  private addFunctionUnit(
    name: string,
    params: string,
    file: string,
    line: number,
    units: MemoryUnit[],
    extraDesc: string,
  ): void {
    units.push({
      id: `method_js_${name.toLowerCase()}`,
      type: 'method',
      summary: `${name}()${extraDesc ? ` — ${extraDesc}` : ''}`,
      source: { file, lines: `${line}` },
      signatures: [name],
      content: {
        description: extraDesc || `${name}()`,
        inputs: params || 'none',
      },
      associations: [],
      meta: {
        created: new Date().toISOString(),
        updated: new Date().toISOString(),
        confidence: 0.65,
        usage_count: 0,
        status: 'active',
      },
    });
  }

  private extractClassMethods(lines: string[], classStart: number): string[] {
    const methods: string[] = [];
    // Simple scan for method-like patterns inside the class body
    for (let i = classStart + 1; i < Math.min(classStart + 100, lines.length); i++) {
      const line = lines[i].trim();
      if (line.startsWith('}')) break;
      const match = line.match(/^\s*(?:static\s+)?(?:async\s+)?(\w+)\s*\(/);
      if (match && !['if', 'for', 'while', 'switch', 'constructor'].includes(match[1])) {
        methods.push(match[1]);
      }
    }
    return methods.slice(0, 15); // cap
  }

  private findSourceDirs(projectRoot: string): string[] {
    const dirs: string[] = [];
    for (const name of ['src', 'lib', 'app', 'dist']) {
      const abs = path.join(projectRoot, name);
      if (!fs.existsSync(abs)) continue;
      if (fs.statSync(abs).isDirectory() && this.hasJSFiles(abs)) {
        dirs.push(abs);
      }
    }
    return dirs;
  }

  private hasJSFiles(dir: string): boolean {
    try {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name.endsWith('.js') || entry.name.endsWith('.mjs')) return true;
        if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
          if (this.hasJSFiles(path.join(dir, entry.name))) return true;
        }
      }
    } catch { /* permission error */ }
    return false;
  }
}
