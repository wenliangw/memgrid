import * as fs from 'fs';
import * as path from 'path';
import type { MemoryUnit, MemoryUnitType, MemoryTier } from '../shared/types.js';
import type { FileStore } from '../store/file-store.js';

interface AtomFrontmatter {
  id: string;
  type: string;
  summary: string;
  timestamp: string;
  source?: string;
  tags?: string[];
  links?: Array<{ atom?: string; agent?: string; file?: string; url?: string }>;
  status?: string;
}

/**
 * Migrate OpenClaw atom memory files (.atom.md) to MemGrid memory units.
 *
 * Scans a workspace-agent directory for memory/atoms/ and converts
 * each .atom.md file into a MemGrid MemoryUnit.
 */
export interface MigrationResult {
  filesScanned: number;
  unitsCreated: number;
  errors: number;
  migratedUnits: MemoryUnit[];
}

export function migrateAgentAtoms(
  workspacePath: string,
  store: FileStore,
  agentName: string,
): MigrationResult {
  const result: MigrationResult = {
    filesScanned: 0,
    unitsCreated: 0,
    errors: 0,
    migratedUnits: [],
  };

  const atomsDir = path.join(workspacePath, 'memory', 'atoms');
  if (!fs.existsSync(atomsDir)) {
    return result;
  }

  // Walk all atom.md files recursively
  const walkAtoms = (dir: string) => {
    if (!fs.existsSync(dir)) return;

    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        walkAtoms(fullPath);
        continue;
      }

      if (!entry.name.endsWith('.atom.md') && !entry.name.endsWith('.md')) continue;

      result.filesScanned++;

      try {
        const content = fs.readFileSync(fullPath, 'utf-8');
        const frontmatter = parseFrontmatter(content);
        const body = extractBody(content);

        if (!frontmatter || !frontmatter.id) {
          result.errors++;
          continue;
        }

        const unit = convertToMemoryUnit(frontmatter, body, agentName, fullPath);
        store.saveUnit(unit);
        result.unitsCreated++;
        result.migratedUnits.push(unit);
      } catch {
        result.errors++;
      }
    }
  };

  walkAtoms(atomsDir);
  return result;
}

/**
 * Parse YAML frontmatter (between --- and ---).
 */
function parseFrontmatter(content: string): AtomFrontmatter | null {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return null;

  const yamlBlock = match[1];
  const fm: Record<string, unknown> = {};

  // Simple YAML parser for the fields we need
  const lines = yamlBlock.split('\n');
  for (const line of lines) {
    const keyMatch = line.match(/^(\w[\w-]*):\s*(.*)/);
    if (!keyMatch) continue;
    const [, key, value] = keyMatch;
    fm[key.trim()] = value.trim();
  }

  // Parse tags: [tag1, tag2]
  const tagsMatch = yamlBlock.match(/tags:\s*\[([^\]]*)\]/);
  const tags = tagsMatch ? tagsMatch[1].split(',').map((t) => t.trim().replace(/"/g, '')) : [];

  // Parse links (simplified — count for provenance tracking)
  const _linksCount = (yamlBlock.match(/- atom:/g) || []).length +
    (yamlBlock.match(/- agent:/g) || []).length +
    (yamlBlock.match(/- file:/g) || []).length +
    (yamlBlock.match(/- url:/g) || []).length;

  return {
    id: String(fm.id || ''),
    type: String(fm.type || 'knowledge'),
    summary: String(fm.summary || ''),
    timestamp: String(fm.timestamp || new Date().toISOString()),
    source: String(fm.source || ''),
    tags,
    status: String(fm.status || 'active'),
  };
}

/**
 * Extract body content after frontmatter.
 */
function extractBody(content: string): string {
  // Remove frontmatter block (--- ... ---)
  const parts = content.split('---');
  if (parts.length >= 3) {
    return parts.slice(2).join('---').trim();
  }
  // No frontmatter — use full content
  return content.trim();
}

/**
 * Convert an atom to a MemGrid MemoryUnit.
 */
function convertToMemoryUnit(
  fm: AtomFrontmatter,
  body: string,
  agentName: string,
  sourceFile: string,
): MemoryUnit {
  const now = new Date(fm.timestamp || Date.now()).toISOString();

  // Map atom type to MemoryUnit type
  const typeMap: Record<string, MemoryUnitType> = {
    event: 'decision',
    knowledge: 'pattern',
    decision: 'decision',
    mistake: 'error_solution',
    habit: 'style_preference',
  };

  const memType: MemoryUnitType = typeMap[fm.type] || 'pattern';

  // Infer a tier from the status
  const tierMap: Record<string, MemoryTier> = {
    active: 'warm',
    archived: 'frozen',
    completed: 'cold',
  };

  const tier: MemoryTier = tierMap[fm.status || 'active'] || 'warm';

  // Build associations from links
  const associations = [];
  if (fm.tags && fm.tags.length > 0) {
    for (const tag of fm.tags) {
      associations.push({
        to: `tag:${tag}`,
        relation: 'tagged_with' as any,
        weight: 0.5,
      });
    }
  }

  // Generate a stable ID from the atom ID
  const unitId = fm.id || `migrated_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

  return {
    id: unitId,
    type: memType,
    summary: fm.summary || body.slice(0, 80),
    source: { file: sourceFile },
    signatures: fm.tags || [],
    content: {
      description: body.slice(0, 1000) || fm.summary,
      style_notes: fm.type === 'habit' ? body.slice(0, 500) : undefined,
    },
    associations: associations.slice(0, 10),
    meta: {
      created: now,
      updated: now,
      confidence: fm.status === 'active' ? 0.8 : 0.5,
      usage_count: 0,
      status: fm.status === 'archived' ? 'archived' : 'active',
      tier,
      lastAccessedAt: now,
    },
    provenance: {
      createdBy: `migration:openclaw-agent:${agentName}`,
      basedOnTask: fm.source || `Migrated from OpenClaw atom: ${fm.id}`,
      timestamp: new Date().toISOString(),
    },
  };
}
