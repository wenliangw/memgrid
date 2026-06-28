import type { MemoryUnit, ScanOptions } from '../shared/types.js';

/**
 * Scanner interface — scan a project directory and produce memory units.
 *
 * MemGrid is language-agnostic. Each language/framework gets its own
 * Scanner implementation. Scanners are composed via CompositeScanner.
 *
 * Implementations:
 * - TypeScriptScanner — ts-morph AST extraction
 * - (future) PythonScanner, GoScanner, MarkdownScanner, ComponentScanner...
 */
export interface Scanner {
  /** Human-readable name for CLI output */
  readonly name: string;

  /**
   * Scan the configured project and return memory units.
   * Called once during init, or per-changed-file during sync.
   */
  scan(options: ScanOptions): Promise<MemoryUnit[]>;

  /**
   * Scan only specific files (used by incremental sync).
   * Default implementation: returns empty array (scanner doesn't support partial).
   * Override for scanners that can parse individual files.
   */
  scanFiles?(files: string[], options: ScanOptions): Promise<MemoryUnit[]>;

  /**
   * Detect whether this scanner applies to the given project.
   * e.g. TypeScriptScanner checks for tsconfig.json or .ts files.
   * Used by auto-detection in CLI.
   */
  detect(projectRoot: string): boolean;
}
