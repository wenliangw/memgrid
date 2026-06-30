import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import MiniSearch from 'minisearch';
import type { LibraryUnit } from '../shared/types.js';

const LIBRARY_DIR = 'library';

export class LibraryManager {
  private gridDir: string;
  private index: MiniSearch | null = null;
  private indexBuilt = false;

  constructor(gridDir: string) {
    this.gridDir = gridDir;
  }

  get libraryDir(): string {
    return path.join(this.gridDir, LIBRARY_DIR);
  }

  ensureDirs(): void {
    fs.mkdirSync(this.libraryDir, { recursive: true });
  }

  /**
   * Add a document to the library.
   * If id not provided, generates one from title hash.
   */
  add(doc: {
    id?: string;
    title: string;
    content: string;
    source?: { file: string; type?: 'memory' | 'document' | 'log' };
    keywords?: string[];
    domain: string;
  }): LibraryUnit {
    this.ensureDirs();

    const id = doc.id || `lib_${crypto.createHash('md5').update(doc.title).digest('hex').slice(0, 8)}`;
    const filePath = path.join(this.libraryDir, `${id}.json`);

    // If already exists, update
    let existing: LibraryUnit | null = null;
    if (fs.existsSync(filePath)) {
      try {
        existing = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      } catch { /* overwrite */ }
    }

    const unit: LibraryUnit = {
      id,
      title: doc.title,
      content: doc.content,
      source: doc.source,
      keywords: doc.keywords || extractKeywords(doc.title + ' ' + doc.content),
      domain: doc.domain,
      meta: {
        created: existing?.meta.created || new Date().toISOString(),
        updated: new Date().toISOString(),
        size: doc.content.length,
        usage_count: existing?.meta.usage_count || 0,
        status: 'active',
      },
    };

    fs.writeFileSync(filePath, JSON.stringify(unit, null, 2), 'utf-8');
    this.invalidateIndex();
    return unit;
  }

  /**
   * Search library by keyword (full-text via MiniSearch).
   */
  search(query: string, maxResults = 10): LibraryUnit[] {
    this.ensureIndex();

    if (!this.index) return [];

    const raw = this.index.search(query, { prefix: true, fuzzy: 0.2 });
    const results: LibraryUnit[] = [];

    for (const hit of raw) {
      if (results.length >= maxResults) break;
      const unit = this.get(hit.id);
      if (unit) {
        // Touch usage count
        unit.meta.usage_count++;
        unit.meta.updated = new Date().toISOString();
        const filePath = path.join(this.libraryDir, `${unit.id}.json`);
        fs.writeFileSync(filePath, JSON.stringify(unit, null, 2), 'utf-8');
        results.push(unit);
      }
    }

    return results;
  }

  /**
   * Get a document by ID.
   */
  get(id: string): LibraryUnit | null {
    const filePath = path.join(this.libraryDir, `${id}.json`);
    if (!fs.existsSync(filePath)) return null;

    try {
      return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    } catch {
      return null;
    }
  }

  /**
   * List all documents.
   */
  list(): LibraryUnit[] {
    this.ensureDirs();
    const results: LibraryUnit[] = [];

    for (const file of fs.readdirSync(this.libraryDir)) {
      if (!file.endsWith('.json')) continue;
      const unit = this.get(file.replace('.json', ''));
      if (unit) results.push(unit);
    }

    // Sort: most recently updated first
    return results.sort((a, b) => b.meta.updated.localeCompare(a.meta.updated));
  }

  /**
   * Remove a document.
   */
  remove(id: string): boolean {
    const filePath = path.join(this.libraryDir, `${id}.json`);
    if (!fs.existsSync(filePath)) return false;

    try {
      // Move to archive
      const archiveDir = path.join(this.gridDir, 'archive', 'library');
      fs.mkdirSync(archiveDir, { recursive: true });
      const archivePath = path.join(archiveDir, `${id}_${Date.now()}.json`);
      fs.renameSync(filePath, archivePath);
      this.invalidateIndex();
      return true;
    } catch {
      return false;
    }
  }

  get stats(): { total: number; totalSize: number } {
    const docs = this.list();
    return {
      total: docs.length,
      totalSize: docs.reduce((sum, d) => sum + d.meta.size, 0),
    };
  }

  private ensureIndex(): void {
    if (this.index && this.indexBuilt) return;

    this.index = new MiniSearch({
      fields: ['title', 'content', 'keywords'],
      storeFields: ['id'],
      searchOptions: {
        boost: { title: 5, keywords: 3 },
        prefix: true,
        fuzzy: 0.2,
      },
    });

    const docs = this.list();
    if (docs.length > 0) {
      this.index.addAll(
        docs.map((d) => ({
          id: d.id,
          title: d.title,
          content: d.content.slice(0, 10000), // cap for index
          keywords: (d.keywords || []).join(' '),
        })),
      );
    }

    this.indexBuilt = true;
  }

  private invalidateIndex(): void {
    this.index = null;
    this.indexBuilt = false;
  }
}

function extractKeywords(text: string): string[] {
  // Simple TF-based keyword extraction
  const words = text
    .toLowerCase()
    .split(/\W+/)
    .filter((w) => w.length > 2)
    .filter((w) => !STOP_WORDS.has(w));

  const freq: Record<string, number> = {};
  for (const w of words) {
    freq[w] = (freq[w] || 0) + 1;
  }

  return Object.entries(freq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([w]) => w);
}

const STOP_WORDS = new Set([
  'the', 'and', 'for', 'with', 'that', 'this', 'from', 'have',
  'not', 'are', 'but', 'was', 'has', 'been', 'can', 'all',
  'will', 'would', 'should', 'about', 'when', 'where',
  'which', 'what', 'their', 'they', 'there', 'here',
  '的', '了', '是', '在', '我', '不', '有', '人',
  '这', '就', '都', '也', '个', '和', '你', '他',
  '那', '要', '会', '着', '没', '到', '说', '去',
  '大', '小', '上', '下', '中', '来', '能', '好',
]);
