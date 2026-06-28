import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import type {
  MemoryUnit,
  MemoryGrid,
  FileSnapshot,
  SyncResult,
  SyncOptions,
  Association,
} from '../shared/types.js';
import type { FileStore } from '../store/file-store.js';
import type { Scanner } from '../scanner/scanner.js';
import { analyzeAssociations } from './phases/associations.js';
import { detectPatterns } from './phases/patterns.js';
import { checkArchitecture } from './phases/architecture.js';
import { generateLearnings } from './phases/learning.js';

// ===== File hash utilities =====

function sha256(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex');
}

// ===== Fuzzy String Matching =====

/**
 * Jaccard similarity on bigram token sets.
 * Returns 0.0 ~ 1.0. Higher = more similar.
 */
function jaccardBigramSimilarity(a: string, b: string): number {
  const bigramsA = new Set<string>();
  const bigramsB = new Set<string>();

  for (let i = 0; i < a.length - 1; i++) bigramsA.add(a.slice(i, i + 2));
  for (let i = 0; i < b.length - 1; i++) bigramsB.add(b.slice(i, i + 2));

  if (bigramsA.size === 0 && bigramsB.size === 0) return 1.0;
  if (bigramsA.size === 0 || bigramsB.size === 0) return 0.0;

  let intersection = 0;
  for (const bg of bigramsA) {
    if (bigramsB.has(bg)) intersection++;
  }

  const union = bigramsA.size + bigramsB.size - intersection;
  return intersection / union;
}

/**
 * Dice coefficient for sequence similarity.
 * Similar to difflib — better for medium-length signatures.
 */
function diceSimilarity(a: string, b: string): number {
  const bgA = new Set<string>();
  const bgB = new Set<string>();
  for (let i = 0; i < a.length - 1; i++) bgA.add(a.slice(i, i + 2));
  for (let i = 0; i < b.length - 1; i++) bgB.add(b.slice(i, i + 2));

  if (bgA.size === 0 || bgB.size === 0) return 0;
  let intersection = 0;
  for (const bg of bgA) {
    if (bgB.has(bg)) intersection++;
  }
  return (2 * intersection) / (bgA.size + bgB.size);
}

// ===== Sync Engine =====

export class SyncEngine {
  private store: FileStore;
  private scanner: Scanner;
  private projectRoot: string;

  constructor(store: FileStore, scanner: Scanner, projectRoot: string) {
    this.store = store;
    this.scanner = scanner;
    this.projectRoot = projectRoot;
  }

  /**
   * Incremental sync: detect changed files → re-scan only those → repair associations.
   *
   * Phases:
   * 1. Hash compare — compute current hashes vs fileSnapshot
   * 2. Re-scan changed files → add/update units
   * 3. Remove units from deleted files → mark stale
   * 4. Repair broken associations via fuzzy match
   * 5. Write updated mesh.json and fileSnapshot
   */
  async sync(options: SyncOptions): Promise<SyncResult> {
    const t0 = Date.now();
    const threshold = options.fuzzyThreshold ?? 0.45;

    // Load cache
    this.store.ensureDirs();
    this.store.load();

    const grid = this.store.getGrid();
    const oldSnapshot = grid?.fileSnapshot ?? {};

    // === Phase 1: Detect diffs ===
    const sourceExts = new Set([
      '.ts',
      '.tsx',
      '.js',
      '.jsx',
      '.mjs',
      '.cjs',
      '.py',
      '.go',
      '.rs',
      '.md',
    ]);
    const testPatterns = ['.spec.', '.test.', '_test.'];
    const skipDirs = new Set(['node_modules', 'dist', '.next', 'vendor', 'target', '__pycache__']);
    const configFiles = [
      'package.json',
      'pyproject.toml',
      'go.mod',
      'Cargo.toml',
      'docker-compose.yml',
    ];

    const collectFiles = (): string[] => {
      const files: string[] = [];
      const collect = (dir: string) => {
        if (!fs.existsSync(dir)) return;
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const rel = path.relative(this.projectRoot, path.join(dir, entry.name));
          if (entry.isDirectory()) {
            if (!skipDirs.has(entry.name) && !entry.name.startsWith('.')) {
              collect(path.join(dir, entry.name));
            }
          } else {
            const ext = path.extname(entry.name);
            if (sourceExts.has(ext)) {
              if (!testPatterns.some((p) => entry.name.includes(p))) {
                files.push(rel);
              }
            } else if (configFiles.includes(entry.name)) {
              files.push(rel);
            }
          }
        }
      };

      // Scan source dirs
      ['apps', 'packages', 'src', 'lib', 'cmd', 'internal', 'pkg', 'app'].forEach((d) =>
        collect(path.join(this.projectRoot, d)),
      );

      // Rules
      if (options.includeRules) collect(path.join(this.projectRoot, '.claude', 'rules'));

      // Examples
      if (options.includeExamples) collect(path.join(this.projectRoot, '.claude', 'examples'));

      return files;
    };

