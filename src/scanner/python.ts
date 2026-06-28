import * as path from 'path';
import * as fs from 'fs';
import type { MemoryUnit, ScanOptions } from '../shared/types.js';
import type { Scanner } from './scanner.js';

/**
 * Python project scanner.
 * Extracts functions, classes, methods, decorators via regex-based parsing.
 */
export class PythonScanner implements Scanner {
  readonly name = 'python';
  private projectRoot: string;

  constructor(_store: any, projectRoot: string) {
    this.projectRoot = projectRoot;
  }

  detect(projectRoot: string): boolean {
    return (
      fs.existsSync(path.join(projectRoot, 'pyproject.toml')) ||
      fs.existsSync(path.join(projectRoot, 'setup.py')) ||
      fs.existsSync(path.join(projectRoot, 'requirements.txt')) ||
      fs.existsSync(path.join(projectRoot, 'Pipfile')) ||
      this.findSourceDirs(projectRoot).length > 0
    );
  }

  async scan(_options: ScanOptions): Promise<MemoryUnit[]> {
    const units: MemoryUnit[] = [];
    const srcDirs = this.findSourceDirs(this.projectRoot);

    for (const dir of srcDirs) {
      await this.scanDir(dir, '', units);
    }

    // Also scan root-level .py files (excluding setup.py, __init__.py scaffold)
    const rootDirs = ['src', 'lib', 'tests', 'app'];
    for (const d of rootDirs) {
      const abs = path.join(this.projectRoot, d);
      if (fs.existsSync(abs) && !srcDirs.includes(abs)) {
        await this.scanDir(abs, '', units);
      }
    }

    return units;
  }

  private async scanDir(dir: string, relPrefix: string, units: MemoryUnit[]): Promise<void> {
    if (!fs.existsSync(dir)) return;

    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      const rel = relPrefix ? path.join(relPrefix, entry.name) : entry.name;

      if (entry.isDirectory()) {
        if (entry.name.startsWith('.') || entry.name === '__pycache__' || entry.name === 'node_modules') continue;
        if (entry.name === 'tests' || entry.name === 'test') continue;
        await this.scanDir(abs, rel, units);
      } else if (entry.name.endsWith('.py') && !entry.name.startsWith('test_') && !entry.name.endsWith('_test.py')) {
        try {
          const code = fs.readFileSync(abs, 'utf-8');
          this.parsePythonFile(code, rel, units);
        } catch {
          // skip unreadable files
        }
      }
    }
  }

  private parsePythonFile(code: string, file: string, units: MemoryUnit[]): void {
    const lines = code.split('\n');

    // Class pattern: class ClassName(...):
    const classPattern = /^class\s+(\w+)\s*(?:\(([^)]*)\))?\s*:/;
    // Function/method pattern: def func_name(params):
    const funcPattern = /^\s{0,8}def\s+(\w+)\s*\(([^)]*)\)\s*(?:->\s*(\S+))?\s*:/;

    let currentClass = '';
    let decorators: string[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const stripped = line.trim();

      // Track decorators
      if (stripped.startsWith('@')) {
        decorators.push(stripped);
        continue;
      }

      // Class
      const classMatch = stripped.match(classPattern);
      if (classMatch) {
        currentClass = classMatch[1];
        const doc = this.extractDoc(lines, i + 1);

        units.push({
          id: `method_py_${this.sanitizeId(currentClass)}`,
          type: 'method',
          summary: `${currentClass}${doc ? ` — ${doc}` : ''}`,
          source: { file, lines: `${i + 1}` },
          signatures: [currentClass],
          content: {
            description: `Python class ${currentClass}${decorators.length ? ` [${decorators.join(', ')}]` : ''}`,
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

        decorators = [];
        continue;
      }

      // Function/method
      const funcMatch = stripped.match(funcPattern);
      if (funcMatch) {
        const funcName = funcMatch[1];
        if (funcName.startsWith('_') && funcName !== '__init__') { decorators = []; continue; } // skip private

        const params = funcMatch[2];
        const returnType = funcMatch[3] || '';
        const doc = this.extractDoc(lines, i + 1);
        const fullName = currentClass ? `${currentClass}.${funcName}` : funcName;

        const unit: MemoryUnit = {
          id: `method_py_${this.sanitizeId(fullName)}`,
          type: 'method',
          summary: doc ? `${fullName}() — ${doc}` : `${fullName}()`,
          source: { file, lines: `${i + 1}` },
          signatures: [fullName, funcName],
          content: {
            description: doc || `${fullName}()`,
            inputs: params || 'none',
            outputs: returnType || 'unknown',
          },
          associations: [],
          meta: {
            created: new Date().toISOString(),
            updated: new Date().toISOString(),
            confidence: currentClass ? 0.75 : 0.7,
            usage_count: 0,
            status: 'active',
          },
        };

        // Add decorator info
        if (decorators.length > 0) {
          unit.content.style_notes = `Decorators: ${decorators.join(', ')}`;
        }

        units.push(unit);
        decorators = [];
      }
    }
  }

  private extractDoc(lines: string[], startLine: number): string {
    // Look for """ or ''' docstring on next non-empty line
    for (let i = startLine; i < Math.min(startLine + 3, lines.length); i++) {
      const line = lines[i].trim();
      const match = line.match(/^["']{3}([^"']*)["']{3}$/);
      if (match) return match[1].trim();
      if (line.startsWith('"""') || line.startsWith("'''")) {
        const inner = line.replace(/^["']{3}|["']{3}$/g, '').trim();
        return inner || '...';
      }
    }
    return '';
  }

  private findSourceDirs(projectRoot: string): string[] {
    const dirs: string[] = [];
    for (const name of ['src', 'app', 'lib', 'modules']) {
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
      .replace(/__/g, '_dunder_')
      .replace(/[^a-zA-Z0-9_\-]/g, '_')
      .replace(/_+/g, '_')
      .toLowerCase()
      .replace(/^_|_$/g, '');
  }
}
