import * as fs from 'fs';
import * as path from 'path';
import type { MemoryUnit, SyncAlert } from '../../shared/types.js';

/**
 * Phase 5: Architecture consistency checks.
 *
 * Scans changed files for violations against known architecture principles
 * stored in the memory grid. Uses heuristic matching because full AST analysis
 * of foreign languages is not available at sync time.
 */
export function checkArchitecture(
  projectRoot: string,
  changedFiles: string[],
  allUnits: Map<string, MemoryUnit>,
): { alerts: SyncAlert[] } {
  const alerts: SyncAlert[] = [];

  // Collect all architecture_principle units
  const principles = Array.from(allUnits.values()).filter(
    (u) => u.type === 'preference' && u.meta.status === 'active',
  );

  for (const file of changedFiles) {
    const abs = path.join(projectRoot, file);
    if (!fs.existsSync(abs)) continue;

    try {
      const code = fs.readFileSync(abs, 'utf-8');

      // Check each principle against changed code
      for (const principle of principles) {
        if (checkPrincipleViolation(code, principle, file)) {
          alerts.push({
            level: 'error',
            message: principle.summary,
            file,
            principle: principle.id,
          });
        }
      }

      // Built-in checks (no principle unit needed)

      // forwardRef() usage
      if (code.includes('forwardRef(')) {
        alerts.push({
          level: 'warning',
          message:
            'forwardRef() detected — may indicate circular dependency. Consider restructuring imports.',
          file,
        });
      }

      // 'as any' type assertion
      if (code.includes(' as any') || code.includes('as any;')) {
        alerts.push({
          level: 'warning',
          message:
            "'as any' type assertion detected — use proper types or 'as unknown as T' instead.",
          file,
        });
      }

      // try-catch with empty catch body
      if (/try\s*\{[\s\S]*?\}\s*catch\s*\([^)]*\)\s*\{\s*\}/.test(code)) {
        alerts.push({
          level: 'warning',
          message: 'Empty catch block detected — errors are being silently swallowed.',
          file,
        });
      }
    } catch {
      // skip
    }
  }

  // Deduplicate alerts by message+file
  const seen = new Set<string>();
  const unique = alerts.filter((a) => {
    const key = `${a.message}::${a.file}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return { alerts: unique };
}

/**
 * Check if a code change violates a specific architecture principle.
 * Uses text matching — crude but effective for well-written principles.
 */
function checkPrincipleViolation(code: string, principle: MemoryUnit, _file: string): boolean {
  const text = (principle.summary + ' ' + (principle.narrative || '')).toLowerCase();

  // forwardRef ban
  if (text.includes('forwardref') && text.includes('禁止') && code.includes('forwardRef(')) {
    return true;
  }

  // try-catch ban
  if (
    text.includes('try-catch') &&
    text.includes('禁止') &&
    code.includes('try {') &&
    code.includes('catch')
  ) {
    // Not all try-catch is banned — only if the principle says so explicitly
    // Check if the principle mentions "吞错误" or "swallow"
    if (text.includes('吞') || text.includes('swallow')) {
      if (/catch\s*\([^)]*\)\s*\{\s*\}/.test(code)) {
        return true; // empty catch → violation
      }
    }
  }

  // Direct fs import
  if (
    text.includes('fs') &&
    text.includes('直接') &&
    code.includes("from 'fs'") &&
    !code.includes('fs/promises')
  ) {
    return true;
  }

  return false;
}