    const currentFiles = collectFiles();
    const newSnapshot: FileSnapshot = {};
    const changedFiles: string[] = [];
    const removedFiles: string[] = [];

    for (const file of currentFiles) {
      const abs = path.join(this.projectRoot, file);
      const hash = sha256(fs.readFileSync(abs, 'utf-8'));
      newSnapshot[file] = hash;

      if (!oldSnapshot[file]) {
        changedFiles.push(file); // new file
      } else if (oldSnapshot[file] !== hash) {
        changedFiles.push(file); // modified
      }
    }

    // Detected removed files
    for (const oldFile of Object.keys(oldSnapshot)) {
      if (!newSnapshot[oldFile]) {
        removedFiles.push(oldFile);
      }
    }

    // No changes — fast path
    if (changedFiles.length === 0 && removedFiles.length === 0) {
      return {
        changedFiles: [],
        removedFiles: [],
        updatedUnits: 0,
        staleUnits: 0,
        repairedAssociations: 0,
        brokenAssociations: 0,
        newAssociations: 0,
        detectedPatterns: [],
        alerts: [],
        autoLearnedUnits: 0,
        elapsedMs: Date.now() - t0,
      };
    }

    // === Phase 2: Re-scan changed files ===
    let updatedUnits = 0;
    let staleUnits: number;

    if (changedFiles.length > 0) {
      // Collect all existing units whose source file is in the changed set
      const changedSet = new Set(changedFiles);
      const allUnits = await this.store.listUnits({ includeArchived: false });

      // Mark old units from changed files as stale (will be replaced or revived)
      for (const unit of allUnits) {
        if (unit.source?.file && changedSet.has(unit.source.file)) {
          // Mark as stale — we'll try to match after re-scan
          unit.meta.status = 'stale';
          this.store.saveUnit(unit);
        }
      }

      // Now do a partial scan of changed files
      // Strategy: fork the scanner's scan but only for changed files
      // Since the scanner works at project level, we do a targeted approach
      const scannedUnits = await this.scanChangedFiles(changedFiles);

      // Merge: try fuzzy-match scanned units to existing stale ones
      const staleList = allUnits.filter((u) => u.meta.status === 'stale');

      for (const newUnit of scannedUnits) {
        const matched = this.fuzzyMatchUnit(newUnit, staleList, threshold);
        if (matched) {
          // Update existing unit with new content
          matched.summary = newUnit.summary;
          matched.signatures = newUnit.signatures;
          matched.content = newUnit.content;
          matched.source = newUnit.source;
          matched.meta.status = 'active';
          matched.meta.updated = new Date().toISOString();
          this.store.saveUnit(matched);
          updatedUnits++;
        } else {
          // Completely new unit
          this.store.saveUnit(newUnit);
          updatedUnits++;
        }
      }
    } // end if (changedFiles.length > 0)

    // Count how many stale units remain unmatched
    this.store.reload();
    const remainingStale = (await this.store.listUnits()).filter(
      (u) => u.meta.status === 'stale' && u.source?.file && changedFiles.includes(u.source.file),
    );
    staleUnits = remainingStale.length;

