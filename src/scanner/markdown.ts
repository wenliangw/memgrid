import * as path from 'path';
import * as fs from 'fs';
import type { MemoryUnit, ScanOptions } from '../shared/types.js';
import type { Scanner } from './scanner.js';

/**
 * General-purpose Markdown scanner.
 * Scans all .md files in the project (README, docs/, etc.) and creates
 * knowledge units from their headings.
 */
export class MarkdownScanner implements Scanner {
  readonly name = 'markdown';
  private projectRoot: string;

  constructor(projectRoot: string) {
    this.projectRoot = projectRoot;
  }

  detect(projectRoot: string): boolean {
    // Always applicable if there are .md files
    return this.findMdFiles(projectRoot).length > 0;
  }

  async scan(_options: ScanOptions): Promise<MemoryUnit[]> {
    const units: MemoryUnit[] = [];
    const mdFiles = this.findMdFiles(this.projectRoot);

    for (const rel of mdFiles) {
      // Skip rules (handled by RulesScanner)
      if (rel.startsWith('.claude/rules/')) continue;
      // Skip examples (handled by ExamplesScanner)
      if (rel.startsWith('.claude/examples/')) continue;

      try {
        const abs = path.join(this.projectRoot, rel);
        const content = fs.readFileSync(abs, 'utf-8');

        // Extract H1 and H2 headings as knowledge units
        const headings = content.match(/^#{1,2}\s+(.+)$/gm);
        if (!headings || headings.length === 0) continue;

        let fileH1 = '';
        for (const heading of headings) {
          const level = heading.match(/^(#+)/)?.[1].length || 1;
          const title = heading.replace(/^#+\s+/, '').trim();
          if (!title) continue;

          if (level === 1) {
            fileH1 = title;
          }

          const safeTitle = title
            .replace(/[^a-zA-Z0-9\u4e00-\u9fff\-_\s]/g, '')
            .replace(/\s+/g, '_')
            .slice(0, 60)
            .toLowerCase();
          if (!safeTitle || safeTitle === '_') continue;

          const safeFile = path.basename(rel)
            .replace('.md', '')
            .replace(/[^a-zA-Z0-9\-_]/g, '_')
            .slice(0, 30)
            .toLowerCase();

          units.push({
            id: `doc_${safeFile}_${safeTitle}`,
            type: 'pattern',
            summary: `${path.basename(rel)} → ${title}`,
            source: { file: rel },
            signatures: [title, path.basename(rel).replace('.md', '')],
            content: {
              description: `${fileH1 ? fileH1 + ' — ' : ''}${title}`,
            },
            associations: [],
            meta: {
              created: new Date().toISOString(),
              updated: new Date().toISOString(),
              confidence: 0.5, // lower confidence — docs may be stale
              usage_count: 0,
              status: 'active',
            },
          });
        }
      } catch { /* skip unreadable */ }
    }

    return units;
  }

  async scanFiles(files: string[], _options: ScanOptions): Promise<MemoryUnit[]> {
    // Could be smarter here — for now, full re-scan is fine
    return this.scan(_options);
  }

  private findMdFiles(projectRoot: string): string[] {
    const files: string[] = [];
    const walk = (dir: string) => {
      if (!fs.existsSync(dir)) return;
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const abs = path.join(dir, entry.name);
        const rel = path.relative(projectRoot, abs);

        if (entry.isDirectory()) {
          if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'target') continue;
          walk(abs);
        } else if (entry.name.endsWith('.md') && !entry.name.startsWith('.')) {
          files.push(rel);
        }
      }
    };

    walk(projectRoot);
    return files;
  }
}
