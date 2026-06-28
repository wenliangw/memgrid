import * as fs from 'fs';
import * as path from 'path';

/**
 * MemGrid hooks auto-configuration.
 *
 * `memgrid init` calls this to set up automatic memory sync hooks.
 * All injections are non-destructive — existing config is preserved.
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
            command:
              'npx memgrid sync --quiet 2>/dev/null || echo "memgrid sync skipped (memgrid not installed)"',
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
              command:
                'npx memgrid sync 2>/dev/null || echo "⚠️ memgrid sync failed — run memgrid init to set up"',
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
 */
function injectGitHook(projectRoot: string): 'created' | 'already_exists' | 'not_hooky_project' {
  const huskyDir = path.join(projectRoot, '.husky');
  const gitHookPath = path.join(projectRoot, '.git', 'hooks', 'post-commit');

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
        'npx memgrid sync --quiet 2>/dev/null || true',
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
      'npx memgrid sync --quiet 2>/dev/null || true',
      '',
    ].join('\n');

    fs.writeFileSync(gitHookPath, hookContent, { mode: 0o755 });
    return 'created';
  } catch {
    return 'not_hooky_project';
  }
}
