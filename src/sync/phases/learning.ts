import type { MemoryUnit, MemoryUnitType } from '../../shared/types.js';
import type { FileStore } from '../../store/file-store.js';
import type { SyncPattern, SyncAlert } from '../../shared/types.js';

/**
 * Phase 6: Learning engine integration.
 *
 * After sync detects code changes, patterns, and architecture alerts,
 * this phase converts that raw data into learning suggestions and
 * auto-applies them to the grid.
 *
 * Unlike the LearnEngine which requires a human to provide TaskResult,
 * this phase works automatically from detected patterns and alerts.
 */
export function generateLearnings(
  store: FileStore,
  changedFiles: string[],
  patterns: SyncPattern[],
  alerts: SyncAlert[],
): { autoUnitsCreated: number } {
  let autoUnitsCreated = 0;

  // 1. Convert detected patterns into memory units
  for (const pattern of patterns) {
    if (pattern.confidence < 0.4) continue; // skip low-confidence guesses

    const unit: MemoryUnit = {
      id: `auto_${pattern.type}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      type: pattern.type as MemoryUnitType,
      summary: pattern.summary,
      source: { file: pattern.file },
      signatures: [pattern.summary],
      content: { description: pattern.summary },
      associations: [],
      meta: {
        created: new Date().toISOString(),
        updated: new Date().toISOString(),
        confidence: pattern.confidence,
        usage_count: 0,
        status: pattern.confidence >= 0.6 ? 'active' : 'stale',
      },
    };

    store.ensureDirs();
    store.saveUnit(unit);
    autoUnitsCreated++;
  }

  // 2. Convert alerts into decision/error_solution units
  for (const alert of alerts) {
    if (alert.level === 'error') {
      const unit: MemoryUnit = {
        id: `auto_error_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        type: 'error_solution',
        summary: `Architecture violation: ${alert.message.slice(0, 80)}`,
        source: { file: alert.file },
        signatures: [alert.message],
        content: {
          description: `Architecture check triggered in ${alert.file}: ${alert.message}`,
        },
        associations: [],
        meta: {
          created: new Date().toISOString(),
          updated: new Date().toISOString(),
          confidence: 0.5,
          usage_count: 0,
          status: 'stale', // needs human review
        },
      };

      store.ensureDirs();
      store.saveUnit(unit);
      autoUnitsCreated++;
    }
  }

  // 3. Mark method units from changed files for association update
  if (changedFiles.length > 0) {
    const existingUnits = store.listUnitsSync?.() || [];
    for (const unit of existingUnits) {
      if (unit.source?.file && changedFiles.includes(unit.source.file)) {
        // Flag for future confidence boost — methods in active files get +0.05 confidence
        unit.meta.confidence = Math.min(1.0, unit.meta.confidence + 0.05);
        unit.meta.usage_count++;
        store.saveUnit(unit);
      }
    }
  }

  return { autoUnitsCreated };
}
