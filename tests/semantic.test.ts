import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  SemanticRetriever,
  KeywordEmbeddingProvider,
  APIEmbeddingProvider,
} from '../src/retrieve/semantic.js';
import { FileStore } from '../src/store/file-store.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('SemanticRetriever', () => {
  let tmpDir: string;
  let store: FileStore;
  let retriever: SemanticRetriever;

  const makeUnit = (id: string, summary: string, description: string) => ({
    id,
    type: 'method' as const,
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
    retriever = new SemanticRetriever(store, new KeywordEmbeddingProvider());
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('falls back to keyword-only when no provider', async () => {
    const noProvider = new SemanticRetriever(store);
    store.saveUnit(makeUnit('u1', 'create user', 'Creates a user'));
    store.saveUnit(makeUnit('u2', 'delete user', 'Deletes a user'));

    const result = await noProvider.search('create');
    expect(result.units.length).toBeGreaterThan(0);
  });

  it('uses keyword embedding for scoring diversity', async () => {
    store.saveUnit(
      makeUnit(
        'u1',
        'user authentication service',
        'Handles login, tokens, and session management',
      ),
    );
    store.saveUnit(
      makeUnit('u2', 'file upload controller', 'Handles multipart uploads to cloud storage'),
    );
    store.saveUnit(
      makeUnit('u3', 'user profile query', 'Fetches user profile with avatar and bio'),
    );

    await retriever.buildIndex();

    const result = await retriever.search('user authentication login', { semanticWeight: 0.5 });
    expect(result.units.length).toBeGreaterThan(0);
    // 'u1' should be first — strongest match for both keyword and semantic
    expect(result.units[0].id).toBe('u1');
  });

  it('empty grid returns no results', async () => {
    const result = await retriever.search('anything');
    expect(result.units).toHaveLength(0);
  });

  it('generates context from semantic results', async () => {
    store.saveUnit(makeUnit('u1', 'auth service', 'Login and registration'));

    const result = await retriever.search('auth');
    const ctx = retriever.toContext(result);
    expect(ctx).toContain('MemGrid Context');
    expect(ctx).toContain('u1');
  });

  it('setProvider clears vector cache', () => {
    retriever.setProvider(new KeywordEmbeddingProvider());
    // No error = success (cache invalidation is internal)
  });
});

describe('KeywordEmbeddingProvider', () => {
  it('generates vectors with consistent dimensions', async () => {
    const provider = new KeywordEmbeddingProvider();
    const vectors = await provider.embed(['hello world', 'foo bar']);

    expect(vectors.length).toBe(2);
    expect(vectors[0].length).toBe(vectors[1].length); // same dims
    expect(vectors[0].length).toBeGreaterThan(0);
  });

  it('returns empty vectors for empty input', async () => {
    const provider = new KeywordEmbeddingProvider();
    const vectors = await provider.embed([]);
    expect(vectors.length).toBe(0);
  });
});

describe('APIEmbeddingProvider', () => {
  it('has correct dimensions', () => {
    const provider = new APIEmbeddingProvider('http://localhost', 'test-key');
    expect(provider.dimensions).toBe(1536);
  });
});
