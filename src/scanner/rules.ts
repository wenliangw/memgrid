import * as path from 'path';
import * as fs from 'fs';
import type { MemoryUnit, ScanOptions } from '../shared/types.js';
import type { Scanner } from './scanner.js';

/**
 * Shared scanner for .claude/rules/*.md files.
 * Extracted from TypeScriptScanner — applies to any language project.
 */
export class RulesScanner implements Scanner {
  readonly name = 'rules';
  private projectRoot: string;

  constructor(projectRoot: string) {
    this.projectRoot = projectRoot;
  }

  detect(projectRoot: string): boolean {
    const dir = path.join(projectRoot, '.claude', 'rules');
    return fs.existsSync(dir) && fs.readdirSync(dir).some((f) => f.endsWith('.md'));
  }

  async scan(_options: ScanOptions): Promise<MemoryUnit[]> {
    const units: MemoryUnit[] = [];
    const rulesDir = path.join(this.projectRoot, '.claude', 'rules');
    if (!fs.existsSync(rulesDir)) return units;

    for (const file of fs.readdirSync(rulesDir)) {
      if (!file.endsWith('.md')) continue;

      const filePath = path.join(rulesDir, file);
      const relativePath = path.relative(this.projectRoot, filePath);

      // Only create a rule_trigger unit — Claude can read the original file
      // when the trigger fires, so storing pattern units is redundant.
      const safeFile = file
        .replace('.md', '')
        .replace(/[^a-zA-Z0-9_-]/g, '_')
        .replace(/_+/g, '_')
        .slice(0, 30)
        .toLowerCase();
      units.push({
        id: `trigger_rule_${safeFile}`,
        type: 'preference',
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
          tier: 'warm',
        },
      });
    }

    return units;
  }

  async scanFiles(_files: string[], _options: ScanOptions): Promise<MemoryUnit[]> {
    // Rules are small — just re-scan all
    return this.scan(_options);
  }
}
