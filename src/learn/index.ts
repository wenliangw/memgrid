import type { MemoryUnit, MemoryUnitType } from '../shared/types.js';
import type { FileStore } from '../store/file-store.js';
import { RetrieveEngine } from '../retrieve/index.js';

export interface TaskResult {
  summary: string; // What was the task about?
  outcome: string; // What was the outcome?
  filesModified: string[]; // Files that were modified/created
  errorsEncountered?: string[]; // Any errors and how they were fixed
  decisions?: string[]; // Any design decisions made
  toolsUsed?: string[]; // MCP/skill/rules used
  styleObservations?: string[]; // Style preferences observed
}

export interface LearningSuggestions {
  add: Partial<MemoryUnit>[];
  update: { id: string; patch: Partial<MemoryUnit> }[];
  archive: string[];
  summary: string;
}

export class LearnEngine {
  private store: FileStore;
  private retrieve: RetrieveEngine;

  constructor(store: FileStore) {
    this.store = store;
    this.retrieve = new RetrieveEngine(store);
  }

  /**
   * Analyze a completed task and suggest memory grid updates.
   * This is the core "self-learning" loop — called after every task.
   */
  async analyze(task: TaskResult): Promise<LearningSuggestions> {
    const suggestions: LearningSuggestions = {
      add: [],
      update: [],
      archive: [],
      summary: '',
    };

    const summaries: string[] = [];

    // 1. Suggest new method units for modified files
    if (task.filesModified.length > 0) {
      const existingUnits = await this.store.listUnits();
      const existingFiles = new Set(
        existingUnits.filter((u) => u.source?.file).map((u) => u.source!.file),
      );

      const newFiles = task.filesModified.filter((f) => !existingFiles.has(f));

      if (newFiles.length > 0) {
        summaries.push(`🆕 ${newFiles.length} new files to scan`);
        // Don't actually scan here — just flag for memgrid init
        for (const file of newFiles) {
          suggestions.add.push({
            type: 'fact',
            summary: `[TODO] New file: ${file}`,
            narrative: `This file was created/modified in task: "${task.summary}". Run \`memgrid init\` to scan for method units.`,
            keywords: ['rescan', 'new-file'],
            source: { file },
          });
        }
      }
    }

    // 2. Suggest error_solution units
    if (task.errorsEncountered && task.errorsEncountered.length > 0) {
      for (const error of task.errorsEncountered) {
        const _id = `error_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        suggestions.add.push({
          type: 'insight',
          summary: `Error fix: ${error.slice(0, 80)}`,
          narrative: error,
          keywords: ['error', 'fix'],
        });
      }
      summaries.push(
        `🐛 ${task.errorsEncountered.length} error(s) recorded as error_solution units`,
      );
    }

    // 3. Suggest decision units
    if (task.decisions && task.decisions.length > 0) {
      for (const decision of task.decisions) {
        const _id = `decision_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        suggestions.add.push({
          type: 'insight',
          summary: decision.slice(0, 80),
          narrative: `Design decision from task "${task.summary}": ${decision}`,
          keywords: ['decision', 'design'],
        });
      }
      summaries.push(`🎯 ${task.decisions.length} decision(s) recorded`);
    }

    // 4. Suggest trigger units based on tools used
    if (task.toolsUsed && task.toolsUsed.length > 0) {
      for (const tool of task.toolsUsed) {
        // Check if a similar trigger already exists
        const existing = (await this.store.listUnits()).find(
          (u) => (u.type as string) === 'skill_trigger' && u.summary.includes(tool),
        );

        if (!existing) {
          const _id = `trigger_skill_${tool.replace(/[^a-z0-9_]/g, '_')}_${Date.now()}`;
          suggestions.add.push({
            type: 'event',
            summary: `When working on ${this.inferDomain(task.summary)} → use ${tool}`,
            narrative: `Task "${task.summary}" successfully used ${tool}. Usage context: ${this.inferDomain(task.summary)}`,
            keywords: [tool.toLowerCase(), 'tool'],
          });
        }
      }
      summaries.push(`🔧 ${task.toolsUsed.length} tool trigger(s) suggested`);
    }

    // 5. Suggest style_preference units based on observations
    if (task.styleObservations && task.styleObservations.length > 0) {
      for (const style of task.styleObservations) {
        const _id = `style_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        suggestions.add.push({
          type: 'preference',
          summary: style.slice(0, 80),
          narrative: `Observed in task "${task.summary}": ${style}`,
          keywords: ['style', 'preference'],
        });
      }
      summaries.push(`🎨 ${task.styleObservations.length} style preference(s) recorded`);
    }

    // 6. Check for units that might need archiving (stale — referenced files deleted)
    const allUnits = await this.store.listUnits();
    for (const unit of allUnits.filter((u) => u.type === 'fact')) {
      if (unit.source?.file && task.filesModified.includes(unit.source.file)) {
        // File was modified — flag for review
        suggestions.update.push({
          id: unit.id,
          patch: {
            meta: {
              ...unit.meta,
              status: 'stale',
              updated: new Date().toISOString(),
            },
          },
        });
      }
    }

    // 7. Build summary
    if (summaries.length === 0) {
      suggestions.summary = 'No significant new knowledge to add. Grid is stable for this task.';
    } else {
      suggestions.summary = summaries.join('\n');
    }

    return suggestions;
  }

  /**
   * Apply the learning suggestions to the grid.
   * v0.8+: options.status controls whether units are created as 'candidate' or 'active'.
   */
  async apply(
    suggestions: LearningSuggestions,
    options?: { status?: 'candidate' | 'active' },
  ): Promise<string[]> {
    const defaultStatus = options?.status ?? 'candidate';
    const applied: string[] = [];

    const now = new Date().toISOString();

    for (const unit of suggestions.add) {
      const status = defaultStatus;

      const fullUnit: MemoryUnit = {
        id: `auto_${unit.type}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        type: unit.type as MemoryUnitType,
        summary: unit.summary || 'Unknown',
        signatures: unit.signatures || [],
        narrative: unit.narrative || '',
        keywords: unit.keywords || [],
        source: unit.source,
        associations: [],
        meta: {
          created: now,
          updated: now,
          confidence: 0.6, // Auto-generated, lower confidence
          usage_count: 0,
          status: status,
        },
        provenance: {
          createdBy: 'ai:learn_engine',
          basedOnTask: `Task analysis: ${unit.summary}`,
          timestamp: now,
        },
      };

      this.store.saveUnit(fullUnit);
      const label = status === 'candidate' ? 'candidate' : 'active';
      applied.push(`+ ${fullUnit.id} (${label}, confidence: ${fullUnit.meta.confidence})`);
    }

    for (const { id, patch } of suggestions.update) {
      const existing = this.store.getUnit(id);
      if (existing) {
        Object.assign(existing, patch);
        existing.meta.updated = new Date().toISOString();
        this.store.saveUnit(existing);
        applied.push(`~ ${id} (updated)`);
      }
    }

    for (const id of suggestions.archive) {
      this.store.archiveUnit(id);
      applied.push(`- ${id} (archived)`);
    }

    return applied;
  }

