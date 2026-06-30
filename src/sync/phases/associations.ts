import * as fs from 'fs';
import * as path from 'path';
import type { MemoryUnit } from '../../shared/types.js';

/**
 * Phase 3: Rebuild associations for changed files.
 *
 * When code changes, existing associations (calls, imports, dependencies)
 * may become stale. This phase re-analyzes changed files and updates
 * method units with fresh associations.
 */
export function analyzeAssociations(
  projectRoot: string,
  changedFiles: string[],
  units: Map<string, MemoryUnit>,
): { newAssociations: number } {
  let newAssociations = 0;

  const unitByFile = new Map<string, MemoryUnit[]>();
  for (const unit of units.values()) {
    if (!unit.source?.file) continue;
    const list = unitByFile.get(unit.source.file) || [];
    list.push(unit);
    unitByFile.set(unit.source.file, list);
  }

  for (const file of changedFiles) {
    const abs = path.join(projectRoot, file);
    if (!fs.existsSync(abs)) continue;
    if (!file.endsWith('.ts') && !file.endsWith('.tsx')) continue;

    try {
      const code = fs.readFileSync(abs, 'utf-8');
      const importMap = buildImportMap(file, code, projectRoot);
      const callMap = buildCallMap(code);

      const fileUnits = unitByFile.get(file) || [];
      for (const unit of fileUnits) {
        if (unit.type !== 'fact') continue;

        // Clear old associations (after task, rebuild fresh)
        const oldCount = unit.associations.length;
        unit.associations = [];

        // Add dependencies from imports
        for (const [importName, sourceFile] of importMap) {
          if (
            !unit.signatures.some((s) => s.includes(importName)) &&
            !unit.keywords?.includes(importName.toLowerCase())
          )
            continue;
          const targetUnitId = findUnitByFile(units, sourceFile, importName);
          if (targetUnitId) {
            unit.associations.push({
              to: targetUnitId,
              relation: 'calls',
              weight: 0.7,
            });
          }
        }

        // Add calls from call graph
        const calls = callMap.get(unit.id) || [];
        for (const callee of calls) {
          const targetId = findUnitBySignature(units, callee);
          if (targetId && targetId !== unit.id) {
            if (!unit.associations.some((a) => a.to === targetId)) {
              unit.associations.push({
                to: targetId,
                relation: 'calls',
                weight: 0.6,
              });
            }
          }
        }

        // Detect imports of architecture patterns
        for (const [importName] of importMap) {
          if (importName === 'Module' && code.includes('@Module(')) {
            const moduleUnits = fileUnits.filter(
              (u) => u.summary.includes('Module') || u.id.includes('_module'),
            );
            for (const moduleUnit of moduleUnits) {
              if (moduleUnit.id !== unit.id) {
                unit.associations.push({
                  to: moduleUnit.id,
                  relation: 'belongs_to_module',
                  weight: 0.5,
                });
              }
            }
          }
        }

        if (unit.associations.length > oldCount) {
          newAssociations += unit.associations.length - oldCount;
        } else if (oldCount > 0 && unit.associations.length === 0) {
          // Associations were rebuilt but total count changed - track delta
          newAssociations += unit.associations.length;
        }
      }
    } catch {
      // Skip unparseable files
    }
  }

  return { newAssociations };
}

/**
 * Build a map of imported names → their source file paths.
 */
function buildImportMap(
  currentFile: string,
  code: string,
  projectRoot: string,
): Map<string, string> {
  const map = new Map<string, string>();

  // Match: import { X, Y } from './foo'
  const namedImportRe = /import\s*\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g;
  let match;
  while ((match = namedImportRe.exec(code)) !== null) {
    const names = match[1]
      .split(',')
      .map((n) => n.trim())
      .filter(Boolean);
    const source = match[2];

    if (source.startsWith('.')) {
      const absSource = resolveRelativeImport(currentFile, source, projectRoot);
      for (const name of names) {
        map.set(name, absSource);
      }
    }
  }

  // Match: import X from './foo'
  const defaultImportRe = /import\s+(\w+)\s+from\s+['"]([^'"]+)['"]/g;
  while ((match = defaultImportRe.exec(code)) !== null) {
    const name = match[1];
    const source = match[2];
    if (source.startsWith('.')) {
      map.set(name, resolveRelativeImport(currentFile, source, projectRoot));
    }
  }

  return map;
}

/**
 * Resolve a relative import path to an absolute file path.
 * Handles barrel exports (./foo → ./foo/index.ts).
 */
function resolveRelativeImport(
  currentFile: string,
  importPath: string,
  projectRoot: string,
): string {
  const currentDir = path.dirname(path.join(projectRoot, currentFile));
  const resolved = path.resolve(currentDir, importPath);

  // Try exact path with .ts extension
  if (fs.existsSync(resolved + '.ts')) return resolved + '.ts';
  if (fs.existsSync(resolved + '.tsx')) return resolved + '.tsx';

  // Try barrel export (directory → index.ts)
  if (fs.existsSync(path.join(resolved, 'index.ts'))) {
    return path.join(resolved, 'index.ts');
  }
  if (fs.existsSync(path.join(resolved, 'index.tsx'))) {
    return path.join(resolved, 'index.tsx');
  }

  return resolved + '.ts'; // best guess
}

/**
 * Build a map of unit ID → called function names.
 */
function buildCallMap(code: string): Map<string, string[]> {
  const map = new Map<string, string[]>();

  // Match this.xxxService.yyy() calls
  const thisCallRe = /this\.(\w+)\.(\w+)\s*\(/g;
  let match;
  while ((match = thisCallRe.exec(code)) !== null) {
    const receiver = match[1];
    const method = match[2];
    const calls = map.get(receiver) || [];
    calls.push(method);
    map.set(receiver, calls);
  }

  return map;
}

/**
 * Find a unit by its source file and exported name.
 */
function findUnitByFile(
  units: Map<string, MemoryUnit>,
  targetFile: string,
  importName: string,
): string | null {
  // Normalize: strip projectRoot prefix
  const normalized = targetFile.replace(/\\/g, '/');

  // Try exact file match + signature match
  for (const unit of units.values()) {
    if (!unit.source?.file) continue;
    const unitFile = unit.source.file.replace(/\\/g, '/');
    if (normalized.endsWith(unitFile) || unitFile.endsWith(normalized)) {
      if (unit.signatures.some((s) => s.includes(importName))) {
        return unit.id;
      }
    }
  }

  // Try signature-only match (for packages like @nestjs/common)
  for (const unit of units.values()) {
    if (unit.signatures.some((s) => s.toLowerCase().includes(importName.toLowerCase()))) {
      return unit.id;
    }
  }

  return null;
}

/**
 * Find a unit by its signature (method name).
 */
function findUnitBySignature(units: Map<string, MemoryUnit>, name: string): string | null {
  const lower = name.toLowerCase();
  for (const unit of units.values()) {
    if (unit.signatures.some((s) => s.toLowerCase().includes(lower))) {
      return unit.id;
    }
  }
  return null;
}