    // === Phase 3: Handle removed files ===
    if (removedFiles.length > 0) {
      const removedSet = new Set(removedFiles);
      const allUnits = await this.store.listUnits();

      for (const unit of allUnits) {
        if (unit.source?.file && removedSet.has(unit.source.file)) {
          unit.meta.status = 'stale';
          this.store.saveUnit(unit);
          staleUnits++;
        }
      }
    }

    // === Phase 4: Repair broken associations ===
    const { repaired, broken } = await this.repairAssociations(threshold);

    // === Phase 5: Update mesh.json ===
    const allActiveUnits = await this.store.listUnits({ includeArchived: false });
    this.updateGrid(allActiveUnits, newSnapshot);

    // === Phase 6: Rebuild associations from changed code ===
    const unitMap = new Map<string, MemoryUnit>();
    for (const u of allActiveUnits) unitMap.set(u.id, u);
    const { newAssociations } = analyzeAssociations(this.projectRoot, changedFiles, unitMap);

    // === Phase 7: Detect semantic patterns ===
    const { patterns } = detectPatterns(this.projectRoot, changedFiles);

    // === Phase 8: Architecture consistency checks ===
    const { alerts } = checkArchitecture(this.projectRoot, changedFiles, unitMap);

    // === Phase 9: Learning engine — auto-create units from patterns/alerts ===
    const { autoUnitsCreated } = generateLearnings(this.store, changedFiles, patterns, alerts);

