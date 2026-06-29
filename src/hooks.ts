import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * MemGrid hooks auto-configuration.
 *
 * `memgrid init` calls this to set up automatic memory sync hooks.
 * All injections are non-destructive — existing config is preserved.
 *
 * v0.8+: Sync failures are logged to .claude/memory-grid/sync.log
 * instead of being silently swallowed.
 */

interface SettingsJson {
  hooks?: {
    PostCompletion?: Array<{
      matcher?: string;
      hooks: Array<{ type: string; command: string }>;
    }>;
    PostToolUse?: Array<{
      matcher?: string;
      hooks: Array<{ type: string; command: string }>;
    }>;
  };
  [key: string]: unknown;
}

export interface InjectResult {
  /** Which hooks were configured */
  actions: string[];
  /** Per-hook status */
  details: {
    claudeSettings?: 'created' | 'merged' | 'already_exists';
    postCommit?: 'created' | 'already_exists' | 'not_hooky_project';
  };
}

/**
 * Return the sync log path for a project.
 */
function syncLogPath(projectRoot: string): string {
  return path.join(projectRoot, '.claude', 'memory-grid', 'sync.log');
}

/**
 * Log a sync event to the sync log file.
 */
export function logSyncEvent(
  projectRoot: string,
  event: 'start' | 'success' | 'failure' | 'skipped',
  details?: string,
): void {
  try {
    const logDir = path.dirname(syncLogPath(projectRoot));
    if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });

    const timestamp = new Date().toISOString();
    const hostname = os.hostname();
    const line =
      `[${timestamp}] [${hostname}] ${event.toUpperCase()}` + (details ? ` ${details}` : '') + '\n';

    fs.appendFileSync(syncLogPath(projectRoot), line, 'utf-8');
  } catch {
    // Log writing itself should never fail silently — but if it does, at least
    // the sync command itself will still run and produce stderr.
  }
}

/**
 * Shell command fragment for sync hooks.
 * Logs start/failure; success is logged by the sync CLI itself (see cli.ts).
 */
export const SYNC_COMMAND = [
  'SYNC_LOG=".claude/memory-grid/sync.log"',
  'mkdir -p "$(dirname "$SYNC_LOG")"',
  'echo "[$(date -Iseconds)] [$(hostname)] SYNC_START" >> "$SYNC_LOG"',
  'if npx memgrid sync --quiet; then',
  '  echo "[$(date -Iseconds)] [$(hostname)] SYNC_SUCCESS" >> "$SYNC_LOG"',
  'else',
  '  EXIT_CODE=$?',
  '  echo "[$(date -Iseconds)] [$(hostname)] SYNC_FAILURE exit=$EXIT_CODE" >> "$SYNC_LOG"',
  '  echo "⚠️  memgrid sync failed (exit $EXIT_CODE) — see $SYNC_LOG for details" >&2',
  'fi',
].join('\n');

/**
 * Inject MemGrid sync hooks into the project.
 *
 * Two hooks:
 * 1. .claude/settings.json → PostCompletion: auto-sync after Claude finishes a task
 * 2. .git/hooks/post-commit → auto-sync after git commit (covers non-Claude changes)
 */
export function injectHooks(projectRoot: string): InjectResult {
  const result: InjectResult = {
    actions: [],
    details: {},
  };

  // 1. Claude PostCompletion hook
  const claudeResult = injectClaudeHook(projectRoot);
  result.details.claudeSettings = claudeResult;
  if (claudeResult !== 'already_exists') {
    result.actions.push('claude-post-completion');
  }

  // 2. Git post-commit hook
  const gitResult = injectGitHook(projectRoot);
  result.details.postCommit = gitResult;
  if (gitResult === 'created') {
    result.actions.push('git-post-commit');
  }

  return result;
}

/**
 * Inject PostCompletion hook into .claude/settings.json.
 * Non-destructive: merges with existing config.
 *
 * v0.8+: Sync command logs to .claude/memory-grid/sync.log — no silent failures.
 */
function injectClaudeHook(projectRoot: string): 'created' | 'merged' | 'already_exists' {
  const settingsPath = path.join(projectRoot, '.claude', 'settings.json');

  // Existing settings?
  if (fs.existsSync(settingsPath)) {
    try {
      const existing = JSON.parse(fs.readFileSync(settingsPath, 'utf-8')) as SettingsJson;

      // Already has PostCompletion with memgrid sync?
      if (
        existing.hooks?.PostCompletion?.some((h) =>
          h.hooks.some((hook) => hook.command.includes('memgrid sync')),
        )
      ) {
        return 'already_exists';
      }

      // Merge: add PostCompletion hook
      if (!existing.hooks) existing.hooks = {};
      if (!existing.hooks.PostCompletion) existing.hooks.PostCompletion = [];

      existing.hooks.PostCompletion.push({
        hooks: [
          {
            type: 'command',
            command: SYNC_COMMAND,
          },
        ],
      });

      fs.writeFileSync(settingsPath, JSON.stringify(existing, null, 2) + '\n', 'utf-8');
      return 'merged';
    } catch {
      // Invalid JSON — skip
      return 'already_exists';
    }
  }

  // Create fresh .claude/settings.json
  const dir = path.dirname(settingsPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const settings: SettingsJson = {
    $schema: 'https://json.schemastore.org/claude-code-settings.json',
    hooks: {
      PostCompletion: [
        {
          hooks: [
            {
              type: 'command',
              command: SYNC_COMMAND,
            },
          ],
        },
      ],
    },
  };

  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n', 'utf-8');
  return 'created';
}

/**
 * Inject post-commit hook for non-Claude changes (git commit by human or other tools).
 *
 * Creates .git/hooks/post-commit if it doesn't exist.
 * If husky is detected, creates .husky/post-commit instead.
 *
 * v0.8+: Sync command logs to sync.log — no silent failures.
 */
function injectGitHook(projectRoot: string): 'created' | 'already_exists' | 'not_hooky_project' {
  const huskyDir = path.join(projectRoot, '.husky');
  const gitHookPath = path.join(projectRoot, '.git', 'hooks', 'post-commit');

  const syncCmd =
    'npx memgrid sync --quiet >> .claude/memory-grid/sync.log 2>&1 || { echo "[$(date -Iseconds)] [$(hostname)] SYNC_FAILURE" >> .claude/memory-grid/sync.log; echo "⚠️  memgrid sync failed — see .claude/memory-grid/sync.log" >&2; }';

  // Check husky first
  if (fs.existsSync(huskyDir)) {
    const huskyHookPath = path.join(huskyDir, 'post-commit');
    if (fs.existsSync(huskyHookPath)) {
      return 'already_exists';
    }
    try {
      const hookContent = [
        '#!/usr/bin/env sh',
        '',
        '# MemGrid: auto-sync memory grid after commit',
        syncCmd,
        '',
      ].join('\n');

      fs.writeFileSync(huskyHookPath, hookContent, { mode: 0o755 });
      return 'created';
    } catch {
      return 'not_hooky_project';
    }
  }

  // Fallback: native git hook
  const hooksDir = path.dirname(gitHookPath);
  if (!fs.existsSync(hooksDir)) return 'not_hooky_project';

  if (fs.existsSync(gitHookPath)) {
    return 'already_exists';
  }

  try {
    const hookContent = [
      '#!/bin/sh',
      '',
      '# MemGrid: auto-sync memory grid after commit',
      syncCmd,
      '',
    ].join('\n');

    fs.writeFileSync(gitHookPath, hookContent, { mode: 0o755 });
    return 'created';
  } catch {
    return 'not_hooky_project';
  }
}
