import * as fs from 'fs';
import * as path from 'path';
import type { SyncPattern } from '../../shared/types.js';

/**
 * Phase 4: Detect semantic patterns from code changes.
 *
 * Reads changed files and identifies:
 * - New error handling patterns (try-catch, BusinessException)
 * - New design patterns (Builder, decorator usage)
 * - New architecture decisions (config changes, new dependencies)
 */
export function detectPatterns(
  projectRoot: string,
  changedFiles: string[],
): { patterns: SyncPattern[] } {
  const patterns: SyncPattern[] = [];

  for (const file of changedFiles) {
    const abs = path.join(projectRoot, file);
    if (!fs.existsSync(abs)) continue;

    try {
      const code = fs.readFileSync(abs, 'utf-8');

      // Detect new try-catch blocks → error_solution
      if (code.includes('try {') && code.includes('catch')) {
        const match = code.match(/catch\s*\(([^)]*)\)\s*\{([^}]*)\}/);
        if (match) {
          patterns.push({
            type: 'insight',
            summary: `Error handling pattern in ${path.basename(file)}`,
            file,
            confidence: 0.4,
          });
        }
      }

      // Detect throw new BusinessException → error_solution
      const businessExRe = /throw new\s+(\w*[Ee]xception\w*)\s*\(/g;
      let bMatch;
      while ((bMatch = businessExRe.exec(code)) !== null) {
        patterns.push({
          type: 'insight',
          summary: `${bMatch[1]} thrown in ${path.basename(file)}`,
          file,
          confidence: 0.5,
        });
      }

      // Detect @Injectable/@Module/@Controller → NestJS pattern
      if (code.includes('@Injectable()')) {
        patterns.push({
          type: 'insight',
          summary: `Injectable service in ${path.basename(file)}`,
          file,
          confidence: 0.6,
        });
      }

      if (code.includes('@Module(')) {
        patterns.push({
          type: 'insight',
          summary: `NestJS Module: ${path.basename(file)}`,
          file,
          confidence: 0.7,
        });
      }

      // Detect Builder pattern
      if (code.includes('extends') && code.includes('builder') && code.includes('return this')) {
        patterns.push({
          type: 'insight',
          summary: `Builder pattern in ${path.basename(file)}`,
          file,
          confidence: 0.5,
        });
      }

      // Detect new imports of infrastructure patterns
      if (code.includes("from '@nestjs/common'") && code.includes('forwardRef')) {
        patterns.push({
          type: 'insight',
          summary: `forwardRef() used in ${path.basename(file)} — may indicate circular dependency`,
          file,
          confidence: 0.3,
        });
      }

      // Detect strategy/template method pattern via abstract classes
      if (code.includes('abstract class') && code.includes('extends')) {
        patterns.push({
          type: 'insight',
          summary: `Strategy/Template pattern in ${path.basename(file)}`,
          file,
          confidence: 0.4,
        });
      }
    } catch {
      // skip
    }
  }

  // Deduplicate by summary
  const seen = new Set<string>();
  const unique = patterns.filter((p) => {
    const key = p.summary;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return { patterns: unique };
}