    return {
      changedFiles,
      removedFiles,
      updatedUnits,
      staleUnits,
      repairedAssociations: repaired,
      brokenAssociations: broken,
      newAssociations,
      detectedPatterns: patterns,
      alerts,
      autoLearnedUnits: autoUnitsCreated,
      elapsedMs: Date.now() - t0,
    };
  }

  /**
   * Partial scan — only re-scan changed TypeScript/markdown files.
   * Uses ts-morph for .ts files, inline parsing for .md / config.
   */
  private async scanChangedFiles(files: string[]): Promise<MemoryUnit[]> {
    const units: MemoryUnit[] = [];

    for (const file of files) {
      const abs = path.join(this.projectRoot, file);

      if (!fs.existsSync(abs)) continue;

      if (file.endsWith('.ts')) {
        // For TypeScript files, use ts-morph project (scoped to this file only)
        const { Project } = await import('ts-morph');
        const project = new Project();
        try {
          project.addSourceFileAtPath(abs);
        } catch {
          continue; // parse error — skip
        }

        for (const sourceFile of project.getSourceFiles()) {
          for (const cls of sourceFile.getClasses()) {
            const className = cls.getName();
            if (!className || cls.isAbstract()) continue;

            for (const method of cls.getMethods()) {
              const scope = method.getScope();
              if (scope !== 'public' && scope !== undefined) continue;

              const methodName = method.getName();
              const signature = `${className}.${methodName}`;
              const params = method
                .getParameters()
                .map((p) => `${p.getName()}: ${p.getType().getText()}`);
              const returnType = method.getReturnType().getText();

              units.push({
                id: `method_${this.sanitizeId(signature)}`,
                type: 'method',
                summary: `${signature} — ${this.extractJsDoc(method)}`,
                source: {
                  file,
                  lines: `${method.getStartLineNumber()}-${method.getEndLineNumber()}`,
                },
                signatures: [signature],
                content: {
                  description: this.extractJsDoc(method) || `${signature}()`,
                  inputs: params.length > 0 ? params.join(', ') : 'none',
                  outputs: returnType,
                  code_snippet: method.getText(),
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
          }

          // Exported functions
          for (const func of sourceFile.getFunctions()) {
            if (!func.isExported()) continue;
            const funcName = func.getName();
            if (!funcName) continue;

            const params = func
              .getParameters()
              .map((p) => `${p.getName()}: ${p.getType().getText()}`);
            const returnType = func.getReturnType().getText();

            units.push({
              id: `method_${this.sanitizeId(funcName)}`,
              type: 'method',
              summary: `${funcName}() — ${this.extractJsDoc(func)}`,
              source: { file, lines: `${func.getStartLineNumber()}-${func.getEndLineNumber()}` },
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
            });
          }
        }
      }

      if (
        file.endsWith('.py') ||
        file.endsWith('.js') ||
        file.endsWith('.go') ||
        file.endsWith('.rs')
      ) {
        // Non-TS language files: only tracked via hash snapshot, full re-scan on next init.
        // Incremental AST parsing for these languages requires language-specific parsers.
        continue;
      }

      if (file.endsWith('.md') && file.startsWith('.claude/rules/')) {
        // Rules — extract sections
        const content = fs.readFileSync(abs, 'utf-8');
        const sections = content.split(/^## /m).filter(Boolean);
        const safeFile = path
          .basename(file)
          .replace('.md', '')
          .replace(/[^a-zA-Z0-9_-]/g, '_')
          .replace(/_+/g, '_')
          .slice(0, 30)
          .toLowerCase();

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

          units.push({
            id: `rule_${safeFile}_${safeTitle}`,
            type: 'pattern',
            summary: `${path.basename(file).replace('.md', '')}: ${title}`,
            source: { file },
            signatures: [title, path.basename(file).replace('.md', '').replace(/-/g, ' ')],
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

        // Rule trigger
        units.push({
          id: `trigger_rule_${safeFile}`,
          type: 'rule_trigger',
          summary: `When working on ${path.basename(file).replace('.md', '').replace(/-/g, ' ')} → load ${file}`,
          source: { file },
          signatures: [path.basename(file).replace('.md', '').replace(/-/g, ' ')],
          content: {
            description: `Load ${file} when working on relevant code`,
            trigger: `Working on ${path.basename(file).replace('.md', '').replace(/-/g, ' ')} related code`,
            action: `Load ${file}`,
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

      if (file === 'package.json') {
        const pkg = JSON.parse(fs.readFileSync(abs, 'utf-8'));
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
    }

    return units;
  }

  /**
   * Fuzzy-match a newly scanned unit against an existing stale unit.
   * Returns the matching stale unit or null.
   *
   * Matching signals:
   * 1. Same source file + high signature overlap (jaccard ≥ threshold)
   * 2. Same source file + high summary similarity (dice ≥ threshold)
   * 3. Same unit id (method was renamed but we kept same id pattern)
   */
  private fuzzyMatchUnit(
    newUnit: MemoryUnit,
    staleUnits: MemoryUnit[],
    threshold: number,
  ): MemoryUnit | null {
    let bestMatch: MemoryUnit | null = null;
    let bestScore = 0;

    for (const stale of staleUnits) {
      // Must be from the same file
      if (stale.source?.file !== newUnit.source?.file) continue;

      let score = 0;

      // Signal 1: Signature overlap
      const newSigs = new Set(newUnit.signatures.map((s) => s.toLowerCase()));
      const staleSigs = new Set(stale.signatures.map((s) => s.toLowerCase()));
      let sigIntersection = 0;
      for (const sig of staleSigs) {
        if (newSigs.has(sig)) sigIntersection++;
      }
      const sigUnion = newSigs.size + staleSigs.size - sigIntersection;
      if (sigUnion > 0) {
        const sigScore = sigIntersection / sigUnion;
        score = Math.max(score, sigScore * 1.2); // weight signatures higher
      }

      // Signal 2: Summary similarity
      const summaryScore = diceSimilarity(
        newUnit.summary.toLowerCase(),
        stale.summary.toLowerCase(),
      );
      score = Math.max(score, summaryScore);

      // Signal 3: Unit id match (same "slot")
      if (newUnit.id === stale.id) {
        score = Math.max(score, 0.9); // strong signal
      }

      // Signal 4: Code snippet Jaccard content
      if (newUnit.content.code_snippet && stale.content.code_snippet) {
        const codeScore = jaccardBigramSimilarity(
          newUnit.content.code_snippet.toLowerCase(),
          stale.content.code_snippet.toLowerCase(),
        );
        // Code similarity is weaker (could be different impl same signature)
        score = Math.max(score, codeScore * 0.4);
      }

      if (score >= threshold && score > bestScore) {
        bestScore = score;
        bestMatch = stale;
      }
    }

    return bestMatch;
  }

  /**
   * Repair broken associations across all units.
   *
   * For each association whose target unit is stale/archived/missing:
   * 1. Try fuzzy match against active units by signature
   * 2. If match found → repair the link
   * 3. If no match → reduce weight, mark for eventual removal
   */
  private async repairAssociations(
    threshold: number,
  ): Promise<{ repaired: number; broken: number }> {
    const allUnits = await this.store.listUnits({ includeArchived: false });
    const unitMap = new Map<string, MemoryUnit>();
    const activeById = new Map<string, MemoryUnit>();

    for (const unit of allUnits) {
      unitMap.set(unit.id, unit);
      if (unit.meta.status === 'active') {
        activeById.set(unit.id, unit);
      }
    }

    // Build signature index of active units
    const sigIndex = new Map<string, string>(); // signature → unit id
    for (const [id, unit] of activeById) {
      for (const sig of unit.signatures) {
        sigIndex.set(sig.toLowerCase(), id);
      }
    }

    let repaired = 0;
    let broken = 0;

    for (const unit of allUnits) {
      const fixedAssociations: Association[] = [];

      for (const assoc of unit.associations) {
        const target = unitMap.get(assoc.to);

        if (target && (target.meta.status === 'active' || target.meta.status === 'archived')) {
          // Target is still valid
          fixedAssociations.push(assoc);
          continue;
        }

        // Try to find a replacement
        const replacement = this.findReplacementAssociation(assoc, activeById, sigIndex, threshold);
        if (replacement) {
          fixedAssociations.push(replacement);
          repaired++;
        } else {
          // Keep it but reduce weight — will eventually be garbage collected
          fixedAssociations.push({ ...assoc, weight: assoc.weight * 0.5 });
          broken++;
        }
      }

      if (fixedAssociations.length !== unit.associations.length) {
        unit.associations = fixedAssociations;
        this.store.saveUnit(unit);
      }
    }

    return { repaired, broken };
  }

  /**
   * Find a replacement unit for a broken association.
   * Strategy:
   * 1. Search signature index for the original unit's summary keywords
   * 2. Fuzzy match summaries against active units
   * 3. Return best match above threshold
   */
  private findReplacementAssociation(
    old: Association,
    activeById: Map<string, MemoryUnit>,
    sigIndex: Map<string, string>,
    threshold: number,
  ): Association | null {
    // Try exact signature match first
    const exact = sigIndex.get(old.to.toLowerCase());
    if (exact && exact !== old.to) {
      return { ...old, to: exact, weight: old.weight * 0.7 };
    }

    // Fuzzy search across active unit ids
    let bestId: string | null = null;
    let bestScore = 0;

    for (const [id] of activeById) {
      const score = diceSimilarity(old.to.toLowerCase(), id.toLowerCase());
      if (score >= threshold && score > bestScore) {
        bestScore = score;
        bestId = id;
      }
    }

    if (bestId) {
      return { ...old, to: bestId, weight: old.weight * bestScore };
    }

    return null;
  }

  private updateGrid(units: MemoryUnit[], fileSnapshot: FileSnapshot): void {
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
      fileSnapshot,
    };

    this.store.saveGrid(grid);
  }

  // === Helpers (delegated to scanner where possible, copied for self-contained scan) ===

  private sanitizeId(text: string): string {
    return text
      .replace(/\./g, '_')
      .replace(/[^a-zA-Z0-9_-]/g, '_')
      .replace(/_+/g, '_')
      .toLowerCase();
  }

  private extractJsDoc(node: any): string {
    const jsDocs = node.getJsDocs?.();
    if (jsDocs && jsDocs.length > 0) {
      return jsDocs[0].getDescription().trim() || '';
    }
    return '';
  }
}
