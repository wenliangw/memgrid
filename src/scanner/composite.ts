import type { MemoryUnit, ScanOptions } from '../shared/types.js';
import type { Scanner } from './scanner.js';

/**
 * CompositeScanner composes multiple language-specific scanners.
 * Detects which scanners apply to a project and runs them in parallel.
 */
export class CompositeScanner implements Scanner {
  readonly name = 'composite';
  private scanners: Scanner[];
  private projectRoot: string;

  constructor(projectRoot: string, scanners?: Scanner[]) {
    this.projectRoot = projectRoot;
    this.scanners = scanners ?? [];
  }

  /** Register a scanner (call before scan) */
  register(scanner: Scanner): void {
    this.scanners.push(scanner);
  }

  /** Auto-detect applicable scanners from a candidate list */
  autoDetect(candidates: Scanner[]): void {
    for (const scanner of candidates) {
      if (scanner.detect(this.projectRoot)) {
        this.scanners.push(scanner);
      }
    }
  }

  /** Return list of registered scanner names */
  get activeScanners(): string[] {
    return this.scanners.map((s) => s.name);
  }

  async scan(options: ScanOptions): Promise<MemoryUnit[]> {
    const units: MemoryUnit[] = [];

    // Run all scanners in parallel
    const results = await Promise.all(this.scanners.map((s) => s.scan(options)));

    for (const result of results) {
      units.push(...result);
    }

    return units;
  }

  /**
   * Partial scan — delegate to scanners that support scanFiles.
   * For scanners without scanFiles support, skip (full re-scan on changed files
   * handled by SyncEngine separately).
   */
  async scanFiles(files: string[], options: ScanOptions): Promise<MemoryUnit[]> {
    const units: MemoryUnit[] = [];

    // Only scanners that support incremental scan
    const results = await Promise.all(
      this.scanners.filter((s) => s.scanFiles).map((s) => s.scanFiles!(files, options)),
    );

    for (const result of results) {
      units.push(...result);
    }

    return units;
  }

  detect(): boolean {
    return this.scanners.length > 0;
  }
}
