import * as path from 'path';
import * as fs from 'fs';
import type { MemoryUnit, ScanOptions } from '../shared/types.js';
import type { Scanner } from './scanner.js';

/**
 * Rust project scanner.
 * Regex-based: extracts fn, struct, impl, trait, enum declarations.
 */
export class RustScanner implements Scanner {
  readonly name = 'rust';
  private projectRoot: string;

  constructor(_store: any, projectRoot: string) {
    this.projectRoot = projectRoot;
  }

  detect(projectRoot: string): boolean {
    return fs.existsSync(path.join(projectRoot, 'Cargo.toml'));
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
        if (entry.name.startsWith('.') || entry.name === 'target' || entry.name === 'node_modules')
          continue;
        await this.scanDir(abs, rel, units);
      } else if (entry.name.endsWith('.rs')) {
        try {
          const code = fs.readFileSync(abs, 'utf-8');
          this.parseRustFile(code, rel, units);
        } catch {
          /* skip */
        }
      }
    }
  }

  private parseRustFile(code: string, file: string, units: MemoryUnit[]): void {
    const lines = code.split('\n');

    let currentImpl = '';

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();

      // fn name(params) -> ReturnType {
      let match = line.match(
        /^(?:pub(?:\s*\(\s*crate\s*\))?\s+)?(?:async\s+)?fn\s+(\w+)\s*(?:<[^>]*>)?\s*\(([^)]*)\)\s*(?:->\s*([^{]+?))?\s*\{/,
      );
      if (match) {
        const fnName = match[1];
        if (fnName === 'main' || fnName.startsWith('test_')) continue;
        const params = match[2];
        const retType = match[3]?.trim() || '';

        const fullName = currentImpl ? `${currentImpl}::${fnName}` : fnName;

        units.push({
          id: `method_rs_${this.sanitizeId(fullName)}`,
          type: 'fact',
          summary: retType ? `${fullName}() → ${retType}` : `${fullName}()`,
          source: { file, lines: `${i + 1}` },
          signatures: [fullName, fnName],
          content: {
            description: `Rust function ${fullName}()`,
            inputs: params || 'none',
            outputs: retType || '()',
          },
          associations: [],
          meta: {
            created: new Date().toISOString(),
            updated: new Date().toISOString(),
            confidence: 0.7,
            usage_count: 0,
            status: 'active',
            tier: 'warm',
          },
        });
        continue;
      }

      // pub struct Name {
      match = line.match(/^(?:pub\s+)?struct\s+(\w+)\s*(?:<[^>]*>)?\s*\{/);
      if (match) {
        const structName = match[1];
        units.push({
          id: `method_rs_struct_${this.sanitizeId(structName)}`,
          type: 'fact',
          summary: `${structName} (struct)`,
          source: { file, lines: `${i + 1}` },
          signatures: [structName],
          content: { description: `Rust struct ${structName}` },
          associations: [],
          meta: {
            created: new Date().toISOString(),
            updated: new Date().toISOString(),
            confidence: 0.65,
            usage_count: 0,
            status: 'active',
            tier: 'warm',
          },
        });
        continue;
      }

      // pub enum Name {
      match = line.match(/^(?:pub\s+)?enum\s+(\w+)\s*\{/);
      if (match) {
        units.push({
          id: `method_rs_enum_${this.sanitizeId(match[1])}`,
          type: 'insight',
          summary: `${match[1]} (enum)`,
          source: { file, lines: `${i + 1}` },
          signatures: [match[1]],
          content: { description: `Rust enum ${match[1]}` },
          associations: [],
          meta: {
            created: new Date().toISOString(),
            updated: new Date().toISOString(),
            confidence: 0.65,
            usage_count: 0,
            status: 'active',
            tier: 'warm',
          },
        });
        continue;
      }

      // pub trait Name {
      match = line.match(/^(?:pub\s+)?trait\s+(\w+)\s*\{/);
      if (match) {
        units.push({
          id: `method_rs_trait_${this.sanitizeId(match[1])}`,
          type: 'insight',
          summary: `${match[1]} (trait)`,
          source: { file, lines: `${i + 1}` },
          signatures: [match[1]],
          content: { description: `Rust trait ${match[1]}` },
          associations: [],
          meta: {
            created: new Date().toISOString(),
            updated: new Date().toISOString(),
            confidence: 0.7,
            usage_count: 0,
            status: 'active',
            tier: 'warm',
          },
        });
        continue;
      }

      // impl Type { or impl Trait for Type {
      match = line.match(/^impl(?:\s+(\w+)\s+for)?\s+(\w+)\s*\{/);
      if (match) {
        currentImpl = match[2];
        continue;
      }

      // Close impl block
      if (line === '}' && currentImpl) {
        currentImpl = '';
        continue;
      }
    }
  }

  private findSourceDirs(projectRoot: string): string[] {
    const dirs: string[] = [];
    for (const name of ['src', 'crates']) {
      const abs = path.join(projectRoot, name);
      if (fs.existsSync(abs) && fs.statSync(abs).isDirectory()) {
        dirs.push(abs);
      }
    }
    return dirs;
  }

  private sanitizeId(text: string): string {
    return text
      .replace(/::/g, '_')
      .replace(/\./g, '_')
      .replace(/<[^>]*>/g, '')
      .replace(/[^a-zA-Z0-9_-]/g, '_')
      .replace(/_+/g, '_')
      .toLowerCase()
      .replace(/^_|_$/g, '');
  }
}