  /**
   * Generate a plain text summary of suggestions for display/copy.
   */
  formatSuggestions(suggestions: LearningSuggestions): string {
    const lines: string[] = ['## 📋 Learning Suggestions', '', suggestions.summary, ''];

    if (suggestions.add.length > 0) {
      lines.push(`### Add (${suggestions.add.length})`, '');
      for (const unit of suggestions.add) {
        lines.push(`- [${unit.type}] ${unit.summary}`);
      }
      lines.push('');
    }

    if (suggestions.update.length > 0) {
      lines.push(`### Update (${suggestions.update.length})`, '');
      for (const { id, patch } of suggestions.update) {
        const status = (patch.meta as any)?.status || 'changed';
        lines.push(`- \`${id}\` → ${status}`);
      }
      lines.push('');
    }

    if (suggestions.archive.length > 0) {
      lines.push(`### Archive (${suggestions.archive.length})`, '');
      for (const id of suggestions.archive) {
        lines.push(`- \`${id}\``);
      }
      lines.push('');
    }

    lines.push('---', 'Run `memgrid apply-suggestions` to apply all changes.');
    return lines.join('\n');
  }

  /**
   * Infer the domain/subject area from a task summary.
   */
  private inferDomain(summary: string): string {
    const domains: Record<string, string[]> = {
      'server code': [
        'server',
        'api',
        'controller',
        'service',
        'nest',
        'typeorm',
        'postgres',
        'database',
        'auth',
      ],
      frontend: [
        'web',
        'ui',
        'component',
        'page',
        'chakra',
        'react',
        'next',
        'figma',
        'style',
        'css',
      ],
      config: ['config', 'env', 'docker', 'ci', 'deploy', 'package'],
      review: ['pr', 'review', 'merge', 'branch'],
      docs: ['docs', 'readme', 'documentation'],
      memory: ['memory', 'grid', 'atom'],
    };

    const lower = summary.toLowerCase();

    for (const [domain, keywords] of Object.entries(domains)) {
      if (keywords.some((k) => lower.includes(k))) {
        return domain;
      }
    }

    return 'generic development tasks';
  }
}
