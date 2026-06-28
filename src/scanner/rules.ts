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
      const content = fs.readFileSync(filePath, 'utf-8');
      const relativePath = path.relative(this.projectRoot, filePath);

      // Extract sections from markdown
      const sections = content.split(/^## /m).filter(Boolean);
      for (const section of sections) {
        const title = section.split('\n')[0].trim();
        const body = section.split('\n').slice(1).join('\n').trim();
        if (!title || body.length < 50) continue;

        const safeTitle = title
          .replace(/[^a-zA-Z0-9_-]/g, '_')
          .replace(/_+/g, '_')
          .slice(0, 50)
          .toLowerCase();
        if (!safeTitle || safeTitle === '_') continue;

        const safeFile = file
          .replace('.md', '')
          .replace(/[^a-zA-Z0-9_-]/g, '_')
          .replace(/_+/g, '_')
          .slice(0, 30)
          .toLowerCase();

        units.push({
          id: `rule_${safeFile}_${safeTitle}`,
          type: 'pattern',
          summary: `${file.replace('.md', '')}: ${title}`,
          source: { file: relativePath },
          signatures: [title, file.replace('.md', '').replace(/-/g, ' ')],
          content: { description: body.slice(0, 500) },
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

      // Also create a rule_trigger unit
      const safeFile = file
        .replace('.md', '')
        .replace(/[^a-zA-Z0-9_-]/g, '_')
        .replace(/_+/g, '_')
        .slice(0, 30)
        .toLowerCase();
      units.push({
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
      });
    }

    return units;
  }

  async scanFiles(_files: string[], _options: ScanOptions): Promise<MemoryUnit[]> {
    // Rules are small — just re-scan all
    return this.scan(_options);
  }
}
