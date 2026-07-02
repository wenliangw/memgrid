import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { MemGrid } from '../src/memgrid.js';
import { ExtractEngine } from '../src/extract/index.js';

// Integration tests for lang + anchor features
// These test MemGrid add() with real temp file stores

describe('Metacognitive Anchor', () => {
  let tmpDir: string;
  let mg: MemGrid;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'memgrid-anchor-'));
    mg = new MemGrid(tmpDir);
    mg.store.ensureDirs();
    mg.store.load();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates an anchor memory unit with high confidence', async () => {
    const unit = await mg.add({
      id: 'anchor_test_001',
      type: 'preference' as const,
      summary: '🔴 元认知铁律：每轮对话后必须立即主动写入记忆',
      narrative: '每轮和用户的实质性对话结束后，必须立刻调用 memgrid_add 写入值得记住的信息。',
      meta: {
        confidence: 1.0,
        status: 'active',
      },
      provenance: {
        createdBy: 'memgrid:init-anchor',
        timestamp: new Date().toISOString(),
      },
      keywords: ['元认知', '铁律', '记忆', '写入'],
    });

    expect(unit).toBeDefined();
    expect(unit.type).toBe('preference');
    expect(unit.meta.confidence).toBe(1.0);
    expect(unit.meta.status).toBe('active');
    expect(unit.summary).toContain('元认知铁律');
  });

  it('stores anchor with active status (not candidate)', async () => {
    const unit = await mg.add({
      id: 'anchor_active_002',
      type: 'preference' as const,
      summary: 'Metacognitive Iron Law',
      narrative: 'Always write memories after every turn.',
      meta: { confidence: 1.0, status: 'active' },
      provenance: {
        createdBy: 'memgrid:init-anchor',
        timestamp: new Date().toISOString(),
      },
      keywords: ['metacognitive', 'memory'],
    });

    const retrieved = mg.store.getUnit(unit.id);
    expect(retrieved).toBeDefined();
    expect(retrieved?.meta.status).toBe('active');
    expect(retrieved?.meta.confidence).toBe(1.0);
  });

  it('creates English anchor summary', async () => {
    const unit = await mg.add({
      id: 'anchor_en_003',
      type: 'preference' as const,
      summary: '🔴 Metacognitive Iron Law: Actively write memories after EVERY conversation turn',
      narrative: 'After every substantive conversation turn, you MUST immediately write memories.',
      meta: { confidence: 1.0, status: 'active' },
      provenance: {
        createdBy: 'memgrid:init-anchor',
        timestamp: new Date().toISOString(),
      },
      keywords: ['metacognitive', 'iron-law', 'memory'],
    });

    expect(unit.summary).toContain('Metacognitive Iron Law');
    expect(unit.summary).toContain('🔴');
    expect(unit.keywords).toContain('metacognitive');
  });

  it('detects duplicate anchor by summary', () => {
    mg.store.saveUnit({
      id: 'existing_anchor',
      type: 'preference',
      domain: 'cognition',
      summary: '🔴 元认知铁律：每轮对话后必须立即主动写入记忆',
      narrative: '描述...',
      keywords: ['元认知'],
      signatures: [],
      associations: [],
      meta: {
        created: new Date().toISOString(),
        updated: new Date().toISOString(),
        confidence: 1.0,
        usage_count: 0,
        status: 'active',
      },
      provenance: {
        createdBy: 'memgrid:init-anchor',
        timestamp: new Date().toISOString(),
      },
    });

    // listUnitsSync should find it
    const units = mg.store.listUnitsSync();
    const anchors = units.filter((u) => u.summary?.includes('元认知铁律'));
    expect(anchors.length).toBe(1);
  });
});

describe('Extract Engine Language Support', () => {
  let tmpDir: string;
  let mg: MemGrid;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'memgrid-lang-'));
    mg = new MemGrid(tmpDir);
    mg.store.ensureDirs();
    mg.store.load();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('zh extract detects Chinese decision patterns', () => {
    // Use the actual ExtractEngine from source
    // imported at top
    const engine = new ExtractEngine({ lang: 'zh' });

    const text = '我们决定用 Rust 作为主要开发语言。最终方案是用 axum 做 HTTP 框架。';
    const result = engine.extract(text);

    expect(result.raw.length).toBeGreaterThan(0);
    const decisions = result.raw.filter((c) => c.type === 'insight');
    expect(decisions.length).toBeGreaterThan(0);
  });

  it('zh extract detects Chinese preference patterns', () => {
    // imported at top
    const engine = new ExtractEngine({ lang: 'zh' });

    const text = '以后都用 Rust 写后端。禁止使用 any 类型。必须检查所有输入。';
    const result = engine.extract(text);

    const prefs = result.raw.filter((c) => c.type === 'preference');
    expect(prefs.length).toBeGreaterThan(0);
  });

  it('zh extract detects Chinese event patterns', () => {
    // imported at top
    const engine = new ExtractEngine({ lang: 'zh' });

    const text = 'v1.0 发布了。测试全绿。PR #50 合并完成。';
    const result = engine.extract(text);

    const events = result.raw.filter((c) => c.type === 'event');
    expect(events.length).toBeGreaterThan(0);
  });

  it('en extract still works with default lang', () => {
    // imported at top
    const engine = new ExtractEngine({ lang: 'en' });

    const text =
      'We decided to use Rust. From now on we always use cargo clippy. v2.0 was released today.';
    const result = engine.extract(text);

    expect(result.raw.length).toBeGreaterThan(0);
  });

  it('zh extract detects Chinese fact patterns', () => {
    // imported at top
    const engine = new ExtractEngine({ lang: 'zh' });

    const text = '技术栈是 Rust + axum。仓库在 github.com/wenliangw/mmos。部署在端口 8877。';
    const result = engine.extract(text);

    const facts = result.raw.filter((c) => c.type === 'fact');
    expect(facts.length).toBeGreaterThan(0);
  });
});
