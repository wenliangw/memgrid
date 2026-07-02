import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { RetrieveEngine } from '../src/retrieve/index.js';
import { FileStore } from '../src/store/file-store.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('RetrieveEngine', () => {
  let tmpDir: string;
  let store: FileStore;
  let engine: RetrieveEngine;

  const makeUnit = (id: string, summary: string, description: string) => ({
    narrative: description,
    keywords: [],
    id,
    type: 'fact' as const,
    summary,
    signatures: [id],
    content: { description },
    associations: [],
    meta: {
      created: new Date().toISOString(),
      updated: new Date().toISOString(),
      confidence: 0.9,
      usage_count: 0,
      status: 'active' as const,
    },
  });

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'memgrid-test-'));
    store = new FileStore(tmpDir);
    store.ensureDirs();
    engine = new RetrieveEngine(store);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns empty result for empty grid', async () => {
    const result = await engine.search('anything');
    expect(result.units).toHaveLength(0);
  });

  it('finds units by summary keyword', async () => {
    store.saveUnit(makeUnit('u1', 'create user', 'Creates a new user in the database'));
    store.saveUnit(makeUnit('u2', 'delete user', 'Removes a user from the system'));

    const result = await engine.search('create', 10, 1);
    expect(result.units.length).toBeGreaterThan(0);
    expect(result.units.some((u) => u.id === 'u1')).toBe(true);
  });

  it('ranks by relevance', async () => {
    store.saveUnit(makeUnit('u1', 'user authentication', 'Handles login and token generation'));
    store.saveUnit(makeUnit('u2', 'file upload', 'Handles file uploads to S3'));
    store.saveUnit(makeUnit('u3', 'user profile', 'Manages user profile information'));

    const result = await engine.search('user login', 10, 1);
    const firstMatch = result.units[0];
    expect(firstMatch.id).toBe('u1'); // 'user authentication' matches both 'user' and 'login'
  });

  it('generates context markdown', async () => {
    store.saveUnit(makeUnit('u1', 'create user', 'Creates a new user'));

    const result = await engine.search('create');
    const context = engine.toContext(result);

    expect(context).toContain('Found');
    expect(context).toContain('u1');
    expect(context).toContain('Creates a new user');
  });

  it('updateIndex makes newly saved units searchable immediately', async () => {
    store.saveUnit(makeUnit('u1', 'dog adoption', 'How to adopt a dog'));
    // Ensure index is built first time
    const resultBefore = await engine.search('cat');
    expect(resultBefore.units).toHaveLength(0);

    // Add new unit and update index
    const newUnit = makeUnit('u2', 'cat adoption', 'How to adopt a cat');
    store.saveUnit(newUnit);
    engine.updateIndex(newUnit);

    // Now it should be searchable
    const resultAfter = await engine.search('cat');
    expect(resultAfter.units.length).toBeGreaterThan(0);
    expect(resultAfter.units.some((u) => u.id === 'u2')).toBe(true);
  });
});
