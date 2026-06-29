import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { LearnEngine } from '../src/learn/index.js';
import { FileStore } from '../src/store/file-store.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('LearnEngine', () => {
  let tmpDir: string;
  let store: FileStore;
  let engine: LearnEngine;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'memgrid-test-'));
    store = new FileStore(tmpDir);
    store.ensureDirs();
    engine = new LearnEngine(store);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('suggests error_solution when errors encountered', async () => {
    const result = await engine.analyze({
      summary: 'Fix GLM OOM error',
      outcome: 'Switched to DeepSeek V4 Pro',
      filesModified: ['src/config.ts'],
      errorsEncountered: ['GLM 5.1 runs out of memory on 3.4G server'],
    });

    expect(result.add.length).toBeGreaterThan(0);
    expect(result.add.some((u) => u.type === 'error_solution')).toBe(true);
  });

  it('suggests decision units for design decisions', async () => {
    const result = await engine.analyze({
      summary: 'Refactor delete to return true instead of null',
      outcome: 'Updated all delete methods',
      filesModified: ['src/service.ts'],
      decisions: ['Delete should return true not null for semantic clarity'],
    });

    expect(result.add.some((u) => u.type === 'decision')).toBe(true);
  });

  it('suggests triggers for tools used', async () => {
    const result = await engine.analyze({
      summary: 'Build a Figma component',
      outcome: 'Created homepage component from Figma',
      filesModified: ['src/components/HomePage.tsx'],
      toolsUsed: ['chakra-ui MCP'],
    });

    expect(result.add.some((u) => u.type === 'skill_trigger')).toBe(true);
  });

  it('suggests style preferences', async () => {
    const result = await engine.analyze({
      summary: 'Refactor dynamic property assignment',
      outcome: 'Replaced for+any with filter+map+Object.assign',
      filesModified: ['src/domain-service.ts'],
      styleObservations: ['Prefer functional pipes over for loops'],
    });

    expect(result.add.some((u) => u.type === 'style_preference')).toBe(true);
  });

  it('flags existing method units as stale when their files are modified', async () => {
    // Add a method unit pointing to a file
    store.saveUnit({
      id: 'test_method',
      type: 'method',
      summary: 'Old create method',
      signatures: ['OldClass.create'],
      content: { description: 'Old implementation' },
      source: { file: 'src/old-service.ts' },
      associations: [],
      meta: {
        created: new Date().toISOString(),
        updated: new Date().toISOString(),
        confidence: 0.9,
        usage_count: 5,
        status: 'active',
      },
    });

    const result = await engine.analyze({
      summary: 'Update old service',
      outcome: 'Rewrote create method',
      filesModified: ['src/old-service.ts'],
    });

    expect(result.update.some((u) => u.id === 'test_method')).toBe(true);
  });

  it('returns empty suggestions for trivial tasks', async () => {
    const result = await engine.analyze({
      summary: 'Fix typo in readme',
      outcome: 'Fixed spelling',
      filesModified: ['README.md'],
    });

    // Only the new file flag, no errors/decisions/styles/tools
    expect(result.add.filter((u) => u.type === 'method').length).toBe(1);
    expect(result.add.filter((u) => u.type !== 'method').length).toBe(0);
  });

  it('apply saves units to store', async () => {
    const result = await engine.analyze({
      summary: 'Fix a bug',
      outcome: 'Fixed',
      filesModified: [],
      errorsEncountered: ['Null pointer in chapter service'],
    });

    const applied = await engine.apply(result, 0.5); // lower threshold to accept auto-generated
    expect(applied.length).toBeGreaterThan(0);

    // Verify unit was saved (v0.8: default candidate, need includeCandidate)
    const units = await store.listUnits({ includeCandidate: true });
    expect(units.some((u) => u.type === 'error_solution')).toBe(true);
  });
});
