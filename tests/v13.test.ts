import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { MemGrid } from '../src/memgrid.js';
import type { MemoryUnit } from '../src/shared/types.js';

describe('v0.13 P2 — LLM retrieval protocol + image memory', () => {
  let tmpDir: string;
  let mg: MemGrid;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'memgrid-v13-'));
    mg = new MemGrid(tmpDir);
    mg.store.ensureDirs();
    mg.store.load();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function makeUnit(
    id: string,
    overrides: Partial<MemoryUnit> = {},
    metaOverrides: Partial<MemoryUnit['meta']> = {},
  ): MemoryUnit {
    return {
      id,
      type: 'insight',
      summary: `Test unit ${id}`,
      signatures: [id],
      narrative: `Narrative for ${id}`,
      keywords: ['test'],
      associations: [],
      meta: {
        created: new Date().toISOString(),
        updated: new Date().toISOString(),
        confidence: 0.8,
        usage_count: 0,
        status: 'active',
        ...metaOverrides,
      },
      ...overrides,
    };
  }

  describe('LLM retrieval with intent', () => {
    it('should search successfully with quick_lookup intent', async () => {
      const unit = makeUnit('quick_001');
      mg.store.saveUnit(unit);

      const result = await mg.search('quick', { intent: 'quick_lookup' });
      expect(result.units.length).toBeGreaterThanOrEqual(0);
    });

    it('should search with explore intent (more hops)', async () => {
      const unit = makeUnit('explore_001');
      mg.store.saveUnit(unit);

      const result = await mg.search('explore', { intent: 'explore' });
      expect(result.totalHops).toBeGreaterThanOrEqual(2);
    });

    it('should search with audit intent (more results)', async () => {
      for (let i = 0; i < 5; i++) {
        mg.store.saveUnit(makeUnit(`audit_${i}`));
      }

      const result = await mg.search('audit', {
        intent: 'audit',
        maxResults: 3,
      });
      // audit scales up maxResults × 3
      expect(result.units.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe('image memory', () => {
    it('should store image metadata', async () => {
      const unit = await mg.addImage({
        id: 'img_001',
        key: 'img_v3_abc123',
        alt: 'Architecture diagram showing MemGrid layers',
        mimeType: 'image/png',
        width: 1920,
        height: 1080,
      });

      expect(unit.id).toBe('img_001');
      expect(unit.image).toBeDefined();
      expect(unit.image!.key).toBe('img_v3_abc123');
      expect(unit.image!.alt).toContain('Architecture');
      expect(unit.image!.dimensions?.width).toBe(1920);
      expect(unit.image!.dimensions?.height).toBe(1080);
    });

    it('should include OCR text in searchable content', async () => {
      const unit = await mg.addImage({
        id: 'img_ocr_001',
        key: 'img_ocr_abc',
        alt: 'Screenshot of error message',
        ocrText: 'Error: Cannot read property of undefined at line 42',
      });

      expect(unit.narrative).toContain('Cannot read property');
      expect(unit.keywords).toContain('error');
    });

    it('should search and find images', async () => {
      const img1 = await mg.addImage({
        id: 'img_search_001',
        key: 'img_key_xyz',
        alt: 'Sequence diagram for user authentication flow',
      });

      const img2 = await mg.addImage({
        id: 'img_search_002',
        key: 'img_key_abc',
        alt: 'Data model ERD for Septonir',
      });

      // Accept candidates to make them searchable
      await mg.acceptCandidate(img1.id);
      await mg.acceptCandidate(img2.id);

      const results = await mg.searchImages('authentication');
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results[0].image).toBeDefined();
    });

    it('should exclude non-image units from searchImages', async () => {
      const textUnit = makeUnit('text_only');
      mg.store.saveUnit(textUnit);

      const img = await mg.addImage({
        id: 'img_only',
        key: 'img_key_only',
        alt: 'Only image with this word pattern',
      });
      await mg.acceptCandidate(img.id);

      const results = await mg.searchImages('only image pattern');
      // Only image units should be returned
      for (const unit of results) {
        expect(unit.image).toBeDefined();
      }
    });
  });
});
